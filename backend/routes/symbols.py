"""Symbol search endpoint using FinMind TaiwanStockInfo."""
from __future__ import annotations

import logging
import os

import httpx
from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)
router = APIRouter()

_symbols: list[dict] = []


async def load_symbols() -> None:
    global _symbols
    token = os.getenv("FINMIND_TOKEN", "")
    if not token:
        logger.warning("FINMIND_TOKEN not set, symbol search disabled")
        return
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://api.finmindtrade.com/api/v4/data",
                params={"dataset": "TaiwanStockInfo"},
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
            seen: set[str] = set()
            deduped: list[dict] = []
            for r in data:
                sid = r.get("stock_id", "")
                if sid and sid not in seen and r.get("type") in ("twse", "tpex", "otc"):
                    seen.add(sid)
                    deduped.append({"symbol": sid, "name": r.get("stock_name", "")})
            _symbols = deduped
            logger.info("Loaded %d symbols from FinMind", len(_symbols))
    except Exception as exc:
        logger.warning("Failed to load symbols: %s", exc)


async def _ensure_loaded() -> None:
    # _symbols starts empty and is filled by lifespan startup. When that load
    # fails (FinMind blip, transient 4xx) _symbols stays [] indefinitely, so
    # every subsequent request used to silently return nothing until process
    # restart. Retry on first miss; if upstream is still down, surface 503
    # via main.py's ValueError handler rather than masking it as success.
    if _symbols:
        return
    await load_symbols()
    if not _symbols:
        raise ValueError("symbols_unavailable")


@router.get("/api/symbols")
async def search_symbols(search: str = Query(default="", min_length=1)) -> list[dict]:
    if not search:
        return []
    await _ensure_loaded()
    q = search.lower()
    results = []
    for s in _symbols:
        if s["symbol"].startswith(q) or q in s["name"].lower():
            results.append(s)
            if len(results) >= 20:
                break
    return results


@router.get("/api/symbols/all")
async def all_symbols() -> list[dict]:
    await _ensure_loaded()
    return _symbols
