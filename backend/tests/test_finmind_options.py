"""Tests for services/finmind_options.py — pure functions."""

import json
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

FIX = Path(__file__).parent / "fixtures" / "options"


def test_list_active_contracts_returns_seven_items_in_order():
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    assert len(items) == 7
    assert [i["kind"] for i in items] == ["weekly"] * 4 + ["monthly"] * 3
    assert [i["slot"] for i in items] == ["W1", "W2", "W3", "W4", "M0", "M1", "M2"]


def test_list_active_contracts_all_have_option_id_TXO():
    from services.finmind_options import list_active_contracts
    for i in list_active_contracts(date(2026, 6, 23)):
        assert i["option_id"] == "TXO"


def test_list_active_contracts_weeklies_share_contract_type_week():
    """FinMind aggregates all weekly OI under contract_type='week';
    monthlies use YYYYMM. The four weekly slots therefore differ in
    contract_date but share contract_type."""
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    weeklies = [i for i in items if i["kind"] == "weekly"]
    monthlies = [i for i in items if i["kind"] == "monthly"]
    assert all(w["contract_type"] == "week" for w in weeklies)
    assert all(m["contract_type"] == m["contract_date"] for m in monthlies)
    # contract_date must still vary per weekly for the Daily query
    assert len({w["contract_date"] for w in weeklies}) == 4


def test_list_active_contracts_matches_fixture():
    from services.finmind_options import list_active_contracts
    fix = json.loads((FIX / "contracts_2026-06-23.json").read_text("utf-8"))
    items = list_active_contracts(date(2026, 6, 23))
    assert [
        {"slot": i["slot"], "kind": i["kind"], "option_id": i["option_id"],
         "contract_date": i["contract_date"], "contract_type": i["contract_type"],
         "settlement": i["settlement"]}
        for i in items
    ] == fix["expected"]


def test_list_active_contracts_excludes_settled_week():
    """When today == settlement Wednesday, that week's W1 must roll over.

    Algorithm: _next_wednesday(d) returns smallest Wednesday strictly > d.
    So on Tuesday day-before-settle, W1 = the next-day Wednesday; on the
    settlement Wednesday itself, W1 must already advance to the following
    Wednesday.
    """
    from services.finmind_options import list_active_contracts
    settle_wed = date(2026, 6, 24)  # 週三, a non-monthly weekly settlement
    items_day_before = list_active_contracts(date(2026, 6, 23))
    items_day_of = list_active_contracts(settle_wed)
    assert items_day_before[0]["settlement"] == "2026-06-24"
    assert items_day_of[0]["settlement"] != "2026-06-24"


def _oi_row(date_, put_call, contract_type="202607", option_id="TXO", **fields):
    """Build a TaiwanOptionOpenInterestLargeTraders row. Phase-0 field names."""
    base = {
        "date": date_, "option_id": option_id, "contract_type": contract_type,
        "put_call": put_call,
        "buy_top5_trader_open_interest":      0, "sell_top5_trader_open_interest":      0,
        "buy_top10_trader_open_interest":     0, "sell_top10_trader_open_interest":     0,
        "buy_top5_specific_open_interest":    0, "sell_top5_specific_open_interest":    0,
        "buy_top10_specific_open_interest":   0, "sell_top10_specific_open_interest":   0,
    }
    base.update(fields)
    return base


def test_parse_oi_large_traders_aggregates_call_put_via_delta_equivalent():
    """long = call.buy + put.sell; short = call.sell + put.buy. Per spec §2.2."""
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call",
                buy_top10_trader_open_interest=18000,
                sell_top10_trader_open_interest=12000),
        _oi_row("2026-06-23", "put",
                buy_top10_trader_open_interest=9000,
                sell_top10_trader_open_interest=13000),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    # long  = call.buy(18000) + put.sell(13000) = 31000
    # short = call.sell(12000) + put.buy(9000)  = 21000
    assert out["current"]["top10_all"] == {"long": 31000, "short": 21000, "net": 10000}


