"""Chip data (籌碼) API routes.

Error handling lives in main.py via global @app.exception_handler — every
endpoint here lets httpx errors and ValueErrors propagate, and they come
back to the client as `{"detail": {"error": "..."}}` with the canonical
status code (502 for upstream, 503 for service not ready).
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

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


@router.get("/api/chip/{symbol}/history")
async def get_chip_history(
    symbol: str,
    refresh: bool = Query(default=False),
) -> dict:
    return await get_finmind().fetch_chip_history(symbol, refresh)


@router.get("/api/chip/{symbol}/broker_history")
async def get_chip_broker_history(
    symbol: str,
    ids: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    id_list = [s.strip() for s in ids.split(",") if s.strip()]
    if not id_list:
        raise HTTPException(status_code=400, detail={"error": "ids_required"})
    if len(id_list) > 20:
        raise HTTPException(status_code=400, detail={"error": "too_many_ids"})
    return await get_finmind().fetch_broker_history(symbol, id_list, refresh)


def _today() -> str:
    return date.today().isoformat()
