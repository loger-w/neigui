# 分點反查 service(services/broker_flows.py)— design .claude/feat/broker-daily-flows/design.md v3
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

import services.broker_flows as bf
from utils.cache import atomic_write_json

# ---------------------------------------------------------------- helpers

_DIRECTORY_ROWS = [
    {"securities_trader_id": "9600", "securities_trader": "富邦",
     "date": "1988-09-16", "address": "", "phone": ""},
    {"securities_trader_id": "9604", "securities_trader": "富邦-陽明",
     "date": "2000-09-09", "address": "", "phone": ""},
    {"securities_trader_id": "9200", "securities_trader": "凱基",
     "date": "1988-01-01", "address": "", "phone": ""},
    {"securities_trader_id": "779c", "securities_trader": "摩根大通",
     "date": "2000-01-01", "address": "", "phone": ""},
]


def _row(stock: str, price: float, buy: int, sell: int, d: str = "2026-07-17") -> dict:
    return {
        "securities_trader": "富邦", "securities_trader_id": "9600",
        "stock_id": stock, "date": d, "price": price, "buy": buy, "sell": sell,
    }


class _FakeFM:
    """fetch_daily_report_by_trader / fetch_securities_trader_info 雙樁。"""

    def __init__(self, day_rows: dict[str, list] | None = None,
                 directory: list | None = None, delay: float = 0.0):
        self.report_calls: list[tuple[str, str]] = []
        self.info_calls = 0
        self.day_rows = day_rows or {}
        self.directory = _DIRECTORY_ROWS if directory is None else directory
        self.delay = delay

    async def fetch_daily_report_by_trader(self, trader_id: str, date_str: str) -> list:
        self.report_calls.append((trader_id, date_str))
        if self.delay:
            await asyncio.sleep(self.delay)
        return self.day_rows.get(date_str, [])

    async def fetch_securities_trader_info(self) -> list:
        self.info_calls += 1
        return self.directory


def _async_ret(value):
    async def _fn(*args, **kwargs):
        return value
    return _fn


@pytest.fixture
def frozen_today(monkeypatch):
    """clock.today() → 2026-07-17(Fri;probe 實測有分點資料的交易日)。"""
    from services import clock

    monkeypatch.setattr(clock, "today", lambda: date(2026, 7, 17))


@pytest.fixture
def names(monkeypatch):
    monkeypatch.setattr(bf, "_symbol_names", _async_ret({"2330": "台積電", "2412": "中華電"}))


def _install(monkeypatch, fake: _FakeFM) -> _FakeFM:
    monkeypatch.setattr(bf, "get_finmind", lambda: fake)
    return fake


# ---------------------------------------------------------------- _aggregate_flows

def test_aggregate_groups_by_stock_and_truncates_lots():
    rows = [_row("2330", 1000.0, 1500, 0), _row("2330", 1005.0, 600, 100)]
    buy_top, sell_top, count = bf._aggregate_flows(rows)
    assert count == 1
    assert sell_top == []
    (item,) = buy_top
    assert item["stock_id"] == "2330"
    assert item["buy_lots"] == (1500 + 600) // 1000  # 股數加總後截斷 = 2
    assert item["sell_lots"] == 0
    assert item["net_lots"] == 2
    assert item["net_amount"] == round(1500 * 1000.0 + 500 * 1005.0)


def test_aggregate_sorts_by_net_amount_and_caps_30():
    rows = [_row(f"{1000 + i}", 10.0, (i + 1) * 1000, 0) for i in range(35)]
    buy_top, sell_top, count = bf._aggregate_flows(rows)
    assert count == 35
    assert len(buy_top) == 30
    amounts = [r["net_amount"] for r in buy_top]
    assert amounts == sorted(amounts, reverse=True)
    # 最小的 5 檔被截掉
    assert {r["stock_id"] for r in buy_top}.isdisjoint({f"{1000 + i}" for i in range(5)})


def test_aggregate_sell_side_sorted_ascending():
    rows = [_row("1101", 50.0, 0, 2000), _row("1102", 50.0, 0, 8000)]
    buy_top, sell_top, _ = bf._aggregate_flows(rows)
    assert buy_top == []
    assert [r["stock_id"] for r in sell_top] == ["1102", "1101"]  # 最負在前
    assert sell_top[0]["net_amount"] == -round(8000 * 50.0)


def test_aggregate_zero_net_amount_excluded():
    rows = [_row("3008", 500.0, 1000, 1000)]  # 同價同量 → net_amount = 0
    buy_top, sell_top, count = bf._aggregate_flows(rows)
    assert buy_top == [] and sell_top == []
    assert count == 1  # stock_count 仍計入


def test_aggregate_sign_divergence_classified_by_amount():
    # 低買高賣同量:net_lots = 0 但 net_amount < 0 → 入賣超表(design R5)
    rows = [_row("2603", 100.0, 1000, 0), _row("2603", 110.0, 0, 1000)]
    buy_top, sell_top, _ = bf._aggregate_flows(rows)
    assert buy_top == []
    (item,) = sell_top
    assert item["net_lots"] == 0
    assert item["net_amount"] == -10000


