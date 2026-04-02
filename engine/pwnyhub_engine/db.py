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


class Source(SQLModel, table=True):
    """
    Represents an ingestion source attached to a project.

    Examples:
      - manual_har
      - crawler
      - enum
      - live_proxy
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(index=True)

    kind: str = Field(index=True)          # manual_har | crawler | enum | live_proxy | etc.
    name: str = Field(index=True)          # human label shown in UI
    status: str = Field(default="queued", index=True)  # queued|running|done|failed

    metadata_json: str = "{}"              # flexible source-specific metadata
    error: str = ""

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class HarEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(index=True)

    # provenance / ingestion source
    source_id: Optional[int] = Field(default=None, index=True)

    method: str
    url: str
    host: str = Field(index=True)
    path: str = Field(index=True)
    query: str = ""

    # normalized ingest fields
    normalized_host: str = Field(default="", index=True)
    normalized_path: str = Field(default="/", index=True)
    query_keys_json: str = "[]"

    # fingerprints for grouping / dedup
    shape_fingerprint: str = Field(default="", index=True)
    entry_fingerprint: str = Field(default="", index=True)

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
    params_json: str = "{}"                    # module params
    selected_action_keys_json: str = "[]"      # list[str]
    summary_json: str = "{}"                   # counts / rollups for UI

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


def _sqlite_index_exists(conn, index_name: str) -> bool:
    rows = conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='index' AND name=:name"),
        {"name": index_name},
    ).fetchall()
    return len(rows) > 0


def _sqlite_add_column_if_missing(table: str, column: str, ddl_fragment: str) -> None:
    # Example ddl_fragment: "TEXT NOT NULL DEFAULT '{}'"
    with engine.begin() as conn:
        if not _sqlite_column_exists(conn, table, column):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_fragment}"))


def _sqlite_create_index_if_missing(index_name: str, table: str, column_expr: str) -> None:
    with engine.begin() as conn:
        if not _sqlite_index_exists(conn, index_name):
            conn.execute(text(f"CREATE INDEX {index_name} ON {table} ({column_expr})"))


def init_db() -> None:
    # Create tables if they don't exist.
    SQLModel.metadata.create_all(engine)

    # Lightweight forward-only migration for existing SQLite DBs.
    # SQLModel/SQLAlchemy won't auto-add new columns to an existing table.
    _sqlite_add_column_if_missing("project", "roe_json", "TEXT NOT NULL DEFAULT '{}'")
    _sqlite_add_column_if_missing("harentry", "source_id", "INTEGER")

    _sqlite_add_column_if_missing("harentry", "normalized_host", "TEXT NOT NULL DEFAULT ''")
    _sqlite_add_column_if_missing("harentry", "normalized_path", "TEXT NOT NULL DEFAULT '/'")
    _sqlite_add_column_if_missing("harentry", "query_keys_json", "TEXT NOT NULL DEFAULT '[]'")

    _sqlite_add_column_if_missing("harentry", "shape_fingerprint", "TEXT NOT NULL DEFAULT ''")
    _sqlite_add_column_if_missing("harentry", "entry_fingerprint", "TEXT NOT NULL DEFAULT ''")

    # indexes
    _sqlite_create_index_if_missing("ix_harentry_source_id", "harentry", "source_id")
    _sqlite_create_index_if_missing("ix_harentry_normalized_host", "harentry", "normalized_host")
    _sqlite_create_index_if_missing("ix_harentry_normalized_path", "harentry", "normalized_path")
    _sqlite_create_index_if_missing("ix_harentry_shape_fingerprint", "harentry", "shape_fingerprint")
    _sqlite_create_index_if_missing("ix_harentry_entry_fingerprint", "harentry", "entry_fingerprint")

    # Optional: keep DB consistent if nulls slipped in.
    with engine.begin() as conn:
        conn.execute(text("UPDATE project SET roe_json='{}' WHERE roe_json IS NULL"))

        conn.execute(text("UPDATE harentry SET normalized_host='' WHERE normalized_host IS NULL"))
        conn.execute(text("UPDATE harentry SET normalized_path='/' WHERE normalized_path IS NULL OR normalized_path=''"))
        conn.execute(text("UPDATE harentry SET query_keys_json='[]' WHERE query_keys_json IS NULL OR query_keys_json=''"))
        conn.execute(text("UPDATE harentry SET shape_fingerprint='' WHERE shape_fingerprint IS NULL"))
        conn.execute(text("UPDATE harentry SET entry_fingerprint='' WHERE entry_fingerprint IS NULL"))


def get_session() -> Session:
    return Session(engine)