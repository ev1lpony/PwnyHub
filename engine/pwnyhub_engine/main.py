from __future__ import annotations

import importlib.util
import json
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select

from pwnyhub_engine.modules.registry import ModuleRegistry
from .actions import actions_to_json, build_actions
from .db import Finding, HarEntry, Project, Run, Source, get_session, init_db
from .har_import import is_asset_mime, parse_har
from .risk import attach_risk

app = FastAPI(title="PwnyHub Engine", version="0.3.1")

module_registry = ModuleRegistry()

# -----------------------------
# ML Risk Configuration
# -----------------------------
ML_RISK_ENABLED: bool = False
ML_MODEL_PATH: Optional[str] = None

if os.getenv("PWNYHUB_ML_RISK_ENABLED", "").strip().lower() in ("1", "true", "yes", "on"):
    ML_RISK_ENABLED = True
if os.getenv("PWNYHUB_ML_MODEL_PATH"):
    ML_MODEL_PATH = os.getenv("PWNYHUB_ML_MODEL_PATH")


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

# -----------------------------
# module registry (dynamic)
# -----------------------------

ModuleRunner = Callable[[Dict[str, Any]], Dict[str, Any]]

_MODULE_CACHE: Dict[str, Any] = {
    "loaded_at": 0.0,
    "modules": [],
    "runners": {},
    "errors": [],
}


@app.on_event("startup")
def _startup() -> None:
    init_db()
    _refresh_modules_cache()


@app.on_event("startup")
def _discover_modules() -> None:
    module_registry.discover()


@app.get("/")
def root():
    return {"ok": True, "service": "pwnyhub-engine", "version": app.version, "docs": "/docs"}


@app.get("/health")
def health():
    return {"ok": True}


# -----------------------------
# ML Settings endpoints
# -----------------------------
@app.get("/settings/ml")
def get_ml_settings():
    return {
        "ml_risk_enabled": ML_RISK_ENABLED,
        "model_path": ML_MODEL_PATH,
        "model_loaded": False,
    }


@app.patch("/settings/ml")
def update_ml_settings(payload: Dict[str, Any] = Body(...)):
    global ML_RISK_ENABLED, ML_MODEL_PATH

    if "enabled" in payload:
        ML_RISK_ENABLED = bool(payload["enabled"])

    if "model_path" in payload:
        ML_MODEL_PATH = payload.get("model_path") or None

    return {
        "ml_risk_enabled": ML_RISK_ENABLED,
        "model_path": ML_MODEL_PATH,
    }


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
    return dict(x)


def _coerce_scope(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "\n".join(str(x).strip() for x in value if str(x).strip())
    return str(value).strip()


def _normalize_scope_pattern(raw: str) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        return None

    if "://" in s:
        try:
            u = urlparse(s)
            host = (u.netloc or "").strip()
        except Exception:
            host = s
    else:
        host = s.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0].strip()

    if not host:
        return None

    host = host.lower()

    if "@" in host:
        host = host.split("@", 1)[1]

    if ":" in host:
        host = host.split(":", 1)[0]

    host = host.strip()
    if not host:
        return None

    return host


def _parse_scope_lines(scope_text: str) -> List[str]:
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

    seen = set()
    deduped: List[str] = []
    for x in out:
        if x not in seen:
            seen.add(x)
            deduped.append(x)
    return deduped


def _scope_text_to_lines(scope_text: str) -> List[str]:
    out: List[str] = []
    for raw in (scope_text or "").splitlines():
        s = (raw or "").strip()
        if s:
            out.append(s)
    return out


def _read_upload_limited(upload: UploadFile, *, max_bytes: int) -> bytes:
    buf = bytearray()
    chunk_size = 1024 * 1024
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


def _coerce_roe_json(value: Any) -> str:
    if value is None:
        return "{}"
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    s = str(value).strip()
    if not s:
        return "{}"
    try:
        parsed = json.loads(s)
    except Exception:
        raise HTTPException(status_code=400, detail="roe_json must be valid JSON (string) or an object")
    return json.dumps(parsed)



