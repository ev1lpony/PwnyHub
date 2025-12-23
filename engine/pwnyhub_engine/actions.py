from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs
import json
import re


# --- heuristics for templating path segments ---
_RE_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)
_RE_HEX = re.compile(r"^[0-9a-f]{16,}$", re.I)
_RE_INT = re.compile(r"^\d+$")

# JWT-ish (3 dot-separated base64url parts)
_RE_JWT = re.compile(r"^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$")

# ULID (26 chars Crockford base32)
_RE_ULID = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$", re.I)

# long base64url-ish tokens (not necessarily valid base64, but "opaque")
_RE_B64URLISH = re.compile(r"^[A-Za-z0-9_\-]{18,}={0,2}$")

# date-ish segments
_RE_DATE_YYYYMMDD = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RE_DATE_YYYYMM = re.compile(r"^\d{4}-\d{2}$")


def normalize_segment(seg: str) -> str:
    """
    Turn path segments into templates when they look like IDs/tokens.
    Key upgrade: short ints are treated as versions ({ver}) not IDs ({int}).
    """
    if not seg:
        return seg

    # Dates first (common in API paths/logging)
    if _RE_DATE_YYYYMMDD.fullmatch(seg):
        return "{date}"
    if _RE_DATE_YYYYMM.fullmatch(seg):
        return "{date}"

    # Pure ints: treat small ones as version-like (1/2/3), keep meaning
    if _RE_INT.fullmatch(seg):
        if len(seg) <= 2:
            return "{ver}"
        return "{int}"

    # UUID
    if _RE_UUID.fullmatch(seg):
        return "{uuid}"

    # ULID
    if _RE_ULID.fullmatch(seg):
        return "{ulid}"

    # JWT token
    if _RE_JWT.fullmatch(seg):
        return "{jwt}"

    # hex-ish long ids
    if _RE_HEX.fullmatch(seg):
        return "{hex}"

    # opaque token-ish segments
    if _RE_B64URLISH.fullmatch(seg):
        return "{token}"

    return seg


def normalize_path(path: str) -> str:
    # keep leading slash, drop extra slashes, template segments
    if not path:
        return "/"
    parts = [p for p in path.split("/") if p != ""]
    norm = [normalize_segment(p) for p in parts]
    return "/" + "/".join(norm)


def path_depth(path_template: str) -> int:
    """
    Depth as number of segments (excluding leading slash).
    "/" => 0, "/a/b" => 2
    """
    if not path_template or path_template == "/":
        return 0
    return len([p for p in path_template.split("/") if p])


def _lower_keys(d: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in (d or {}).items():
        kk = str(k).strip().lower()
        out[kk] = v
    return out


def _parse_headers_maybe(x: Any) -> Dict[str, Any]:
    """
    Accept dict-like, or JSON string, or list of {name,value} pairs (HAR-ish),
    and return a lowercase-key dict.
    """
    if not x:
        return {}

    # Already dict
    if isinstance(x, dict):
        return _lower_keys(x)

    # HAR-like list of {"name":..., "value":...}
    if isinstance(x, list):
        out: Dict[str, Any] = {}
        for it in x:
            if not isinstance(it, dict):
                continue
            name = (it.get("name") or it.get("key") or "").strip().lower()
            if not name:
                continue
            out[name] = it.get("value")
        return out

    # JSON string
    if isinstance(x, (str, bytes)):
        try:
            s = x.decode("utf-8", errors="ignore") if isinstance(x, bytes) else x
            s = s.strip()
            if not s:
                return {}
            obj = json.loads(s)
            return _parse_headers_maybe(obj)
        except Exception:
            return {}

    return {}


def get_entry_method(entry: Any) -> str:
    for attr in ("method", "request_method"):
        if hasattr(entry, attr) and getattr(entry, attr):
            return str(getattr(entry, attr)).upper()
    return "GET"


def get_entry_status(entry: Any) -> Optional[int]:
    """
    Treat 0 as "unknown/no response" (common in captures) rather than a real status.
    """
    for attr in ("status", "response_status", "status_code"):
        if hasattr(entry, attr) and getattr(entry, attr) is not None:
            try:
                v = int(getattr(entry, attr))
                if v == 0:
                    return None
                return v
            except Exception:
                return None
    return None


def get_entry_mime(entry: Any) -> str:
    for attr in ("mime", "mime_type", "content_type", "response_mime"):
        if hasattr(entry, attr) and getattr(entry, attr):
            return str(getattr(entry, attr))
    return "x-unknown"


def get_entry_resp_bytes(entry: Any) -> int:
    # Your DB uses body_size
    for attr in ("body_size", "resp_bytes", "response_bytes", "response_size"):
        if hasattr(entry, attr) and getattr(entry, attr) is not None:
            try:
                return int(getattr(entry, attr))
            except Exception:
                pass

    # fallback: response body text length if stored
    for attr in ("resp_body_text", "response_text", "response_body", "resp_text"):
        if hasattr(entry, attr) and getattr(entry, attr) is not None:
            try:
                return len(str(getattr(entry, attr)).encode("utf-8", errors="ignore"))
            except Exception:
                pass

    return 0


def get_entry_time_ms(entry: Any) -> float:
    for attr in ("time_ms", "duration_ms", "elapsed_ms"):
        if hasattr(entry, attr) and getattr(entry, attr) is not None:
            try:
                return float(getattr(entry, attr))
            except Exception:
                pass
    return 0.0


def entry_has_body(entry: Any) -> bool:
    # Your DB uses req_body_text
    for attr in ("req_body_text", "request_body_text", "req_body", "body"):
        if hasattr(entry, attr) and getattr(entry, attr):
            try:
                return len(str(getattr(entry, attr))) > 0
            except Exception:
                return True
    return False


def get_entry_req_headers(entry: Any) -> Dict[str, Any]:
    for attr in ("req_headers", "request_headers", "req_headers_json", "request_headers_json"):
        if hasattr(entry, attr) and getattr(entry, attr):
            return _parse_headers_maybe(getattr(entry, attr))
    return {}


def get_entry_resp_headers(entry: Any) -> Dict[str, Any]:
    for attr in ("resp_headers", "response_headers", "resp_headers_json", "response_headers_json"):
        if hasattr(entry, attr) and getattr(entry, attr):
            return _parse_headers_maybe(getattr(entry, attr))
    return {}


def build_sample_url(entry: Any) -> str:
    """
    Prefer stored full URL if available, else reconstruct from host/path/query.
    (Scheme is unknown; default https for display.)
    """
    for attr in ("url", "request_url", "full_url"):
        if hasattr(entry, attr) and getattr(entry, attr):
            return str(getattr(entry, attr))

    host = (getattr(entry, "host", "") or "").strip()
    path = getattr(entry, "path", "/") or "/"
    query = getattr(entry, "query", "") or ""
    if host:
        if query:
            return f"https://{host}{path}?{query}"
        return f"https://{host}{path}"
    return ""


def top_k_counts(d: Dict[str, int], k: int = 5) -> List[Dict[str, Any]]:
    items = sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:k]
    return [{"value": v, "count": c} for (v, c) in items]