# ---------------------------------------------------------------- _candidate_dates

def test_candidate_dates_skips_weekend():
    # 起點週日 2026-07-19 → [17(Fri), 16(Thu), 15(Wed)]
    assert bf._candidate_dates(date(2026, 7, 19)) == ["2026-07-17", "2026-07-16", "2026-07-15"]


# ---------------------------------------------------------------- get_daily_flows

async def test_daily_flows_happy_path(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({"2026-07-17": [
        _row("2330", 1000.0, 2000, 0), _row("2412", 120.0, 0, 5000),
    ]}))
    payload = await bf.get_daily_flows("9600", None, False)
    assert payload["broker_id"] == "9600"
    assert payload["broker_name"] == "富邦"
    assert payload["requested_date"] == "2026-07-17"
    assert payload["as_of_date"] == "2026-07-17"
    assert payload["no_trading_day"] is False
    assert payload["stock_count"] == 2
    assert payload["buy_top"][0]["stock_name"] == "台積電"
    assert payload["sell_top"][0]["stock_name"] == "中華電"
    assert fake.report_calls == [("9600", "2026-07-17")]


async def test_daily_flows_falls_back_to_prev_trading_day(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({"2026-07-16": [_row("2330", 1000.0, 2000, 0, "2026-07-16")]}))
    payload = await bf.get_daily_flows("9600", None, False)
    assert payload["as_of_date"] == "2026-07-16"
    assert payload["no_trading_day"] is True
    assert [d for _, d in fake.report_calls] == ["2026-07-17", "2026-07-16"]


async def test_daily_flows_all_empty_503_and_at_most_3_requests(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({}))
    with pytest.raises(HTTPException) as ei:
        await bf.get_daily_flows("9600", None, False)
    assert ei.value.status_code == 503
    assert ei.value.detail == {"error": "broker_flows_unavailable"}
    assert len(fake.report_calls) == 3  # SC-8:候選日上限 3

async def test_daily_flows_invalid_calendar_date_400(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({}))
    with pytest.raises(HTTPException) as ei:
        await bf.get_daily_flows("9600", "2026-02-31", False)
    assert ei.value.status_code == 400
    assert ei.value.detail == {"error": "invalid_date"}
    assert fake.report_calls == []


async def test_daily_flows_future_date_clamped_to_today(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({"2026-07-17": [_row("2330", 1000.0, 2000, 0)]}))
    payload = await bf.get_daily_flows("9600", "2026-07-24", False)
    assert fake.report_calls[0] == ("9600", "2026-07-17")
    assert payload["requested_date"] == "2026-07-17"  # clamp 後的有效請求日
    assert payload["no_trading_day"] is False


async def test_daily_flows_unknown_broker_404(monkeypatch, frozen_today, names):
    _install(monkeypatch, _FakeFM({}))
    with pytest.raises(HTTPException) as ei:
        await bf.get_daily_flows("0000", None, False)
    assert ei.value.status_code == 404
    assert ei.value.detail == {"error": "broker_not_found"}


async def test_daily_flows_directory_down_degrades(monkeypatch, frozen_today, names):
    """目錄不可得:跳過 404 前置檢查,broker_name fallback = broker_id(R10)。"""
    fake = _install(monkeypatch, _FakeFM({"2026-07-17": [_row("2330", 1000.0, 2000, 0)]}))
    monkeypatch.setattr(bf, "_get_directory_or_none", _async_ret(None))
    payload = await bf.get_daily_flows("9600", None, False)
    assert payload["broker_name"] == "9600"
    assert len(fake.report_calls) == 1


async def test_daily_flows_symbols_unavailable_degrades_names(monkeypatch, frozen_today):
    """symbols 載入失敗(ValueError)→ 名稱空字串,不 503(R1)。"""
    import routes.symbols as symbols_mod

    _install(monkeypatch, _FakeFM({"2026-07-17": [_row("2330", 1000.0, 2000, 0)]}))

    async def _boom():
        raise ValueError("symbols_unavailable")

    monkeypatch.setattr(symbols_mod, "get_symbol_name_map", _boom)
    payload = await bf.get_daily_flows("9600", None, False)
    assert payload["buy_top"][0]["stock_name"] == ""


async def test_daily_flows_cache_hit_skips_fetch(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({"2026-07-17": [_row("2330", 1000.0, 2000, 0)]}))
    await bf.get_daily_flows("9600", None, False)
    await bf.get_daily_flows("9600", None, False)
    assert len(fake.report_calls) == 1  # 第二發吃 cache


