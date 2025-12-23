from __future__ import annotations

from typing import Any, Dict, List, Tuple, Optional
import fnmatch
import re


# ============================================================
# PwnyHub Risk Heuristics (Triage)
# ------------------------------------------------------------
# Goal: score endpoints 0..100 for "what should I look at first?"
# - Not exploitation logic.
# - Fast, explainable, and extensible.
# - Adds risk_tags explaining the score.
# ============================================================


# --- hints / dictionaries ---

_SENSITIVE_PATH_HINTS = [
    "admin", "internal", "manage", "settings",
    "oauth", "sso", "token", "jwt", "key", "secret",
    "billing", "payment", "invoice", "subscription",
    "user", "users", "account", "accounts", "profile",
    "role", "permission", "acl",
    "order", "orders", "cart", "checkout",
    "support", "staff", "backoffice", "console",
    "config", "debug", "diagnostic", "metrics", "health",
]

# ID-ish query keys (IDOR/BAC triage)
_ID_QUERY_HINTS = {
    "id", "uid", "uuid", "ulid",
    "user", "user_id", "userid",
    "account", "account_id", "accountid",
    "org", "org_id", "orgid", "tenant", "tenant_id",
    "customer", "customer_id", "client_id",
    "project", "project_id", "team_id",
    "owner", "owner_id",
}

# Open redirect-ish keys
_REDIRECT_QUERY_HINTS = {
    "redirect", "redirect_url", "redirecturi", "redirect_uri",
    "return", "return_url", "returnurl",
    "next", "next_url",
    "url", "target", "dest", "destination",
    "callback", "continue",
}

# File/path-ish keys (download / traversal / LFI triage)
_FILE_QUERY_HINTS = {
    "file", "filename", "filepath", "path", "dir", "directory",
    "download", "attachment", "export", "import",
    "template", "doc", "document",
}

# Keys that suggest search/filters (SQLi-ish triage — still just triage)
_QUERY_INJECTION_HINTS = {
    "q", "query", "search", "filter",
    "where", "order", "orderby", "sort",
    "sql", "expr", "expression",
}

# Keys that suggest pagination/limits (often data listing)
_PAGINATION_HINTS = {
    "page", "page_size", "pagesize", "per_page", "limit", "offset", "cursor",
}

# Admin/debug toggles
_DEBUG_HINTS = {
    "debug", "trace", "verbose", "test", "dry_run", "dryrun",
}

# Assets we want to de-emphasize
_ASSET_MIME_PREFIXES = ("image/", "font/")
_ASSET_MIME_EXACT = {
    "text/css",
    "text/javascript",
    "application/javascript",
    "application/x-javascript",
}

# Path placeholder types that imply "identifier-like" segments
_PATH_ID_PLACEHOLDERS = {"{uuid}", "{ulid}", "{int}", "{hex}", "{id}"}
_PATH_TOKEN_PLACEHOLDERS = {"{token}", "{jwt}", "{apikey}", "{api_key}", "{session}"}

# Methods grouped
_WRITE_METHODS = {"POST", "PUT", "PATCH"}
_DESTRUCTIVE_METHODS = {"DELETE"}


# --- regex helpers ---
_RE_UUID_LIKE = re.compile(r"\{uuid\}|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", re.I)
_RE_TOKEN_WORD = re.compile(r"\b(token|jwt|session|apikey|api_key|secret)\b", re.I)
_RE_AUTH_HEADER_WORDS = re.compile(r"\b(authorization|bearer|cookie|set-cookie|x-api-key|x-auth|x-session)\b", re.I)


# --- helpers ---

def _contains_any(haystack: str, needles: List[str]) -> List[str]:
    h = (haystack or "").lower()
    return [n for n in needles if n in h]


def _norm_hosts(x: Optional[List[str]]) -> List[str]:
    if not x:
        return []
    out: List[str] = []
    for h in x:
        hh = (h or "").strip().lower()
        if hh:
            out.append(hh)
    return out


def _host_is_allowed(host: str, allow_hosts: List[str], deny_hosts: List[str]) -> Tuple[bool, List[str]]:
    """
    allow_hosts / deny_hosts support:
      - exact hosts: api.example.com
      - wildcard hosts: *.example.com (fnmatch)

    Behavior:
      - If BOTH allow_hosts and deny_hosts are empty => scope is unset:
          -> allow anything, tag scope_unset
      - Deny takes precedence
      - If allow_hosts is empty (but deny_hosts not empty) => allow anything unless denylisted
      - If allow_hosts exists => must match allow_hosts
    Returns (allowed?, tags)
    """
    h = (host or "").strip().lower()
    tags: List[str] = []

    if not h:
      # no host, don't penalize, still show scope_unset if truly unset
      if not allow_hosts and not deny_hosts:
          tags.append("scope_unset")
      return True, tags

    # Scope not configured at all
    if not allow_hosts and not deny_hosts:
        tags.append("scope_unset")
        return True, tags

    # Deny takes precedence
    for pat in deny_hosts:
        if fnmatch.fnmatch(h, pat):
            tags.append("denylisted_host")
            return False, tags

    # If no allowlist: everything allowed (deny already handled)
    if not allow_hosts:
        return True, tags

    # If allowlist exists: must match
    for pat in allow_hosts:
        if fnmatch.fnmatch(h, pat):
            return True, tags

    tags.append("out_of_scope")
    return False, tags



