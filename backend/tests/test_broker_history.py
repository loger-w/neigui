"""Tests for broker-history parsing and fetch."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from services.finmind import FinMindClient, _filter_broker_history, _parse_broker_history


# ---------------------------------------------------------------------------
# Pure function: _parse_broker_history
# ---------------------------------------------------------------------------


def test_parse_broker_history_computes_net_in_lots():
    rows = [
        {"securities_trader": "X", "date": "2026-06-20",
         "buy": 120000, "sell": 50000},
    ]
    result = _parse_broker_history(rows)
    # 120000 shares → 120 lots; 50000 → 50; net = 70
    assert result["X"][0] == {"date": "2026-06-20", "buy": 120, "sell": 50, "net": 70}


def test_parse_broker_history_truncates_shares_to_lots():
    rows = [
        {"securities_trader": "X", "date": "2026-06-20",
         "buy": 1500, "sell": 999},
    ]
    # 1500 → 1 lot (truncate); 999 → 0
    result = _parse_broker_history(rows)
    assert result["X"][0]["buy"] == 1
    assert result["X"][0]["sell"] == 0


def test_parse_broker_history_aggregates_duplicate_date_rows():
    rows = [
        {"securities_trader": "Z", "date": "2026-06-20",
         "buy": 1000, "sell": 0},
        {"securities_trader": "Z", "date": "2026-06-20",
         "buy": 2000, "sell": 500},
    ]
    result = _parse_broker_history(rows)
    assert len(result["Z"]) == 1
    # buy = 3 lots, sell = 0 lots (500 truncated)
    assert result["Z"][0] == {"date": "2026-06-20", "buy": 3, "sell": 0, "net": 3}


def test_parse_broker_history_empty_input():
    assert _parse_broker_history([]) == {}


def test_parse_broker_history_strips_broker_name_whitespace():
    rows = [
        {"securities_trader": " 凱基 ", "date": "2026-06-20",
         "buy": 1000, "sell": 0},
    ]
    result = _parse_broker_history(rows)
    assert list(result.keys()) == ["凱基"]


# ---------------------------------------------------------------------------
# fetch_broker_history (Task 2 — written together so we lock interfaces)
# ---------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("FINMIND_TOKEN", "test")
    monkeypatch.setattr(
        "services.finmind.chip_cache_dir", lambda: tmp_path,
    )
    return FinMindClient()


# ---------------------------------------------------------------------------
# Bug #1 — name-based join (NEW behavior)
# ---------------------------------------------------------------------------


def test_parse_broker_history_groups_by_broker_name():
    """_parse_broker_history must group by `securities_trader` (NAME), because
    `top_brokers` (sourced from TradingDailyReport) and broker history
    (sourced from SecIdAgg) use different id namespaces but the same NAME."""
    rows = [
        {"securities_trader_id": "9201A", "securities_trader": "凱基台北",
         "date": "2026-06-20", "buy": 100000, "sell": 50000},
        {"securities_trader_id": "9202B", "securities_trader": "富邦台北",
         "date": "2026-06-20", "buy": 30000, "sell": 80000},
        {"securities_trader_id": "9201A", "securities_trader": "凱基台北",
         "date": "2026-06-21", "buy": 20000, "sell": 0},
    ]
    result = _parse_broker_history(rows)
    assert set(result.keys()) == {"凱基台北", "富邦台北"}
    assert len(result["凱基台北"]) == 2


def test_parse_broker_history_skips_blank_broker_name():
    """Rows with blank/whitespace `securities_trader` are skipped (the join
    key is the name; an empty name cannot be matched against `top_brokers`)."""
    rows = [
        {"securities_trader_id": "X1", "securities_trader": "",
         "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader_id": "X2", "securities_trader": "  ",
         "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader_id": "X3", "securities_trader": "凱基",
         "date": "2026-06-20", "buy": 1000, "sell": 0},
    ]
    result = _parse_broker_history(rows)
    assert list(result.keys()) == ["凱基"]


@pytest.mark.asyncio
async def test_fetch_broker_history_name_based_join(client, monkeypatch):
    """Requesting by broker NAME must return that broker's history even when
    the underlying SecIdAgg `securities_trader_id` differs from the id the
    frontend would receive from /taiwan_stock_trading_daily_report."""
    mock_rows = [
        {"securities_trader_id": "9201A", "securities_trader": "凱基台北",
         "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader_id": "9202B", "securities_trader": "富邦台北",
         "date": "2026-06-20", "buy": 2000, "sell": 0},
    ]
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=mock_rows),
    )
    result = await client.fetch_broker_history("2330", ["凱基台北"])
    assert "凱基台北" in result["brokers"]
    assert len(result["brokers"]["凱基台北"]) == 1
    assert result["brokers"]["凱基台北"][0]["buy"] == 1


def test_filter_broker_history_logs_warning_on_missing_keys(caplog):
    """Defensive log: silent {key: []} substitution had hidden Bug #1 for weeks.
    `_filter_broker_history` must emit a WARNING when requested keys are
    absent from the payload, while still returning the empty-list shape
    (so the frontend renders a 0-bar row instead of crashing)."""
    payload = {
        "symbol": "2330", "fetched_at": "", "last_date": "",
        "brokers": {"凱基台北": [{"date": "d", "buy": 1, "sell": 0, "net": 1}]},
    }
    with caplog.at_level(logging.WARNING, logger="services.finmind"):
        result = _filter_broker_history(payload, ["凱基台北", "不存在的分點"])
    assert result["brokers"]["不存在的分點"] == []
    assert any("不存在的分點" in r.message for r in caplog.records), (
        f"expected warning naming the missing key; got {[r.message for r in caplog.records]}"
    )


@pytest.mark.asyncio
async def test_fetch_broker_history_filters_to_requested_ids(client, monkeypatch):
    mock_rows = [
        {"securities_trader": "A", "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader": "B", "date": "2026-06-20", "buy": 2000, "sell": 0},
        {"securities_trader": "C", "date": "2026-06-20", "buy": 3000, "sell": 0},
    ]
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=mock_rows),
    )
    result = await client.fetch_broker_history("2330", ["A", "B"])
    assert set(result["brokers"].keys()) == {"A", "B"}
    assert "C" not in result["brokers"]


@pytest.mark.asyncio
async def test_fetch_broker_history_caches_full_payload(
    client, monkeypatch, tmp_path,
):
    mock_rows = [
        {"securities_trader": "A", "date": "2026-06-20", "buy": 1000, "sell": 0},
        {"securities_trader": "B", "date": "2026-06-20", "buy": 2000, "sell": 0},
    ]
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=mock_rows),
    )
    await client.fetch_broker_history("2330", ["A"])
    cache_path = tmp_path / "2330_broker_history.json"
    assert cache_path.exists()
    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    # cache stores ALL brokers, not just requested
    assert set(cached["brokers"].keys()) == {"A", "B"}


@pytest.mark.asyncio
async def test_fetch_broker_history_cache_hit_when_fresh_and_today(
    client, monkeypatch, tmp_path,
):
    """Cache hit ONLY when last_date == today AND fetched_at is within TTL."""
    today = date.today().isoformat()
    fresh = datetime.now().isoformat(timespec="seconds")
    cache_payload = {
        "_cache_version": 2,
        "symbol": "2330",
        "fetched_at": fresh,
        "last_date": today,
        "brokers": {"A": [{"date": today, "buy": 5, "sell": 0, "net": 5}]},
    }
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(cache_payload), encoding="utf-8",
    )
    mock_fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(client, "_safe_get_secid_agg", mock_fetch)
    result = await client.fetch_broker_history("2330", ["A"])
    assert result["brokers"]["A"][0]["net"] == 5
    mock_fetch.assert_not_called()  # fresh cache hit


@pytest.mark.asyncio
async def test_fetch_broker_history_refetches_when_stale_and_today(
    client, monkeypatch, tmp_path,
):
    """Bug #2 fix: stale cache (older than TTL) must re-fetch on plain GET
    (browser F5 sends refresh=false). Previously: cache with last_date==today
    was served indefinitely until next-day rollover; F5 returned the same JSON
    written hours ago."""
    today = date.today().isoformat()
    stale_fetched_at = (datetime.now() - timedelta(hours=1)).isoformat(
        timespec="seconds",
    )
    cache_payload = {
        "_cache_version": 2,
        "symbol": "2330",
        "fetched_at": stale_fetched_at,
        "last_date": today,
        "brokers": {"A": [{"date": today, "buy": 5, "sell": 0, "net": 5}]},
    }
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(cache_payload), encoding="utf-8",
    )
    fresh_rows = [
        {"securities_trader": "A", "date": today, "buy": 99000, "sell": 0},
    ]
    mock_fetch = AsyncMock(return_value=fresh_rows)
    monkeypatch.setattr(client, "_safe_get_secid_agg", mock_fetch)
    result = await client.fetch_broker_history("2330", ["A"])
    mock_fetch.assert_called_once()  # bug #2 — was 0
    assert result["brokers"]["A"][0]["buy"] == 99  # fresh, not 5


@pytest.mark.asyncio
async def test_fetch_broker_history_returns_empty_list_for_missing_broker(
    client, monkeypatch,
):
    mock_rows = [
        {"securities_trader": "A", "date": "2026-06-20", "buy": 1000, "sell": 0},
    ]
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=mock_rows),
    )
    result = await client.fetch_broker_history("2330", ["A", "MISSING"])
    assert result["brokers"]["A"]
    assert result["brokers"]["MISSING"] == []


@pytest.mark.asyncio
async def test_fetch_broker_history_raises_when_secid_agg_empty(client, monkeypatch):
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=[]),
    )
    with pytest.raises(ValueError, match="secid_agg_unavailable"):
        await client.fetch_broker_history("2330", ["A"])


@pytest.mark.asyncio
async def test_fetch_broker_history_serves_stale_cache_when_secid_agg_fails(
    client, monkeypatch, tmp_path,
):
    """If SecIdAgg returns empty but stale cache exists, serve the stale cache."""
    stale_payload = {
        "_cache_version": 2, "symbol": "2330",
        "fetched_at": "2026-06-20T10:00:00",
        "last_date": "2026-06-20",  # < today
        "brokers": {"A": [{"date": "2026-06-20", "buy": 5, "sell": 0, "net": 5}]},
    }
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(stale_payload), encoding="utf-8",
    )
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=[]),
    )
    result = await client.fetch_broker_history("2330", ["A"])
    assert result["brokers"]["A"][0]["net"] == 5


@pytest.mark.asyncio
async def test_fetch_broker_history_dedup_concurrent_calls(client, monkeypatch):
    call_count = 0

    async def slow_fetch(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return [{"securities_trader": "A", "date": "2026-06-20",
                 "buy": 1000, "sell": 0}]

    monkeypatch.setattr(client, "_safe_get_secid_agg", slow_fetch)
    results = await asyncio.gather(
        client.fetch_broker_history("2330", ["A"]),
        client.fetch_broker_history("2330", ["A"]),
        client.fetch_broker_history("2330", ["A"]),
    )
    assert call_count == 1  # _run_once dedup
    assert all(r["brokers"]["A"] for r in results)


@pytest.mark.asyncio
async def test_fetch_broker_history_concurrent_different_ids_get_correct_subset(
    client, monkeypatch,
):
    """Two concurrent callers with different `ids` must each receive only
    their own subset, NOT the first caller's filtered result."""
    call_count = 0

    async def slow_fetch(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return [
            {"securities_trader": "A", "date": "2026-06-20",
             "buy": 1000, "sell": 0},
            {"securities_trader": "B", "date": "2026-06-20",
             "buy": 2000, "sell": 0},
        ]

    monkeypatch.setattr(client, "_safe_get_secid_agg", slow_fetch)
    res_a, res_b = await asyncio.gather(
        client.fetch_broker_history("2330", ["A"]),
        client.fetch_broker_history("2330", ["B"]),
    )
    assert call_count == 1  # only one underlying fetch
    assert "A" in res_a["brokers"]
    assert res_a["brokers"]["A"][0]["net"] == 1
    assert "B" not in res_a["brokers"]
    assert "B" in res_b["brokers"]
    assert res_b["brokers"]["B"][0]["net"] == 2
    assert "A" not in res_b["brokers"]
