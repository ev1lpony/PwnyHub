from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import ValidationError

from .manifest import ModuleManifest


def modules_root() -> Path:
    # This file lives at engine/pwnyhub_engine/modules/registry.py
    # Root should be engine/pwnyhub_engine/modules
    return Path(__file__).resolve().parent


def load_manifest(manifest_path: Path) -> ModuleManifest:
    raw = manifest_path.read_text(encoding="utf-8")

    # Support both Pydantic v2 and v1
    try:
        return ModuleManifest.model_validate_json(raw)  # pydantic v2
    except AttributeError:
        return ModuleManifest.parse_raw(raw)            # pydantic v1


@dataclass(frozen=True)
class LoadedModule:
    manifest: ModuleManifest
    folder: Path
    manifest_path: Path


class ModuleRegistry:
    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = (root or modules_root()).resolve()
        self._modules: Dict[str, LoadedModule] = {}
        self._errors: Dict[str, str] = {}

    def discover(self) -> None:
        """
        Scan: engine/pwnyhub_engine/modules/*/manifest.json
        Does not execute module code.
        """
        self._modules.clear()
        self._errors.clear()

        if not self.root.exists():
            self._errors["__modules_root__"] = f"Modules root not found: {self.root}"
            return

        for child in self.root.iterdir():
            if not child.is_dir():
                continue

            manifest_path = child / "manifest.json"
            if not manifest_path.exists():
                continue

            try:
                manifest = load_manifest(manifest_path)
            except (ValidationError, json.JSONDecodeError) as e:
                self._errors[str(child.name)] = f"Invalid manifest: {e}"
                continue
            except Exception as e:
                self._errors[str(child.name)] = f"Failed to load manifest: {e}"
                continue

            module_id = manifest.id.strip()
            if not module_id:
                self._errors[str(child.name)] = "Manifest id is empty"
                continue

            if module_id in self._modules:
                self._errors[module_id] = f"Duplicate module id: {module_id}"
                continue

            self._modules[module_id] = LoadedModule(
                manifest=manifest,
                folder=child,
                manifest_path=manifest_path,
            )

    def list_manifests(self) -> List[ModuleManifest]:
        return [lm.manifest for lm in sorted(self._modules.values(), key=lambda x: x.manifest.id)]

    def get_manifest(self, module_id: str) -> Optional[ModuleManifest]:
        lm = self._modules.get(module_id)
        return lm.manifest if lm else None

    def errors(self) -> Dict[str, str]:
        return dict(self._errors)
