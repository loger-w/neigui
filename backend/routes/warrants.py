"""權證選擇器 routes — EOD 快照 / MIS 盤中 quotes / 分點流向。

Error 邊界逐 endpoint(design R9):warrants/quotes 上游是 TWSE/TPEx/MIS,
自己 catch httpx 基類 → 502 warrant_upstream(中央 handler 會錯標
finmind_error);flow 上游是 FinMind → 不 catch,沿中央 handler。
"""

from __future__ import annotations

import logging
import re

import httpx
from fastapi import APIRouter, HTTPException, Request

from services import (
    warrant_flow,
    warrant_quotes,
    warrants,
)
from utils.cancel import run_with_disconnect
from utils.validation import parse_date_param

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


@router.get("/api/warrants/{stock_id}/flow")
async def get_warrant_flow(
    request: Request, stock_id: str, date: str | None = None, refresh: bool = False
) -> dict:
    _validate_id(stock_id)
    if date is not None:
        parse_date_param(date)
    # FinMind httpx 錯誤不 catch → 中央 handler finmind_error;
    # 快照(TWSE/TPEx)錯誤 service 內已轉 502 warrant_upstream(design R16)
    return await run_with_disconnect(request, warrant_flow.get_flow(stock_id, date, refresh))
