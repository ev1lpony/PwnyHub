from __future__ import annotations

import json
from typing import Any, Dict, List

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

    return [
        {
            "id": r.id,
            "name": r.name,
            "qps": r.qps,
        }
        for r in rows
    ]


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

    # Sort then convert back to dict to keep UI simple (Object.entries)
    hosts_sorted = sorted(by_host.items(), key=lambda x: x[1], reverse=True)[:25]
    mimes_sorted = sorted(by_mime.items(), key=lambda x: x[1], reverse=True)[:25]

    return {
        "project_id": project_id,
        "entries": len(rows),
        "entries_stored": len(rows),  # backward compat for UI
        "hosts": {k: v for (k, v) in hosts_sorted},
        "mimes": {k: v for (k, v) in mimes_sorted},
    }


@app.get("/actions")
def actions(
    project_id: int,
    include_risk: bool = True,
):
    with get_session() as s:
        entries = s.exec(select(HarEntry).where(HarEntry.project_id == project_id)).all()

    acts = build_actions(entries)
    out = actions_to_json(acts)

    if include_risk:
        out = attach_risk(out)

    return {"project_id": project_id, "actions": out}
