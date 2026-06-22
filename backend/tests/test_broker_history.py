"""Tests for broker-history parsing and fetch.

Contract: broker history is keyed by FinMind `securities_trader_id` because
FinMind's SecIdAgg endpoint requires `securities_trader_id` as a query filter
(no-filter calls return 400). The frontend already has these ids in
`top_brokers[].broker_id`, so the same value flows through the round-trip.

SecIdAgg row fields: `buy_volume` / `sell_volume` (NOT `buy` / `sell`).
"""
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


def test_parse_broker_history_groups_by_broker_id_and_uses_volume_fields():
    rows = [
        {"securities_trader_id": "9800", "securities_trader": "元大",
         "date": "2026-06-20", "buy_volume": 120000, "sell_volume": 50000},
    ]
    result = _parse_broker_history(rows)
    # 120000 shares → 120 lots; 50000 → 50; net = 70
    assert result["9800"][0] == {
        "date": "2026-06-20", "buy": 120, "sell": 50, "net": 70,
    }


def test_parse_broker_history_truncates_shares_to_lots():
    rows = [
        {"securities_trader_id": "X1", "date": "2026-06-20",
         "buy_volume": 1500, "sell_volume": 999},
    ]
    # 1500 → 1 lot (truncate); 999 → 0
    result = _parse_broker_history(rows)
    assert result["X1"][0]["buy"] == 1
    assert result["X1"][0]["sell"] == 0


def test_parse_broker_history_aggregates_duplicate_date_rows():
    rows = [
        {"securities_trader_id": "Z9", "date": "2026-06-20",
         "buy_volume": 1000, "sell_volume": 0},
        {"securities_trader_id": "Z9", "date": "2026-06-20",
         "buy_volume": 2000, "sell_volume": 500},
    ]
    result = _parse_broker_history(rows)
    assert len(result["Z9"]) == 1
    # buy = 3 lots, sell = 0 lots (500 truncated)
    assert result["Z9"][0] == {"date": "2026-06-20", "buy": 3, "sell": 0, "net": 3}


def test_parse_broker_history_empty_input():
    assert _parse_broker_history([]) == {}


def test_parse_broker_history_skips_blank_broker_id():
    rows = [
        {"securities_trader_id": "", "date": "2026-06-20",
         "buy_volume": 1000, "sell_volume": 0},
        {"securities_trader_id": "  ", "date": "2026-06-20",
         "buy_volume": 1000, "sell_volume": 0},
        {"securities_trader_id": "Y3", "date": "2026-06-20",
         "buy_volume": 1000, "sell_volume": 0},
    ]
    result = _parse_broker_history(rows)
    assert list(result.keys()) == ["Y3"]


def test_parse_broker_history_sorts_dates_ascending():
    rows = [
        {"securities_trader_id": "A", "date": "2026-06-22",
         "buy_volume": 1000, "sell_volume": 0},
        {"securities_trader_id": "A", "date": "2026-06-20",
         "buy_volume": 1000, "sell_volume": 0},
        {"securities_trader_id": "A", "date": "2026-06-21",
         "buy_volume": 1000, "sell_volume": 0},
    ]
    result = _parse_broker_history(rows)
    assert [d["date"] for d in result["A"]] == [
        "2026-06-20", "2026-06-21", "2026-06-22",
    ]


# ---------------------------------------------------------------------------
# _filter_broker_history
# ---------------------------------------------------------------------------


def test_filter_broker_history_logs_warning_on_missing_keys(caplog):
    payload = {
        "symbol": "2330", "fetched_at": "", "last_date": "",
        "brokers": {"9800": [{"date": "d", "buy": 1, "sell": 0, "net": 1}]},
    }
    with caplog.at_level(logging.WARNING, logger="services.finmind"):
        result = _filter_broker_history(payload, ["9800", "MISSING"])
    assert result["brokers"]["MISSING"] == []
    assert any("MISSING" in r.message for r in caplog.records), (
        f"expected warning naming the missing key; got {[r.message for r in caplog.records]}"
    )


