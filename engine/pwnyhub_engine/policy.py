from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

_DISPOSITION_RANK = {
    "prohibited": -100,
    "out_of_scope": -90,
    "no_bounty": -70,
    "known_issue": -60,
    "low_value": -20,
    "conditional": 25,
    "valid": 45,
    "target": 70,
}

_PRIORITY_RANK = {
    "noise": -20,
    "low": 10,
    "medium": 25,
    "high": 45,
    "critical": 65,
}

_BLOCKING_DISPOSITIONS = {"prohibited", "out_of_scope", "no_bounty", "known_issue"}
_REPORTABLE_DISPOSITIONS = {"target", "valid", "conditional"}


def _safe_dict(x: Any) -> Dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _safe_list(x: Any) -> List[Any]:
    return x if isinstance(x, list) else []


def _s(x: Any) -> str:
    return str(x or "").strip()


def _sl(x: Any) -> str:
    return _s(x).lower()


def _project_root(project: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(project, dict) and isinstance(project.get("project"), dict):
        return project["project"]
    return _safe_dict(project)


def project_roe(project: Dict[str, Any]) -> Dict[str, Any]:
    p = _project_root(project)
    roe = p.get("roe")
    return roe if isinstance(roe, dict) else {}


def _split_lines(text: Any) -> List[str]:
    if isinstance(text, list):
        return [_s(x) for x in text if _s(x)]
    return [_s(x) for x in str(text or "").splitlines() if _s(x)]


def _normalize_host(raw: Any) -> str:
    s = _sl(raw)
    if not s:
        return ""
    if "://" in s:
        try:
            u = urlparse(s)
            s = _sl(u.netloc or s)
        except Exception:
            pass
    s = s.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if "@" in s:
        s = s.rsplit("@", 1)[1]
    if ":" in s:
        s = s.split(":", 1)[0]
    return s.strip()


def _normalize_pattern(raw: Any) -> str:
    s = _normalize_host(raw)
    if not s:
        return ""
    return s


def _host_matches(pattern: str, host: str) -> bool:
    p = _normalize_pattern(pattern)
    h = _normalize_host(host)
    if not p or not h:
        return False
    if p == h:
        return True
    if p.startswith("*."):
        suffix = p[1:]  # .example.com
        return h.endswith(suffix) and h != suffix.lstrip(".")
    if p.startswith("*"):
        return h.endswith(p.lstrip("*"))
    if p.endswith(".*"):
        return h.startswith(p[:-1])
    return False


def parse_asset_table(text: Any) -> List[Dict[str, str]]:
    """
    Accept quick BBP table paste lines like:
      payment.example.com | Tier 1 | URL | notes
      *.example.com, Tier 2, Wildcard, notes

    We intentionally keep this forgiving. It is a policy helper, not a strict schema.
    """
    rows: List[Dict[str, str]] = []
    for line in _split_lines(text):
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in re.split(r"\s*\|\s*|\s*,\s*", line) if p.strip()]
        if not parts:
            continue
        asset = parts[0]
        tier = parts[1] if len(parts) >= 2 else ""
        typ = parts[2] if len(parts) >= 3 else ""
        notes = " | ".join(parts[3:]) if len(parts) >= 4 else ""
        rows.append({"asset": asset, "tier": tier, "type": typ, "notes": notes, "raw": line})
    return rows


def _match_first_asset(host: str, rows: Iterable[Dict[str, str]]) -> Optional[Dict[str, str]]:
    for row in rows:
        if _host_matches(row.get("asset", ""), host):
            return dict(row)
    return None


