from __future__ import annotations

from typing import Any, Dict, List, Tuple


_SENSITIVE_PATH_HINTS = [
    "admin", "internal", "manage", "settings",
    "oauth", "sso", "token", "jwt", "key", "secret",
    "billing", "payment", "invoice", "subscription",
    "user", "users", "account", "accounts", "profile",
    "role", "permission", "acl",
    "order", "orders", "cart", "checkout",
]

_ID_QUERY_HINTS = {
    "id", "uid", "user", "user_id", "userid",
    "account", "account_id", "accountid",
    "org", "org_id", "orgid", "tenant", "tenant_id",
    "customer", "customer_id",
    "project", "project_id",
}


_ASSET_MIME_PREFIXES = ("image/", "font/")
_ASSET_MIME_EXACT = {
    "text/css",
    "text/javascript",
    "application/javascript",
    "application/x-javascript",
}


def _contains_any(haystack: str, needles: List[str]) -> List[str]:
    h = (haystack or "").lower()
    hits = [n for n in needles if n in h]
    return hits


def score_action(a: Dict[str, Any]) -> Tuple[int, List[str]]:
    """
    Pure heuristic score 0..100 for triage (NOT exploitation).
    Adds tags explaining why it scored high.
    """
    tags: List[str] = []
    score = 0

    method = (a.get("method") or "").upper()
    path = (a.get("path_template") or "")
    mime = (a.get("top_mime") or "").lower()
    status_codes = a.get("status_codes") or []
    avg_bytes = int(a.get("avg_resp_bytes") or 0)
    has_body = bool(a.get("has_body") or False)
    qkeys = [str(x).lower() for x in (a.get("query_keys") or [])]

    # Method weight
    if method == "GET":
        score += 5
    elif method in ("HEAD", "OPTIONS"):
        score += 2
    elif method == "POST":
        score += 22
        tags.append("writes")
    elif method in ("PUT", "PATCH"):
        score += 28
        tags.append("writes")
    elif method == "DELETE":
        score += 34
        tags.append("destructive")
    else:
        score += 8

    # Has request body
    if has_body:
        score += 10
        tags.append("has_body")

    # Path sensitivity hints
    hits = _contains_any(path, _SENSITIVE_PATH_HINTS)
    if hits:
        score += min(25, 5 + 3 * len(hits))
        tags.append("sensitive_path")

    # Auth boundary hints
    if any(int(s) in (401, 403) for s in status_codes):
        score += 12
        tags.append("authz_boundary")

    # Server errors can indicate unstable/interesting behavior
    if any(500 <= int(s) <= 599 for s in status_codes):
        score += 10
        tags.append("5xx_seen")

    # Large responses (often data heavy)
    if avg_bytes >= 200_000:
        score += 10
        tags.append("large_resp")
    elif avg_bytes >= 50_000:
        score += 6
        tags.append("medium_resp")

    # ID-like query keys
    id_hits = sorted(set(q for q in qkeys if q in _ID_QUERY_HINTS))
    if id_hits:
        score += min(12, 4 + 2 * len(id_hits))
        tags.append("id_query")

    # De-emphasize obvious assets
    if mime.startswith(_ASSET_MIME_PREFIXES) or mime in _ASSET_MIME_EXACT:
        score -= 25
        tags.append("asset_like")

    # Clamp and dedupe tags
    score = max(0, min(100, score))
    tags = sorted(set(tags))
    return score, tags


def attach_risk(actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for a in actions:
        s, tags = score_action(a)
        a["risk_score"] = s
        a["risk_tags"] = tags
    return actions