def _coerce_enabled_modules_json(value: Any) -> str:
    if value is None:
        return "[]"
    if isinstance(value, list):
        return json.dumps([str(x).strip() for x in value if str(x).strip()])
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return "[]"
        try:
            parsed = json.loads(s)
        except Exception:
            raise HTTPException(status_code=400, detail="enabled_modules must be valid JSON (string) or a list")
        if not isinstance(parsed, list):
            raise HTTPException(status_code=400, detail="enabled_modules must be a list")
        return json.dumps([str(x).strip() for x in parsed if str(x).strip()])
    raise HTTPException(status_code=400, detail="enabled_modules must be a list")


def _coerce_module_configs_json(value: Any) -> str:
    if value is None:
        return "{}"
    if isinstance(value, dict):
        return json.dumps(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return "{}"
        try:
            parsed = json.loads(s)
        except Exception:
            raise HTTPException(status_code=400, detail="module_configs must be valid JSON (string) or an object")
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="module_configs must be an object")
        return json.dumps(parsed)
    raise HTTPException(status_code=400, detail="module_configs must be an object")

def _project_setup_complete(p: Project) -> bool:
    allow_hosts = _parse_scope_lines(p.scope_allow or "")
    return len(allow_hosts) > 0


def _project_config_response(p: Project) -> Dict[str, Any]:
    roe_obj: Dict[str, Any] = {}
    try:
        roe_obj = json.loads(getattr(p, "roe_json", "") or "{}")
        if not isinstance(roe_obj, dict):
            roe_obj = {"_value": roe_obj}
    except Exception:
        roe_obj = {}

    enabled_modules_obj: List[str] = []
    try:
        raw_enabled = json.loads(getattr(p, "enabled_modules_json", "") or "[]")
        if isinstance(raw_enabled, list):
            enabled_modules_obj = [str(x).strip() for x in raw_enabled if str(x).strip()]
    except Exception:
        enabled_modules_obj = []

    module_configs_obj: Dict[str, Any] = {}
    try:
        raw_cfg = json.loads(getattr(p, "module_configs_json", "") or "{}")
        if isinstance(raw_cfg, dict):
            module_configs_obj = raw_cfg
    except Exception:
        module_configs_obj = {}

    return {
        "id": p.id,
        "name": p.name,
        "qps": p.qps,
        "scope": {
            "allow": _scope_text_to_lines(p.scope_allow or ""),
            "deny": _scope_text_to_lines(p.scope_deny or ""),
            "allow_hosts": _parse_scope_lines(p.scope_allow or ""),
            "deny_hosts": _parse_scope_lines(p.scope_deny or ""),
        },
        "roe": roe_obj,
        "roe_json": getattr(p, "roe_json", "") or "{}",
        "enabled_modules": enabled_modules_obj,
        "enabled_modules_json": getattr(p, "enabled_modules_json", "") or "[]",
        "module_configs": module_configs_obj,
        "module_configs_json": getattr(p, "module_configs_json", "") or "{}",
        "setup_complete": _project_setup_complete(p),
    }


def _default_roe_template(*, qps: float = 3.0) -> Dict[str, Any]:
    return {
        "version": 1,
        "network": {
            "qps": qps,
            "burst": max(1, int(round(qps))),
            "timeout_s": 20,
            "retries": 0,
        },
        "constraints": {
            "respect_scope": True,
            "include_third_party": False,
        },
        "notes": "ROE is shared globally across all network-active modules.",
    }


def _source_metadata_obj(raw: str) -> Dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        if isinstance(data, dict):
            return data
        return {"_value": data}
    except Exception:
        return {}


def _source_to_dict(src: Source, entry_count: Optional[int] = None) -> Dict[str, Any]:
    out = _model_to_dict(src)
    out["metadata"] = _source_metadata_obj(getattr(src, "metadata_json", "") or "{}")
    if entry_count is not None:
        out["entry_count"] = entry_count
    return out


def _create_source(*, project_id: int, kind: str, name: str, metadata: Optional[Dict[str, Any]] = None) -> Source:
    now = datetime.now(timezone.utc)
    src = Source(
        project_id=project_id,
        kind=(kind or "manual_har").strip(),
        name=(name or f"{kind}_{now.strftime('%Y%m%d_%H%M%S')}").strip(),
        status="running",
        metadata_json=json.dumps(metadata or {}),
        error="",
        created_at=now,
        started_at=now,
        finished_at=None,
    )
    with get_session() as s:
        s.add(src)
        s.commit()
        s.refresh(src)
        return src


