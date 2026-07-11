"""權證分點展開 service 測試(warrant-selector design §1.4;FinMind T+1 單發)。"""

from __future__ import annotations

from datetime import date as date_type

import pytest

from services import clock
from services import warrant_brokers as wb


def fm_row(
    date: str = "2026-07-09",
    trader: str = "凱基-台北",
    buy: int = 500,
    sell: int = 100,
) -> dict:
    return {
        "date": date,
        "stock_id": "030012",
        "securities_trader": trader,
        "securities_trader_id": "9200",
        "buy": buy,
        "sell": sell,
    }


class FakeFinMind:
    def __init__(self, rows_by_date: dict[str, list]) -> None:
        self.rows_by_date = rows_by_date
        self.calls: list[str] = []

    async def fetch_warrant_trading_daily_report(self, warrant_id: str, date: str) -> list:
        self.calls.append(date)
        return self.rows_by_date.get(date, [])


@pytest.fixture(autouse=True)
def _freeze_today(monkeypatch):
    # 2026-07-10 = Friday
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 10))


def patch_fm(monkeypatch, rows_by_date: dict[str, list]) -> FakeFinMind:
    fake = FakeFinMind(rows_by_date)
    monkeypatch.setattr(wb, "get_finmind", lambda: fake)
    return fake


async def test_hits_t_minus_1_sorted_by_abs_net(monkeypatch):
    fake = patch_fm(monkeypatch, {
        "2026-07-09": [
            fm_row(trader="小券商", buy=110, sell=100),      # net +10
            fm_row(trader="大買超", buy=900, sell=100),      # net +800
            fm_row(trader="大賣超", buy=100, sell=600),      # net -500
        ],
    })
    payload = await wb.get_brokers("030012")
    assert payload["data_date"] == "2026-07-09"
    assert fake.calls == ["2026-07-09"]
    rows = payload["rows"]
    assert [r["broker_name"] for r in rows] == ["大買超", "大賣超", "小券商"]
    assert rows[0] == {"broker_name": "大買超", "buy": 900, "sell": 100, "net": 800}


async def test_skips_weekend_in_walkback(monkeypatch):
    # today = Mon 2026-07-13 → T-1 走 Fri 2026-07-10(跳週日/週六)
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 13))
    fake = patch_fm(monkeypatch, {"2026-07-10": [fm_row(date="2026-07-10")]})
    payload = await wb.get_brokers("030012")
    assert payload["data_date"] == "2026-07-10"
    assert fake.calls == ["2026-07-10"]  # 不打週末


async def test_multiday_rows_filtered_to_query_date(monkeypatch):
    # impl-R4:FinMind start_date open-ended 回多日 rows → 只留查詢日
    patch_fm(monkeypatch, {
        "2026-07-09": [fm_row(date="2026-07-09"), fm_row(date="2026-07-10", trader="混入")],
    })
    payload = await wb.get_brokers("030012")
    assert payload["data_date"] == "2026-07-09"
    assert [r["broker_name"] for r in payload["rows"]] == ["凱基-台北"]


async def test_walkback_until_hit(monkeypatch):
    fake = patch_fm(monkeypatch, {"2026-07-07": [fm_row(date="2026-07-07")]})
    payload = await wb.get_brokers("030012")
    assert payload["data_date"] == "2026-07-07"
    assert fake.calls == ["2026-07-09", "2026-07-08", "2026-07-07"]


async def test_all_empty_returns_none(monkeypatch):
    fake = patch_fm(monkeypatch, {})
    payload = await wb.get_brokers("030012")
    assert payload == {"data_date": None, "rows": []}
    assert len(fake.calls) == wb.BROKER_LOOKBACK_DAYS


async def test_cache_hit_skips_refetch(monkeypatch):
    fake = patch_fm(monkeypatch, {"2026-07-09": [fm_row()]})
    await wb.get_brokers("030012")
    await wb.get_brokers("030012")
    assert len(fake.calls) == 1


async def test_refresh_bypasses_cache(monkeypatch):
    fake = patch_fm(monkeypatch, {"2026-07-09": [fm_row()]})
    await wb.get_brokers("030012")
    await wb.get_brokers("030012", refresh=True)
    assert len(fake.calls) == 2