def evaluate_asset_policy(action: Dict[str, Any], project: Dict[str, Any]) -> Dict[str, Any]:
    roe = project_roe(project)
    pp = _safe_dict(roe.get("program_policy"))
    host = _s(action.get("host"))

    out_rows = parse_asset_table(pp.get("out_of_scope_assets_text"))
    no_bounty_rows = parse_asset_table(pp.get("no_bounty_assets_text"))
    asset_rows = parse_asset_table(pp.get("assets_text"))

    out_match = _match_first_asset(host, out_rows)
    if out_match:
        return {
            "status": "out_of_scope",
            "disposition": "out_of_scope",
            "tier": out_match.get("tier") or "out_of_scope",
            "matched_asset": out_match,
            "reason": "Host matches program out-of-scope assets.",
        }

    nb_match = _match_first_asset(host, no_bounty_rows)
    if nb_match:
        return {
            "status": "no_bounty",
            "disposition": "no_bounty",
            "tier": nb_match.get("tier") or "no_bounty",
            "matched_asset": nb_match,
            "reason": "Host matches program no-bounty assets.",
        }

    asset_match = _match_first_asset(host, asset_rows)
    if asset_match:
        return {
            "status": "in_scope",
            "disposition": "valid",
            "tier": asset_match.get("tier") or "in_scope",
            "matched_asset": asset_match,
            "reason": "Host matches program in-scope assets.",
        }

    tags = set(_safe_list(action.get("risk_tags")))
    if "out_of_scope" in tags or "denylisted_host" in tags:
        return {
            "status": "out_of_scope",
            "disposition": "out_of_scope",
            "tier": "out_of_scope",
            "matched_asset": None,
            "reason": "Risk/scope tags mark this host as out of scope.",
        }
    if "third_party" in tags:
        return {
            "status": "review",
            "disposition": "conditional",
            "tier": "third_party_review",
            "matched_asset": None,
            "reason": "Third-party host; verify program policy before testing/reporting.",
        }

    return {
        "status": "unknown",
        "disposition": "conditional",
        "tier": "unknown",
        "matched_asset": None,
        "reason": "No program asset policy match. Review manually.",
    }


def infer_vulnerability_candidates(action: Dict[str, Any]) -> List[str]:
    tags = set(str(t) for t in _safe_list(action.get("risk_tags")))
    path = _sl(action.get("path_template"))
    method = _sl(action.get("method"))
    mime = _sl(action.get("top_mime"))
    query_keys = " ".join(_sl(x) for x in _safe_list(action.get("query_keys")))
    top_query = " ".join(_sl(x.get("value")) for x in _safe_list(action.get("top_query_keys")) if isinstance(x, dict))
    q = f"{query_keys} {top_query}"
    blob = f"{path} {q} {mime}"

    out: List[str] = []

    def add(x: str) -> None:
        if x not in out:
            out.append(x)

    if "authz_boundary" in tags or "id_query" in tags or "id_in_path" in tags or "{int}" in path or "{uuid}" in path:
        add("idor_bac")
    if any(x in path for x in ("/admin", "/internal", "/staff", "/support")):
        add("privilege_escalation")
    if any(x in path for x in ("tenant", "organization", "org", "workspace", "company", "account")) and ("{int}" in path or "{uuid}" in path or "id" in q):
        add("tenant_isolation")
    if method in {"post", "put", "patch", "delete"} and any(x in path for x in ("approve", "verify", "payment", "transfer", "withdraw", "order", "checkout", "refund", "workflow")):
        add("business_logic")
    if method in {"post", "put", "patch", "delete"}:
        add("workflow_bypass")

    if "query_injection_param" in tags or any(x in q for x in ("query", "search", "filter", "where", "sort", "sql", "select")):
        add("server_side_injection")
    if any(x in blob for x in ("template", "render", "view", "preview")):
        add("server_side_injection")
    if "file_param" in tags or any(x in q for x in ("file", "path", "filename", "document", "template")):
        add("local_file_read_xxe")
    if any(x in blob for x in ("xml", "xxe", "soap")):
        add("local_file_read_xxe")

    if any(x in blob for x in ("url", "uri", "callback", "webhook", "redirect_uri", "return_url", "next", "dest", "target")):
        add("open_redirect")
        add("full_read_ssrf")
    if any(x in path for x in ("webhook", "callback", "fetch", "import", "preview", "proxy", "avatar", "image")):
        add("full_read_ssrf")
    if any(x in path for x in ("upload", "file", "attachment", "import")) or "multipart" in mime:
        add("file_upload_executable")

    if "redirect_param" in tags:
        add("open_redirect")
    if any(x in path for x in ("cors", "origin")) or "origin" in q:
        add("cors")
    if method in {"post", "put", "patch", "delete"} and not ("auth_headers_present" in tags):
        add("csrf")
    if any(x in path for x in ("clickjack", "frame")):
        add("clickjacking")
    if any(x in q for x in ("html", "content", "body", "message", "description", "comment", "name", "title")):
        add("xss")
        add("content_injection")

    if any(x in path for x in ("metrics", "status", "debug", "version", "health", "actuator")):
        add("info_disclosure_low")
    if "asset_like" in tags:
        add("scanner_only")

    return out or ["scanner_only"]


