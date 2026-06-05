from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlparse

from sqlmodel import select

from .db import Asset, DiscoveryObservation, DiscoveredLink, Endpoint, Parameter, Technology, WebForm, get_session


def _now():
    return datetime.now(timezone.utc)


def _json(x: Any) -> str:
    try