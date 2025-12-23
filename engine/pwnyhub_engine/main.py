from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select

from .actions import actions_to_json, build_actions
from .db import Finding, HarEntry, Project, Run, get_session, init_db
from .har_import import is_asset_mime, parse_har
from .risk import attach_risk

app = FastAPI(title="PwnyHub Engine", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/")
def root():
    return {"ok": True, "service": "pwnyhub-engine", "version": app.version, "docs": "/docs"}


@app.get("/health")
def health():
    return {"ok": True}


# -----------------------------
# helpers / utilities
# -----------------------------

def _model_to_dict(x: Any) -> Dict[str, Any]:
    if x is None:
        return {}
    if hasattr(x, "model_dump"):
        return x.model_dump()
    if hasattr(x, "dict"):
        return x.dict()
    # last resort
    return dict(x)


def _coerce_scope(value: Any) -> str:
    """
    Accept either:
      - newline-separated string
      - list[str]
      - None
    Return newline-separated string for DB storage.
    """
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(str(x).strip() for x in value if str(x).strip())
    return str(value).strip()


def _normalize_scope_pattern(raw: str) -> Optional[str]:
    """
    Normalize a user-provided scope line into a host pattern.
    Supports:
      - example.com
      - *.example.com
      - https://example.com/foo
      - example.com:443
      - localhost / 127.0.0.1
    Returns None if unusable.
    """
    s = (raw or "").strip()
    if not s:
        return None

    # If they pasted a URL, parse it and use netloc
    if "://" in s:
        try:
            u = urlparse(s)
            host = (u.netloc or "").strip()
        except Exception:
            host = s
    else:
        # Could still include paths like example.com/foo
        host = s.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0].strip()

    if not host:
        return None

    host = host.lower()

    # Strip creds: user:pass@host
    if "@" in host:
        host = host.split("@", 1)[1]

    # Strip port: host:443 -> host
    if ":" in host:
        host = host.split(":", 1)[0]

    host = host.strip()
    if not host:
        return None

    return host


def _parse_scope_lines(scope_text: str) -> List[str]:
    """
    Convert stored newline-separated scope into normalized host patterns.

    Convenience behavior:
      - "example.com" becomes ["example.com", "*.example.com"]
      - wildcard patterns preserved
      - blank lines ignored
      - URLs accepted and normalized
    """
    out: List[str] = []
    for raw in (scope_text or "").splitlines():
        p = _normalize_scope_pattern(raw)
        if not p:
            continue

        if "*" in p:
            out.append(p)
            continue

        out.append(p)
        if p not in ("localhost", "127.0.0.1") and "." in p and not p.startswith("."):
            out.append(f"*.{p}")

    # dedup keep order
    seen = set()
    deduped: List[str] = []
    for x in out:
        if x not in seen:
            seen.add(x)
            deduped.append(x)
    return deduped


def _read_upload_limited(upload: UploadFile, *, max_bytes: int) -> bytes:
    """
    Read an UploadFile into memory with a hard cap.
    Prevents accidental OOM for huge HARs.

    NOTE: This still reads into memory (because parse_har expects bytes).
    True "big HAR" support later = streaming parse.
    """
    buf = bytearray()
    chunk_size = 1024 * 1024  # 1MB
    while True:
        chunk = upload.file.read(chunk_size)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload too large. Limit is {max_bytes} bytes (PWNYHUB_MAX_HAR_BYTES).",
            )
    return bytes(buf)


def _modules_registry() -> List[Dict[str, Any]]:
    """
    Keep this simple and explicit for now.
    Later we can make this dynamic + plugin-based.
    """
    return [
        {
            "id": "risk_digest",
            "name": "Risk Digest",
            "kind": "passive",
            "targets": ["project", "actions"],
            "description": "Converts high-risk actions into persisted findings (triage list).",
            "params_schema": {
                "min_risk": {"type": "int", "default": 70, "min": 0, "max": 100},
            },
        },
    ]


def _compute_actions_for_project(project_id: int, *, include_risk: bool) -> Dict[str, Any]:
    """
    Shared internal helper so modules can reuse the exact same action-building logic.
    Returns dict containing: actions, allow_hosts, deny_hosts, risk_included
    """
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

        entries = s.exec(select(HarEntry).where(HarEntry.project_id == project_id)).all()

        allow_hosts = _parse_scope_lines(p.scope_allow or "")
        deny_hosts = _parse_scope_lines(p.scope_deny or "")

    acts = build_actions(entries)
    out = actions_to_json(acts)

    if include_risk:
        out = attach_risk(out, allow_hosts=allow_hosts, deny_hosts=deny_hosts)

    return {
        "actions": out,
        "allow_hosts": allow_hosts,
        "deny_hosts": deny_hosts,
        "risk_included": bool(include_risk),
    }


