"""分點反查 API(feat/broker-daily-flows design v3 §2.3)。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from services import broker_flows

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/broker/traders")
async def get_broker_traders(search: str = Query(min_length=1)) -> dict:
    return await broker_flows.search_traders(search)


@router.get("/api/broker/daily-flows")
async def get_broker_daily_flows(
    broker_id: str = Query(min_length=1),
    date: str | None = Query(default=None),
    refresh: bool = Query(default=False),
) -> dict:
    # date 驗證集中 service 層 fromisoformat(單一真源;route 不做 regex)
    return await broker_flows.get_daily_flows(broker_id.strip(), date, refresh)
