"""market-monitor-v2 Phase 1 — universe filter service.

排除規則(spec.md §6.1):
- ETF:`stock_id` startswith `00`(0050 / 0056 / 00919)
- 權證:`stock_id` 長度 != 4 或含非 digit(7XXXXX 6 位 / 含字母 / 包含特殊符號)
- 注意處置股:FinMind TaiwanStockDispositionSecuritiesPeriod period_start <= today <= period_end
"""
from __future__ import annotations

import asyncio
from datetime import date

import pytest

from services.market_universe import (
    classify_stock_id,
    fetch_disposition_stocks,
    filter_universe,
    get_filtered_universe,
)

# ---------------------------------------------------------------------------
# classify_stock_id — 純函式 stock_id pattern check
# ---------------------------------------------------------------------------


def test_classify_etf_prefix_00_excluded() -> None:
    """ETF 統一基金:`00` 開頭(4 / 5 / 6 位皆有,如 0050 / 00919)→ 'etf'。"""
    assert classify_stock_id("0050") == "etf"
    assert classify_stock_id("0056") == "etf"
    assert classify_stock_id("00919") == "etf"
    assert classify_stock_id("00878") == "etf"


def test_classify_warrant_non_4_digit_excluded() -> None:
    """權證 / 衍生品:stock_id 長度 != 4(6 位數 7XXXXX / 含非 digit)→ 'warrant'。"""
    # 6 位數認購權證
    assert classify_stock_id("712345") == "warrant"
    # 5 位數非 ETF prefix
    assert classify_stock_id("12345") == "warrant"
    # 含字母 (TDR / KY 後綴 / 警示)
    assert classify_stock_id("2330R") == "warrant"
    # 含特殊字元
    assert classify_stock_id("303-7") == "warrant"


def test_classify_common_stock_included() -> None:
    """4 位數普通股(包括非 00 開頭)→ None,代表 pass through。"""
    assert classify_stock_id("3037") is None  # 欣興
    assert classify_stock_id("8046") is None  # 南電
    assert classify_stock_id("2330") is None  # 台積電
    assert classify_stock_id("2317") is None  # 鴻海
    assert classify_stock_id("1101") is None  # 台泥


def test_classify_empty_or_invalid_treated_as_warrant() -> None:
    """空字串 / None-ish 視為 warrant(排除以防汙染 universe)。"""
    assert classify_stock_id("") == "warrant"
    assert classify_stock_id("   ") == "warrant"


# ---------------------------------------------------------------------------
# filter_universe — 純函式 candidate list + watch list → 分桶
# ---------------------------------------------------------------------------


def test_filter_universe_partitions_correctly() -> None:
    """Plan §Phase 1:給 mixed list,回 universe set + excluded dict。"""
    candidates = [
        "2330",   # 普通股
        "0050",   # ETF
        "0056",   # ETF
        "712345",  # 權證
        "3037",   # 普通股
        "8046",   # 普通股(同時在 watch_list)
        "00919",  # ETF
    ]
    watch_list = {"8046"}  # mock disposition stock

    out = filter_universe(candidates, watch_list=watch_list)

    assert out["universe"] == {"2330", "3037"}
    assert set(out["excluded"]["etf"]) == {"0050", "0056", "00919"}
    assert set(out["excluded"]["warrant"]) == {"712345"}
    assert set(out["excluded"]["watch_list"]) == {"8046"}


def test_filter_universe_watch_list_overrides_common_classification() -> None:
    """普通股若同時在 watch_list,歸入 watch_list 桶,不雙計。"""
    out = filter_universe(["3037"], watch_list={"3037"})
    assert out["universe"] == set()
    assert "3037" not in out["excluded"]["etf"]
    assert "3037" not in out["excluded"]["warrant"]
    assert "3037" in out["excluded"]["watch_list"]


def test_filter_universe_empty_watch_list_keeps_all_common() -> None:
    """空 watch_list → 純按 classify 結果分桶。"""
    out = filter_universe(["2330", "0050", "712345"], watch_list=set())
    assert out["universe"] == {"2330"}
    assert out["excluded"]["watch_list"] == []


