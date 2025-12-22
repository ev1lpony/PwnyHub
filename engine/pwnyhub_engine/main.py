from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select

from .actions import actions_to_json, build_actions
from .db import HarEntry, Project, get_session, init_db
from .har_import import is_asset_mime, parse_har
from .risk import attach_risk

app = FastAPI(title="PwnyHub Engine", version="0.1.0")

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
    return {"ok": True, "service": "pwnyhub-engine", "docs": "/docs"}


@app.get("/health")
def health():
    return {"ok": True}


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

    s = s.strip()

    # If they pasted a URL, parse it and use netloc
    if "://" in s:
        try:
            u = urlparse(s)
            host = (u.netloc or "").strip()
        except Exception:
            host = s
    else:
        # Could still include paths like example.com/foo
        # Split off path/query fragments defensively.
        host = s.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0].strip()

    if not host:
        return None

    host = host.lower()

    # If they included credentials (rare), strip them: user:pass@host
    if "@" in host:
        host = host.split("@", 1)[1]

    # Strip port if present (except wildcard patterns where : is still a port delimiter)
    # "*.example.com:443" -> "*.example.com"
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
      - wildcard patterns (e.g. "*.foo.com") are preserved
      - blank lines ignored
      - URLs are accepted and normalized to host patterns
    """
    out: List[str] = []

    for raw in (scope_text or "").splitlines():
        p = _normalize_scope_pattern(raw)
        if not p:
            continue

        # If user already used wildcard (or any *), keep as-is.
        if "*" in p:
            out.append(p)
            continue

        # Keep exact host
        out.append(p)

        # Add subdomain wildcard for normal domains (skip localhost-ish)
        if p not in ("localhost", "127.0.0.1") and "." in p and not p.startswith("."):
            out.append(f"*.{p}")

    # Dedup while keeping order
    seen = set()
    deduped: List[str] = []
    for x in out:
        if x not in seen:
            seen.add(x)
            deduped.append(x)
    return deduped


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


@app.post("/import/har")
def import_har(
    project_id: int = Form(...),
    file: UploadFile = File(...),
    include_assets: bool = Form(False),
):
    # Ensure project exists (nice error instead of silently inserting)
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    har_bytes = file.file.read()
    items = parse_har(har_bytes)

    inserted = 0
    skipped_assets = 0

    with get_session() as s:
        for it in items:
            if (not include_assets) and is_asset_mime(it.mime):
                skipped_assets += 1
                continue

            row = HarEntry(
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
            s.add(row)
            inserted += 1

        s.commit()

    return {"inserted": inserted, "skipped_assets": skipped_assets, "total": len(items)}


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

    # UI currently expects arrays of [key, count]
    hosts_sorted = sorted(by_host.items(), key=lambda x: x[1], reverse=True)[:25]
    mimes_sorted = sorted(by_mime.items(), key=lambda x: x[1], reverse=True)[:25]

    return {
        "project_id": project_id,
        "entries": len(rows),
        "entries_stored": len(rows),  # backward compat
        "hosts": [[k, v] for (k, v) in hosts_sorted],
        "mimes": [[k, v] for (k, v) in mimes_sorted],
        # Extra (future-proof): maps for quick lookups / charts
        "hosts_map": {k: v for (k, v) in hosts_sorted},
        "mimes_map": {k: v for (k, v) in mimes_sorted},
    }


@app.get("/actions")
def actions(
    project_id: int,
    include_risk: bool = True,
):
    # Load project to get scope allow/deny for risk scoring (and to 404 nicely)
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

        entries = s.exec(select(HarEntry).where(HarEntry.project_id == project_id)).all()

    acts = build_actions(entries)
    out = actions_to_json(acts)

    allow_hosts: List[str] = []
    deny_hosts: List[str] = []

    if include_risk:
        allow_hosts = _parse_scope_lines(p.scope_allow or "")
        deny_hosts = _parse_scope_lines(p.scope_deny or "")
        out = attach_risk(out, allow_hosts=allow_hosts, deny_hosts=deny_hosts)

    return {
        "project_id": project_id,
        "actions": out,
        "risk_included": bool(include_risk),
        "scope": {
            "allow_hosts": allow_hosts,
            "deny_hosts": deny_hosts,
        },
    }
