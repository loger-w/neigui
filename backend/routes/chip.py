"""Chip data (籌碼) API routes."""
from __future__ import annotations

import logging
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Query

from services.finmind import get_finmind

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/chip/{symbol}")
async def get_chip_summary(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    try:
        return await get_finmind().fetch_chip_summary(symbol, d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind error for %s: %s", symbol, exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception as exc:
        logger.exception("Unexpected chip error for %s", symbol)
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})


@router.get("/api/chip/{symbol}/bubble")
async def get_chip_bubble(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    try:
        return await get_finmind().fetch_chip_bubble(symbol, d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind bubble error for %s: %s", symbol, exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception as exc:
        logger.exception("Unexpected chip bubble error for %s", symbol)
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})


@router.get("/api/chip/{symbol}/history")
async def get_chip_history(
    symbol: str,
    refresh: bool = Query(default=False),
) -> dict:
    try:
        return await get_finmind().fetch_chip_history(symbol, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind history error for %s: %s", symbol, exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception as exc:
        logger.exception("Unexpected chip history error for %s", symbol)
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})


def _today() -> str:
    return date.today().isoformat()