# ---------------------------------------------------------------------------
# fetch_disposition_stocks — FinMind IO + cache
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_finmind_disposition(monkeypatch):
    """Mock get_finmind()._get to return disposition fixture rows."""
    import services.market_universe as mu

    calls: list[dict] = []

    class _MockClient:
        async def _get(self, url: str, params: dict) -> list:
            calls.append({"url": url, "params": dict(params)})
            return [
                # 2330 處置中(period 覆蓋 today)
                {
                    "date": "2026-06-20",
                    "stock_id": "2330",
                    "stock_name": "台積電",
                    "period_start": "2026-06-20",
                    "period_end": "2026-07-05",
                },
                # 9999 處置已結束(period_end < today)
                {
                    "date": "2026-05-01",
                    "stock_id": "9999",
                    "stock_name": "某",
                    "period_start": "2026-05-01",
                    "period_end": "2026-05-10",
                },
                # 8888 處置未開始(period_start > today)
                {
                    "date": "2026-06-25",
                    "stock_id": "8888",
                    "stock_name": "某",
                    "period_start": "2026-07-10",
                    "period_end": "2026-07-20",
                },
            ]

    monkeypatch.setattr(mu, "get_finmind", lambda: _MockClient())
    return calls


async def test_fetch_disposition_stocks_filters_by_today(
    mock_finmind_disposition,
) -> None:
    """只回 period_start <= today <= period_end 的 stock_id。"""
    out = await fetch_disposition_stocks(today=date(2026, 6, 30), refresh=True)
    assert out == {"2330"}


async def test_fetch_disposition_stocks_uses_cache_on_second_call(
    mock_finmind_disposition,
) -> None:
    """同 today 二次呼叫:cache hit,FinMind 只 call 一次。"""
    today = date(2026, 6, 30)
    await fetch_disposition_stocks(today=today, refresh=True)  # 暖 cache
    await fetch_disposition_stocks(today=today, refresh=False)
    # First call was refresh=True(force fetch);second was cache hit → still 1 total
    assert len(mock_finmind_disposition) == 1


async def test_fetch_disposition_stocks_refresh_bypasses_cache(
    mock_finmind_disposition,
) -> None:
    """refresh=True 跳 cache 重抓。"""
    today = date(2026, 6, 30)
    await fetch_disposition_stocks(today=today, refresh=True)
    await fetch_disposition_stocks(today=today, refresh=True)
    assert len(mock_finmind_disposition) == 2


async def test_fetch_disposition_stocks_concurrent_dedup(
    mock_finmind_disposition,
) -> None:
    """並發同 key ×2 → inflight 合流,FinMind 只 call 一次(characterization,
    refactor F-3:遷移前拍「合流」現狀 — 此性質新舊兩版 _run_once 皆成立)。"""
    today = date(2026, 6, 30)
    out = await asyncio.gather(
        fetch_disposition_stocks(today=today, refresh=True),
        fetch_disposition_stocks(today=today, refresh=True),
    )
    assert out[0] == out[1] == {"2330"}
    assert len(mock_finmind_disposition) == 1


# ---------------------------------------------------------------------------
# Phase 4 review confirmed P1 — disposition fetch error must NOT silent cache
# empty + 24h TTL(real production failure mode caught by workflow Find lens).
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_finmind_disposition_raises(monkeypatch):
    """Mock get_finmind so disposition fetch raises httpx-style exception."""
    import httpx

    import services.market_universe as mu

    calls: list[dict] = []

    class _RaisingClient:
        async def _get(self, url: str, params: dict) -> list:
            calls.append({"url": url, "params": dict(params)})
            raise httpx.ConnectError("simulated upstream blip")

    monkeypatch.setattr(mu, "get_finmind", lambda: _RaisingClient())
    return calls


async def test_fetch_disposition_stocks_propagates_http_error_does_not_cache_empty(
    mock_finmind_disposition_raises,
) -> None:
    """Phase 4 P1 finding:httpx error 不能 silent swallow,必須 raise — 否則
    上層 `_fetch_watch_list` 拿不到 exception 信號,gather 視為成功 set();且
    若 swallow 後寫 empty cache(stock_ids=[], TTL 24h),整天 disposition 過濾失效。
    """
    import httpx

    from services.market_universe import _read_cache, fetch_disposition_stocks

    today = date(2026, 6, 30)
    cache_key = f"disposition_{today.isoformat()}"

    with pytest.raises(httpx.ConnectError):
        await fetch_disposition_stocks(today=today, refresh=True)

    # 關鍵 assertion:**不能寫 empty cache**(否則 24h 內後續 call 拿到 stale 空 set)
    cached = _read_cache(cache_key)
    assert cached is None, (
        "P1 fix:disposition fetch raise 時不該寫 cache;"
        f"否則整天過濾失效。got cached={cached}"
    )
    assert len(mock_finmind_disposition_raises) == 1


