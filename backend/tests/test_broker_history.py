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

import httpx
import pytest

from services import clock
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
    c = FinMindClient()
    # broker_history 會用 summary(daily_report)補 secid_agg 缺的當天;
    # 預設 stub 成「當天無資料」讓既有測試不打網路,補列行為由專節測試覆寫。
    monkeypatch.setattr(
        c, "fetch_chip_summary", AsyncMock(return_value={"top_brokers": []}),
    )
    return c


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


# ---------------------------------------------------------------------------
# v3 spec §B1 — days param separates cache key (W10 不影響舊路徑)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_broker_history_days_separates_cache(
    client, monkeypatch, tmp_path,
):
    """days==90 寫舊路徑 `2330_broker_history.json`(W10);
    其他 days 寫 `2330_broker_history_{days}d.json`,互不污染。"""
    today = date.today().isoformat()

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, today, 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)

    # days=60 寫到 _60d.json
    await client.fetch_broker_history("2330", ["9800"], days=60)
    assert (tmp_path / "2330_broker_history_60d.json").exists()
    # 舊路徑不該被建立
    assert not (tmp_path / "2330_broker_history.json").exists()

    # days==90(default)走舊路徑
    await client.fetch_broker_history("2330", ["8440"])
    assert (tmp_path / "2330_broker_history.json").exists()

    # 兩個檔案的 brokers 互相獨立
    c60 = json.loads(
        (tmp_path / "2330_broker_history_60d.json").read_text(encoding="utf-8"),
    )
    c90 = json.loads(
        (tmp_path / "2330_broker_history.json").read_text(encoding="utf-8"),
    )
    assert "9800" in c60["brokers"] and "8440" not in c60["brokers"]
    assert "8440" in c90["brokers"] and "9800" not in c90["brokers"]


# ---------------------------------------------------------------------------
# fix/broker-net-bar-today-missing — secid_agg 比 daily_report 晚一天發布,
# 當天缺列時用 summary(daily_report,已 per-day cache)補該分點當天 buy/sell/net。
# ---------------------------------------------------------------------------


def _summary_with(brokers: list[dict]) -> AsyncMock:
    return AsyncMock(return_value={"top_brokers": brokers})


@pytest.mark.asyncio
async def test_fetch_broker_history_fills_today_from_daily_report_when_secid_agg_lags(
    client, monkeypatch,
):
    """SC-1:secid_agg 最後一天是昨天、summary 有該分點當天 → series 末尾補當天列,
    值取自 summary(單位張,net = buy - sell)。"""
    today = clock.today()
    yesterday = (today - timedelta(days=1)).isoformat()

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, yesterday, 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    # 賣超、buy/sell 皆非零、net ≠ buy:鎖 net 來源與符號(review P2)
    summary_mock = _summary_with([
        {"broker_id": "1440", "name": "美林", "buy": 500, "sell": 2143, "net": -1643},
        {"broker_id": "9999", "name": "other", "buy": 1, "sell": 5, "net": -4},
    ])
    monkeypatch.setattr(client, "fetch_chip_summary", summary_mock)

    result = await client.fetch_broker_history("2330", ["1440"])
    series = result["brokers"]["1440"]
    assert [d["date"] for d in series] == [yesterday, today.isoformat()]
    assert series[-1] == {
        "date": today.isoformat(), "buy": 500, "sell": 2143, "net": -1643,
    }
    summary_mock.assert_awaited_once()
    assert summary_mock.await_args.args[:2] == ("2330", today.isoformat())


@pytest.mark.asyncio
async def test_fetch_broker_history_does_not_fill_when_secid_agg_has_today(
    client, monkeypatch,
):
    """SC-2:secid_agg 已含當天 → 不重複、不用 summary 覆寫。"""
    today = clock.today().isoformat()

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, today, 5000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    summary_mock = _summary_with([
        {"broker_id": "1440", "name": "美林", "buy": 999, "sell": 0, "net": 999},
    ])
    monkeypatch.setattr(client, "fetch_chip_summary", summary_mock)

    result = await client.fetch_broker_history("2330", ["1440"])
    series = result["brokers"]["1440"]
    assert len(series) == 1
    assert series[0] == {"date": today, "buy": 5, "sell": 0, "net": 5}