def top_k_int_counts(d: Dict[int, int], k: int = 5) -> List[Dict[str, Any]]:
    items = sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:k]
    return [{"value": int(v), "count": int(c)} for (v, c) in items]


@dataclass
class ActionRow:
    key: str
    method: str
    host: str
    path_template: str
    count: int
    status_codes: List[int]
    top_mime: str
    avg_resp_bytes: int
    query_keys: List[str]

    # upgrades (extra signals)
    avg_time_ms: float
    has_body: bool
    sample_urls: List[str]
    top_statuses: List[Dict[str, Any]]
    top_mimes: List[Dict[str, Any]]
    top_query_keys: List[Dict[str, Any]]

    # more upgrades (triage + auth surface signals)
    path_depth: int
    query_key_count: int
    avg_query_keys: float
    has_auth_header: bool
    has_cookie_header: bool
    sets_cookie: bool
    req_content_type: str
    top_req_content_types: List[Dict[str, Any]]


def build_actions(entries: List[Any], sample_limit: int = 3) -> List[ActionRow]:
    """
    Build "actions": deduped request patterns keyed by (method, host, templated path).
    This is ORGANIZATION / INTEL ONLY (no replay, no fuzzing).
    """
    buckets: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for e in entries:
        method = get_entry_method(e)
        host = (getattr(e, "host", "") or "").lower()
        path = getattr(e, "path", "/") or "/"
        query = getattr(e, "query", "") or ""

        path_t = normalize_path(path)
        q_keys = sorted(parse_qs(query, keep_blank_values=True).keys())
        qk_len = len(q_keys)

        k = (method, host, path_t)

        b = buckets.get(k)
        if b is None:
            b = buckets[k] = {
                "count": 0,
                "status_set": set(),
                "status_counts": {},      # int -> count
                "mime_counts": {},        # str -> count
                "resp_bytes_sum": 0,
                "resp_bytes_n": 0,
                "time_sum": 0.0,
                "time_n": 0,
                "query_key_set": set(),
                "query_key_counts": {},   # str -> count
                "query_keys_sum": 0,      # sum(len(q_keys)) for avg_query_keys
                "has_body": False,
                "sample_urls": [],        # preserve insertion order

                # header surface signals
                "has_auth_header": False,
                "has_cookie_header": False,
                "sets_cookie": False,
                "req_ct_counts": {},      # str -> count
            }

        b["count"] += 1
        b["query_keys_sum"] += qk_len

        # status (0 treated as unknown in get_entry_status)
        st = get_entry_status(e)
        if st is not None:
            b["status_set"].add(st)
            b["status_counts"][st] = b["status_counts"].get(st, 0) + 1

        # mime
        mime = get_entry_mime(e) or "x-unknown"
        b["mime_counts"][mime] = b["mime_counts"].get(mime, 0) + 1

        # resp bytes
        rb = get_entry_resp_bytes(e)
        if rb > 0:
            b["resp_bytes_sum"] += rb
            b["resp_bytes_n"] += 1

        # time
        tm = get_entry_time_ms(e)
        if tm > 0:
            b["time_sum"] += tm
            b["time_n"] += 1

        # query keys (track both presence and frequency)
        for qk in q_keys:
            b["query_key_set"].add(qk)
            b["query_key_counts"][qk] = b["query_key_counts"].get(qk, 0) + 1

        # request body
        if not b["has_body"] and entry_has_body(e):
            b["has_body"] = True

        # header presence signals (no payloads, just booleans + content-type)
        req_h = get_entry_req_headers(e)
        if req_h:
            if (not b["has_auth_header"]) and ("authorization" in req_h):
                b["has_auth_header"] = True
            if (not b["has_cookie_header"]) and ("cookie" in req_h):
                b["has_cookie_header"] = True

            ct = req_h.get("content-type")
            if ct:
                ct_s = str(ct).split(";")[0].strip().lower()
                if ct_s:
                    b["req_ct_counts"][ct_s] = b["req_ct_counts"].get(ct_s, 0) + 1

        resp_h = get_entry_resp_headers(e)
        if resp_h and (not b["sets_cookie"]) and ("set-cookie" in resp_h):
            b["sets_cookie"] = True

        # sample urls
        if len(b["sample_urls"]) < sample_limit:
            su = build_sample_url(e)
            if su and su not in b["sample_urls"]:
                b["sample_urls"].append(su)

    out: List[ActionRow] = []
    for (method, host, path_t), b in buckets.items():
        mime_counts: Dict[str, int] = b["mime_counts"]
        top_mime = max(mime_counts.items(), key=lambda kv: kv[1])[0] if mime_counts else "x-unknown"
        avg_bytes = int(b["resp_bytes_sum"] / b["resp_bytes_n"]) if b["resp_bytes_n"] else 0
        avg_time = float(b["time_sum"] / b["time_n"]) if b["time_n"] else 0.0

        qk_unique = sorted(list(b["query_key_set"]))
        qk_unique_count = len(qk_unique)
        avg_qk = float(b["query_keys_sum"] / b["count"]) if b["count"] else 0.0

        req_ct_counts: Dict[str, int] = b["req_ct_counts"]
        top_req_ct = max(req_ct_counts.items(), key=lambda kv: kv[1])[0] if req_ct_counts else ""

        key = f"{method}|{host}|{path_t}"

        out.append(
            ActionRow(
                key=key,
                method=method,
                host=host,
                path_template=path_t,
                count=int(b["count"]),
                status_codes=sorted(list(b["status_set"])),
                top_mime=top_mime,
                avg_resp_bytes=avg_bytes,
                query_keys=qk_unique,

                avg_time_ms=avg_time,
                has_body=bool(b["has_body"]),
                sample_urls=list(b["sample_urls"]),
                top_statuses=top_k_int_counts(b["status_counts"], k=5),
                top_mimes=top_k_counts(b["mime_counts"], k=5),
                top_query_keys=top_k_counts(b["query_key_counts"], k=8),

                path_depth=path_depth(path_t),
                query_key_count=qk_unique_count,
                avg_query_keys=avg_qk,
                has_auth_header=bool(b["has_auth_header"]),
                has_cookie_header=bool(b["has_cookie_header"]),
                sets_cookie=bool(b["sets_cookie"]),
                req_content_type=top_req_ct,
                top_req_content_types=top_k_counts(req_ct_counts, k=5),
            )
        )

    # most frequent first
    out.sort(key=lambda a: a.count, reverse=True)
    return out


def actions_to_json(actions: List[ActionRow]) -> List[Dict[str, Any]]:
    """
    Backwards compatible: keeps all previous keys and adds new ones.
    """
    return [
        {
            "key": a.key,
            "method": a.method,
            "host": a.host,
            "path_template": a.path_template,
            "count": a.count,
            "status_codes": a.status_codes,
            "top_mime": a.top_mime,
            "avg_resp_bytes": a.avg_resp_bytes,
            "query_keys": a.query_keys,

            # upgrades
            "avg_time_ms": a.avg_time_ms,
            "has_body": a.has_body,
            "sample_urls": a.sample_urls,
            "top_statuses": a.top_statuses,
            "top_mimes": a.top_mimes,
            "top_query_keys": a.top_query_keys,

            # more upgrades (triage + auth surface signals)
            "path_depth": a.path_depth,
            "query_key_count": a.query_key_count,
            "avg_query_keys": a.avg_query_keys,
            "has_auth_header": a.has_auth_header,
            "has_cookie_header": a.has_cookie_header,
            "sets_cookie": a.sets_cookie,
            "req_content_type": a.req_content_type,
            "top_req_content_types": a.top_req_content_types,
        }
        for a in actions
    ]