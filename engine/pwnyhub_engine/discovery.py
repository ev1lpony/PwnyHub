from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence
from urllib.parse import parse_qsl, urlparse

from sqlmodel import select

from .db import Asset, DiscoveryObservation, DiscoveredLink, Endpoint, Parameter, Technology, WebForm, get_session


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def dumps(value: Any) -> str:
    try:
        return json.dumps(value if