@pytest.mark.asyncio
async def test_fetch_broker_history_skips_fill_when_summary_lacks_broker(
    client, monkeypatch,
):
    """SC-3:summary 沒有該分點(當天沒交易 / 尚未發布 / 非交易日)→ series 不變。"""
    yesterday = (clock.today() - timedelta(days=1)).isoformat()

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, yesterday, 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    monkeypatch.setattr(client, "fetch_chip_summary", _summary_with([
        {"broker_id": "9999", "name": "other", "buy": 1, "sell": 5, "net": -4},
    ]))

    result = await client.fetch_broker_history("2330", ["1440"])
    assert result["brokers"]["1440"] == [
        {"date": yesterday, "buy": 1, "sell": 0, "net": 1},
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc", [httpx.HTTPError("502 upstream"), ValueError("bad int in margin row")],
)
async def test_fetch_broker_history_summary_failure_degrades_to_no_fill(
    client, monkeypatch, exc,
):
    """review P1:summary 抽風(FinMind 5xx / 非 JSON / 無關 dataset schema 漂移的
    parse ValueError)不得炸掉 secid_agg 已成功的整包 — 降級為不補(等同修前行為),
    與 _safe_get_secid_agg 同一「可用性優先」策略。"""
    yesterday = (clock.today() - timedelta(days=1)).isoformat()

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, yesterday, 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    monkeypatch.setattr(client, "fetch_chip_summary", AsyncMock(side_effect=exc))

    result = await client.fetch_broker_history("2330", ["1440"])
    assert result["brokers"]["1440"] == [
        {"date": yesterday, "buy": 1, "sell": 0, "net": 1},
    ]


@pytest.mark.asyncio
async def test_fetch_broker_history_fill_is_idempotent_and_skips_sticky_brokers(
    client, monkeypatch, tmp_path,
):
    """edge 3/4 + review P2:cache 已含補過的當天列、secid_agg 抓失敗沿用舊 series →
    不重複補;sticky(非本次請求)分點即使 summary 有它也不補。"""
    today = clock.today().isoformat()
    yesterday = (clock.today() - timedelta(days=1)).isoformat()
    seed = {
        "_cache_version": 3, "symbol": "2330",
        "fetched_at": "2026-06-20T10:00:00", "last_date": yesterday,
        "brokers": {
            "1440": [
                {"date": yesterday, "buy": 1, "sell": 0, "net": 1},
                {"date": today, "buy": 500, "sell": 2143, "net": -1643},
            ],
            "9800": [{"date": yesterday, "buy": 5, "sell": 0, "net": 5}],
        },
    }
    (tmp_path / "2330_broker_history.json").write_text(json.dumps(seed), encoding="utf-8")
    monkeypatch.setattr(client, "_safe_get_secid_agg", AsyncMock(return_value=[]))
    monkeypatch.setattr(client, "fetch_chip_summary", _summary_with([
        {"broker_id": "1440", "name": "美林", "buy": 500, "sell": 2143, "net": -1643},
        {"broker_id": "9800", "name": "元大", "buy": 9, "sell": 0, "net": 9},
    ]))

    result = await client.fetch_broker_history("2330", ["1440"])
    assert [d for d in result["brokers"]["1440"] if d["date"] == today] == [
        {"date": today, "buy": 500, "sell": 2143, "net": -1643},
    ]
    cached = json.loads((tmp_path / "2330_broker_history.json").read_text(encoding="utf-8"))
    assert sum(d["date"] == today for d in cached["brokers"]["1440"]) == 1
    assert [d["date"] for d in cached["brokers"]["9800"]] == [yesterday]


@pytest.mark.asyncio
async def test_fetch_broker_history_duplicate_ids_fill_once(client, monkeypatch, tmp_path):
    """review P2:?ids=1440,1440 只補一列(前端 brokerDateNet 是累加,重複列會讓柱翻倍)。"""
    yesterday = (clock.today() - timedelta(days=1)).isoformat()
    today = clock.today().isoformat()

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, yesterday, 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    monkeypatch.setattr(client, "fetch_chip_summary", _summary_with([
        {"broker_id": "1440", "name": "美林", "buy": 10, "sell": 2, "net": 8},
    ]))
    result = await client.fetch_broker_history("2330", ["1440", "1440"])
    assert sum(d["date"] == today for d in result["brokers"]["1440"]) == 1
    cached = json.loads((tmp_path / "2330_broker_history.json").read_text(encoding="utf-8"))
    assert sum(d["date"] == today for d in cached["brokers"]["1440"]) == 1


@pytest.mark.asyncio
async def test_fetch_broker_history_refresh_propagates_to_summary_fill(client, monkeypatch):
    """review P2:refresh=true 一路帶到補列用的 fetch_chip_summary(CLAUDE.md §4 refresh 契約)。"""
    yesterday = (clock.today() - timedelta(days=1)).isoformat()

    async def fake_secid(symbol, start, end, trader_id):
        return [_row(trader_id, yesterday, 1000)]

    monkeypatch.setattr(client, "_safe_get_secid_agg", fake_secid)
    summary_mock = _summary_with([])
    monkeypatch.setattr(client, "fetch_chip_summary", summary_mock)
    await client.fetch_broker_history("2330", ["1440"], refresh=True)
    assert summary_mock.await_args.args == ("2330", clock.today().isoformat(), True)