def _is_third_party(host: str, allow_hosts: List[str]) -> bool:
    """
    If allow_hosts exists and host doesn't match it, it is third-party.
    If allow_hosts empty, we can't determine -> False.
    """
    h = (host or "").strip().lower()
    if not h or not allow_hosts:
        return False
    for pat in allow_hosts:
        if fnmatch.fnmatch(h, pat):
            return False
    return True


def _path_placeholder_tags(path_template: str) -> Tuple[int, List[str]]:
    """
    Adds score based on density of placeholders like {uuid}/{token}/{jwt}.
    Returns (score_delta, tags)
    """
    p = (path_template or "").lower()
    tags: List[str] = []
    score = 0

    id_hits = sum(p.count(ph) for ph in _PATH_ID_PLACEHOLDERS)
    tok_hits = sum(p.count(ph) for ph in _PATH_TOKEN_PLACEHOLDERS)

    if id_hits > 0:
        score += min(14, 4 + 3 * id_hits)
        tags.append("id_in_path")

    if tok_hits > 0:
        score += min(18, 6 + 4 * tok_hits)
        tags.append("token_in_path")

    # generic UUID-like even if template isn't normalized exactly
    if _RE_UUID_LIKE.search(p):
        score += 4
        tags.append("uuid_like")

    return score, tags


def _status_tags(status_codes: List[Any]) -> Tuple[int, List[str]]:
    """
    Status code signal:
      - 401/403 => authz boundary hint (good triage)
      - 5xx => interesting/unstable
      - 3xx => redirect flows (sometimes interesting)
    """
    tags: List[str] = []
    score = 0

    norm: List[int] = []
    for s in status_codes or []:
        try:
            if s is None:
                continue
            norm.append(int(s))
        except Exception:
            continue

    if any(s in (401, 403) for s in norm):
        score += 12
        tags.append("authz_boundary")

    if any(500 <= s <= 599 for s in norm):
        score += 10
        tags.append("5xx_seen")

    if any(300 <= s <= 399 for s in norm):
        score += 3
        tags.append("redirect_seen")

    return score, tags


def _likely_api_mime(mime: str) -> bool:
    m = (mime or "").lower()
    return m in ("application/json", "application/xml", "text/xml") or m.endswith("+json") or m.endswith("+xml")


def _asset_like_mime(mime: str) -> bool:
    m = (mime or "").lower()
    return m.startswith(_ASSET_MIME_PREFIXES) or m in _ASSET_MIME_EXACT


def _confidence_from_evidence(tags: List[str]) -> int:
    """
    Light signal about how much evidence we have.
    Not returned as a separate field (yet), but used to nudge the score.
    """
    strong = {
        "writes", "destructive", "authz_boundary", "sensitive_path",
        "token_in_path", "id_in_path", "file_param", "redirect_param",
        "query_injection_param", "5xx_seen",
    }
    c = sum(1 for t in tags if t in strong)
    return c


# --- scoring ---

