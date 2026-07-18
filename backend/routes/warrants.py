"""權證選擇器 routes — EOD 快照 / MIS 盤中 quotes / IV 歷史 / 分點流向。

Error 邊界逐 endpoint(design R9):warrants/quotes/iv-history 上游是
TWSE/TPEx/MIS,自己 catch httpx 基類 → 502 warrant_upstream(中央 handler
會錯標 finmind_error);flow 上游是 FinMind → 不 catch,沿中央 handler。
"""

from __future__ import annotations

import logging
import re
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Request

from services import (
    warrant_flow,
    warrant_flow_history,
    warrant_iv_history,
    warrant_quotes,
    warrants,
)
from utils.cancel import run_with_disconnect

logger = logging.getLogger(__name__)

router = APIRouter()

# R2-3:warrant_id 同驗 — 未驗證直傳 FinMind data_id 會以 ×5 日回退放大配額浪費
_VALID_ID = re.compile(r"^[0-9A-Za-z]{4,6}$")
_VALID_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _validate_id(value: str) -> None:
    if not _VALID_ID.fullmatch(value):
        raise HTTPException(status_code=400, detail={"error": "bad_symbol"})


def _validate_date(value: str) -> None:
    """regex + fromisoformat 雙驗(impl R2-2:2026-13-99 形狀合法但日曆非法)。"""
    if not _VALID_DATE.fullmatch(value):
        raise HTTPException(status_code=400, detail={"error": "bad_date"})
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": "bad_date"}) from exc


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


@router.get("/api/warrants/{warrant_id}/iv-history")
async def get_warrant_iv_history(request: Request, warrant_id: str, refresh: bool = False) -> dict:
    _validate_id(warrant_id)
    try:
        payload = await run_with_disconnect(
            request, warrant_iv_history.get_iv_history(warrant_id, refresh)
        )
    except httpx.HTTPError as exc:
        # snapshot 冷 build 可觸 TWSE/TPEx 網路 — 同 warrants/quotes 自 catch(R9)
        logger.warning("warrant iv-history upstream error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "warrant_upstream"}) from exc
    if payload is None:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return payload


@router.get("/api/warrants/{stock_id}/flow/history")
async def get_warrant_flow_history(request: Request, stock_id: str, backfill: bool = False) -> dict:
    """外部淨額時序(近 20 交易日槽位)。backfill 不用 refresh 語意 —
    refresh = 跳 cache 全重抓,對 20 日 series ≈ 4000 req(design §3.2 divergence)。"""
    _validate_id(stock_id)
    # FinMind httpx 不 catch(中央 handler);快照錯誤 service 內轉 502(同 flow)
    return await run_with_disconnect(
        request, warrant_flow_history.get_flow_history(stock_id, backfill)
    )


@router.get("/api/warrants/{stock_id}/flow")
async def get_warrant_flow(
    request: Request, stock_id: str, date: str | None = None, refresh: bool = False
) -> dict:
    _validate_id(stock_id)
    if date is not None:
        _validate_date(date)
    # FinMind httpx 錯誤不 catch → 中央 handler finmind_error;
    # 快照(TWSE/TPEx)錯誤 service 內已轉 502 warrant_upstream(design R16)
    return await run_with_disconnect(request, warrant_flow.get_flow(stock_id, date, refresh))
