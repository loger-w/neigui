"""daytrade_fee service 單元測試(/feat daytrade-borrow-fee Wave 1)。

SC 對映見 .claude/feat/daytrade-borrow-fee/brainstorm.md;
raw payload 樣本取自 2026-07-08/11 TWSE BFIF8U 與 TPEx intraday_fee probe 縮樣。
"""

from __future__ import annotations

import asyncio
from datetime import date as date_type

import pytest
from fastapi import HTTPException

import services.daytrade_fee as df
from services import clock


@pytest.fixture(autouse=True)
def _reset_daytrade_fee_module(monkeypatch):
    """module-level 狀態隔離(impl-spec R1-2):對齊 conftest 的 fm._client
    reset 慣例(_inflight 已由 conftest _reset_realtime_task_registries 統一清)。"""
    monkeypatch.setattr(df, "_client", None)


@pytest.fixture()
def frozen_today(monkeypatch):
    """clock.today() → 2026-07-10(週五為非交易日的那週,無所謂 — 測試只看日期算術)。"""
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 10))


TWSE_ROW = ["115/07/09", "8150      ", "南茂          ", "10,000", "3.500%"]
TPEX_ROW = {
    "Date": "1150709",
    "SecuritiesCompanyCode": "8069  ",
    "CompanyName": "元太  ",
    " LendingVolume": "25,000",
    "LendingFee": "1.000",
}


# ---------------------------------------------------------------- SC-7 normalize

def test_normalize_twse_row_dirty():
    row = df.normalize_twse_row(TWSE_ROW)
    assert row == {
        "date": "2026-07-09",
        "market": "twse",
        "stock_id": "8150",
        "name": "南茂",
        "lending_shares": 10000,
        "fee_rate": 3.5,
    }


def test_normalize_tpex_row_dirty():
    row = df.normalize_tpex_row(TPEX_ROW)
    assert row == {
        "date": "2026-07-09",
        "market": "tpex",
        "stock_id": "8069",
        "name": "元太",
        "lending_shares": 25000,
        "fee_rate": 1.0,
    }


def test_normalize_bad_row_returns_none():
    assert df.normalize_twse_row(["115/07/09", "8150", "南茂", "not-a-number", "x%"]) is None
    assert df.normalize_twse_row([]) is None
    assert df.normalize_tpex_row({"Date": "1150709"}) is None


# ---------------------------------------------------------------- SC-3 常數鎖

def test_fee_highlight_threshold_value():
    # 前端同名測試:frontend/src/lib/borrow-fee-utils.test.ts(兩端鎖同值防 drift)
    assert df.FEE_HIGHLIGHT_THRESHOLD == 3.5


# ---------------------------------------------------------------- SC-6 cache

def _raw_stub(monkeypatch, payload_map):
    """monkeypatch _fetch_month_raw;payload_map[(market, yyyymm)] = raw list。
    回傳呼叫計數 dict。"""
    calls: dict[str, int] = {}

    async def fake_raw(market: str, yyyymm: str) -> list:
        key = f"{market}_{yyyymm}"
        calls[key] = calls.get(key, 0) + 1
        return payload_map.get((market, yyyymm), [])

    monkeypatch.setattr(df, "_fetch_month_raw", fake_raw)
    return calls


async def test_fetch_month_caches_and_refresh_busts(monkeypatch, frozen_today):
    calls = _raw_stub(monkeypatch, {("twse", "2026-07"): [TWSE_ROW]})
    rows1 = await df.fetch_month("twse", "2026-07")
    rows2 = await df.fetch_month("twse", "2026-07")
    assert rows1 == rows2
    assert calls["twse_2026-07"] == 1
    await df.fetch_month("twse", "2026-07", refresh=True)
    assert calls["twse_2026-07"] == 2


async def test_current_month_cache_stale_next_day(monkeypatch, frozen_today):
    calls = _raw_stub(monkeypatch, {("twse", "2026-07"): [TWSE_ROW]})
    await df.fetch_month("twse", "2026-07")
    assert calls["twse_2026-07"] == 1
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 11))
    await df.fetch_month("twse", "2026-07")
    assert calls["twse_2026-07"] == 2


async def test_past_month_cache_immortal(monkeypatch, frozen_today):
    calls = _raw_stub(monkeypatch, {("twse", "2026-06"): [["115/06/26", "0050", "元大台灣50", "1,000", "3.500%"]]})
    await df.fetch_month("twse", "2026-06")
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 11))
    rows = await df.fetch_month("twse", "2026-06")
    assert calls["twse_2026-06"] == 1
    assert rows[0]["stock_id"] == "0050"