def test_parse_oi_large_traders_fills_all_four_groups():
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call",
                buy_top5_trader_open_interest=100,    sell_top5_trader_open_interest=50,
                buy_top10_trader_open_interest=200,   sell_top10_trader_open_interest=120,
                buy_top5_specific_open_interest=80,   sell_top5_specific_open_interest=30,
                buy_top10_specific_open_interest=140, sell_top10_specific_open_interest=60),
        _oi_row("2026-06-23", "put",
                buy_top5_trader_open_interest=40,     sell_top5_trader_open_interest=70,
                buy_top10_trader_open_interest=90,    sell_top10_trader_open_interest=160,
                buy_top5_specific_open_interest=20,   sell_top5_specific_open_interest=55,
                buy_top10_specific_open_interest=45,  sell_top10_specific_open_interest=110),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    assert out["current"]["top5_all"]   == {"long": 100 + 70, "short": 50  + 40,  "net":  80}   # 170 - 90
    assert out["current"]["top10_all"]  == {"long": 200 + 160, "short": 120 + 90,  "net": 150}   # 360 - 210
    assert out["current"]["top5_prop"]  == {"long": 80 + 55,   "short": 30  + 20,  "net":  85}   # 135 - 50
    assert out["current"]["top10_prop"] == {"long": 140 + 110, "short": 60  + 45,  "net": 145}   # 250 - 105


def test_parse_oi_large_traders_series_in_date_order():
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call", buy_top10_trader_open_interest=18000, sell_top10_trader_open_interest=12000),
        _oi_row("2026-06-23", "put",  buy_top10_trader_open_interest=9000,  sell_top10_trader_open_interest=13000),
        _oi_row("2026-06-20", "call", buy_top10_trader_open_interest=17500, sell_top10_trader_open_interest=11500),
        _oi_row("2026-06-20", "put",  buy_top10_trader_open_interest=8500,  sell_top10_trader_open_interest=12800),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    assert [s["date"] for s in out["series"]] == ["2026-06-20", "2026-06-23"]
    # date 2026-06-23: top10_all_net = (18000+13000) - (12000+9000) = 31000 - 21000 = 10000
    assert out["series"][-1]["top10_all_net"] == 10000


def test_parse_oi_large_traders_series_includes_four_nets_per_day():
    """Each series entry must carry top5 + top10 x prop + all (4 nets)."""
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call",
                buy_top5_trader_open_interest=100,    sell_top5_trader_open_interest=40,
                buy_top10_trader_open_interest=200,   sell_top10_trader_open_interest=120,
                buy_top5_specific_open_interest=80,   sell_top5_specific_open_interest=30,
                buy_top10_specific_open_interest=140, sell_top10_specific_open_interest=60),
        _oi_row("2026-06-23", "put",
                buy_top5_trader_open_interest=40,     sell_top5_trader_open_interest=70,
                buy_top10_trader_open_interest=90,    sell_top10_trader_open_interest=160,
                buy_top5_specific_open_interest=20,   sell_top5_specific_open_interest=55,
                buy_top10_specific_open_interest=45,  sell_top10_specific_open_interest=110),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    assert len(out["series"]) == 1
    entry = out["series"][0]
    # delta-equivalent net:  long(call.buy+put.sell) - short(call.sell+put.buy)
    assert entry["top5_all_net"]   == (100 + 70) - (40  + 40)   #  80
    assert entry["top10_all_net"]  == (200 + 160) - (120 + 90)  # 150
    assert entry["top5_prop_net"]  == (80 + 55) - (30 + 20)     #  85
    assert entry["top10_prop_net"] == (140 + 110) - (60 + 45)   # 145
    assert entry["date"] == "2026-06-23"


def test_parse_oi_large_traders_filters_by_contract_type():
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call", contract_type="202607",
                buy_top10_trader_open_interest=999),
        _oi_row("2026-06-23", "put",  contract_type="202607",
                sell_top10_trader_open_interest=999),
        # Different contract_type — must be ignored
        _oi_row("2026-06-23", "call", contract_type="all",
                buy_top10_trader_open_interest=10_000_000),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    assert out["current"]["top10_all"]["long"] == 999 + 999  # call.buy(999) + put.sell(999)


def test_parse_oi_large_traders_filters_by_option_id():
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call", option_id="TEO",  # 電子選 — must be ignored
                buy_top10_trader_open_interest=999_999),
        _oi_row("2026-06-23", "call", option_id="TXO",
                buy_top10_trader_open_interest=100),
        _oi_row("2026-06-23", "put",  option_id="TXO",
                sell_top10_trader_open_interest=50),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607", option_id="TXO")
    assert out["current"]["top10_all"]["long"] == 100 + 50


