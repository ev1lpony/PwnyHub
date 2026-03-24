from __future__ import annotations

from typing import Any, List, Literal, Optional
from pydantic import BaseModel, Field

ModuleCategory = Literal["recon", "analysis", "exploit", "other"]
ConfigFieldType = Literal["string", "int", "bool", "enum", "file", "text"]
ROEFieldType = Literal["string", "int", "bool", "enum"]

class ModuleIO(BaseModel):
    type: str = Field(..., min_length=1)   # e.g. "target.scope", "recon.subdomains"
    required: bool = True
    artifact: bool = False
    description: Optional[str] = None

class ConfigField(BaseModel):
    key: str = Field(..., min_length=1)
    type: ConfigFieldType
    label: str = Field(..., min_length=1)

    default: Any = None
    optional: bool = False

    enum: Optional[List[str]] = None
    help: Optional[str] = None

class ModuleConfig(BaseModel):
    fields: List[ConfigField] = Field(default_factory=list)

class ROEField(BaseModel):
    key: str = Field(..., min_length=1)
    type: ROEFieldType
    label: str = Field(..., min_length=1)

    default: Any = None
    optional: bool = False

    min: Optional[int] = None
    max: Optional[int] = None
    enum: Optional[List[str]] = None
    help: Optional[str] = None

class ROEConstraint(BaseModel):
    rule: str = Field(..., min_length=1)
    severity: Literal["hard", "soft"] = "hard"
    note: Optional[str] = None

class ROESection(BaseModel):
    requires: List[ROEField] = Field(default_factory=list)
    constraints: List[ROEConstraint] = Field(default_factory=list)

class ModuleManifest(BaseModel):
    id: str = Field(..., min_length=1)     # "subdomain_enum"
    name: str = Field(..., min_length=1)   # "Subdomain Enumeration"
    version: str = "0.1.0"
    category: ModuleCategory = "recon"
    description: str = ""

    # Later execution: "module:run" means modules/<id>/module.py has run(...)
    entrypoint: str = "module:run"

    inputs: List[ModuleIO] = Field(default_factory=list)
    outputs: List[ModuleIO] = Field(default_factory=list)

    config: Optional[ModuleConfig] = None
    roe: Optional[ROESection] = None

    tags: List[str] = Field(default_factory=list)