# -----------------------------
# projects
# -----------------------------

@app.post("/projects")
def create_project(payload: Dict[str, Any] = Body(...)):
    name = (payload.get("name") or "Untitled").strip()

    scope_allow = _coerce_scope(payload.get("scope_allow"))
    scope_deny = _coerce_scope(payload.get("scope_deny"))

    try:
        qps = float(payload.get("qps") or 3.0)
    except Exception:
        qps = 3.0

    p = Project(name=name, scope_allow=scope_allow, scope_deny=scope_deny, qps=qps)

    with get_session() as s:
        s.add(p)
        s.commit()
        s.refresh(p)

    return {"id": p.id, "name": p.name, "qps": p.qps}


@app.get("/projects")
def list_projects():
    with get_session() as s:
        rows = s.exec(select(Project)).all()
    return [{"id": r.id, "name": r.name, "qps": r.qps} for r in rows]


# -----------------------------
# har import
# -----------------------------

@app.post("/import/har")
def import_har(
    project_id: int = Form(...),
    file: UploadFile = File(...),
    include_assets: bool = Form(False),
):
    # Ensure project exists
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    # Size guard (default 256MB)
    max_bytes = int(os.getenv("PWNYHUB_MAX_HAR_BYTES", str(256 * 1024 * 1024)))
    har_bytes = _read_upload_limited(file, max_bytes=max_bytes)

    # Parse HAR (still in-memory today)
    items = parse_har(har_bytes)

    inserted = 0
    skipped_assets = 0

    # Batch inserts for speed
    BATCH_N = int(os.getenv("PWNYHUB_INSERT_BATCH", "1000"))
    batch: List[HarEntry] = []

    with get_session() as s:
        for it in items:
            if (not include_assets) and is_asset_mime(it.mime):
                skipped_assets += 1
                continue

            batch.append(
                HarEntry(
                    project_id=project_id,
                    method=it.method,
                    url=it.url,
                    host=it.host,
                    path=it.path,
                    query=it.query,
                    req_headers_json=json.dumps(it.req_headers),
                    req_body_text=it.req_body,
                    status=it.status,
                    mime=it.mime,
                    resp_headers_json=json.dumps(it.resp_headers),
                    resp_body_text=it.resp_body,
                    time_ms=it.time_ms,
                    body_size=it.body_size,
                )
            )
            inserted += 1

            if len(batch) >= BATCH_N:
                s.add_all(batch)
                s.commit()
                batch.clear()

        if batch:
            s.add_all(batch)
            s.commit()
            batch.clear()

    return {"inserted": inserted, "skipped_assets": skipped_assets, "total": len(items)}


# -----------------------------
# summary
# -----------------------------

@app.get("/summary")
def project_summary(project_id: int):
    with get_session() as s:
        rows = s.exec(select(HarEntry).where(HarEntry.project_id == project_id)).all()

    by_host: Dict[str, int] = {}
    by_mime: Dict[str, int] = {}

    for r in rows:
        h = (r.host or "").strip()
        m = (r.mime or "").strip()
        if h:
            by_host[h] = by_host.get(h, 0) + 1
        if m:
            by_mime[m] = by_mime.get(m, 0) + 1

    hosts_sorted = sorted(by_host.items(), key=lambda x: x[1], reverse=True)[:25]
    mimes_sorted = sorted(by_mime.items(), key=lambda x: x[1], reverse=True)[:25]

    return {
        "project_id": project_id,
        "entries": len(rows),
        "entries_stored": len(rows),  # backward compat
        "hosts": [[k, v] for (k, v) in hosts_sorted],
        "mimes": [[k, v] for (k, v) in mimes_sorted],
        "hosts_map": {k: v for (k, v) in hosts_sorted},
        "mimes_map": {k: v for (k, v) in mimes_sorted},
    }


# -----------------------------
# actions
# -----------------------------

@app.get("/actions")
def actions(
    project_id: int,
    include_risk: bool = True,
):
    data = _compute_actions_for_project(project_id, include_risk=include_risk)
    return {
        "project_id": project_id,
        "actions": data["actions"],
        "risk_included": data["risk_included"],
        "scope": {
            "allow_hosts": data["allow_hosts"],
            "deny_hosts": data["deny_hosts"],
        },
    }


# -----------------------------
# modules / runs / findings
# -----------------------------

@app.get("/modules")
def list_modules():
    return {"modules": _modules_registry()}


