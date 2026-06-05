from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse, urldefrag

import httpx
from sqlmodel import select

from pwnyhub_engine.db import HarEntry, Project, Source, get_session
from pwnyhub_engine.har_import import (
    build_entry_fingerprint,
    build_shape_fingerprint,
    is_asset_mime,
    sanitize_headers,
)

MODULE = {
    "id": "safe_crawler",
    "name": "Safe Scope Crawler",
    "kind": "active_safe",
    "targets": ["project", "sources", "actions"],
    "description": (
        "Scope-aware, rate-limited GET crawler that stores discovered requests as a new "
        "PwnyHub Source and feeds the normal actions/risk/policy pipeline."
    ),
    "params_schema": {
        "seed_urls": {
            "type": "string",
            "default": "",
            "description": "One seed URL per line. Must be in scope.",
        },
        "max_pages": {
            "type": "int",
            "default": 80,
            "min": 1,
            "max": 1000,
            "description": "Maximum pages/URLs to request.",
        },
        "max_depth": {
            "type": "int",
            "default": 2,
            "min": 0,
            "max": 10,
            "description": "Maximum link-follow depth from seed URLs.",
        },
        "qps": {
            "type": "float",
            "default": 1,
            "min": 0.1,
            "max": 10,
            "description": "Crawler QPS. Capped by project ROE QPS when lower.",
        },
        "same_host_only": {
            "type": "boolean",
            "default": False,
            "description": "Only crawl the same host as each seed URL.",
        },
        "include_assets": {
            "type": "boolean",
            "default": False,
            "description": "Store static assets such as images/CSS/JS as entries.",
        },
        "include_no_bounty_assets": {
            "type": "boolean",
            "default": False,
            "description": "Allow crawling hosts listed as no-bounty in the program profile.",
        },
        "discover_js_urls": {
            "type": "boolean",
            "default": True,
            "description": "Extract same-scope URLs/paths from JavaScript/text responses.",
        },
        "cookie_header": {
            "type": "string",
            "default": "",
            "description": "Optional Cookie header from your own authorized test session.",
        },
        "extra_headers_json": {
            "type": "string",
            "default": "{}",
            "description": "Optional JSON object of extra headers, for example {\"User-Agent\":\"...\"}.",
        },
        "source_name": {
            "type": "string",
            "default": "",
            "description": "Optional Source name. Defaults to safe_crawler timestamp.",
        },
        "body_capture_limit": {
            "type": "int",
            "default": 250000,
            "min": 0,
            "max": 2000000,
            "description": "Maximum response body characters to store per entry.",
        },
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SENSITIVE_HEADER_NAMES = {"authorization", "cookie", "set-cookie", "x-api-key", "x-csrf-token"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _s(value: Any) -> str:
    return str(value or "").strip()


def _sl(value: Any) -> str:
    return _s(value).lower()


def _safe_int(value: Any, default: int, min_v: int, max_v: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    return max(min_v, min(max_v, n))


def _safe_float(value: Any, default: float, min_v: float, max_v: float) -> float:
    try:
        n = float(value)
    except Exception:
        n = default
    return max(min_v, min(max_v, n))


def _safe_bool(params: Dict[str, Any], key: str, default: bool) -> bool:
    if key not in params:
        return default
    value = params.get(key)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_json_object(text: Any) -> Dict[str, str]:
    if isinstance(text, dict):
        return {str(k): str(v) for k, v in text.items()}
    raw = str(text or "").strip()
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(obj, dict):
        return {}
    return {str(k): str(v) for k, v in obj.items()}


def _split_lines(text: Any) -> List[str]:
    if isinstance(text, list):
        return [_s(x) for x in text if _s(x)]
    return [_s(x) for x in str(text or "").splitlines() if _s(x)]


def _normalize_host(raw: Any) -> str:
    host = _sl(raw)
    if not host:
        return ""

    if "://" in host:
        try:
            parsed = urlparse(host)
            host = parsed.netloc or host
        except Exception:
            pass

    host = host.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]

    if "@" in host:
        host = host.rsplit("@", 1)[1]

    if ":" in host:
        host = host.split(":", 1)[0]

    return host.rstrip(".")


def _host_matches(pattern: str, host: str) -> bool:
    p = _normalize_host(pattern)
    h = _normalize_host(host)

    if not p or not h:
        return False

    if p == h:
        return True

    if p.startswith("*."):
        suffix = p[1:]  # ".example.com"
        return h.endswith(suffix) and h != suffix.lstrip(".")

    if p.startswith("*"):
        return h.endswith(p.lstrip("*"))

    if p.endswith(".*"):
        return h.startswith(p[:-1])

    return False


def _parse_asset_lines(text: Any) -> List[str]:
    out: List[str] = []
    for line in _split_lines(text):
        if not line or line.startswith("#"):
            continue
        # Supports "asset | tier | type | notes"
        first = line.split("|", 1)[0].strip()
        if first:
            out.append(first)
    return out


def _clean_url(url: str) -> str:
    no_frag, _frag = urldefrag(str(url or "").strip())
    return no_frag


def _normalize_url(url: str) -> str:
    parsed = urlparse(_clean_url(url))
    scheme = (parsed.scheme or "https").lower()
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"

    # Keep query order stable enough for dedupe.
    pairs = parse_qsl(parsed.query or "", keep_blank_values=True)
    query = urlencode(sorted(pairs), doseq=True)

    return urlunparse((scheme, netloc, path, "", query, ""))


def _url_host(url: str) -> str:
    return _normalize_host(urlparse(url).netloc)


def _path_and_query(url: str) -> Tuple[str, str]:
    parsed = urlparse(url)
    path = parsed.path or "/"
    query = parsed.query or ""
    return path, query


def _query_keys(query: str) -> List[str]:
    keys = sorted({str(k or "").strip().lower() for k, _v in parse_qsl(query or "", keep_blank_values=True) if str(k or "").strip()})
    return keys


def _headers_to_list(headers: httpx.Headers | Dict[str, str]) -> List[Dict[str, str]]:
    return [{"name": str(k), "value": str(v)} for k, v in dict(headers).items()]


def _redact_request_headers(headers: Dict[str, str]) -> List[Dict[str, str]]:
    return sanitize_headers([{"name": str(k), "value": str(v)} for k, v in headers.items()])


def _redact_response_headers(headers: httpx.Headers) -> List[Dict[str, str]]:
    return sanitize_headers(_headers_to_list(headers))


def _safe_response_text(resp: httpx.Response, limit: int) -> str:
    if limit <= 0:
        return ""
    try:
        text = resp.text or ""
    except Exception:
        return ""
    if len(text) > limit:
        return text[:limit] + "\n<!-- pwnyhub: response body truncated -->"
    return text


def _mime_from_response(resp: httpx.Response) -> str:
    ctype = resp.headers.get("content-type", "") or ""
    return ctype.split(";", 1)[0].strip().lower()


def _project_dict(ctx: Dict[str, Any], project_id: int) -> Dict[str, Any]:
    project = ctx.get("project")
    if isinstance(project, dict):
        return project

    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            return {}
        roe: Dict[str, Any] = {}
        try:
            roe = json.loads(p.roe_json or "{}")
            if not isinstance(roe, dict):
                roe = {}
        except Exception:
            roe = {}

        return {
            "id": p.id,
            "name": p.name,
            "qps": p.qps,
            "scope": {
                "allow": _split_lines(p.scope_allow),
                "deny": _split_lines(p.scope_deny),
            },
            "roe": roe,
        }


def _project_id_from_ctx(ctx: Dict[str, Any]) -> int:
    for key in ("project_id", "projectId"):
        if ctx.get(key) is not None:
            try:
                return int(ctx[key])
            except Exception:
                pass

    project = ctx.get("project")
    if isinstance(project, dict) and project.get("id") is not None:
        try:
            return int(project["id"])
        except Exception:
            pass

    raise ValueError("safe_crawler requires project_id in module context")


def _project_scope(project: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    scope = project.get("scope") if isinstance(project.get("scope"), dict) else {}
    allow = _split_lines(scope.get("allow") or scope.get("allow_hosts") or [])
    deny = _split_lines(scope.get("deny") or scope.get("deny_hosts") or [])
    return allow, deny


def _program_policy_hosts(project: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    roe = project.get("roe") if isinstance(project.get("roe"), dict) else {}
    pp = roe.get("program_policy") if isinstance(roe.get("program_policy"), dict) else {}
    no_bounty = _parse_asset_lines(pp.get("no_bounty_assets_text", ""))
    out_of_scope = _parse_asset_lines(pp.get("out_of_scope_assets_text", ""))
    return no_bounty, out_of_scope


def _network_qps_cap(project: Dict[str, Any], requested_qps: float) -> float:
    qps_values: List[float] = []

    try:
        qps_values.append(float(project.get("qps")))
    except Exception:
        pass

    roe = project.get("roe") if isinstance(project.get("roe"), dict) else {}
    network = roe.get("network") if isinstance(roe.get("network"), dict) else {}

    for key in ("qps", "automated_tooling_max_qps"):
        try:
            value = float(network.get(key))
            if value > 0:
                qps_values.append(value)
        except Exception:
            pass

    qps_values.append(requested_qps if requested_qps > 0 else 1.0)
    return max(0.1, min(qps_values))


@dataclass
class ScopeDecision:
    allowed: bool
    reason: str


class ScopeGate:
    def __init__(
        self,
        *,
        allow_hosts: Iterable[str],
        deny_hosts: Iterable[str],
        no_bounty_hosts: Iterable[str],
        out_of_scope_hosts: Iterable[str],
        include_no_bounty_assets: bool,
        same_host_only: bool,
        seed_hosts: Iterable[str],
    ) -> None:
        self.allow_hosts = [_s(x) for x in allow_hosts if _s(x)]
        self.deny_hosts = [_s(x) for x in deny_hosts if _s(x)]
        self.no_bounty_hosts = [_s(x) for x in no_bounty_hosts if _s(x)]
        self.out_of_scope_hosts = [_s(x) for x in out_of_scope_hosts if _s(x)]
        self.include_no_bounty_assets = include_no_bounty_assets
        self.same_host_only = same_host_only
        self.seed_hosts = {_normalize_host(x) for x in seed_hosts if _normalize_host(x)}

    def check(self, url: str) -> ScopeDecision:
        parsed = urlparse(url)
        if parsed.scheme.lower() not in {"http", "https"}:
            return ScopeDecision(False, "unsupported_scheme")

        host = _normalize_host(parsed.netloc)
        if not host:
            return ScopeDecision(False, "missing_host")

        if self.same_host_only and host not in self.seed_hosts:
            return ScopeDecision(False, "different_host")

        if any(_host_matches(pattern, host) for pattern in self.deny_hosts):
            return ScopeDecision(False, "scope_denylist")

        if any(_host_matches(pattern, host) for pattern in self.out_of_scope_hosts):
            return ScopeDecision(False, "program_out_of_scope")

        if (not self.include_no_bounty_assets) and any(_host_matches(pattern, host) for pattern in self.no_bounty_hosts):
            return ScopeDecision(False, "program_no_bounty")

        if self.allow_hosts:
            if not any(_host_matches(pattern, host) for pattern in self.allow_hosts):
                return ScopeDecision(False, "not_in_allowlist")
        else:
            # If no allowlist exists, keep crawl bounded to seed hosts.
            if host not in self.seed_hosts:
                return ScopeDecision(False, "no_allowlist_seed_hosts_only")

        return ScopeDecision(True, "allowed")


class LinkExtractor(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: Set[str] = set()
        self.forms: List[Dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        attr = {str(k).lower(): v for k, v in attrs}
        tag_l = tag.lower()

        for key in ("href", "src"):
            value = attr.get(key)
            if value:
                self._add_url(value)

        if tag_l == "form":
            action = attr.get("action") or self.base_url
            method = (attr.get("method") or "GET").upper()
            full = _normalize_url(urljoin(self.base_url, action))
            self.forms.append({"method": method, "action": full})

    def _add_url(self, raw: str) -> None:
        value = str(raw or "").strip()
        if not value:
            return
        if value.startswith(("mailto:", "tel:", "javascript:", "data:")):
            return
        full = _normalize_url(urljoin(self.base_url, value))
        self.links.add(full)


JS_URL_RE = re.compile(
    r"""
    (?:
        ["'](
            https?://[^"'<>\\\s]+
            |
            /[A-Za-z0-9_\-./?=&:%]+
        )["']
    )
    """,
    re.VERBOSE,
)


def extract_js_urls(base_url: str, text: str) -> Set[str]:
    out: Set[str] = set()
    for match in JS_URL_RE.finditer(text or ""):
        raw = match.group(1)
        if not raw:
            continue
        if raw.startswith("//"):
            parsed = urlparse(base_url)
            raw = f"{parsed.scheme}:{raw}"
        try:
            full = _normalize_url(urljoin(base_url, raw))
            out.add(full)
        except Exception:
            continue
    return out


# ---------------------------------------------------------------------------
# DB insertion
# ---------------------------------------------------------------------------

def _create_source(project_id: int, name: str, params_summary: Dict[str, Any]) -> Source:
    src = Source(
        project_id=project_id,
        kind="safe_crawler",
        name=name,
        status="running",
        metadata_json=json.dumps(
            {
                "module": "safe_crawler",
                "params": params_summary,
                "summary": {},
            },
            indent=2,
            sort_keys=True,
        ),
        started_at=_now(),
    )
    with get_session() as s:
        s.add(src)
        s.commit()
        s.refresh(src)
        return src


def _finish_source(source_id: int, status: str, summary: Dict[str, Any], error: str = "") -> None:
    with get_session() as s:
        src = s.get(Source, source_id)
        if not src:
            return

        metadata: Dict[str, Any] = {}
        try:
            metadata = json.loads(src.metadata_json or "{}")
            if not isinstance(metadata, dict):
                metadata = {}
        except Exception:
            metadata = {}

        metadata["summary"] = summary
        src.status = status
        src.finished_at = _now()
        src.error = error
        src.metadata_json = json.dumps(metadata, indent=2, sort_keys=True)
        s.add(src)
        s.commit()


def _existing_fingerprints(project_id: int) -> Set[str]:
    with get_session() as s:
        rows = s.exec(select(HarEntry.entry_fingerprint).where(HarEntry.project_id == project_id)).all()
    return {str(x) for x in rows if x}


def _insert_observation(
    *,
    project_id: int,
    source_id: int,
    method: str,
    url: str,
    request_headers: Dict[str, str],
    status_code: int,
    mime: str,
    response_headers: httpx.Headers,
    response_body: str,
    elapsed_ms: float,
    existing_fps: Set[str],
) -> str:
    parsed = urlparse(url)
    host = _normalize_host(parsed.netloc)
    path = parsed.path or "/"
    query = parsed.query or ""
    req_body = ""

    shape_fp = build_shape_fingerprint(method, host, path, query)
    entry_fp = build_entry_fingerprint(method, host, path, query, req_body, int(status_code or 0), mime)

    if entry_fp in existing_fps:
        return "duplicate"

    existing_fps.add(entry_fp)

    entry = HarEntry(
        project_id=project_id,
        source_id=source_id,
        method=method.upper(),
        url=url,
        host=host,
        path=path,
        query=query,
        normalized_host=host,
        normalized_path=path,
        query_keys_json=json.dumps(_query_keys(query)),
        shape_fingerprint=shape_fp,
        entry_fingerprint=entry_fp,
        req_headers_json=json.dumps(_redact_request_headers(request_headers)),
        req_body_text=req_body,
        status=int(status_code or 0),
        mime=mime,
        resp_headers_json=json.dumps(_redact_response_headers(response_headers)),
        resp_body_text=response_body,
        time_ms=float(elapsed_ms or 0.0),
        body_size=len(response_body or ""),
    )

    with get_session() as s:
        s.add(entry)
        s.commit()

    return "inserted"


# ---------------------------------------------------------------------------
# Module run
# ---------------------------------------------------------------------------

def run(ctx: Dict[str, Any]) -> Dict[str, Any]:
    params = ctx.get("params") or {}
    project_id = _project_id_from_ctx(ctx)
    project = _project_dict(ctx, project_id)

    seed_urls_raw = _split_lines(params.get("seed_urls", ""))
    seed_urls = [_normalize_url(x) for x in seed_urls_raw if _s(x)]
    if not seed_urls:
        raise ValueError("safe_crawler requires at least one seed URL in seed_urls")

    max_pages = _safe_int(params.get("max_pages"), 80, 1, 1000)
    max_depth = _safe_int(params.get("max_depth"), 2, 0, 10)
    requested_qps = _safe_float(params.get("qps"), 1.0, 0.1, 10.0)
    effective_qps = _network_qps_cap(project, requested_qps)
    delay_s = 1.0 / effective_qps if effective_qps > 0 else 1.0

    same_host_only = _safe_bool(params, "same_host_only", False)
    include_assets = _safe_bool(params, "include_assets", False)
    include_no_bounty_assets = _safe_bool(params, "include_no_bounty_assets", False)
    discover_js = _safe_bool(params, "discover_js_urls", True)
    body_capture_limit = _safe_int(params.get("body_capture_limit"), 250000, 0, 2_000_000)

    cookie_header = _s(params.get("cookie_header", ""))
    extra_headers = _parse_json_object(params.get("extra_headers_json", "{}"))

    default_source_name = f"safe_crawler_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    source_name = _s(params.get("source_name")) or default_source_name

    allow_hosts, deny_hosts = _project_scope(project)
    no_bounty_hosts, out_of_scope_hosts = _program_policy_hosts(project)
    seed_hosts = [_url_host(u) for u in seed_urls]

    gate = ScopeGate(
        allow_hosts=allow_hosts,
        deny_hosts=deny_hosts,
        no_bounty_hosts=no_bounty_hosts,
        out_of_scope_hosts=out_of_scope_hosts,
        include_no_bounty_assets=include_no_bounty_assets,
        same_host_only=same_host_only,
        seed_hosts=seed_hosts,
    )

    source = _create_source(
        project_id,
        source_name,
        {
            "seed_urls": seed_urls,
            "max_pages": max_pages,
            "max_depth": max_depth,
            "requested_qps": requested_qps,
            "effective_qps": effective_qps,
            "same_host_only": same_host_only,
            "include_assets": include_assets,
            "include_no_bounty_assets": include_no_bounty_assets,
            "discover_js_urls": discover_js,
            "body_capture_limit": body_capture_limit,
        },
    )

    summary: Dict[str, Any] = {
        "seed_urls": seed_urls,
        "requested": 0,
        "inserted": 0,
        "duplicates": 0,
        "skipped_assets": 0,
        "queued": len(seed_urls),
        "discovered": 0,
        "forms_observed": 0,
        "errors": 0,
        "status_counts": {},
        "skip_reasons": {},
        "effective_qps": effective_qps,
        "source_id": source.id,
    }

    queue: List[Tuple[str, int]] = [(u, 0) for u in seed_urls]
    queued: Set[str] = {u for u in seed_urls}
    visited: Set[str] = set()
    existing_fps = _existing_fingerprints(project_id)

    headers: Dict[str, str] = {
        "User-Agent": "PwnyHub SafeCrawler/0.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.8",
    }
    headers.update(extra_headers)
    if cookie_header:
        headers["Cookie"] = cookie_header

    timeout = _safe_float(
        (project.get("roe") or {}).get("network", {}).get("timeout_s", 20)
        if isinstance(project.get("roe"), dict)
        else 20,
        20,
        1,
        120,
    )

    try:
        with httpx.Client(
            headers=headers,
            timeout=timeout,
            follow_redirects=True,
            max_redirects=8,
        ) as client:
            last_request_at = 0.0

            while queue and summary["requested"] < max_pages:
                url, depth = queue.pop(0)
                normalized = _normalize_url(url)

                if normalized in visited:
                    continue

                decision = gate.check(normalized)
                if not decision.allowed:
                    summary["skip_reasons"][decision.reason] = summary["skip_reasons"].get(decision.reason, 0) + 1
                    continue

                visited.add(normalized)

                wait = delay_s - (time.monotonic() - last_request_at)
                if wait > 0:
                    time.sleep(wait)

                started = time.perf_counter()
                try:
                    resp = client.get(normalized)
                    elapsed_ms = (time.perf_counter() - started) * 1000.0
                    last_request_at = time.monotonic()
                except Exception as e:
                    summary["errors"] += 1
                    summary["skip_reasons"]["request_error"] = summary["skip_reasons"].get("request_error", 0) + 1
                    continue

                summary["requested"] += 1
                status_key = str(resp.status_code)
                summary["status_counts"][status_key] = summary["status_counts"].get(status_key, 0) + 1

                final_url = _normalize_url(str(resp.url))
                mime = _mime_from_response(resp)
                body = _safe_response_text(resp, body_capture_limit)

                if (not include_assets) and is_asset_mime(mime):
                    summary["skipped_assets"] += 1
                else:
                    result = _insert_observation(
                        project_id=project_id,
                        source_id=int(source.id or 0),
                        method="GET",
                        url=final_url,
                        request_headers=headers,
                        status_code=resp.status_code,
                        mime=mime,
                        response_headers=resp.headers,
                        response_body=body,
                        elapsed_ms=elapsed_ms,
                        existing_fps=existing_fps,
                    )
                    if result == "inserted":
                        summary["inserted"] += 1
                    elif result == "duplicate":
                        summary["duplicates"] += 1

                if depth >= max_depth:
                    continue

                should_parse_html = "html" in mime or final_url.endswith(("/", ".html", ".htm"))
                should_parse_text = ("javascript" in mime) or ("json" in mime) or ("text" in mime)

                discovered: Set[str] = set()

                if should_parse_html and body:
                    parser = LinkExtractor(final_url)
                    try:
                        parser.feed(body)
                        discovered.update(parser.links)
                        summary["forms_observed"] += len(parser.forms)

                        # Record form actions as discovered URLs only. Do not submit forms.
                        for form in parser.forms:
                            action = form.get("action")
                            if action:
                                discovered.add(_normalize_url(action))
                    except Exception:
                        summary["skip_reasons"]["html_parse_error"] = summary["skip_reasons"].get("html_parse_error", 0) + 1

                if discover_js and should_parse_text and body:
                    discovered.update(extract_js_urls(final_url, body))

                for found in sorted(discovered):
                    clean = _normalize_url(found)
                    if clean in queued or clean in visited:
                        continue
                    d = gate.check(clean)
                    if not d.allowed:
                        summary["skip_reasons"][d.reason] = summary["skip_reasons"].get(d.reason, 0) + 1
                        continue
                    queued.add(clean)
                    queue.append((clean, depth + 1))
                    summary["discovered"] += 1

                summary["queued"] = len(queue)

        _finish_source(int(source.id or 0), "done", summary)
        return {
            "findings": [],
            "summary": summary,
            "source": {
                "id": source.id,
                "name": source.name,
                "kind": source.kind,
                "status": "done",
            },
        }

    except Exception as e:
        summary["fatal_error"] = str(e)
        _finish_source(int(source.id or 0), "failed", summary, error=str(e))
        raise