def _finish_source(source_id: int, *, status: str = "done", error: str = "") -> Optional[Source]:
    with get_session() as s:
        src = s.get(Source, source_id)
        if not src:
            return None
        src.status = status
        src.error = error or ""
        src.finished_at = datetime.now(timezone.utc)
        s.add(src)
        s.commit()
        s.refresh(src)
        return src




def _enrich_entries_with_source_context(entries: List[HarEntry], sources: List[Source]) -> List[Any]:
    """
    Attach source_name / source_kind onto entry-like objects before action aggregation.

    We keep HarEntry rows unchanged in DB and only enrich the in-memory objects used
    for build_actions(), so the rest of the engine stays untouched.
    """
    src_map: Dict[int, Source] = {}
    for src in sources:
        if getattr(src, "id", None) is None:
            continue
        try:
            src_map[int(src.id)] = src
        except Exception:
            continue

    out: List[Any] = []
    for e in entries:
        sid = getattr(e, "source_id", None)
        src = None
        if sid is not None:
            try:
                src = src_map.get(int(sid))
            except Exception:
                src = None

        payload = _model_to_dict(e)
        payload["source_name"] = (getattr(src, "name", "") or "") if src else ""
        payload["source_kind"] = (getattr(src, "kind", "") or "") if src else ""
        out.append(SimpleNamespace(**payload))
    return out


def _compute_actions_for_project(project_id: int, *, include_risk: bool) -> Dict[str, Any]:
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

        entries = s.exec(select(HarEntry).where(HarEntry.project_id == project_id)).all()
        src_rows = s.exec(select(Source).where(Source.project_id == project_id)).all()
        allow_hosts = _parse_scope_lines(p.scope_allow or "")
        deny_hosts = _parse_scope_lines(p.scope_deny or "")

    enriched_entries = _enrich_entries_with_source_context(entries, src_rows)
    acts = build_actions(enriched_entries)
    out = actions_to_json(acts)

    if include_risk:
        out = attach_risk(
            out,
            allow_hosts=allow_hosts,
            deny_hosts=deny_hosts,
            use_ml=ML_RISK_ENABLED,
            model_path=ML_MODEL_PATH,
        )

    return {
        "actions": out,
        "allow_hosts": allow_hosts,
        "deny_hosts": deny_hosts,
        "risk_included": bool(include_risk),
    }


def _builtin_modules() -> List[Dict[str, Any]]:
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


def _safe_module_meta(raw: Any, fallback_id: str) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    if isinstance(raw, dict):
        meta = dict(raw)
    mid = str(meta.get("id") or fallback_id).strip()
    meta["id"] = mid
    meta.setdefault("name", mid)
    meta.setdefault("kind", "passive")
    meta.setdefault("targets", ["project"])
    meta.setdefault("description", "")
    meta.setdefault("params_schema", {})
    return meta


def _load_module_file(path: Path) -> Optional[Dict[str, Any]]:
    try:
        stem = path.stem
        mod_name = f"pwnyhub_extmod_{stem}_{abs(hash(str(path)))}"
        spec = importlib.util.spec_from_file_location(mod_name, str(path))
        if not spec or not spec.loader:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]

        raw_meta = getattr(mod, "MODULE", None)
        meta = _safe_module_meta(raw_meta, fallback_id=stem)

        run_fn = getattr(mod, "run", None)
        if not callable(run_fn):
            raise RuntimeError("Module missing required callable: run(ctx)")

        return {"meta": meta, "run": run_fn}
    except Exception as e:
        _MODULE_CACHE["errors"].append(f"{path.name}: {e}")
        return None


def _refresh_modules_cache() -> None:
    _MODULE_CACHE["errors"] = []
    runners: Dict[str, ModuleRunner] = {}
    metas: List[Dict[str, Any]] = []

    for m in _builtin_modules():
        mid = str(m.get("id") or "").strip()
        if not mid:
            continue
        metas.append(m)
        runners[mid] = lambda ctx, _mid=mid: {"summary": {"ok": True, "module_id": _mid}, "findings": []}

    base = Path(__file__).resolve().parent
    mod_dir = base / "modules"
    if mod_dir.exists() and mod_dir.is_dir():
        for p in sorted(mod_dir.glob("*.py")):
            if p.name.startswith("_"):
                continue
            loaded = _load_module_file(p)
            if not loaded:
                continue
            meta = loaded["meta"]
            run_fn = loaded["run"]

            mid = str(meta.get("id") or "").strip()
            if not mid:
                continue

            runners[mid] = run_fn
            metas = [x for x in metas if str(x.get("id")) != mid]
            metas.append(meta)

    _MODULE_CACHE["modules"] = sorted(metas, key=lambda x: str(x.get("id") or ""))
    _MODULE_CACHE["runners"] = runners
    _MODULE_CACHE["loaded_at"] = datetime.now(timezone.utc).timestamp()


