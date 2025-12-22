from __future__ import annotations

from typing import Optional
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


engine = create_engine("sqlite:///pwnyhub.db", echo=False)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)
