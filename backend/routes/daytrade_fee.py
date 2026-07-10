"""券差(當日沖銷券差借券費率)route — 最上層「券差」mode 的資料端點。"""

from __future__ import annotations

import logging
from datetime import date as date_type

import httpx
from fastapi import APIRouter, HTTPException, Request

from services import daytrade_fee as svc
from utils.cancel import run_with_disconnect

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/daytrade-fee")
async def get_daytrade_fee(
    request: Request,
    date: str | None = None,
    refresh: bool = False,
) -> dict:
    if date is not None:
        try:
            date_type.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail={"error": "bad_date"}) from None
    try:
        # run_with_disconnect:對齊 chip/options/market 全部 upstream-IO route 慣例;
        # client 斷線即 cancel handler,service _run_once 的 shield+refcount 才有
        # production 觸發源(cancel-chain)。
        return await run_with_disconnect(request, svc.get_day(date, refresh))
    except httpx.HTTPError as exc:
        # 基類全蓋(ReadError / RemoteProtocolError / ... 不漏)— 中央 handler 會
        # 把漏網 httpx 例外標成 finmind_error,對 TWSE/TPEx 是錯標籤。
        logger.warning("borrow fee upstream error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "borrow_fee_upstream"}) from exc