def _get_module_registry() -> Dict[str, Any]:
    if os.getenv("PWNYHUB_MODULES_RELOAD", "").strip() in ("1", "true", "yes", "on"):
        _refresh_modules_cache()
    return _MODULE_CACHE


def _normalize_finding_dict(x: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(x, dict):
        return None
    title = str(x.get("title") or "").strip()
    if not title:
        return None

    severity = str(x.get("severity") or "info").strip().lower()
    if severity not in ("info", "low", "med", "high"):
        severity = "info"

    description = str(x.get("description") or "").strip()

    evidence = x.get("evidence")
    if evidence is None:
        evidence_obj: Any = {}
    elif isinstance(evidence, (dict, list, str, int, float, bool)):
        evidence_obj = evidence
    else:
        evidence_obj = {"_value": str(evidence)}

    tags = x.get("tags") or []
    if isinstance(tags, str):
        tags_list = [tags]
    elif isinstance(tags, list):
        tags_list = [str(t) for t in tags if str(t).strip()]
    else:
        tags_list = []

    action_keys = x.get("action_keys") or []
    if isinstance(action_keys, str):
        action_keys_list = [action_keys]
    elif isinstance(action_keys, list):
        action_keys_list = [str(k) for k in action_keys if str(k).strip()]
    else:
        action_keys_list = []

    return {
        "severity": severity,
        "title": title,
        "description": description,
        "evidence": evidence_obj,
        "tags": tags_list,
        "action_keys": action_keys_list,
    }


def _run_builtin_risk_digest(ctx: Dict[str, Any]) -> Dict[str, Any]:
    params = ctx.get("params") or {}
    action_keys = ctx.get("action_keys") or []
    min_risk = int(params.get("min_risk", 70))
    min_risk = max(0, min(100, min_risk))

    acts = ctx["get_actions"](include_risk=True)
    keyset = set(str(k) for k in action_keys) if action_keys else None

    findings: List[Dict[str, Any]] = []
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

        findings.append(
            {
                "severity": sev,
                "title": title,
                "description": desc,
                "evidence": {
                    "risk_score": rs,
                    "risk_tags": tags,
                    "sample_urls": a.get("sample_urls") or [],
                    "status_codes": a.get("status_codes") or [],
                    "top_mime": a.get("top_mime") or "",
                    "avg_time_ms": a.get("avg_time_ms"),
                    "avg_resp_bytes": a.get("avg_resp_bytes"),
                },
                "action_keys": [k],
                "tags": tags,
            }
        )

    return {
        "findings": findings,
        "summary": {"min_risk": min_risk, "findings_created": len(findings)},
    }


# -----------------------------
# roe defaults
# -----------------------------

@app.get("/roe/default")
def roe_default(qps: float = 3.0):
    try:
        qps_f = float(qps)
    except Exception:
        qps_f = 3.0
    if qps_f <= 0:
        qps_f = 3.0
    return {"roe": _default_roe_template(qps=qps_f)}


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
    if qps <= 0:
        qps = 3.0

    roe_json = _coerce_roe_json(payload.get("roe_json") if "roe_json" in payload else payload.get("roe"))
    enabled_modules_json = _coerce_enabled_modules_json(payload.get("enabled_modules")) if "enabled_modules" in payload else "[]"
    module_configs_json = _coerce_module_configs_json(payload.get("module_configs")) if "module_configs" in payload else "{}"

    p = Project(
        name=name,
        scope_allow=scope_allow,
        scope_deny=scope_deny,
        qps=qps,
        roe_json=roe_json,
        enabled_modules_json=enabled_modules_json,
        module_configs_json=module_configs_json,
    )  # type: ignore[arg-type]

    with get_session() as s:
        s.add(p)
        s.commit()
        s.refresh(p)

    return {
        "id": p.id,
        "name": p.name,
        "qps": p.qps,
        "enabled_modules": json.loads(getattr(p, "enabled_modules_json", "") or "[]"),
        "module_configs": json.loads(getattr(p, "module_configs_json", "") or "{}"),
        "setup_complete": _project_setup_complete(p),
    }


@app.get("/projects")
def list_projects():
    with get_session() as s:
        rows = s.exec(select(Project)).all()
    return [{"id": r.id, "name": r.name, "qps": r.qps, "setup_complete": _project_setup_complete(r)} for r in rows]


@app.get("/projects/{project_id}")
def get_project(project_id: int):
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")
        return {"project": _project_config_response(p)}


@app.patch("/projects/{project_id}")
def patch_project(project_id: int, payload: Dict[str, Any] = Body(...)):
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

        if "name" in payload:
            p.name = (payload.get("name") or p.name or "Untitled").strip()

        if "scope_allow" in payload:
            p.scope_allow = _coerce_scope(payload.get("scope_allow"))
        if "scope_deny" in payload:
            p.scope_deny = _coerce_scope(payload.get("scope_deny"))

        if "qps" in payload:
            try:
                qps = float(payload.get("qps") or p.qps or 3.0)
            except Exception:
                qps = p.qps or 3.0
            if qps <= 0:
                raise HTTPException(status_code=400, detail="qps must be > 0")
            p.qps = qps

        if "roe_json" in payload or "roe" in payload:
            raw = payload.get("roe_json") if "roe_json" in payload else payload.get("roe")
            p.roe_json = _coerce_roe_json(raw)  # type: ignore[attr-defined]

        if "enabled_modules" in payload:
            p.enabled_modules_json = _coerce_enabled_modules_json(payload.get("enabled_modules"))  # type: ignore[attr-defined]

        if "module_configs" in payload:
            p.module_configs_json = _coerce_module_configs_json(payload.get("module_configs"))  # type: ignore[attr-defined]

        s.add(p)
        s.commit()
        s.refresh(p)

        return {"project": _project_config_response(p)}


# -----------------------------
# sources
# -----------------------------

@app.get("/sources")
def list_sources(project_id: int):
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

        src_rows = s.exec(
            select(Source).where(Source.project_id == project_id).order_by(Source.id.desc())
        ).all()

        entries = s.exec(
            select(HarEntry).where(HarEntry.project_id == project_id)
        ).all()

    counts: Dict[int, int] = {}
    for row in entries:
        if row.source_id is None:
            continue
        counts[row.source_id] = counts.get(row.source_id, 0) + 1

    return {
        "project_id": project_id,
        "sources": [_source_to_dict(src, counts.get(int(src.id or 0), 0)) for src in src_rows],
    }


@app.get("/sources/{source_id}")
def get_source(source_id: int):
    with get_session() as s:
        src = s.get(Source, source_id)
        if not src:
            raise HTTPException(status_code=404, detail="source not found")

        entries = s.exec(select(HarEntry).where(HarEntry.source_id == source_id)).all()

    return {"source": _source_to_dict(src, len(entries))}


# -----------------------------
# har import
# -----------------------------

@app.post("/import/har")
def import_har(
    project_id: int = Form(...),
    file: UploadFile = File(...),
    include_assets: bool = Form(False),
    source_name: Optional[str] = Form(None),
):
    with get_session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    resolved_source_name = (source_name or "").strip() or (file.filename or "").strip()
    if not resolved_source_name:
        resolved_source_name = f"manual_har_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"

    src = _create_source(
        project_id=project_id,
        kind="manual_har",
        name=resolved_source_name,
        metadata={
            "filename": file.filename or "",
            "content_type": file.content_type or "",
            "include_assets": bool(include_assets),
        },
    )

    try:
        max_bytes = int(os.getenv("PWNYHUB_MAX_HAR_BYTES", str(256 * 1024 * 1024)))
        har_bytes = _read_upload_limited(file, max_bytes=max_bytes)
        items = parse_har(har_bytes)

        inserted = 0
        skipped_assets = 0
        skipped_duplicates = 0
        BATCH_N = int(os.getenv("PWNYHUB_INSERT_BATCH", "1000"))
        batch: List[HarEntry] = []

        with get_session() as s:
            existing_fps = s.exec(
                select(HarEntry.entry_fingerprint).where(HarEntry.project_id == project_id)
            ).all()
            seen_fps = {str(x) for x in existing_fps if x}

            for it in items:
                if (not include_assets) and is_asset_mime(it.mime):
                    skipped_assets += 1
                    continue

                fp = str(getattr(it, "entry_fingerprint", "") or "").strip()
                if fp and fp in seen_fps:
                    skipped_duplicates += 1
                    continue

                if fp:
                    seen_fps.add(fp)

                batch.append(
                    HarEntry(
                        project_id=project_id,
                        source_id=src.id,
                        method=it.method,
                        url=it.url,
                        host=it.host,
                        path=it.path,
                        query=it.query,
                        normalized_host=getattr(it, "normalized_host", "") or "",
                        normalized_path=getattr(it, "normalized_path", "/") or "/",
                        query_keys_json=json.dumps(getattr(it, "query_keys", []) or []),
                        shape_fingerprint=getattr(it, "shape_fingerprint", "") or "",
                        entry_fingerprint=fp,
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

        finished = _finish_source(int(src.id or 0), status="done")
        return {
            "inserted": inserted,
            "skipped_assets": skipped_assets,
            "skipped_duplicates": skipped_duplicates,
            "total": len(items),
            "source": _source_to_dict(finished or src, inserted),
        }

    except Exception as e:
        _finish_source(int(src.id or 0), status="failed", error=str(e))
        raise


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
        "entries_stored": len(rows),
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
        "ml_risk_enabled": ML_RISK_ENABLED,
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
    reg = _get_module_registry()
    return {"modules": reg["modules"], "errors": reg.get("errors") or []}


@app.post("/runs")
def create_run(payload: Dict[str, Any] = Body(...)):
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

    reg = _get_module_registry()
    runners: Dict[str, ModuleRunner] = reg.get("runners") or {}

    if module_id not in runners:
        raise HTTPException(status_code=400, detail=f"Unknown module_id: {module_id}")

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

    try:
        with get_session() as s:
            p = s.get(Project, project_id)
            if not p:
                raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

            proj_cfg = _project_config_response(p)

        def _get_actions(include_risk: bool = True) -> List[Dict[str, Any]]:
            return _compute_actions_for_project(project_id, include_risk=include_risk)["actions"]

        ctx: Dict[str, Any] = {
            "project_id": project_id,
            "params": params,
            "action_keys": action_keys,
            "project": proj_cfg,
            "get_actions": _get_actions,
            "now_utc": datetime.now(timezone.utc).isoformat(),
        }

        if module_id == "risk_digest":
            result = _run_builtin_risk_digest(ctx)
        else:
            result = runners[module_id](ctx)

        if not isinstance(result, dict):
            raise RuntimeError("Module returned non-dict result (expected dict)")

        raw_findings = result.get("findings") or []
        if not isinstance(raw_findings, list):
            raise RuntimeError("Module result.findings must be a list")

        summary = result.get("summary")
        if summary is None:
            summary_obj: Any = {}
        elif isinstance(summary, (dict, list, str, int, float, bool)):
            summary_obj = summary
        else:
            summary_obj = {"_value": str(summary)}

        to_insert: List[Finding] = []
        for rf in raw_findings:
            norm = _normalize_finding_dict(rf)
            if not norm:
                continue
            to_insert.append(
                Finding(
                    project_id=project_id,
                    run_id=run.id,
                    module_id=module_id,
                    severity=norm["severity"],
                    title=norm["title"],
                    description=norm["description"],
                    evidence_json=json.dumps(norm["evidence"]),
                    action_keys_json=json.dumps(norm["action_keys"]),
                    tags_json=json.dumps(norm["tags"]),
                    created_at=datetime.now(timezone.utc),
                )
            )

        with get_session() as s:
            if to_insert:
                s.add_all(to_insert)
                s.commit()

        findings_created = len(to_insert)

        with get_session() as s:
            rr = s.get(Run, run.id)
            if rr:
                rr.status = "done"
                rr.finished_at = datetime.now(timezone.utc)
                rr.summary_json = json.dumps(
                    {
                        "module_id": module_id,
                        "findings_created": findings_created,
                        "summary": summary_obj,
                    }
                )
                s.add(rr)
                s.commit()

        return {
            "run_id": run.id,
            "status": "done",
            "findings_created": findings_created,
            "summary": summary_obj,
        }

    except Exception as e:
        with get_session() as s:
            rr = s.get(Run, run.id)
            if rr:
                rr.status = "failed"
                rr.finished_at = datetime.now(timezone.utc)
                rr.error = f"{e}\n{traceback.format_exc()}"
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