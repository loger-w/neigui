"""Market dashboard API routes.

Single endpoint:
- GET /api/market/snapshot — 整盤 + sectors + leaderboards 派生

Error contract(對齊 routes/options.py 慣例):
- 502 detail={"error": "finmind_unreachable"} — services raise ValueError
- 503 detail={"error": "snapshot_unavailable"} — service 尚未 ready

design.md §4 §9
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query

from services.finmind_realtime import fetch_market_snapshot

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/snapshot")
async def get_market_snapshot(
    refresh: bool = Query(default=False),
) -> dict:
    """Return market snapshot (sectors + leaderboards).

    See design.md §4 for payload shape + size budget.
    """
    try:
        return await fetch_market_snapshot(refresh=refresh)
    except ValueError as exc:
        msg = str(exc)
        if msg == "finmind_unreachable":
            raise HTTPException(
                status_code=502,
                detail={"error": "finmind_unreachable"},
            ) from exc
        logger.exception("market snapshot service raised unexpected ValueError")
        raise HTTPException(
            status_code=503,
            detail={"error": "snapshot_unavailable"},
        ) from exc
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.exception("market snapshot upstream http error")
        raise HTTPException(
            status_code=502,
            detail={"error": "finmind_unreachable"},
        ) from exc
