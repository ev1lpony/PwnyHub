from __future__ import annotations

import sys
from typing import Any, Dict, List

from pwnyhub_engine.policy import apply_policy_to_actions, policy_summary

MODULE = {
    "id": "policy_digest",
    "name": "Policy Digest",
    "kind": "passive",
    "targets": ["project", "actions", "program_policy"],
    "description": "Uses the saved Program Policy Profile to rank actions by bounty relevance, asset tier, exclusions, and evidence requirements.",
    "params_schema": {
        "min_policy_risk": {
            "type": "int",
            "default": 50,
            "min": 0,
            "max": 100,
            "description": "Minimum policy-adjusted risk score to create findings for reportable actions.",
        },
        "include_conditional": {
            "type": "boolean",
            "default": True,
            "description": "Include conditional findings that need impact proof.",
        },
        "include_low_value": {
            "type": "boolean",
            "default": False,
            "description": "Include low-value findings. Usually leave off for bounty-focused triage.",
        },
        "include_filtered_summary": {
            "type": "boolean",
            "default": True,
            "description": "Include summary counts for no-bounty/out-of-scope/prohibited actions without creating findings for them.",
        },
    },
}


def _install_policy_autowire() -> None:
    """
    Additive integration hook.

    main.py already discovers modules on startup. Loading this module lets us enrich the
    existing /actions path without rewriting the large engine file: every computed action
    receives policy fields/tags derived from the saved Program Policy Profile.
    """
    main_mod = sys.modules.get("pwnyhub_engine.main")
    if main_mod is None:
        return
    if getattr(main_mod, "_POLICY_AUTOWIRE_INSTALLED", False):
        return
    original = getattr(main_mod, "_compute_actions_for_project", None)
    if not callable(original):
        return

    def _policy_compute_actions_for_project(project_id: int, *, include_risk: bool) -> Dict[str, Any]:
        data = original(project_id, include_risk=include_risk)
        project_cfg: Dict[str, Any] = {}
        try:
            with main_mod.get_session() as s:
                p = s.get(main_mod.Project, project_id)
                if p:
                    project_cfg = main_mod._project_config_response(p)
        except Exception:
            project_cfg = {}

        actions = data.get("actions") if isinstance(data, dict) else []
        if isinstance(actions, list):
            enriched = apply_policy_to_actions(actions, project_cfg)
            data["actions"] = enriched
            data["policy_included"] = True
            data["policy_summary"] = policy_summary(enriched)
        return data

    main_mod._POLICY_AUTOWIRE_INSTALLED = True
    main_mod._policy_original_compute_actions_for_project = original
    main_mod._compute_actions_for_project = _policy_compute_actions_for_project


_install_policy_autowire()


def _int_param(params: Dict[str, Any], key: str, default: int) -> int:
    try:
        return int(params.get(key, default))
    except Exception:
        return default


def _bool_param(params: Dict[str, Any], key: str, default: bool) -> bool:
    if key not in params:
        return default
    v = params.get(key)
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in {"1", "true", "yes", "on"}


def _sev_from_score(score: int, disposition: str, priority: str) -> str:
    if disposition == "target" and (priority in {"critical", "high"} or score >= 80):
        return "high"
    if score >= 75:
        return "high"
    if score >= 50:
        return "med"
    if score >= 25:
        return "low"
    return "info"


def _finding_for_action(a: Dict[str, Any]) -> Dict[str, Any]:
    policy = a.get("policy") or {}
    vuln = policy.get("vulnerability") or {}
    asset = policy.get("asset") or {}
    disposition = str(policy.get("disposition") or "conditional")
    priority = str(policy.get("priority") or "medium")
    adjusted = int(a.get("policy_adjusted_risk") or a.get("risk_score") or 0)
    method = a.get("method") or ""
    host = a.get("host") or ""
    path_t = a.get("path_template") or ""
    label = vuln.get("label") or vuln.get("id") or "Policy-relevant action"
    tier = asset.get("tier") or "unknown"
    cap = vuln.get("matched_cap") or ""

    title_bits = [f"{label}: {method} {path_t}".strip()]
    if tier and tier != "unknown":
        title_bits.append(str(tier))
    if cap:
        title_bits.append(f"cap {cap}")

    requirements = vuln.get("requires") or "Manual validation and demonstrated impact required."
    invalid_if = vuln.get("invalid_if") or "No program-specific invalid conditions recorded."
    notes = vuln.get("notes") or ""
    blocking = policy.get("blocking_reason") or ""

    description = "\n".join(
        x
        for x in [
            f"Host: {host}",
            f"Policy disposition: {disposition}",
            f"Policy priority: {priority}",
            f"Asset tier/status: {tier} / {asset.get('status') or 'unknown'}",
            f"Requires: {requirements}",
            f"Invalid if: {invalid_if}",
            f"Notes: {notes}" if notes else "",
            f"Policy warning: {blocking}" if blocking else "",
        ]
        if x
    )

    tags = list(a.get("risk_tags") or [])
    for t in ["policy_digest", f"policy_{disposition}", f"policy_priority_{priority}"]:
        if t not in tags:
            tags.append(t)

    return {
        "severity": _sev_from_score(adjusted, disposition, priority),
        "title": " | ".join(title_bits),
        "description": description,
        "evidence": {
            "action_key": a.get("key"),
            "risk_score": a.get("risk_score"),
            "policy_adjusted_risk": adjusted,
            "policy": policy,
            "sample_urls": a.get("sample_urls") or [],
            "status_codes": a.get("status_codes") or [],
            "top_mime": a.get("top_mime") or "",
            "top_query_keys": a.get("top_query_keys") or [],
            "source_ids": a.get("source_ids") or [],
            "source_names": a.get("source_names") or [],
        },
        "action_keys": [a.get("key")],
        "tags": tags,
    }


def run(ctx: Dict[str, Any]) -> Dict[str, Any]:
    params = ctx.get("params") or {}
    project = ctx.get("project") or {}
    min_policy_risk = max(0, min(100, _int_param(params, "min_policy_risk", 50)))
    include_conditional = _bool_param(params, "include_conditional", True)
    include_low_value = _bool_param(params, "include_low_value", False)
    include_filtered_summary = _bool_param(params, "include_filtered_summary", True)
    action_keys = ctx.get("action_keys") or []
    keyset = set(str(k) for k in action_keys) if action_keys else None

    actions = ctx["get_actions"](include_risk=True)
    enriched = apply_policy_to_actions(actions, project)

    findings: List[Dict[str, Any]] = []
    skipped: Dict[str, int] = {}

    for a in enriched:
        k = str(a.get("key") or "")
        if keyset is not None and k not in keyset:
            continue

        disp = str(a.get("policy_disposition") or "conditional")
        adjusted = int(a.get("policy_adjusted_risk") or a.get("risk_score") or 0)

        include = bool(a.get("policy_should_report"))
        if disp == "conditional" and not include_conditional:
            include = False
        if disp == "low_value" and include_low_value:
            include = True
        if adjusted < min_policy_risk and disp != "target":
            include = False

        if include:
            findings.append(_finding_for_action(a))
        else:
            skipped[disp] = skipped.get(disp, 0) + 1

    summary = policy_summary(enriched)
    summary.update(
        {
            "min_policy_risk": min_policy_risk,
            "include_conditional": include_conditional,
            "include_low_value": include_low_value,
            "include_filtered_summary": include_filtered_summary,
            "findings_created": len(findings),
            "skipped_by_disposition": skipped,
        }
    )

    return {"findings": findings, "summary": summary}
