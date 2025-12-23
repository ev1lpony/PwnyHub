from __future__ import annotations

from typing import Optional
from datetime import datetime, timezone

from sqlmodel import SQLModel, Field, create_engine, Session


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    scope_allow: str  # newline-separated domains
    scope_deny: str = ""  # newline-separated domains
    qps: float = 3.0


class HarEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(index=True)

    method: str
    url: str
    host: str = Field(index=True)
    path: str = Field(index=True)
    query: str = ""

    req_headers_json: str = "{}"
    req_body_text: str = ""

    status: int = 0
    mime: str = ""
    resp_headers_json: str = "{}"
    resp_body_text: str = ""
    time_ms: float = 0.0
    body_size: int = 0


# ------------------------------
# Module backbone: Runs + Findings
# ------------------------------

class Run(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(index=True)

    module_id: str = Field(index=True)
    status: str = Field(default="queued", index=True)  # queued|running|done|failed

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None

    # JSON blobs (keep schema flexible while we iterate)
    params_json: str = "{}"                   # module params
    selected_action_keys_json: str = "[]"     # list[str]
    summary_json: str = "{}"                  # counts / rollups for UI

    error: str = ""


class Finding(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    project_id: int = Field(index=True)
    run_id: int = Field(index=True)
    module_id: str = Field(index=True)

    severity: str = Field(default="info", index=True)  # info|low|med|high
    title: str = Field(index=True)
    description: str = ""

    # JSON blobs
    evidence_json: str = "{}"        # arbitrary evidence payload
    action_keys_json: str = "[]"     # list[str] of related actions
    tags_json: str = "[]"            # list[str]

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)


engine = create_engine("sqlite:///pwnyhub.db", echo=False)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)