async def test_fetch_disposition_stocks_recovers_after_blip(
    monkeypatch,
) -> None:
    """Phase 4 P1 finding(意圖反證):httpx blip 後 FinMind 恢復,下次 call
    應該 fetch 成功(而非繼續吃 empty cache 24h)。"""
    import httpx

    import services.market_universe as mu

    today = date(2026, 6, 30)
    call_count = {"n": 0}

    class _FlakyClient:
        async def _get(self, url: str, params: dict) -> list:
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise httpx.ConnectError("first call blip")
            return [
                {
                    "date": "2026-06-20",
                    "stock_id": "2330",
                    "stock_name": "台積電",
                    "period_start": "2026-06-20",
                    "period_end": "2026-07-05",
                },
            ]

    monkeypatch.setattr(mu, "get_finmind", lambda: _FlakyClient())

    # 第一次 call → fail raises
    with pytest.raises(httpx.ConnectError):
        await fetch_disposition_stocks(today=today, refresh=False)

    # 第二次 call → 應該重 fetch(不是吃 empty cache)→ 拿到 active disposition
    out = await fetch_disposition_stocks(today=today, refresh=False)
    assert out == {"2330"}
    assert call_count["n"] == 2


# ---------------------------------------------------------------------------
# get_filtered_universe — orchestrator(fetch TaiwanStockInfo + disposition + filter)
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_finmind_full(monkeypatch):
    """Mock TaiwanStockInfo + TaiwanStockDispositionSecuritiesPeriod responses."""
    import services.market_universe as mu

    calls: list[dict] = []

    class _MockClient:
        async def _get(self, url: str, params: dict) -> list:
            calls.append({"url": url, "params": dict(params)})
            dataset = params.get("dataset")
            if dataset == "TaiwanStockInfo":
                return [
                    {"stock_id": "2330", "stock_name": "台積電", "industry_category": "半導體業", "type": "twse"},
                    {"stock_id": "3037", "stock_name": "欣興", "industry_category": "電子零組件業", "type": "twse"},
                    {"stock_id": "0050", "stock_name": "元大台灣50", "industry_category": "ETF", "type": "twse"},
                    {"stock_id": "00919", "stock_name": "群益台灣精選高息", "industry_category": "ETF", "type": "twse"},
                    {"stock_id": "712345", "stock_name": "權證X", "industry_category": "認購權證", "type": "twse"},
                    {"stock_id": "8046", "stock_name": "南電", "industry_category": "電子零組件業", "type": "twse"},
                ]
            if dataset == "TaiwanStockDispositionSecuritiesPeriod":
                return [
                    {
                        "date": "2026-06-20",
                        "stock_id": "8046",
                        "stock_name": "南電",
                        "period_start": "2026-06-20",
                        "period_end": "2026-07-05",
                    },
                ]
            return []

    monkeypatch.setattr(mu, "get_finmind", lambda: _MockClient())
    return calls


async def test_get_filtered_universe_end_to_end(mock_finmind_full) -> None:
    """End-to-end:抓 TaiwanStockInfo + disposition → 分桶。"""
    out = await get_filtered_universe(today=date(2026, 6, 30), refresh=True)

    assert out["universe"] == {"2330", "3037"}
    assert set(out["excluded"]["etf"]) == {"0050", "00919"}
    assert set(out["excluded"]["warrant"]) == {"712345"}
    assert set(out["excluded"]["watch_list"]) == {"8046"}


async def test_get_filtered_universe_excluded_counts_match(mock_finmind_full) -> None:
    """`excluded_count` shape 直接 derivable from `excluded`(len of each list)。"""
    out = await get_filtered_universe(today=date(2026, 6, 30), refresh=True)

    assert len(out["excluded"]["etf"]) == 2
    assert len(out["excluded"]["warrant"]) == 1
    assert len(out["excluded"]["watch_list"]) == 1
