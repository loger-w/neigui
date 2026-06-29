"""Tests for services/finmind.py — FinMind API client."""

import json
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest


def _fm_response(data: list, status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {"msg": "success", "status": 200, "data": data}
    resp.raise_for_status = MagicMock()
    return resp


def _mock_http(*responses):
    client = AsyncMock()
    client.get = AsyncMock(side_effect=list(responses))
    return client


INST_ROW = {
    "date": "2026-06-19",
    "stock_id": "2330",
    "Foreign_Investor_buy": 12845000,
    "Foreign_Investor_sell": 8231000,
    "Foreign_Dealer_Self_buy": 0,
    "Foreign_Dealer_Self_sell": 0,
    "Investment_Trust_buy": 2156000,
    "Investment_Trust_sell": 1872000,
    "Dealer_buy": 0,
    "Dealer_sell": 0,
    "Dealer_self_buy": 1800000,
    "Dealer_self_sell": 2100000,
    "Dealer_Hedging_buy": 1621000,
    "Dealer_Hedging_sell": 2002000,
}

MARGIN_ROW = {
    "date": "2026-06-19",
    "stock_id": "2330",
    "MarginPurchaseBuy": 500,
    "MarginPurchaseSell": 300,
    "MarginPurchaseCashRepayment": 50,
    "MarginPurchaseTodayBalance": 18432,
    "MarginPurchaseYesterdayBalance": 18106,
    "MarginPurchaseLimit": 259362,
    "ShortSaleBuy": 100,
    "ShortSaleSell": 200,
    "ShortSaleCashRepayment": 13,
    "ShortSaleTodayBalance": 1245,
    "ShortSaleYesterdayBalance": 1332,
    "ShortSaleLimit": 259362,
    "OffsetLoanAndShort": 0,
    "Note": "",
}

BROKER_ROWS = [
    {
        "securities_trader": "美林",
        "securities_trader_id": "9A00",
        "stock_id": "2330",
        "date": "2026-06-19",
        "price": 1090.0,
        "buy": 800000,
        "sell": 20000,
    },
    {
        "securities_trader": "美林",
        "securities_trader_id": "9A00",
        "stock_id": "2330",
        "date": "2026-06-19",
        "price": 1089.0,
        "buy": 445000,
        "sell": 18000,
    },
    {
        "securities_trader": "元大-台北",
        "securities_trader_id": "6110",
        "stock_id": "2330",
        "date": "2026-06-19",
        "price": 1094.0,
        "buy": 25000,
        "sell": 500000,
    },
    {
        "securities_trader": "元大-台北",
        "securities_trader_id": "6110",
        "stock_id": "2330",
        "date": "2026-06-19",
        "price": 1093.0,
        "buy": 20000,
        "sell": 392000,
    },
]


# _reset_singleton fixture moved to tests/conftest.py (design v4 T1)


@pytest.mark.asyncio
async def test_fetch_chip_summary_transforms():
    from services.finmind import FinMindClient

    mc = _mock_http(
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(BROKER_ROWS),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_summary("2330", "2026-06-19")
    assert r["symbol"] == "2330"
    assert r["institutional"]["foreign"]["buy"] == 12845
    assert r["institutional"]["foreign"]["net"] == 12845 - 8231
    assert r["institutional"]["trust"]["net"] == 2156 - 1872
    assert r["institutional"]["dealer"]["buy"] == (1800000 + 1621000) // 1000
    assert r["margin"]["margin_purchase"]["balance"] == 18432
    assert r["margin"]["margin_purchase"]["change"] == 18432 - 18106
    assert r["margin"]["short_balance_ratio"] == pytest.approx(1245 / 18432 * 100, rel=1e-2)
    assert len(r["top_brokers"]) == 2
    assert r["top_brokers"][0]["name"] == "美林"
    assert r["top_brokers"][0]["buy"] == (800000 + 445000) // 1000
    assert r["top_brokers"][0]["sell"] == (20000 + 18000) // 1000
    assert r["top_brokers"][0]["net"] == 1245 - 38


@pytest.mark.asyncio
async def test_fetch_chip_summary_cache_hit(tmp_path, monkeypatch):
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    from services.finmind import FinMindClient, _CACHE_VERSION

    cached = {
        "symbol": "2330",
        "date": "2026-01-01",
        "fetched_at": "2026-01-01T20:00:00",
        "institutional": {},
        "margin": {},
        "top_brokers": [],
        "_cache_version": _CACHE_VERSION,
    }
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_2026-01-01.json").write_text(json.dumps(cached))
    client = FinMindClient()
    result = await client.fetch_chip_summary("2330", "2026-01-01")
    assert result == {k: v for k, v in cached.items() if k != "_cache_version"}


@pytest.mark.asyncio
async def test_fetch_chip_summary_refresh_ignores_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    from services.finmind import FinMindClient

    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_2026-01-01.json").write_text(json.dumps({"old": True}))
    mc = _mock_http(
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(BROKER_ROWS),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_summary("2330", "2026-01-01", refresh=True)
    assert r["symbol"] == "2330"
    assert "old" not in r


@pytest.mark.asyncio
async def test_fetch_chip_summary_empty_data():
    from services.finmind import FinMindClient

    mc = _mock_http(_fm_response([]), _fm_response([]), _fm_response([]))
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_summary("9999", "2026-06-21")
    assert r["institutional"]["foreign"]["buy"] == 0
    assert r["margin"]["short_balance_ratio"] == 0
    assert r["top_brokers"] == []


@pytest.mark.asyncio
async def test_fetch_chip_bubble_transforms():
    from services.finmind import FinMindClient

    rows = [
        {
            "securities_trader": "美林",
            "securities_trader_id": "9A00",
            "price": 1090.0,
            "buy": 320000,
            "sell": 5000,
            "stock_id": "2330",
            "date": "2026-06-19",
        },
    ]
    mc = _mock_http(_fm_response(rows))
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_bubble("2330", "2026-06-19")
    assert r["trades"][0]["buy"] == 320
    assert r["trades"][0]["sell"] == 5


@pytest.mark.asyncio
async def test_fetch_chip_history():
    from services.finmind import FinMindClient

    candle_row = {
        "date": "2026-06-19",
        "stock_id": "2330",
        "open": 1080,
        "max": 1098,
        "min": 1078,
        "close": 1095,
        "Trading_Volume": 36200,
    }
    agg_row = {
        "date": "2026-06-19",
        "securities_trader": "A",
        "securities_trader_id": "A1",
        "buy": 5000000,
        "sell": 1000000,
    }
    mc = _mock_http(
        _fm_response([candle_row]),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response([agg_row]),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_history("2330")
    assert r["candles"][0]["high"] == 1098.0
    assert r["candles"][0]["volume"] == 36
    assert r["institutional"][0]["foreign_net"] == 12845 - 8231
    assert r["margin"][0]["margin_change"] == 18432 - 18106
    assert r["major"][0]["major_net"] == 4000


def test_to_lots_truncation():
    from services.finmind import _to_lots

    assert _to_lots(0) == 0
    assert _to_lots(999) == 0
    assert _to_lots(1000) == 1
    assert _to_lots(1500) == 1
    assert _to_lots(-1000) == -1
    assert _to_lots(-1500) == -1
    assert _to_lots(-499) == 0


def test_compute_major_net():
    from services.finmind import _compute_major_net

    rows = [
        {
            "securities_trader": "A",
            "securities_trader_id": "A1",
            "price": 100.0,
            "buy": 5000000,
            "sell": 1000000,
        },
        {
            "securities_trader": "B",
            "securities_trader_id": "B1",
            "price": 100.0,
            "buy": 500000,
            "sell": 3000000,
        },
    ]
    assert _compute_major_net(rows) == 1500
    assert _compute_major_net([]) == 0


def test_compute_major_net_agg():
    from services.finmind import _compute_major_net_agg

    rows = [
        {"buy": 5000000, "sell": 1000000},
        {"buy": 500000, "sell": 3000000},
    ]
    assert _compute_major_net_agg(rows) == 1500


def test_broker_net_from_truncated_lots():
    from services.finmind import _parse_top_brokers

    rows = [
        {
            "securities_trader": "TestA",
            "securities_trader_id": "T001",
            "price": 100.0,
            "buy": 5730600,
            "sell": 4496400,
        },
    ]
    result = _parse_top_brokers(rows)
    assert result[0]["buy"] == 5730
    assert result[0]["sell"] == 4496
    assert result[0]["net"] == 1234


@pytest.mark.asyncio
async def test_history_major_series_via_per_date_fallback():
    """`_do_fetch_history` no longer pre-fetches SecIdAgg (the endpoint
    requires a per-broker filter, so a corpus-wide call always 400'd). The
    major series is computed entirely via per-date TradingDailyReport calls.
    """
    from services.finmind import FinMindClient

    candle_rows = [
        {
            "date": "2026-06-18",
            "stock_id": "2330",
            "open": 100,
            "max": 105,
            "min": 99,
            "close": 103,
            "Trading_Volume": 10000,
        },
        {
            "date": "2026-06-19",
            "stock_id": "2330",
            "open": 103,
            "max": 108,
            "min": 102,
            "close": 107,
            "Trading_Volume": 12000,
        },
    ]
    broker_day_18 = [
        {
            "securities_trader": "A",
            "securities_trader_id": "A1",
            "price": 100.0,
            "buy": 3000000,
            "sell": 1000000,
        },
    ]
    broker_day_19 = [
        {
            "securities_trader": "B",
            "securities_trader_id": "B1",
            "price": 100.0,
            "buy": 1000000,
            "sell": 4000000,
        },
    ]

    mc = _mock_http(
        _fm_response(candle_rows),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(broker_day_18),
        _fm_response(broker_day_19),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_history("2330")
    assert len(r["major"]) == 2
    assert r["major"][0]["major_net"] == 2000
    assert r["major"][1]["major_net"] == -3000
    # 3 corpus fetches (price/inst/margin) + 2 per-date TradingDailyReport
    assert mc.get.await_count == 5


def test_no_token_raises(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "")
    from services.finmind import FinMindClient

    with pytest.raises(ValueError, match="FINMIND_TOKEN"):
        FinMindClient()


# ---------------------------------------------------------------------------
# Bug #2 — fetch_chip_history cache TTL (15-min staleness)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_chip_history_cache_hit_when_fresh_and_today(tmp_path):
    """Fresh cache (within TTL) for today is served — no FinMind call."""
    from services.finmind import FinMindClient, _CACHE_VERSION

    today = date.today().isoformat()
    fresh = datetime.now().isoformat(timespec="seconds")
    cached = {
        "_cache_version": _CACHE_VERSION,
        "symbol": "2330",
        "fetched_at": fresh,
        "last_date": today,
        "candles": [],
        "institutional": [],
        "margin": [],
        "major": [],
    }
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_history.json").write_text(json.dumps(cached))
    client = FinMindClient()
    mc = AsyncMock()
    mc.get = AsyncMock(side_effect=AssertionError("must not call FinMind"))
    client._http = mc
    r = await client.fetch_chip_history("2330")
    assert r["fetched_at"] == fresh
    mc.get.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_chip_history_refetches_when_stale_and_today(tmp_path):
    """Bug #2 fix: cached entry with last_date==today but fetched_at older
    than the 15-min TTL must trigger a re-fetch on plain GET (browser F5
    sends refresh=false). Previously cache was served indefinitely until
    next-day rollover."""
    from services.finmind import FinMindClient, _CACHE_VERSION

    today = date.today().isoformat()
    stale_fetched_at = (datetime.now() - timedelta(hours=1)).isoformat(
        timespec="seconds",
    )
    cached = {
        "_cache_version": _CACHE_VERSION,
        "symbol": "2330",
        "fetched_at": stale_fetched_at,
        "last_date": today,
        "candles": [],
        "institutional": [],
        "margin": [],
        "major": [],
    }
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_history.json").write_text(json.dumps(cached))
    candle_rows = [
        {
            "date": today,
            "stock_id": "2330",
            "open": 100,
            "max": 105,
            "min": 99,
            "close": 103,
            "Trading_Volume": 10000,
        },
    ]
    agg_rows = [
        {"date": today, "buy": 5000000, "sell": 1000000},
    ]
    mc = _mock_http(
        _fm_response(candle_rows),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(agg_rows),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_history("2330")
    assert r["fetched_at"] != stale_fetched_at  # re-fetched
    assert mc.get.await_count == 4  # all 4 endpoints hit


@pytest.mark.asyncio
async def test_fetch_chip_history_serves_stale_cache_when_upstream_fails(tmp_path):
    """K-line resilience: when the live FinMind fetch raises (token expired,
    rate-limit, transient outage) AND any cached history exists, return the
    cached payload with `stale: True` instead of bubbling a 502. Without this
    the K-line UI goes blank on every FinMind blip even though we have a
    perfectly good prior day's chart already on disk."""
    from services.finmind import FinMindClient, _CACHE_VERSION
    import httpx

    yesterday = (date.today() - timedelta(days=1)).isoformat()
    cached_payload = {
        "_cache_version": _CACHE_VERSION,
        "symbol": "2330",
        "fetched_at": "2026-06-25T10:00:00",
        "last_date": yesterday,
        "candles": [
            {
                "date": yesterday,
                "open": 1090,
                "high": 1095,
                "low": 1085,
                "close": 1092,
                "volume": 25000,
            },
        ],
        "institutional": [],
        "margin": [],
        "major": [],
    }
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_history.json").write_text(json.dumps(cached_payload))

    # Live fetch fails (the actual production symptom: FinMind returns 400
    # "Token is illegal" or rate-limits us). Any httpx error qualifies.
    client = FinMindClient()
    fail_resp = MagicMock()
    fail_resp.raise_for_status = MagicMock(
        side_effect=httpx.HTTPStatusError(
            "400 Bad Request",
            request=MagicMock(),
            response=MagicMock(),
        )
    )
    mc = AsyncMock()
    mc.get = AsyncMock(return_value=fail_resp)
    client._http = mc

    r = await client.fetch_chip_history("2330")
    # Stale cache served, NOT raised — the K-line chart still renders.
    assert r["stale"] is True
    assert r["candles"][0]["date"] == yesterday
    assert r["last_date"] == yesterday


@pytest.mark.asyncio
async def test_fetch_chip_history_raises_when_upstream_fails_and_no_cache(tmp_path):
    """If FinMind fails AND we have nothing cached, the 502 still bubbles —
    we genuinely cannot show anything, so the frontend should display the
    error rather than a misleading empty chart."""
    from services.finmind import FinMindClient
    import httpx

    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)

    client = FinMindClient()
    fail_resp = MagicMock()
    fail_resp.raise_for_status = MagicMock(
        side_effect=httpx.HTTPStatusError(
            "400 Bad Request",
            request=MagicMock(),
            response=MagicMock(),
        )
    )
    mc = AsyncMock()
    mc.get = AsyncMock(return_value=fail_resp)
    client._http = mc

    with pytest.raises(httpx.HTTPError):
        await client.fetch_chip_history("2330")


@pytest.mark.asyncio
async def test_fetch_chip_history_cache_hit_when_pre_today(tmp_path):
    """Cache with last_date < today is NEVER served regardless of freshness —
    we need the new day's bar. (Same gate as before the TTL fix.)"""
    from services.finmind import FinMindClient, _CACHE_VERSION

    yesterday = (date.today() - timedelta(days=1)).isoformat()
    fresh = datetime.now().isoformat(timespec="seconds")
    cached = {
        "_cache_version": _CACHE_VERSION,
        "symbol": "2330",
        "fetched_at": fresh,
        "last_date": yesterday,
        "candles": [],
        "institutional": [],
        "margin": [],
        "major": [],
    }
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_history.json").write_text(json.dumps(cached))
    candle_rows = [
        {
            "date": yesterday,
            "stock_id": "2330",
            "open": 100,
            "max": 105,
            "min": 99,
            "close": 103,
            "Trading_Volume": 10000,
        },
    ]
    agg_rows = [
        {"date": yesterday, "buy": 5000000, "sell": 1000000},
    ]
    mc = _mock_http(
        _fm_response(candle_rows),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(agg_rows),
    )
    client = FinMindClient()
    client._http = mc
    await client.fetch_chip_history("2330")
    # All 4 endpoints called; agg_rows cover all dates so no fallback fires.
    assert mc.get.await_count == 4


# ---------------------------------------------------------------------------
# v3 spec §B1 — days param separates cache key (W10 不影響舊路徑)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_chip_history_days_separates_cache(tmp_path):
    """days==90 寫 `{symbol}_history.json`(舊路徑、W10 保護);
    其他 days 寫 `{symbol}_history_{days}d.json` — 互不污染。"""
    from services.finmind import FinMindClient, _CACHE_VERSION

    today = date.today().isoformat()
    fresh = datetime.now().isoformat(timespec="seconds")

    # 預先放一個 days==90 的 cache(舊路徑)
    cached_90 = {
        "_cache_version": _CACHE_VERSION,
        "symbol": "2330",
        "fetched_at": fresh,
        "last_date": today,
        "candles": [{"date": today, "marker": 90}],
        "institutional": [],
        "margin": [],
        "major": [],
    }
    chip_dir = tmp_path / "cache" / "chip"
    chip_dir.mkdir(parents=True)
    (chip_dir / "2330_history.json").write_text(json.dumps(cached_90))

    # days=60 call:不能命中 90 cache → 走 FinMind
    candle_rows = [
        {
            "date": today,
            "stock_id": "2330",
            "open": 100,
            "max": 105,
            "min": 99,
            "close": 103,
            "Trading_Volume": 60000,
        },
    ]
    agg_rows = [{"date": today, "buy": 5000000, "sell": 1000000}]
    mc = _mock_http(
        _fm_response(candle_rows),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(agg_rows),
    )
    client = FinMindClient()
    client._http = mc

    r = await client.fetch_chip_history("2330", days=60)
    # 不是 marker=90 那個,代表走了真的 fetch
    assert r["candles"][0].get("marker") != 90
    # 寫到新 cache key 路徑
    assert (chip_dir / "2330_history_60d.json").exists()
    # 舊路徑 cache 沒被污染
    on_disk_90 = json.loads(
        (chip_dir / "2330_history.json").read_text(encoding="utf-8"),
    )
    assert on_disk_90["candles"][0].get("marker") == 90

    # 反過來:days==90(default)時直接命中舊路徑
    client2 = FinMindClient()
    mc2 = AsyncMock()
    mc2.get = AsyncMock(
        side_effect=AssertionError("days=90 應命中舊 cache 不打 FinMind"),
    )
    client2._http = mc2
    r2 = await client2.fetch_chip_history("2330")  # days=90 default
    assert r2["candles"][0].get("marker") == 90


# ---------------------------------------------------------------------------
# History split: /history/base + /history/major (perf: K-line TTI 24s → ~1s)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_chip_history_base_skips_major_fan_out():
    """fetch_chip_history_base must NOT call the per-day TradingDailyReport
    fan-out — that's the entire point of the split. 3 range calls, period."""
    from services.finmind import FinMindClient

    candle_rows = [
        {
            "date": "2026-06-19",
            "stock_id": "2330",
            "open": 100,
            "max": 105,
            "min": 99,
            "close": 103,
            "Trading_Volume": 10000,
        },
    ]
    mc = _mock_http(
        _fm_response(candle_rows),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_history_base("2330", days=90)
    # Exactly 3 HTTP calls: candles, institutional, margin range queries.
    assert mc.get.await_count == 3
    assert r["major"] == []
    assert len(r["candles"]) == 1
    assert r["candles"][0]["close"] == 103
    assert len(r["institutional"]) == 1
    assert len(r["margin"]) == 1


@pytest.mark.asyncio
async def test_fetch_chip_history_base_serves_from_full_cache(tmp_path):
    """If the legacy /history populated the full cache, /base reuses it
    and strips `major` — no FinMind fetch."""
    from services.finmind import FinMindClient
    from utils.cache import atomic_write_json, chip_cache_dir

    cached = {
        "symbol": "2330",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "last_date": date.today().isoformat(),
        "candles": [
            {
                "date": date.today().isoformat(),
                "open": 1,
                "high": 1,
                "low": 1,
                "close": 1,
                "volume": 0,
            }
        ],
        "institutional": [],
        "margin": [],
        "major": [{"date": date.today().isoformat(), "major_net": 999}],
        "_cache_version": 3,
    }
    atomic_write_json(chip_cache_dir() / "2330_history_540d.json", cached)

    client = FinMindClient()
    client._http = AsyncMock()
    client._http.get = AsyncMock(side_effect=AssertionError("should not fetch"))

    r = await client.fetch_chip_history_base("2330", days=540)
    assert r["candles"][0]["close"] == 1
    assert r["major"] == []  # stripped from full cache
    client._http.get.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_chip_history_major_fans_out_per_day():
    """fetch_chip_history_major:
    1 TaiwanStockPrice range call (for trading dates) + N per-day
    TradingDailyReport calls. Returns slim {symbol, fetched_at, last_date,
    major: [...]}."""
    from services.finmind import FinMindClient

    candle_rows = [
        {
            "date": "2026-06-18",
            "stock_id": "2330",
            "open": 100,
            "max": 105,
            "min": 99,
            "close": 103,
            "Trading_Volume": 10000,
        },
        {
            "date": "2026-06-19",
            "stock_id": "2330",
            "open": 103,
            "max": 108,
            "min": 102,
            "close": 107,
            "Trading_Volume": 12000,
        },
    ]
    broker_day_18 = [
        {
            "securities_trader": "A",
            "securities_trader_id": "A1",
            "price": 100.0,
            "buy": 3000000,
            "sell": 1000000,
        },
    ]
    broker_day_19 = [
        {
            "securities_trader": "B",
            "securities_trader_id": "B1",
            "price": 100.0,
            "buy": 1000000,
            "sell": 4000000,
        },
    ]
    mc = _mock_http(
        _fm_response(candle_rows),
        _fm_response(broker_day_18),
        _fm_response(broker_day_19),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_history_major("2330", days=90)
    # 1 range + 2 per-day = 3 calls
    assert mc.get.await_count == 3
    assert len(r["major"]) == 2
    assert r["major"][0]["major_net"] == 2000
    assert r["major"][1]["major_net"] == -3000
    # Slim payload — no candles / institutional / margin keys
    assert "candles" not in r
    assert "institutional" not in r
    assert "margin" not in r


@pytest.mark.asyncio
async def test_fetch_chip_history_major_serves_from_full_cache(tmp_path):
    """Full cache present → /major reuses it, returns just the major slice."""
    from services.finmind import FinMindClient
    from utils.cache import atomic_write_json, chip_cache_dir

    cached = {
        "symbol": "2330",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "last_date": date.today().isoformat(),
        "candles": [],
        "institutional": [],
        "margin": [],
        "major": [{"date": "2026-06-19", "major_net": 999}],
        "_cache_version": 3,
    }
    atomic_write_json(chip_cache_dir() / "2330_history_540d.json", cached)

    client = FinMindClient()
    client._http = AsyncMock()
    client._http.get = AsyncMock(side_effect=AssertionError("should not fetch"))

    r = await client.fetch_chip_history_major("2330", days=540)
    assert r["major"][0]["major_net"] == 999
    assert "candles" not in r
    client._http.get.assert_not_called()


@pytest.mark.asyncio
async def test_legacy_fetch_chip_history_unchanged():
    """Regression: legacy /history still returns the full super-set."""
    from services.finmind import FinMindClient

    candle_rows = [
        {
            "date": "2026-06-19",
            "stock_id": "2330",
            "open": 100,
            "max": 105,
            "min": 99,
            "close": 103,
            "Trading_Volume": 10000,
        },
    ]
    broker_rows = [
        {
            "securities_trader": "A",
            "securities_trader_id": "A1",
            "price": 100.0,
            "buy": 3000000,
            "sell": 1000000,
        },
    ]
    mc = _mock_http(
        _fm_response(candle_rows),
        _fm_response([INST_ROW]),
        _fm_response([MARGIN_ROW]),
        _fm_response(broker_rows),
    )
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_history("2330")
    assert "candles" in r and "institutional" in r and "margin" in r
    assert "major" in r and len(r["major"]) == 1
    assert r["major"][0]["major_net"] == 2000


# ---------------------------------------------------------------------------
# fetch_chip_intraday — 1-min KBar close-price time series for bubble overlay
# ---------------------------------------------------------------------------
#
# Fixture rows below are VERBATIM copies from the 2026-06-29 EOD probe of
# 2330 on 2026-06-26 (scratchpad/kbar_golden_row.json). Schema verified:
#   {date: "YYYY-MM-DD", minute: "HH:MM:SS",
#    stock_id, open, high, low, close, volume}
# Do NOT alter field names or formats; they reflect real FinMind output.

KBAR_GOLDEN_ROWS = [
    {
        "date": "2026-06-26",
        "minute": "09:00:00",
        "stock_id": "2330",
        "open": 2360.0,
        "high": 2365.0,
        "low": 2355.0,
        "close": 2360.0,
        "volume": 3595,
    },
    {
        "date": "2026-06-26",
        "minute": "09:01:00",
        "stock_id": "2330",
        "open": 2360.0,
        "high": 2365.0,
        "low": 2355.0,
        "close": 2365.0,
        "volume": 478,
    },
    {
        "date": "2026-06-26",
        "minute": "09:02:00",
        "stock_id": "2330",
        "open": 2365.0,
        "high": 2370.0,
        "low": 2360.0,
        "close": 2365.0,
        "volume": 443,
    },
]


@pytest.mark.asyncio
async def test_fetch_chip_intraday_transforms():
    """real FinMind row → {t: "HH:MM", price: float} points, sorted ascending."""
    from services.finmind import FinMindClient

    mc = _mock_http(_fm_response(KBAR_GOLDEN_ROWS))
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_intraday("2330", "2026-06-26")

    assert r["symbol"] == "2330"
    assert r["date"] == "2026-06-26"
    assert "fetched_at" in r
    assert r["points"] == [
        {"t": "09:00", "price": 2360.0},
        {"t": "09:01", "price": 2365.0},
        {"t": "09:02", "price": 2365.0},
    ]


@pytest.mark.asyncio
async def test_fetch_chip_intraday_empty_when_no_kbar():
    """假日 / 該日無交易 / 盤中前 → FinMind 回空 list,points: []。"""
    from services.finmind import FinMindClient

    mc = _mock_http(_fm_response([]))
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_intraday("2330", "2026-06-28")  # Sunday

    assert r["points"] == []
    assert r["symbol"] == "2330"


@pytest.mark.asyncio
async def test_fetch_chip_intraday_sorts_unsorted_input():
    """Defensive sort: even if FinMind returns out-of-order rows, points 升序。"""
    from services.finmind import FinMindClient

    unsorted = [
        KBAR_GOLDEN_ROWS[2],
        KBAR_GOLDEN_ROWS[0],
        KBAR_GOLDEN_ROWS[1],
    ]
    mc = _mock_http(_fm_response(unsorted))
    client = FinMindClient()
    client._http = mc
    r = await client.fetch_chip_intraday("2330", "2026-06-26")

    assert [p["t"] for p in r["points"]] == ["09:00", "09:01", "09:02"]


@pytest.mark.asyncio
async def test_fetch_chip_intraday_cache_hit_skips_http():
    """warm cache → 第二次 fetch 0 HTTP calls(對齊 bubble cache 行為)。"""
    from services.finmind import FinMindClient

    mc = _mock_http(_fm_response(KBAR_GOLDEN_ROWS))
    client = FinMindClient()
    client._http = mc
    await client.fetch_chip_intraday("2330", "2026-06-26")
    first_calls = mc.get.await_count

    # second fetch — same (symbol, date), no refresh
    r2 = await client.fetch_chip_intraday("2330", "2026-06-26")
    assert mc.get.await_count == first_calls  # no new HTTP
    assert r2["points"][0]["t"] == "09:00"


@pytest.mark.asyncio
async def test_fetch_chip_intraday_refresh_bypasses_cache():
    """refresh=True 跳過 cache,重新打 FinMind。"""
    from services.finmind import FinMindClient

    mc = _mock_http(
        _fm_response(KBAR_GOLDEN_ROWS),
        _fm_response(KBAR_GOLDEN_ROWS),
    )
    client = FinMindClient()
    client._http = mc
    await client.fetch_chip_intraday("2330", "2026-06-26")
    first_calls = mc.get.await_count

    await client.fetch_chip_intraday("2330", "2026-06-26", refresh=True)
    assert mc.get.await_count == first_calls + 1