def test_parse_oi_large_traders_missing_one_side_contributes_zero():
    """If only call (or only put) present for a date, the other side is 0."""
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call",
                buy_top10_trader_open_interest=100, sell_top10_trader_open_interest=50),
        # No put row for this date
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    assert out["current"]["top10_all"] == {"long": 100, "short": 50, "net": 50}


def test_parse_oi_large_traders_empty_returns_zero_current():
    from services.finmind_options import parse_oi_large_traders
    out = parse_oi_large_traders([], contract_type="202607")
    assert out["current"] == {
        "top5_prop":  {"long": 0, "short": 0, "net": 0},
        "top10_prop": {"long": 0, "short": 0, "net": 0},
        "top5_all":   {"long": 0, "short": 0, "net": 0},
        "top10_all":  {"long": 0, "short": 0, "net": 0},
    }
    assert out["series"] == []


def _od_row(date_, ct, cp, strike, vol, oi, *, session="position", option_id="TXO"):
    return {"date": date_, "option_id": option_id, "contract_date": ct,
            "call_put": cp, "strike_price": float(strike),
            "volume": vol, "open_interest": oi, "trading_session": session}


def test_parse_strike_volume_picks_top_n_per_side():
    from services.finmind_options import parse_strike_volume
    today = "2026-06-23"
    rows = [
        _od_row(today, "202607", "call", 22000, 18500, 35200),
        _od_row(today, "202607", "call", 22100, 12100, 30000),
        _od_row(today, "202607", "call", 21900,  9400, 22000),
        _od_row(today, "202607", "call", 21800,  3000, 12000),
        _od_row(today, "202607", "put",  21500, 14200, 28100),
        _od_row(today, "202607", "put",  21000,  9800, 18000),
    ]
    out = parse_strike_volume(rows, "202607", top_n=2)
    assert [c["strike"] for c in out["call"]] == [22000, 22100]
    assert [p["strike"] for p in out["put"]]  == [21500, 21000]
    assert out["call"][0]["volume"] == 18500
    assert out["call"][0]["oi"]     == 35200


def test_parse_strike_volume_sums_trading_sessions():
    """position + after_market both contribute to volume; OI takes max."""
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000, 12000, 35200, session="position"),
        _od_row("2026-06-23", "202607", "call", 22000,  6500, 35400, session="after_market"),
    ]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["call"][0]["volume"] == 12000 + 6500
    assert out["call"][0]["oi"] == 35400  # max of (35200, 35400)


def test_parse_strike_volume_computes_oi_change_against_prev_day():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-20", "202607", "call", 22000, 14000, 33100),
        _od_row("2026-06-23", "202607", "call", 22000, 18500, 35200),
    ]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["call"][0]["oi_change"] == 35200 - 33100


def test_parse_strike_volume_first_day_oi_change_zero():
    from services.finmind_options import parse_strike_volume
    rows = [_od_row("2026-06-23", "202607", "call", 22000, 18500, 35200)]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["call"][0]["oi_change"] == 0


def test_parse_strike_volume_filters_by_contract_date():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000, 99999, 35200),
        _od_row("2026-06-23", "202608", "call", 22000, 18500, 30000),
    ]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["call"][0]["volume"] == 99999


def test_parse_strike_volume_filters_by_option_id():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000, 99_999, 30000, option_id="TEO"),
        _od_row("2026-06-23", "202607", "call", 22000,    100, 35200, option_id="TXO"),
    ]
    out = parse_strike_volume(rows, "202607", top_n=1, option_id="TXO")
    assert out["call"][0]["volume"] == 100


def test_parse_strike_volume_drops_zero_volume_rows():
    """Phase 0 noted ~70% of TXO rows have volume=0 (illiquid OTM strikes).
    Those should not occupy top-N slots, even with top_n large."""
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000,  10, 5),
        _od_row("2026-06-23", "202607", "call", 22100,   0, 7),
        _od_row("2026-06-23", "202607", "call", 22200,   0, 9),
    ]
    out = parse_strike_volume(rows, "202607", top_n=10)
    assert len(out["call"]) == 1
    assert out["call"][0]["strike"] == 22000


def test_parse_strike_volume_empty_returns_empty_lists():
    from services.finmind_options import parse_strike_volume
    out = parse_strike_volume([], "202607", top_n=10)
    assert out == {"call": [], "put": [], "as_of_date": None}


# ---------------------------------------------------------------------------
# Bug fix: as_of_date exposure for non-trading-day banner detection
# ---------------------------------------------------------------------------