def _policy_record_for(roe: Dict[str, Any], vuln_id: str) -> Dict[str, Any]:
    pp = _safe_dict(roe.get("program_policy"))
    vulns = _safe_dict(pp.get("vulnerabilities"))
    rec = _safe_dict(vulns.get(vuln_id))
    if rec:
        return rec
    return {
        "id": vuln_id,
        "label": vuln_id,
        "group": "Inferred",
        "disposition": "conditional",
        "priority": "medium",
        "requires": "Manual validation and demonstrated security impact required.",
        "invalid_if": "No demonstrable impact or only automated scanner output.",
        "notes": "No program-specific policy record found for this inferred class.",
    }


def _choose_policy_record(roe: Dict[str, Any], candidates: List[str]) -> Dict[str, Any]:
    best: Optional[Tuple[int, Dict[str, Any]]] = None
    for cid in candidates:
        rec = dict(_policy_record_for(roe, cid))
        disp = _sl(rec.get("disposition")) or "conditional"
        pri = _sl(rec.get("priority")) or "medium"
        score = _DISPOSITION_RANK.get(disp, 0) + _PRIORITY_RANK.get(pri, 0)
        if best is None or score > best[0]:
            best = (score, rec)
    return best[1] if best else _policy_record_for(roe, "scanner_only")


def evaluate_action_policy(action: Dict[str, Any], project: Dict[str, Any]) -> Dict[str, Any]:
    roe = project_roe(project)
    asset = evaluate_asset_policy(action, project)
    candidates = infer_vulnerability_candidates(action)
    rec = _choose_policy_record(roe, candidates)

    vuln_disp = _sl(rec.get("disposition")) or "conditional"
    asset_disp = _sl(asset.get("disposition")) or "conditional"

    final = vuln_disp
    blocking_reason = ""
    if asset_disp in _BLOCKING_DISPOSITIONS:
        final = asset_disp
        blocking_reason = asset.get("reason", "Asset policy blocks or filters this action.")
    elif vuln_disp in _BLOCKING_DISPOSITIONS:
        final = vuln_disp
        blocking_reason = rec.get("invalid_if") or "Vulnerability policy blocks or filters this class."

    priority = _sl(rec.get("priority")) or "medium"
    tier = _s(asset.get("tier")) or "unknown"
    cap = ""
    t_low = tier.lower()
    if "1" in t_low:
        cap = _s(rec.get("tier1_cap"))
    elif "2" in t_low:
        cap = _s(rec.get("tier2_cap"))
    elif "3" in t_low:
        cap = _s(rec.get("tier3_cap"))

    tags = [f"policy_{final}", f"policy_vuln_{_s(rec.get('id')) or 'unknown'}"]
    if tier:
        tags.append("asset_" + re.sub(r"[^a-z0-9]+", "_", tier.lower()).strip("_"))
    if final == "target":
        tags.append("policy_money_target")
    if final == "conditional":
        tags.append("policy_needs_impact")
    if final in _BLOCKING_DISPOSITIONS:
        tags.append("policy_filtered")

    should_report = final in _REPORTABLE_DISPOSITIONS
    return {
        "disposition": final,
        "priority": priority,
        "should_report": should_report,
        "blocking_reason": blocking_reason,
        "asset": asset,
        "vulnerability": {
            "id": _s(rec.get("id")) or candidates[0],
            "label": _s(rec.get("label")) or candidates[0],
            "group": _s(rec.get("group")),
            "candidates": candidates,
            "requires": _s(rec.get("requires")),
            "invalid_if": _s(rec.get("invalid_if")),
            "notes": _s(rec.get("notes")),
            "tier1_cap": _s(rec.get("tier1_cap")),
            "tier2_cap": _s(rec.get("tier2_cap")),
            "tier3_cap": _s(rec.get("tier3_cap")),
            "matched_cap": cap,
        },
        "tags": tags,
        "score_adjustment": _score_adjustment(final, priority, tier),
    }