def test_filter_broker_history_narrows_to_requested_subset():
    payload = {
        "symbol": "2330", "fetched_at": "", "last_date": "",
        "brokers": {
            "A": [{"date": "d", "buy": 1, "sell": 0, "net": 1}],
            "B": [{"date": "d", "buy": 2, "sell": 0, "net": 2}],
            "C": [{"date": "d", "buy": 3, "sell": 0, "net": 3}],
        },
    }
    result = _filter_broker_history(payload, ["A", "C"])
    assert set(result["brokers"].keys()) == {"A", "C"}


# ---------------------------------------------------------------------------
# _safe_get_secid_agg
# ---------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("FINMIND_TOKEN", "test")
    monkeypatch.setattr(
        "services.finmind.chip_cache_dir", lambda: tmp_path,
    )
    return FinMindClient()


@pytest.mark.asyncio
async def test_safe_get_secid_agg_passes_trader_id_param(client, monkeypatch):
    """SecIdAgg endpoint requires `securities_trader_id` — a missing arg makes
    the call 400. Asserting the param flows through here catches the most
    common regression (someone refactors and drops the arg)."""
    captured = {}

    async def fake_get(url, params):
        captured["url"] = url
        captured["params"] = dict(params)
        return []

    monkeypatch.setattr(client, "_get", fake_get)
    await client._safe_get_secid_agg("2330", "2026-03-25", "2026-06-22", "9800")
    assert captured["params"].get("securities_trader_id") == "9800"
    assert captured["params"].get("data_id") == "2330"


@pytest.mark.asyncio
async def test_safe_get_secid_agg_returns_empty_on_error(client, monkeypatch):
    async def boom(*a, **kw):
        raise RuntimeError("upstream 502")

    monkeypatch.setattr(client, "_get", boom)
    result = await client._safe_get_secid_agg("2330", "s", "e", "9800")
    assert result == []


# ---------------------------------------------------------------------------
# fetch_broker_history
# ---------------------------------------------------------------------------


def _row(trader_id: str, d: str, buy: int, sell: int = 0) -> dict:
    return {
        "securities_trader_id": trader_id,
        "securities_trader": f"broker-{trader_id}",
        "date": d,
        "buy_volume": buy,
        "sell_volume": sell,
    }


@pytest.mark.asyncio
async def test_fetch_broker_history_calls_secid_agg_per_id(client, monkeypatch):
    """One requested id → exactly one SecIdAgg call carrying that trader_id."""
    seen_ids: list[str] = []

    async def fake_secid(symbol, start, end, trader_id):
        seen_ids.append(trader_id)
        return [_row(trader_id, "2026-06-20", 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    result = await client.fetch_broker_history("2330", ["9800", "8440"])
    assert sorted(seen_ids) == ["8440", "9800"]
    assert result["brokers"]["9800"][0]["buy"] == 1
    assert result["brokers"]["8440"][0]["buy"] == 1


@pytest.mark.asyncio
async def test_fetch_broker_history_returns_empty_list_for_unknown_id(
    client, monkeypatch,
):
    async def fake_secid(symbol, start, end, trader_id):
        return [_row("9800", "2026-06-20", 1000)] if trader_id == "9800" else []

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    result = await client.fetch_broker_history("2330", ["9800", "MISSING"])
    assert result["brokers"]["9800"]
    assert result["brokers"]["MISSING"] == []


@pytest.mark.asyncio
async def test_fetch_broker_history_raises_when_all_ids_empty_and_no_cache(
    client, monkeypatch,
):
    monkeypatch.setattr(
        client, "_safe_get_secid_agg", AsyncMock(return_value=[]),
    )
    with pytest.raises(ValueError, match="secid_agg_unavailable"):
        await client.fetch_broker_history("2330", ["9800"])


@pytest.mark.asyncio
async def test_fetch_broker_history_caches_partial_payload(
    client, monkeypatch, tmp_path,
):
    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, "2026-06-20", 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    await client.fetch_broker_history("2330", ["9800"])
    cache_path = tmp_path / "2330_broker_history.json"
    assert cache_path.exists()
    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    assert set(cached["brokers"].keys()) == {"9800"}


@pytest.mark.asyncio
async def test_fetch_broker_history_merges_with_existing_cache(
    client, monkeypatch, tmp_path,
):
    """Selecting a new broker must NOT evict previously-cached brokers."""
    today = date.today().isoformat()
    seed = {
        "_cache_version": 3, "symbol": "2330",
        "fetched_at": "2026-06-20T10:00:00",
        "last_date": "2026-06-20",
        "brokers": {"9800": [{"date": today, "buy": 5, "sell": 0, "net": 5}]},
    }
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(seed), encoding="utf-8",
    )

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, today, 2000)] if trader_id == "8440" else []

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    await client.fetch_broker_history("2330", ["8440"])

    cached = json.loads((tmp_path / "2330_broker_history.json").read_text(encoding="utf-8"))
    assert set(cached["brokers"].keys()) == {"9800", "8440"}
    # Original 9800 series preserved verbatim
    assert cached["brokers"]["9800"][0]["buy"] == 5


