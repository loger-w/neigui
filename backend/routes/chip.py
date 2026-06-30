"""Chip data (籌碼) API routes.

Error handling lives in main.py via global @app.exception_handler — every
endpoint here lets httpx errors and ValueErrors propagate, and they come
back to the client as `{"detail": {"error": "..."}}` with the canonical
status code (502 for upstream, 503 for service not ready).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from services import clock
from services.finmind import get_finmind

router = APIRouter()


@router.get("/api/chip/{symbol}")
async def get_chip_summary(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    return await get_finmind().fetch_chip_summary(symbol, d, refresh)


@router.get("/api/chip/{symbol}/bubble")
async def get_chip_bubble(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    return await get_finmind().fetch_chip_bubble(symbol, d, refresh)


@router.get("/api/chip/{symbol}/intraday")
async def get_chip_intraday(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    return await get_finmind().fetch_chip_intraday(symbol, d, refresh)


@router.get("/api/chip/{symbol}/history")
async def get_chip_history(
    symbol: str,
    refresh: bool = Query(default=False),
    days: int = Query(default=90, ge=5, le=540),
) -> dict:
    return await get_finmind().fetch_chip_history(symbol, refresh, days)


@router.get("/api/chip/{symbol}/history/base")
async def get_chip_history_base(
    symbol: str,
    refresh: bool = Query(default=False),
    days: int = Query(default=90, ge=5, le=540),
) -> dict:
    """Same payload as /history but with `major: []`. Pairs with
    /history/major for parallel-fetch frontends; K-line TTI ~1s instead of
    blocking on the major-net per-day fan-out."""
    return await get_finmind().fetch_chip_history_base(symbol, refresh, days)


@router.get("/api/chip/{symbol}/history/major")
async def get_chip_history_major(
    symbol: str,
    refresh: bool = Query(default=False),
    days: int = Query(default=90, ge=5, le=540),
) -> dict:
    """Slim payload {symbol, fetched_at, last_date, major: MajorDaily[]}.
    Runs the expensive per-day TradingDailyReport fan-out independently
    from /history/base."""
    return await get_finmind().fetch_chip_history_major(symbol, refresh, days)


@router.get("/api/chip/{symbol}/brokers_window")
async def get_chip_brokers_window(
    symbol: str,
    date: str = Query(default=""),
    days: int = Query(default=10, ge=1, le=60),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    return await get_finmind().fetch_brokers_window(symbol, d, days, refresh)


@router.get("/api/chip/{symbol}/broker_history")
async def get_chip_broker_history(
    symbol: str,
    ids: str = Query(default=""),
    refresh: bool = Query(default=False),
    days: int = Query(default=90, ge=5, le=365),
) -> dict:
    id_list = [s.strip() for s in ids.split(",") if s.strip()]
    if not id_list:
        raise HTTPException(status_code=400, detail={"error": "ids_required"})
    if len(id_list) > 20:
        raise HTTPException(status_code=400, detail={"error": "too_many_ids"})
    return await get_finmind().fetch_broker_history(symbol, id_list, refresh, days)


def _today() -> str:
    return clock.today().isoformat()
