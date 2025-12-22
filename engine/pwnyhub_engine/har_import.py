from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse


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


def parse_har(har_bytes: bytes) -> List[Imported]:
    har = json.loads(har_bytes.decode("utf-8", errors="replace"))
    entries = har.get("log", {}).get("entries", [])
    out: List[Imported] = []

    for e in entries:
        req = e.get("request", {})
        resp = e.get("response", {})

        url = req.get("url", "")
        u = urlparse(url)
        host = u.netloc
        path = u.path
        query = u.query

        method = req.get("method", "GET")
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
            )
        )

    return out
