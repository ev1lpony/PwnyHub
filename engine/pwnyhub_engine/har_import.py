from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple
from urllib.parse import parse_qsl, unquote, urlparse


ASSET_MIME_PREFIXES = (
    "image/",
)
ASSET_MIME_EXACT = {
    "text/css",
    "application/x-javascript",
    "text/javascript",
    "application/javascript",
    "application/font-woff2",
    "application/x-font-ttf",
}


def _safe_mime(entry: Dict[str, Any]) -> str:
    mime = (entry.get("response", {})
                 .get("content", {})
                 .get("mimeType") or "")
    return mime.split(";")[0].strip().lower()


def is_asset_mime(mime: str) -> bool:
    if any(mime.startswith(p) for p in ASSET_MIME_PREFIXES):
        return True
    if mime in ASSET_MIME_EXACT:
        return True
    if "font" in mime or "woff" in mime or "ttf" in mime:
        return True
    if mime.startswith("video/"):
        return True
    return False


def sanitize_headers(headers: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Remove or redact sensitive headers.

    This is important when importing real-world captures.
    """
    redacted = []
    for h in headers:
        name = h.get("name", "")
        value = h.get("value", "")
        lname = name.lower()
        if lname in {"authorization", "cookie", "set-cookie", "x-api-key"}:
            redacted.append({"name": name, "value": "<redacted>"})
        else:
            redacted.append({"name": name, "value": value})
    return redacted


def _normalize_method(method: str) -> str:
    return str(method or "GET").strip().upper() or "GET"


def _normalize_host(raw: str) -> str:
    host = str(raw or "").strip().lower()

    if "@" in host:
        host = host.split("@", 1)[1]

    if ":" in host:
        host = host.split(":", 1)[0]

    return host.rstrip(".")


def _normalize_path(path: str) -> str:
    p = unquote(str(path or "").strip())
    if not p:
        return "/"

    if not p.startswith("/"):
        p = f"/{p}"

    p = re.sub(r"/{2,}", "/", p)

    if len(p) > 1 and p.endswith("/"):
        p = p[:-1]

    return p


def _normalize_query_pairs(query: str) -> List[Tuple[str, str]]:
    pairs = parse_qsl(str(query or ""), keep_blank_values=True)
    normalized: List[Tuple[str, str]] = []
    for k, v in pairs:
        key = str(k or "").strip().lower()
        val = str(v or "").strip()
        normalized.append((key, val))
    normalized.sort(key=lambda x: (x[0], x[1]))
    return normalized


def _query_keys_from_pairs(pairs: List[Tuple[str, str]]) -> List[str]:
    seen = set()
    out: List[str] = []
    for k, _v in pairs:
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(k)
    out.sort()
    return out


def _sha256_text(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8", errors="replace")).hexdigest()


def build_shape_fingerprint(method: str, host: str, path: str, query: str) -> str:
    """
    Coarse-grained endpoint shape fingerprint.

    Good for:
      - clustering
      - merge heuristics
      - future module routing

    Intentionally ignores query values and bodies.
    """
    pairs = _normalize_query_pairs(query)
    payload = {
        "method": _normalize_method(method),
        "host": _normalize_host(host),
        "path": _normalize_path(path),
        "query_keys": _query_keys_from_pairs(pairs),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_entry_fingerprint(
    method: str,
    host: str,
    path: str,
    query: str,
    req_body: str,
    status: int,
    mime: str,
) -> str:
    """
    Finer-grained observation fingerprint.

    Good for:
      - deduping exact/similar repeated HAR observations across imports

    This keeps more detail than shape fingerprint so we do not collapse
    obviously different requests too aggressively.
    """
    pairs = _normalize_query_pairs(query)
    payload = {
        "method": _normalize_method(method),
        "host": _normalize_host(host),
        "path": _normalize_path(path),
        "query_pairs": pairs,
        "req_body_sha256": _sha256_text(req_body),
        "status": int(status or 0),
        "mime": str(mime or "").strip().lower(),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass
class Imported:
    method: str
    url: str
    host: str
    path: str
    query: str
    req_headers: List[Dict[str, str]]
    req_body: str
    status: int
    mime: str
    resp_headers: List[Dict[str, str]]
    resp_body: str
    time_ms: float
    body_size: int

    # Normalized / fingerprint-ready fields
    normalized_host: str = ""
    normalized_path: str = "/"
    query_keys: List[str] = None  # type: ignore[assignment]
    shape_fingerprint: str = ""
    entry_fingerprint: str = ""


def parse_har(har_bytes: bytes) -> List[Imported]:
    har = json.loads(har_bytes.decode("utf-8", errors="replace"))
    entries = har.get("log", {}).get("entries", [])
    out: List[Imported] = []

    for e in entries:
        req = e.get("request", {})
        resp = e.get("response", {})

        url = req.get("url", "")
        u = urlparse(url)

        host = _normalize_host(u.netloc or "")
        path = _normalize_path(u.path or "")
        query = u.query or ""

        method = _normalize_method(req.get("method", "GET"))
        status = int(resp.get("status", 0) or 0)
        time_ms = float(e.get("time", 0.0) or 0.0)
        body_size = int(resp.get("bodySize", 0) or 0)

        mime = _safe_mime(e)

        req_headers = sanitize_headers(req.get("headers", []) or [])
        resp_headers = sanitize_headers(resp.get("headers", []) or [])

        # Request body
        post = req.get("postData", {}) or {}
        req_body = post.get("text") or ""

        # Response body: HAR may include text or base64; we keep text if present.
        content = resp.get("content", {}) or {}
        resp_body = content.get("text") or ""

        query_pairs = _normalize_query_pairs(query)
        query_keys = _query_keys_from_pairs(query_pairs)
        shape_fingerprint = build_shape_fingerprint(method, host, path, query)
        entry_fingerprint = build_entry_fingerprint(method, host, path, query, req_body, status, mime)

        out.append(
            Imported(
                method=method,
                url=url,
                host=host,
                path=path,
                query=query,
                req_headers=req_headers,
                req_body=req_body,
                status=status,
                mime=mime,
                resp_headers=resp_headers,
                resp_body=resp_body,
                time_ms=time_ms,
                body_size=body_size,
                normalized_host=host,
                normalized_path=path,
                query_keys=query_keys,
                shape_fingerprint=shape_fingerprint,
                entry_fingerprint=entry_fingerprint,
            )
        )

    return out