async def test_tpex_past_month_refresh_serves_cache(monkeypatch):
    """P0-1 保護 (a):tpex 過去月 + refresh=True 不打 upstream、不覆寫 cache。"""
    # 6 月時抓過(當月)→ cache 落地
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 6, 26))
    calls = _raw_stub(monkeypatch, {("tpex", "2026-06"): [TPEX_ROW | {"Date": "1150626"}]})
    await df.fetch_month("tpex", "2026-06")
    assert calls["tpex_2026-06"] == 1
    # 時間走到 7 月,6 月變過去月 → refresh 也回 cache,零 raw call
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 10))
    rows = await df.fetch_month("tpex", "2026-06", refresh=True)
    assert calls["tpex_2026-06"] == 1
    assert rows[0]["date"] == "2026-06-26"


async def test_empty_raw_does_not_overwrite_nonempty_cache(monkeypatch, frozen_today):
    """P0-1 保護 (b):上游暫時回空不得吃掉既有非空 cache。"""
    payload_map = {("twse", "2026-07"): [TWSE_ROW]}
    calls = _raw_stub(monkeypatch, payload_map)
    await df.fetch_month("twse", "2026-07")
    # 隔日 stale → 重抓,但上游這次回空
    payload_map[("twse", "2026-07")] = []
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 11))
    rows = await df.fetch_month("twse", "2026-07")
    assert calls["twse_2026-07"] == 2
    assert rows[0]["stock_id"] == "8150"  # 舊資料仍在
    # cache 檔本身也未被覆寫成空:再讀一次(同日,cache fresh)仍有料
    rows2 = await df.fetch_month("twse", "2026-07")
    assert rows2 == rows


# ---------------------------------------------------------------- P0-2 inflight dedup

async def test_run_once_dedup_concurrent(monkeypatch, frozen_today):
    started = asyncio.Event()
    release = asyncio.Event()
    calls = {"n": 0}

    async def slow_raw(market: str, yyyymm: str) -> list:
        calls["n"] += 1
        started.set()
        await release.wait()
        return [TWSE_ROW]

    monkeypatch.setattr(df, "_fetch_month_raw", slow_raw)
    t1 = asyncio.create_task(df.fetch_month("twse", "2026-07"))
    t2 = asyncio.create_task(df.fetch_month("twse", "2026-07"))
    await started.wait()
    release.set()
    r1, r2 = await asyncio.gather(t1, t2)
    assert r1 == r2
    assert calls["n"] == 1


async def test_run_once_cancel_one_waiter_other_survives(monkeypatch, frozen_today):
    """finmind._run_once 同構性質:caller cancel 不殺共享 task(shield + refcount)。"""
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_raw(market: str, yyyymm: str) -> list:
        started.set()
        await release.wait()
        return [TWSE_ROW]

    monkeypatch.setattr(df, "_fetch_month_raw", slow_raw)
    t1 = asyncio.create_task(df.fetch_month("twse", "2026-07"))
    t2 = asyncio.create_task(df.fetch_month("twse", "2026-07"))
    await started.wait()
    t1.cancel()
    await asyncio.sleep(0)  # 讓 cancel 傳導
    release.set()
    rows = await t2
    assert rows[0]["stock_id"] == "8150"
    with pytest.raises(asyncio.CancelledError):
        await t1


# ---------------------------------------------------------------- SC-4 / SC-2 get_day

def _fetch_month_stub(monkeypatch, rows_map):
    """monkeypatch fetch_month 本體,隔離 get_day 邏輯。
    rows_map[(market, yyyymm)] = normalized rows。"""
    async def fake_fetch(market: str, yyyymm: str, refresh: bool = False) -> list[dict]:
        return rows_map.get((market, yyyymm), [])

    monkeypatch.setattr(df, "fetch_month", fake_fetch)


def _row(date: str, market: str, sid: str, shares: int, fee: float) -> dict:
    return {"date": date, "market": market, "stock_id": sid, "name": f"n{sid}",
            "lending_shares": shares, "fee_rate": fee}


async def test_get_day_falls_back_within_month(monkeypatch, frozen_today):
    _fetch_month_stub(monkeypatch, {("twse", "2026-07"): [_row("2026-07-09", "twse", "8150", 10000, 3.5)]})
    payload = await df.get_day(None)
    assert payload["as_of_date"] == "2026-07-09"
    assert payload["no_trading_day"] is True


