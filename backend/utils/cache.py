"""Atomic JSON cache utilities."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_BACKEND_DIR = Path(__file__).resolve().parents[1]


def data_dir() -> Path:
    raw = os.getenv("CHIP_DATA_DIR", "").strip()
    return Path(raw) if raw else _BACKEND_DIR / "data"


def chip_cache_dir() -> Path:
    d = data_dir() / "cache" / "chip"
    d.mkdir(parents=True, exist_ok=True)
    return d


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