@app.post("/runs")
def create_run(payload: Dict[str, Any] = Body(...)):
    """
    MVP: Runs are synchronous (fast modules only).
    Later: background job queue + progress.
    """
    try:
        project_id = int(payload.get("project_id") or 0)
    except Exception:
        project_id = 0

    module_id = str(payload.get("module_id") or "").strip()
    params = payload.get("params") or {}
    action_keys = payload.get("action_keys") or []

    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")
    if not module_id:
        raise HTTPException(status_code=400, detail="module_id is required")

    # Validate module exists
    mod_ids = {m["id"] for m in _modules_registry()}
    if module_id not in mod_ids:
        raise HTTPException(status_code=400, detail=f"Unknown module_id: {module_id}")

    # Verify project exists + create run row
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

        run = Run(
            project_id=project_id,
            module_id=module_id,
            status="running",
            created_at=datetime.now(timezone.utc),
            started_at=datetime.now(timezone.utc),
            params_json=json.dumps(params),
            selected_action_keys_json=json.dumps(action_keys),
            summary_json="{}",
            error="",
        )
        s.add(run)
        s.commit()
        s.refresh(run)

    # Execute module synchronously
    try:
        findings_created = 0

        if module_id == "risk_digest":
            min_risk = int(params.get("min_risk", 70))
            min_risk = max(0, min(100, min_risk))

            # We need risk for this module
            data = _compute_actions_for_project(project_id, include_risk=True)
            acts = data["actions"]

            keyset = set(str(k) for k in action_keys) if action_keys else None

            to_insert: List[Finding] = []
            for a in acts:
                k = str(a.get("key") or "")
                if not k:
                    continue
                if keyset is not None and k not in keyset:
                    continue

                rs = int(a.get("risk_score") or 0)
                if rs < min_risk:
                    continue

                tags = a.get("risk_tags") or []
                method = a.get("method") or ""
                host = a.get("host") or ""
                path_t = a.get("path_template") or ""

                title = f"High-risk endpoint ({rs}) {method} {path_t}"
                desc = f"Host: {host}\nTags: {', '.join(tags) if tags else '(none)'}"

                sev = "med"
                if rs >= 85:
                    sev = "high"
                elif rs >= 70:
                    sev = "med"
                else:
                    sev = "low"

                to_insert.append(
                    Finding(
                        project_id=project_id,
                        run_id=run.id,
                        module_id=module_id,
                        severity=sev,
                        title=title,
                        description=desc,
                        evidence_json=json.dumps(
                            {
                                "risk_score": rs,
                                "risk_tags": tags,
                                "sample_urls": a.get("sample_urls") or [],
                                "status_codes": a.get("status_codes") or [],
                                "top_mime": a.get("top_mime") or "",
                                "avg_time_ms": a.get("avg_time_ms"),
                                "avg_resp_bytes": a.get("avg_resp_bytes"),
                            }
                        ),
                        action_keys_json=json.dumps([k]),
                        tags_json=json.dumps(tags),
                        created_at=datetime.now(timezone.utc),
                    )
                )

            with get_session() as s:
                if to_insert:
                    s.add_all(to_insert)
                    s.commit()
                findings_created = len(to_insert)

        # Mark run done
        with get_session() as s:
            rr = s.get(Run, run.id)
            if rr:
                rr.status = "done"
                rr.finished_at = datetime.now(timezone.utc)
                rr.summary_json = json.dumps({"findings_created": findings_created})
                s.add(rr)
                s.commit()

        return {
            "run_id": run.id,
            "status": "done",
            "findings_created": findings_created,
        }

    except Exception as e:
        # Mark run failed
        with get_session() as s:
            rr = s.get(Run, run.id)
            if rr:
                rr.status = "failed"
                rr.finished_at = datetime.now(timezone.utc)
                rr.error = str(e)
                s.add(rr)
                s.commit()
        raise


@app.get("/runs")
def list_runs(project_id: int):
    with get_session() as s:
        rows = s.exec(
            select(Run).where(Run.project_id == project_id).order_by(Run.id.desc())
        ).all()
    return {"project_id": project_id, "runs": [_model_to_dict(r) for r in rows]}


@app.get("/runs/{run_id}")
def get_run(run_id: int):
    with get_session() as s:
        r = s.get(Run, run_id)
        if not r:
            raise HTTPException(status_code=404, detail="run not found")
    return {"run": _model_to_dict(r)}


@app.get("/runs/{run_id}/findings")
def run_findings(run_id: int):
    with get_session() as s:
        r = s.get(Run, run_id)
        if not r:
            raise HTTPException(status_code=404, detail="run not found")

        rows = s.exec(
            select(Finding).where(Finding.run_id == run_id).order_by(Finding.id.desc())
        ).all()

    return {"run_id": run_id, "project_id": r.project_id, "findings": [_model_to_dict(f) for f in rows]}