async def test_get_day_recurses_prev_month_once(monkeypatch, frozen_today):
    _fetch_month_stub(monkeypatch, {("twse", "2026-06"): [_row("2026-06-30", "twse", "2408", 68000, 0.97)]})
    payload = await df.get_day(None)
    assert payload["as_of_date"] == "2026-06-30"
    assert payload["no_trading_day"] is True
    assert payload["partial"] == ["tpex"]  # 過去月 tpex 全空 → partial


async def test_get_day_404_no_data(monkeypatch, frozen_today):
    _fetch_month_stub(monkeypatch, {})
    with pytest.raises(HTTPException) as ei:
        await df.get_day(None)
    assert ei.value.status_code == 404
    assert ei.value.detail == {"error": "no_data"}


async def test_no_trading_day_flag_with_explicit_date(monkeypatch, frozen_today):
    rows = {("twse", "2026-07"): [_row("2026-07-07", "twse", "8150", 1000, 1.0)]}
    _fetch_month_stub(monkeypatch, rows)
    fallback = await df.get_day("2026-07-08")
    assert fallback["as_of_date"] == "2026-07-07"
    assert fallback["no_trading_day"] is True
    exact = await df.get_day("2026-07-07")
    assert exact["as_of_date"] == "2026-07-07"
    assert "no_trading_day" not in exact


async def test_get_day_merges_markets_sorted_fee_desc(monkeypatch, frozen_today):
    _fetch_month_stub(monkeypatch, {
        ("twse", "2026-07"): [
            _row("2026-07-10", "twse", "2434", 21000, 2.619),
            _row("2026-07-10", "twse", "8046", 2000, 7.0),
        ],
        ("tpex", "2026-07"): [_row("2026-07-10", "tpex", "8069", 25000, 1.0)],
    })
    payload = await df.get_day(None)
    assert "no_trading_day" not in payload
    assert [r["stock_id"] for r in payload["rows"]] == ["8046", "2434", "8069"]
    assert {r["market"] for r in payload["rows"]} == {"twse", "tpex"}


async def test_month_counts_distinct_dates(monkeypatch, frozen_today):
    """同日多筆算 1 次(brainstorm edge 5)。"""
    _fetch_month_stub(monkeypatch, {
        ("twse", "2026-07"): [
            _row("2026-07-09", "twse", "8150", 1000, 0.6),
            _row("2026-07-09", "twse", "8150", 10000, 3.5),
            _row("2026-07-10", "twse", "8150", 2000, 1.0),
            _row("2026-07-10", "twse", "2408", 68000, 0.97),
        ],
    })
    payload = await df.get_day(None)
    assert payload["month_counts"]["8150"] == 2
    assert payload["month_counts"]["2408"] == 1


async def test_rows_keep_multiple_entries_per_stock(monkeypatch, frozen_today):
    """逐筆保留,不折疊(FinMind 判死主因)。"""
    _fetch_month_stub(monkeypatch, {
        ("twse", "2026-07"): [
            _row("2026-07-10", "twse", "8046", 2000, 7.0),
            _row("2026-07-10", "twse", "8046", 12000, 0.1),
        ],
    })
    payload = await df.get_day(None)
    assert len(payload["rows"]) == 2
    assert payload["rows"][0]["fee_rate"] == 7.0


# ---------------------------------------------------------------- R2-1 partial per-day

async def test_partial_tpex_stale_cache_missing_asof_day(monkeypatch, frozen_today):
    """tpex 過去月 cache 凍結在月中(有料但缺 as_of 日)也要 partial。"""
    _fetch_month_stub(monkeypatch, {
        ("twse", "2026-06"): [_row("2026-06-30", "twse", "2408", 68000, 0.97)],
        ("tpex", "2026-06"): [_row("2026-06-15", "tpex", "8069", 1000, 1.0)],
    })
    payload = await df.get_day("2026-06-30")
    assert payload["as_of_date"] == "2026-06-30"
    assert payload["partial"] == ["tpex"]


async def test_partial_absent_when_tpex_covers_asof(monkeypatch, frozen_today):
    _fetch_month_stub(monkeypatch, {
        ("twse", "2026-06"): [_row("2026-06-30", "twse", "2408", 68000, 0.97)],
        ("tpex", "2026-06"): [_row("2026-06-30", "tpex", "8069", 1000, 1.0)],
    })
    payload = await df.get_day("2026-06-30")
    assert "partial" not in payload
