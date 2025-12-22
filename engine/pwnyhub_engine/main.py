from __future__ import annotations

import json
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select

from .db import init_db, get_session, Project, HarEntry
from .har_import import parse_har, is_asset_mime

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


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/projects")
def create_project(payload: dict):
    name = payload.get("name") or "Untitled"
    scope_allow = "\n".join(payload.get("scope_allow") or [])
    scope_deny = "\n".join(payload.get("scope_deny") or [])
    qps = float(payload.get("qps") or 3.0)

    p = Project(name=name, scope_allow=scope_allow, scope_deny=scope_deny, qps=qps)
    with get_session() as s:
        s.add(p)
        s.commit()
        s.refresh(p)
    return {"id": p.id, "name": p.name}


@app.get("/projects")
def list_projects():
    with get_session() as s:
        rows = s.exec(select(Project)).all()
    return [{"id": r.id, "name": r.name, "qps": r.qps} for r in rows]


@app.post("/import/har")
def import_har(project_id: int, har: UploadFile = File(...), include_assets: bool = False):
    har_bytes = har.file.read()
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

    by_host = {}
    by_mime = {}
    for r in rows:
        by_host[r.host] = by_host.get(r.host, 0) + 1
        by_mime[r.mime] = by_mime.get(r.mime, 0) + 1

    return {
        "entries": len(rows),
        "hosts": sorted(by_host.items(), key=lambda x: x[1], reverse=True)[:25],
        "mimes": sorted(by_mime.items(), key=lambda x: x[1], reverse=True)[:25],
    }

@app.get("/")
def root():
    return {"ok": True, "service": "pwnyhub-engine", "docs": "/docs"}