def test_parse_oi_large_traders_exposes_as_of_date():
    """Banner detection needs to know the actual date `current` represents."""
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-19", "call",
                buy_top10_trader_open_interest=100, sell_top10_trader_open_interest=50),
        _oi_row("2026-06-19", "put",
                buy_top10_trader_open_interest=40, sell_top10_trader_open_interest=60),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    assert out["as_of_date"] == "2026-06-19"


def test_parse_oi_large_traders_empty_as_of_date_is_none():
    from services.finmind_options import parse_oi_large_traders
    out = parse_oi_large_traders([], contract_type="202607")
    assert out["as_of_date"] is None


def test_parse_strike_volume_exposes_as_of_date():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-19", "202607", "call", 22000, 18500, 35200),
    ]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["as_of_date"] == "2026-06-19"


def test_parse_strike_volume_empty_as_of_date_is_none():
    from services.finmind_options import parse_strike_volume
    out = parse_strike_volume([], "202607", top_n=10)
    assert out["as_of_date"] is None


# ---------------------------------------------------------------------------
# Task 4: FinMindClient.fetch_oi_large_traders
# ---------------------------------------------------------------------------


def _fm_resp(data, status=200):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = {"msg": "success", "status": 200, "data": data}
    r.raise_for_status = MagicMock()
    return r


def _mock_http(*responses):
    c = AsyncMock()
    c.get = AsyncMock(side_effect=list(responses))
    return c


@pytest.fixture(autouse=True)
def _reset_singleton(tmp_path, monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "test-token")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    import services.finmind as mod
    mod._client = None
    mod._fm_limiter = None


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_writes_cache_and_returns_shape():
    from services.finmind import FinMindClient
    rows = [
        _oi_row("2026-06-20", "call",
                buy_top10_trader_open_interest=17500, sell_top10_trader_open_interest=11500),
        _oi_row("2026-06-20", "put",
                buy_top10_trader_open_interest=8500,  sell_top10_trader_open_interest=12800),
        _oi_row("2026-06-23", "call",
                buy_top10_trader_open_interest=18000, sell_top10_trader_open_interest=12000),
        _oi_row("2026-06-23", "put",
                buy_top10_trader_open_interest=9000,  sell_top10_trader_open_interest=13000),
    ]
    mc = _mock_http(_fm_resp(rows))
    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202607", "contract_type": "202607"}
    out = await fm.fetch_oi_large_traders(contract, "2026-06-23")
    assert out["contract"] == "TXO202607"
    assert out["date"] == "2026-06-23"
    # current top10_all.net = (call.buy + put.sell) - (call.sell + put.buy)
    #                       = (18000 + 13000) - (12000 + 9000) = 31000 - 21000 = 10000
    assert out["current"]["top10_all"]["net"] == 10000
    assert len(out["series"]) == 2
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / "TXO202607_2026-06-23_oi_lt.json").exists()


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_returns_cached_on_second_call():
    from services.finmind import FinMindClient
    rows = [_oi_row("2025-01-01", "call",
                    buy_top10_trader_open_interest=100, sell_top10_trader_open_interest=50)]
    mc = _mock_http(_fm_resp(rows))
    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202501", "contract_type": "202501"}
    first = await fm.fetch_oi_large_traders(contract, "2025-01-01")  # past date → permanent
    second = await fm.fetch_oi_large_traders(contract, "2025-01-01")
    assert first == second
    assert mc.get.await_count == 1  # second call hit cache


@pytest.mark.asyncio
async def test_fetch_strike_volume_writes_cache_and_returns_shape():
    from services.finmind import FinMindClient
    today = "2026-06-23"
    rows = [
        _od_row("2026-06-20", "202607", "call", 22000, 14000, 33100),
        _od_row(today, "202607", "call", 22000, 18500, 35200),
        _od_row(today, "202607", "call", 22100, 12100, 30000),
        _od_row(today, "202607", "put",  21500, 14200, 28100),
    ]
    mc = _mock_http(_fm_resp(rows))
    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202607", "contract_type": "202607"}
    out = await fm.fetch_strike_volume(contract, today, top_n=2)
    assert out["contract"] == "TXO202607"
    assert out["date"] == today
    assert [c["strike"] for c in out["call"]] == [22000, 22100]
    assert out["call"][0]["oi_change"] == 35200 - 33100
    assert [p["strike"] for p in out["put"]] == [21500]
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / "TXO202607_2026-06-23_strike_vol_top2.json").exists()