@pytest.mark.asyncio
async def test_fetch_broker_history_fresh_cache_subset_skips_fetch(
    client, monkeypatch, tmp_path,
):
    """When all requested ids are in a fresh today-dated cache, no SecIdAgg
    call is made."""
    today = date.today().isoformat()
    cache_payload = {
        "_cache_version": 3, "symbol": "2330",
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "last_date": today,
        "brokers": {"9800": [{"date": today, "buy": 5, "sell": 0, "net": 5}]},
    }
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(cache_payload), encoding="utf-8",
    )
    mock_fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(client, "_safe_get_secid_agg", mock_fetch)
    result = await client.fetch_broker_history("2330", ["9800"])
    assert result["brokers"]["9800"][0]["net"] == 5
    mock_fetch.assert_not_called()


@pytest.mark.asyncio
async def test_fetch_broker_history_refetches_when_cache_stale_today(
    client, monkeypatch, tmp_path,
):
    """Stale (older than 15-min TTL) today-dated cache must refetch on a plain
    GET — browser F5 sends refresh=false but still expects fresh data."""
    today = date.today().isoformat()
    stale = (datetime.now() - timedelta(hours=1)).isoformat(timespec="seconds")
    cache_payload = {
        "_cache_version": 3, "symbol": "2330",
        "fetched_at": stale, "last_date": today,
        "brokers": {"9800": [{"date": today, "buy": 5, "sell": 0, "net": 5}]},
    }
    (tmp_path / "2330_broker_history.json").write_text(
        json.dumps(cache_payload), encoding="utf-8",
    )
    mock_fetch = AsyncMock(return_value=[_row("9800", today, 99000)])
    monkeypatch.setattr(client, "_safe_get_secid_agg", mock_fetch)
    result = await client.fetch_broker_history("2330", ["9800"])
    mock_fetch.assert_called_once()
    assert result["brokers"]["9800"][0]["buy"] == 99


@pytest.mark.asyncio
async def test_fetch_broker_history_dedup_concurrent_same_ids(client, monkeypatch):
    call_count = 0

    async def slow_secid(symbol, start, end, trader_id):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return [_row(trader_id, "2026-06-20", 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", slow_secid)
    await asyncio.gather(
        client.fetch_broker_history("2330", ["9800"]),
        client.fetch_broker_history("2330", ["9800"]),
        client.fetch_broker_history("2330", ["9800"]),
    )
    # _run_once dedups by (symbol, sorted-ids), so the three identical calls
    # collapse into one underlying SecIdAgg fetch.
    assert call_count == 1


@pytest.mark.asyncio
async def test_fetch_broker_history_concurrent_different_ids_each_get_subset(
    client, monkeypatch,
):
    async def slow_secid(symbol, start, end, trader_id):
        await asyncio.sleep(0.02)
        return [_row(trader_id, "2026-06-20", 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", slow_secid)
    res_a, res_b = await asyncio.gather(
        client.fetch_broker_history("2330", ["9800"]),
        client.fetch_broker_history("2330", ["8440"]),
    )
    assert "9800" in res_a["brokers"] and "8440" not in res_a["brokers"]
    assert "8440" in res_b["brokers"] and "9800" not in res_b["brokers"]
