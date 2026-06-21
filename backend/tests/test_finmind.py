"""Tests for services/finmind.py — FinMind API client."""

import json
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
    "date": "2026-06-19", "stock_id": "2330",
    "Foreign_Investor_buy": 12845000, "Foreign_Investor_sell": 8231000,
    "Foreign_Dealer_Self_buy": 0, "Foreign_Dealer_Self_sell": 0,
    "Investment_Trust_buy": 2156000, "Investment_Trust_sell": 1872000,
    "Dealer_buy": 0, "Dealer_sell": 0,
    "Dealer_self_buy": 1800000, "Dealer_self_sell": 2100000,
    "Dealer_Hedging_buy": 1621000, "Dealer_Hedging_sell": 2002000,
}

MARGIN_ROW = {
    "date": "2026-06-19", "stock_id": "2330",
    "MarginPurchaseBuy": 500, "MarginPurchaseSell": 300,
    "MarginPurchaseCashRepayment": 50,
    "MarginPurchaseTodayBalance": 18432,
    "MarginPurchaseYesterdayBalance": 18106,
    "MarginPurchaseLimit": 259362,
    "ShortSaleBuy": 100, "ShortSaleSell": 200,
    "ShortSaleCashRepayment": 13,
    "ShortSaleTodayBalance": 1245,
    "ShortSaleYesterdayBalance": 1332,
    "ShortSaleLimit": 259362,
    "OffsetLoanAndShort": 0, "Note": "",
}

BROKER_ROWS = [
    {"securities_trader": "美林", "securities_trader_id": "9A00",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1090.0, "buy": 800000, "sell": 20000},
    {"securities_trader": "美林", "securities_trader_id": "9A00",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1089.0, "buy": 445000, "sell": 18000},
    {"securities_trader": "元大-台北", "securities_trader_id": "6110",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1094.0, "buy": 25000, "sell": 500000},
    {"securities_trader": "元大-台北", "securities_trader_id": "6110",
     "stock_id": "2330", "date": "2026-06-19",
     "price": 1093.0, "buy": 20000, "sell": 392000},
]


@pytest.fixture(autouse=True)
def _reset_singleton(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "test-token")
    import services.finmind as mod
    mod._client = None
    mod._fm_limiter = None


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
        "symbol": "2330", "date": "2026-01-01",
        "fetched_at": "2026-01-01T20:00:00",
        "institutional": {}, "margin": {}, "top_brokers": [],
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
        {"securities_trader": "美林", "securities_trader_id": "9A00",
         "price": 1090.0, "buy": 320000, "sell": 5000,
         "stock_id": "2330", "date": "2026-06-19"},
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
        "date": "2026-06-19", "stock_id": "2330",
        "open": 1080, "max": 1098, "min": 1078, "close": 1095,
        "Trading_Volume": 36200,
    }
    agg_row = {
        "date": "2026-06-19", "securities_trader": "A",
        "securities_trader_id": "A1", "buy": 5000000, "sell": 1000000,
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
        {"securities_trader": "A", "securities_trader_id": "A1",
         "price": 100.0, "buy": 5000000, "sell": 1000000},
        {"securities_trader": "B", "securities_trader_id": "B1",
         "price": 100.0, "buy": 500000, "sell": 3000000},
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
        {"securities_trader": "TestA", "securities_trader_id": "T001",
         "price": 100.0, "buy": 5730600, "sell": 4496400},
    ]
    result = _parse_top_brokers(rows)
    assert result[0]["buy"] == 5730
    assert result[0]["sell"] == 4496
    assert result[0]["net"] == 1234


def test_no_token_raises(monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "")
    from services.finmind import FinMindClient
    with pytest.raises(ValueError, match="FINMIND_TOKEN"):
        FinMindClient()
