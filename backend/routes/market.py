"""Market dashboard API routes.

Endpoints:
- GET /api/market/snapshot — 整盤 + sectors + leaderboards 派生
- GET /api/market/sector_members — 族群輪動三層鑽取的成員股列表(SC-3)

Error contract(對齊 routes/options.py 慣例):
- 502 detail={"error": "finmind_unreachable"} — services raise ValueError /
  httpx 上游錯誤穿出
- 503 detail={"error": "snapshot_unavailable"} — service 尚未 ready
- 404 detail={"error": "unknown_sector"} — sector_members 未知 industry/sub

design.md §4 §9 / .claude/mod/market-today-only/change-spec.md §3 §4
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from services.finmind_realtime import fetch_market_snapshot, fetch_sector_members
from utils.cancel import run_with_disconnect

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/snapshot")
async def get_market_snapshot(
    request: Request,
    refresh: bool = Query(default=False),
) -> dict:
    """Return market snapshot (sectors + leaderboards).

    See design.md §4 for payload shape + size budget.
    """
    # Audit X4:刪掉 httpx tuple catch — service 用 asyncio.gather(return_exceptions=True)
    # 並且只 re-raise ValueError('finmind_unreachable'),raw httpx 例外無法穿過 service
    # 邊界,catch 形同 dead code。Round-1 R5 accepted decision。
    try:
        return await run_with_disconnect(request, fetch_market_snapshot(refresh=refresh))
    except asyncio.CancelledError:
        # prd 500 修正(2026-07-03):共用 inflight task 被取消(其他請求
        # 斷線觸發 cancel 鏈)時,還連著的共乘 client 會收到 CancelledError。
        # service 層已補 shield+refcount,此處為 defense-in-depth:
        # - client 已斷線 → 本 task 的正常取消,re-raise 維持取消語意
        # - client 還連著 → 轉 503(前端有對應處理),不裸 500
        if await request.is_disconnected():
            raise
        logger.warning("market snapshot shared task cancelled while client still connected")
        raise HTTPException(
            status_code=503,
            detail={"error": "snapshot_unavailable"},
        ) from None
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


@router.get("/sector_members")
async def get_sector_members(
    request: Request,
    industry: str = Query(...),
    sub_industry: str | None = Query(default=None),
) -> dict:
    """SC-3 drill-down:族群 → 子族群(optional)→ 成員股列表。

    change-spec.md §3:未知 industry/sub_industry → 404 unknown_sector;
    上游(FinMind universe / chain)失敗 → 502 finmind_unreachable(對齊
    snapshot route 慣例);cancel 鏈同 snapshot 走 run_with_disconnect。
    """
    try:
        result = await run_with_disconnect(request, fetch_sector_members(industry, sub_industry))
    except asyncio.CancelledError:
        if await request.is_disconnected():
            raise
        logger.warning("sector_members shared task cancelled while client still connected")
        raise HTTPException(
            status_code=503,
            detail={"error": "snapshot_unavailable"},
        ) from None
    except httpx.HTTPError as exc:
        logger.exception("sector_members upstream FinMind failure")
        raise HTTPException(
            status_code=502,
            detail={"error": "finmind_unreachable"},
        ) from exc
    except ValueError as exc:
        msg = str(exc)
        if msg == "finmind_unreachable":
            raise HTTPException(
                status_code=502,
                detail={"error": "finmind_unreachable"},
            ) from exc
        logger.exception("sector_members service raised unexpected ValueError")
        raise HTTPException(
            status_code=503,
            detail={"error": "snapshot_unavailable"},
        ) from exc

    if result is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_sector"})
    return result