def _score_adjustment(disposition: str, priority: str, tier: str) -> int:
    disp = _sl(disposition)
    pri = _sl(priority)
    tier_l = _sl(tier)
    score = 0
    if disp == "target":
        score += 15
    elif disp == "valid":
        score += 8
    elif disp == "conditional":
        score += 0
    elif disp == "low_value":
        score -= 15
    elif disp in _BLOCKING_DISPOSITIONS:
        score -= 45
    if pri == "critical":
        score += 10
    elif pri == "high":
        score += 6
    elif pri == "noise":
        score -= 10
    if "tier 1" in tier_l or tier_l == "tier1":
        score += 8
    elif "tier 2" in tier_l or tier_l == "tier2":
        score += 4
    elif "no_bounty" in tier_l or "out_of_scope" in tier_l:
        score -= 25
    return score


def apply_policy_to_actions(actions: List[Dict[str, Any]], project: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for a in actions:
        b = dict(a)
        policy = evaluate_action_policy(b, project)
        b["policy"] = policy
        b["policy_disposition"] = policy.get("disposition")
        b["policy_priority"] = policy.get("priority")
        b["policy_vulnerability"] = policy.get("vulnerability", {}).get("label")
        b["policy_asset_tier"] = policy.get("asset", {}).get("tier")
        b["policy_should_report"] = bool(policy.get("should_report"))
        b["policy_score_adjustment"] = int(policy.get("score_adjustment") or 0)
        tags = list(b.get("risk_tags") or [])
        for t in policy.get("tags") or []:
            if t not in tags:
                tags.append(t)
        b["risk_tags"] = tags
        if b.get("risk_score") is not None:
            try:
                b["policy_adjusted_risk"] = max(0, min(100, int(b.get("risk_score") or 0) + int(policy.get("score_adjustment") or 0)))
            except Exception:
                b["policy_adjusted_risk"] = b.get("risk_score")
        out.append(b)
    return out


def policy_summary(actions: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_disposition: Dict[str, int] = {}
    by_vuln: Dict[str, int] = {}
    by_tier: Dict[str, int] = {}
    reportable = 0
    filtered = 0
    for a in actions:
        disp = _s(a.get("policy_disposition") or a.get("policy", {}).get("disposition") or "unknown")
        vuln = _s(a.get("policy_vulnerability") or a.get("policy", {}).get("vulnerability", {}).get("label") or "unknown")
        tier = _s(a.get("policy_asset_tier") or a.get("policy", {}).get("asset", {}).get("tier") or "unknown")
        by_disposition[disp] = by_disposition.get(disp, 0) + 1
        by_vuln[vuln] = by_vuln.get(vuln, 0) + 1
        by_tier[tier] = by_tier.get(tier, 0) + 1
        if a.get("policy_should_report"):
            reportable += 1
        if disp in _BLOCKING_DISPOSITIONS or disp == "low_value":
            filtered += 1
    return {
        "by_disposition": by_disposition,
        "by_vulnerability": by_vuln,
        "by_asset_tier": by_tier,
        "reportable": reportable,
        "filtered_or_low_value": filtered,
    }
