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
    # Audit X4:刪掉 httpx tuple catch — service 用 asyncio.gather(return_exceptions=True)
    # 並且只 re-raise ValueError('finmind_unreachable'),raw httpx 例外無法穿過 service
    # 邊界,catch 形同 dead code。Round-1 R5 accepted decision。
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