async def test_daily_flows_empty_result_not_cached(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({}))
    with pytest.raises(HTTPException):
        await bf.get_daily_flows("9600", None, False)
    fake.day_rows["2026-07-17"] = [_row("2330", 1000.0, 2000, 0)]
    payload = await bf.get_daily_flows("9600", None, False)  # 空結果若落 cache 這裡會再 503
    assert payload["as_of_date"] == "2026-07-17"


async def test_daily_flows_refresh_bypasses_cache(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({"2026-07-17": [_row("2330", 1000.0, 2000, 0)]}))
    await bf.get_daily_flows("9600", None, False)
    await bf.get_daily_flows("9600", None, True)
    assert len(fake.report_calls) == 2


async def test_daily_flows_today_ttl_expired_refetches(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM({"2026-07-17": [_row("2330", 1000.0, 2000, 0)]}))
    await bf.get_daily_flows("9600", None, False)
    # 手動把今日 cache 的 fetched_at 調成 2 小時前(>30min TTL)
    path = bf._flows_cache_path("9600", "2026-07-17")
    from utils.cache import read_json

    payload = read_json(path)
    payload["fetched_at"] = (datetime.now() - timedelta(hours=2)).isoformat(timespec="seconds")
    atomic_write_json(path, payload)
    await bf.get_daily_flows("9600", None, False)
    assert len(fake.report_calls) == 2


async def test_daily_flows_concurrent_same_key_dedup(monkeypatch, frozen_today, names):
    fake = _install(monkeypatch, _FakeFM(
        {"2026-07-17": [_row("2330", 1000.0, 2000, 0)]}, delay=0.05,
    ))
    r1, r2 = await asyncio.gather(
        bf.get_daily_flows("9600", None, False),
        bf.get_daily_flows("9600", None, False),
    )
    assert r1["as_of_date"] == r2["as_of_date"] == "2026-07-17"
    assert len(fake.report_calls) == 1  # SC-8 inflight dedup


# ---------------------------------------------------------------- search_traders

async def test_search_traders_id_prefix_case_insensitive(monkeypatch, frozen_today):
    _install(monkeypatch, _FakeFM({}))
    hits = await bf.search_traders("779C")
    assert hits == [{"broker_id": "779c", "broker_name": "摩根大通"}]


async def test_search_traders_name_substring(monkeypatch, frozen_today):
    _install(monkeypatch, _FakeFM({}))
    hits = await bf.search_traders("富邦")
    assert {h["broker_id"] for h in hits} == {"9600", "9604"}


async def test_search_traders_caps_at_50(monkeypatch, frozen_today):
    rows = [
        {"securities_trader_id": f"X{i:03d}", "securities_trader": f"測試{i}",
         "date": "", "address": "", "phone": ""}
        for i in range(60)
    ]
    _install(monkeypatch, _FakeFM({}, directory=rows))
    hits = await bf.search_traders("測試")
    assert len(hits) == 50


async def test_search_traders_directory_unavailable_503(monkeypatch, frozen_today):
    monkeypatch.setattr(bf, "_get_directory_or_none", _async_ret(None))
    with pytest.raises(HTTPException) as ei:
        await bf.search_traders("富邦")
    assert ei.value.status_code == 503
    assert ei.value.detail == {"error": "broker_directory_unavailable"}


async def test_directory_cached_24h(monkeypatch, frozen_today):
    fake = _install(monkeypatch, _FakeFM({}))
    await bf.search_traders("富邦")
    await bf.search_traders("凱基")
    assert fake.info_calls == 1  # 24h 內共用 cache
    path = bf._directory_cache_path()
    from utils.cache import read_json

    payload = read_json(path)
    payload["fetched_at"] = (datetime.now() - timedelta(hours=25)).isoformat(timespec="seconds")
    atomic_write_json(path, payload)
    await bf.search_traders("富邦")
    assert fake.info_calls == 2  # 過期重抓


# ---------------------------------------------------------------- FinMindClient fetch 參數

async def test_fetch_daily_report_by_trader_params(monkeypatch):
    from services.finmind import FinMindClient

    client = FinMindClient()
    seen: dict = {}

    async def fake_get(url: str, params: dict) -> list:
        seen["url"], seen["params"] = url, params
        return []

    monkeypatch.setattr(client, "_get", fake_get)
    await client.fetch_daily_report_by_trader("9600", "2026-07-17")
    assert seen["url"].endswith("/taiwan_stock_trading_daily_report")
    assert seen["params"] == {"securities_trader_id": "9600", "date": "2026-07-17"}


async def test_fetch_securities_trader_info_params(monkeypatch):
    from services.finmind import FinMindClient

    client = FinMindClient()
    seen: dict = {}

    async def fake_get(url: str, params: dict) -> list:
        seen["url"], seen["params"] = url, params
        return []

    monkeypatch.setattr(client, "_get", fake_get)
    await client.fetch_securities_trader_info()
    assert seen["url"].endswith("/data")
    assert seen["params"] == {"dataset": "TaiwanSecuritiesTraderInfo"}
