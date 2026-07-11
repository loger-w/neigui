"""權證選擇器 routes — EOD 快照 / MIS 盤中 quotes / FinMind 分點展開。

Error 邊界逐 endpoint(design R9):warrants/quotes 上游是 TWSE/TPEx/MIS,
自己 catch httpx 基類 → 502 warrant_upstream(中央 handler 會錯標
finmind_error);brokers 上游真是 FinMind → 不 catch,沿中央 handler。
"""

from __future__ import annotations

import logging
import re

import httpx
from fastapi import APIRouter, HTTPException, Request

from services import warrant_brokers, warrant_quotes, warrants
from utils.cancel import run_with_disconnect

logger = logging.getLogger(__name__)

router = APIRouter()

# R2-3:warrant_id 同驗 — 未驗證直傳 FinMind data_id 會以 ×5 日回退放大配額浪費
_VALID_ID = re.compile(r"^[0-9A-Za-z]{4,6}$")


def _validate_id(value: str) -> None:
    if not _VALID_ID.fullmatch(value):
        raise HTTPException(status_code=400, detail={"error": "bad_symbol"})


@router.get("/api/warrants/{stock_id}")
async def get_warrants(request: Request, stock_id: str, refresh: bool = False) -> dict:
    _validate_id(stock_id)
    try:
        return await run_with_disconnect(
            request, warrants.get_underlying_warrants(stock_id, refresh)
        )
    except httpx.HTTPError as exc:
        logger.warning("warrant snapshot upstream error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "warrant_upstream"}) from exc


@router.get("/api/warrants/{stock_id}/quotes")
async def get_warrant_quotes(request: Request, stock_id: str, refresh: bool = False) -> dict:
    _validate_id(stock_id)
    try:
        return await run_with_disconnect(request, warrant_quotes.get_quotes(stock_id, refresh))
    except httpx.HTTPError as exc:
        logger.warning("warrant quotes upstream error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "warrant_upstream"}) from exc


@router.get("/api/warrants/{warrant_id}/brokers")
async def get_warrant_brokers(request: Request, warrant_id: str, refresh: bool = False) -> dict:
    _validate_id(warrant_id)
    # 不 catch httpx:FinMind 上游走中央 handler → finmind_error(R9)
    return await run_with_disconnect(request, warrant_brokers.get_brokers(warrant_id, refresh))
