from __future__ import annotations

from typing import Optional
from datetime import datetime, timezone

from sqlmodel import SQLModel, Field, create_engine, Session
from sqlalchemy import text


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    scope_allow: str  # newline-separated domains
    scope_deny: str = ""  # newline-separated domains
    qps: float = 3.0

    # ROE (Rules of Engagement) config stored as JSON string.
    # Keep as string for schema flexibility while iterating.
    roe_json: str = "{}"


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


def _sqlite_column_exists(conn, table: str, column: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    # PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
    return any(r[1] == column for r in rows)


def _sqlite_add_column_if_missing(table: str, column: str, ddl_fragment: str) -> None:
    # Example ddl_fragment: "TEXT NOT NULL DEFAULT '{}'"
    with engine.begin() as conn:
        if not _sqlite_column_exists(conn, table, column):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_fragment}"))


def init_db() -> None:
    # Create tables if they don't exist.
    SQLModel.metadata.create_all(engine)

    # Lightweight forward-only migration for existing SQLite DBs.
    # SQLModel/SQLAlchemy won't auto-add new columns to an existing table.
    _sqlite_add_column_if_missing("project", "roe_json", "TEXT NOT NULL DEFAULT '{}'")

    # Optional: keep DB consistent if the column exists but nulls slipped in.
    with engine.begin() as conn:
        conn.execute(text("UPDATE project SET roe_json='{}' WHERE roe_json IS NULL"))


def get_session() -> Session:
    return Session(engine)