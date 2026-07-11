"""權證分點展開 — FinMind TaiwanStockWarrantTradingDailyReport(T+1 單發)。

全表不含分點欄(spec §6.3 降級設計,避免 fan-out 燒配額);只在前端展開
單一權證時抓,cache per (warrant_id, date)。
"""

from __future__ import annotations

import logging
from datetime import timedelta

from services import clock
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION = 1
BROKER_LOOKBACK_DAYS = 5  # 跳週末後最多向前試的交易日數


def get_finmind():
    """per-module wrap(finmind-conventions):test 可獨立 monkeypatch。"""
    from services.finmind import get_finmind as _real

    return _real()


def _cache_path(warrant_id: str, date: str):
    return chip_cache_dir() / f"warrant_brokers_{warrant_id}_{date}.json"


def _read_cache(warrant_id: str, date: str) -> dict | None:
    payload = read_json(_cache_path(warrant_id, date))
    if not isinstance(payload, dict) or payload.get("_cache_version") != _CACHE_VERSION:
        return None
    return payload


def _candidate_dates() -> list[str]:
    """today−1 起向前的非週末日,取 BROKER_LOOKBACK_DAYS 個。"""
    dates: list[str] = []
    d = clock.today() - timedelta(days=1)
    while len(dates) < BROKER_LOOKBACK_DAYS:
        if d.weekday() < 5:
            dates.append(d.isoformat())
        d -= timedelta(days=1)
    return dates


async def get_brokers(warrant_id: str, refresh: bool = False) -> dict:
    """最近可得日的分點買賣超;全空 → data_date None(權證存在但無報表屬常態)。"""
    fm = get_finmind()
    for date in _candidate_dates():
        if not refresh:
            cached = _read_cache(warrant_id, date)
            if cached is not None:
                return {"data_date": cached["data_date"], "rows": cached["rows"]}
        raw = await fm.fetch_warrant_trading_daily_report(warrant_id, date)
        # impl-R4:start_date open-ended 會回多日 rows → 只留查詢日
        day_rows = [r for r in raw if r.get("date") == date]
        if not day_rows:
            continue
        rows = []
        for r in day_rows:
            try:
                buy = int(r["buy"])
                sell = int(r["sell"])
                rows.append(
                    {
                        "broker_name": str(r["securities_trader"]),
                        "buy": buy,
                        "sell": sell,
                        "net": buy - sell,
                    }
                )
            except (KeyError, ValueError, TypeError):
                logger.warning("skip bad warrant broker row: %r", r)
        rows.sort(key=lambda r: -abs(r["net"]))
        atomic_write_json(
            _cache_path(warrant_id, date),
            {"_cache_version": _CACHE_VERSION, "data_date": date, "rows": rows},
        )
        return {"data_date": date, "rows": rows}
    return {"data_date": None, "rows": []}