def score_action(
    a: Dict[str, Any],
    *,
    allow_hosts: Optional[List[str]] = None,
    deny_hosts: Optional[List[str]] = None,
) -> Tuple[int, List[str]]:
    """
    Pure heuristic score 0..100 for triage (NOT exploitation).
    Adds tags explaining why it scored high/low.

    allow_hosts / deny_hosts are optional and are meant to come from Project scope.
    """
    tags: List[str] = []
    score = 0

    method = (a.get("method") or "").upper()
    host = (a.get("host") or "").lower()
    path = (a.get("path_template") or "")
    mime = (a.get("top_mime") or "").lower()
    status_codes = a.get("status_codes") or []
    avg_bytes = int(a.get("avg_resp_bytes") or 0)
    has_body = bool(a.get("has_body") or False)
    qkeys = [str(x).lower() for x in (a.get("query_keys") or [])]
    avg_time_ms = float(a.get("avg_time_ms") or 0.0)
    count = int(a.get("count") or 0)

    allow_hosts_n = _norm_hosts(allow_hosts)
    deny_hosts_n = _norm_hosts(deny_hosts)

    # --- scope awareness ---
        # --- scope awareness ---
    allowed, scope_tags = _host_is_allowed(host, allow_hosts_n, deny_hosts_n)
    tags.extend(scope_tags)

    # If scope isn't configured, don't punish endpoints (just label it)
    # Optional tiny nudge:
    # if "scope_unset" in tags:
    #     score -= 2


    if _is_third_party(host, allow_hosts_n):
        tags.append("third_party")

    # De-emphasize out of scope / third-party noise (still visible)
    if not allowed:
        score -= 22
    if "third_party" in tags:
        score -= 10

    # --- method weight ---
    if method == "GET":
        score += 5
    elif method in ("HEAD", "OPTIONS"):
        score += 2
    elif method in _WRITE_METHODS:
        score += 22 if method == "POST" else 28
        tags.append("writes")
    elif method in _DESTRUCTIVE_METHODS:
        score += 34
        tags.append("destructive")
    else:
        score += 8

    # --- request body ---
    if has_body:
        score += 10
        tags.append("has_body")

    # --- path sensitivity hints ---
    hits = _contains_any(path, _SENSITIVE_PATH_HINTS)
    if hits:
        score += min(25, 5 + 3 * len(hits))
        tags.append("sensitive_path")

    # --- placeholder density in path templates ---
    ph_score, ph_tags = _path_placeholder_tags(path)
    if ph_score:
        score += ph_score
        tags.extend(ph_tags)

    # --- status signals ---
    st_score, st_tags = _status_tags(status_codes)
    if st_score:
        score += st_score
        tags.extend(st_tags)

    # --- response size (data-heavy endpoints) ---
    if avg_bytes >= 400_000:
        score += 12
        tags.append("very_large_resp")
    elif avg_bytes >= 200_000:
        score += 10
        tags.append("large_resp")
    elif avg_bytes >= 50_000:
        score += 6
        tags.append("medium_resp")

    # --- slow endpoints (heavy compute / upstream waits) ---
    if avg_time_ms >= 2000:
        score += 9
        tags.append("slow")
    elif avg_time_ms >= 1200:
        score += 7
        tags.append("slow")
    elif avg_time_ms >= 600:
        score += 4
        tags.append("slow")

    # --- query key hints ---
    id_hits = sorted(set(q for q in qkeys if q in _ID_QUERY_HINTS))
    if id_hits:
        score += min(12, 4 + 2 * len(id_hits))
        tags.append("id_query")

    redir_hits = sorted(set(q for q in qkeys if q in _REDIRECT_QUERY_HINTS))
    if redir_hits:
        score += min(14, 6 + 2 * len(redir_hits))
        tags.append("redirect_param")

    file_hits = sorted(set(q for q in qkeys if q in _FILE_QUERY_HINTS))
    if file_hits:
        score += min(12, 5 + 2 * len(file_hits))
        tags.append("file_param")

    inj_hits = sorted(set(q for q in qkeys if q in _QUERY_INJECTION_HINTS))
    if inj_hits:
        score += min(10, 4 + 2 * len(inj_hits))
        tags.append("query_injection_param")

    pag_hits = sorted(set(q for q in qkeys if q in _PAGINATION_HINTS))
    if pag_hits:
        score += 3
        tags.append("listing_pagination")

    dbg_hits = sorted(set(q for q in qkeys if q in _DEBUG_HINTS))
    if dbg_hits:
        score += 6
        tags.append("debug_param")

    # --- content-type nudges ---
    # De-emphasize obvious assets
    if _asset_like_mime(mime):
        score -= 25
        tags.append("asset_like")

    # JSON/XML endpoints usually more actionable than HTML
    if _likely_api_mime(mime):
        score += 3
        tags.append("api_like")

    # HTML is noisy unless it has strong signals elsewhere
    if mime == "text/html":
        score -= 2

    # --- frequency / “hot path” ---
    # High count endpoints might be interesting but can also be telemetry noise.
    # Small nudge only, and only if other signals exist.
    if count >= 25:
        tags.append("high_frequency")
        # If it's also api_like or has boundary signals, bump a bit.
        if "api_like" in tags or "authz_boundary" in tags or "writes" in tags:
            score += 3
        else:
            score += 1

    # --- lightweight auth/header hints (if present in action dicts later) ---
    # If actions include req/resp headers in the future, we can use them.
    # For now, keep it safe: only act if keys exist.
    for hk in ("req_headers", "resp_headers"):
        hv = a.get(hk)
        if isinstance(hv, dict):
            flat = " ".join([str(k) for k in hv.keys()])
            if _RE_AUTH_HEADER_WORDS.search(flat):
                score += 4
                tags.append("auth_headers_present")
                break

    # token-ish words in path (extra hint beyond placeholders)
    if _RE_TOKEN_WORD.search(path):
        score += 2
        tags.append("token_word_in_path")

    # --- evidence-based nudge ---
    # If we have multiple strong tags, push score a bit to separate the “real” stuff.
    conf = _confidence_from_evidence(tags)
    if conf >= 3:
        score += 3
        tags.append("multi_signal")
    elif conf == 2:
        score += 1

    # Clamp & dedupe
    score = max(0, min(100, score))
    tags = sorted(set(tags))
    return score, tags


def attach_risk(
    actions: List[Dict[str, Any]],
    *,
    allow_hosts: Optional[List[str]] = None,
    deny_hosts: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Mutates action dicts by adding:
      - risk_score
      - risk_tags

    Pass allow_hosts/deny_hosts from Project scope for better signal.
    """
    for a in actions:
        s, tags = score_action(a, allow_hosts=allow_hosts, deny_hosts=deny_hosts)
        a["risk_score"] = s
        a["risk_tags"] = tags
    return actions
