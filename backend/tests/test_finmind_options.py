"""Tests for services/finmind_options.py — pure functions."""

import json
from datetime import date
from pathlib import Path

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
