"""Tests for services/finmind_options.py — pure functions."""

import json
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

FIX = Path(__file__).parent / "fixtures" / "options"


def test_list_active_contracts_has_three_monthlies_and_some_weeklies():
    """At minimum: 3 monthlies (M0/M1/M2 anchors) + ≥1 weekly_wed + ≥1 weekly_fri.
    Slot labels are gone — picker is sorted by settlement, no W1..W4 numbering."""
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    assert sum(1 for i in items if i["kind"] == "monthly") == 3
    assert sum(1 for i in items if i["kind"] == "weekly_wed") >= 1
    assert sum(1 for i in items if i["kind"] == "weekly_fri") >= 1


def test_list_active_contracts_all_have_option_id_TXO():
    from services.finmind_options import list_active_contracts
    for i in list_active_contracts(date(2026, 6, 23)):
        assert i["option_id"] == "TXO"


def test_list_active_contracts_weeklies_share_contract_type_week():
    """FinMind aggregates ALL weekly OI (Wed + Fri) under contract_type='week';
    monthlies use YYYYMM. The weekly contracts differ in contract_date but
    share contract_type='week'. Verified via 2026-06-23 OI-large-traders probe."""
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    weeklies = [i for i in items if i["kind"].startswith("weekly")]
    monthlies = [i for i in items if i["kind"] == "monthly"]
    assert all(w["contract_type"] == "week" for w in weeklies)
    assert all(m["contract_type"] == m["contract_date"] for m in monthlies)
    # contract_date must still vary per weekly for the Daily query
    assert len({w["contract_date"] for w in weeklies}) == len(weeklies)


def test_list_active_contracts_matches_fixture():
    from services.finmind_options import list_active_contracts
    fix = json.loads((FIX / "contracts_2026-06-23.json").read_text("utf-8"))
    items = list_active_contracts(date(2026, 6, 23))
    assert [
        {"kind": i["kind"], "option_id": i["option_id"],
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


# ---------------------------------------------------------------------------
# Friday-expiry TXO weeklies (TAIFEX 上市 2025/06/27).
# FinMind packs them into TaiwanOptionDaily under the same option_id 'TXO',
# distinguished by contract_date suffix 'F{n}' (vs 'W{n}' for Wed weeklies).
# OI Large Traders aggregates ALL weeklies — Wed + Fri — under
# contract_type='week' (no per-leg split). list_active_contracts must
# enumerate Fri weeklies alongside Wed weeklies and monthlies, sorted by
# settlement date ascending so the picker is chronological.
# ---------------------------------------------------------------------------


def test_list_active_contracts_includes_friday_weeklies():
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    fri = [i for i in items if i["kind"] == "weekly_fri"]
    assert len(fri) > 0, "must include at least one weekly_fri contract"
    # 2026-06-26 is a Friday within the default horizon
    assert any(i["settlement"] == "2026-06-26" for i in fri)


def test_list_active_contracts_friday_contract_date_format():
    """Friday contracts use 'YYYYMMF{ordinal}' where ordinal = (day-1)//7+1.
    e.g. 2026-06-26 → '202606F4' (4th week of June)."""
    import re
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    for i in items:
        if i["kind"] != "weekly_fri":
            continue
        assert re.match(r"^\d{6}F\d$", i["contract_date"]), \
            f"bad contract_date: {i['contract_date']}"


def test_list_active_contracts_friday_settles_on_friday():
    """A weekly_fri contract's settlement date must fall on a Friday (wd=4)."""
    from datetime import date as D
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    fri = [i for i in items if i["kind"] == "weekly_fri"]
    for f in fri:
        s = D.fromisoformat(f["settlement"])
        assert s.weekday() == 4, \
            f"weekly_fri settles on {s} (weekday={s.weekday()}, expected 4)"


def test_list_active_contracts_friday_uses_contract_type_week():
    """FinMind aggregates Wed+Fri weeklies into contract_type='week'.
    Verified via probe of TaiwanOptionOpenInterestLargeTraders on 2026-06-23."""
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    fri = [i for i in items if i["kind"] == "weekly_fri"]
    assert all(f["contract_type"] == "week" for f in fri)


def test_list_active_contracts_sorted_by_settlement_ascending():
    """User-facing picker shows contracts chronologically — by settlement asc.
    Monthly W3-coinciding settlements appear in chronological position."""
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    setts = [i["settlement"] for i in items]
    assert setts == sorted(setts), \
        f"contracts must be sorted by settlement ascending; got {setts}"


def test_list_active_contracts_kinds_are_three_known():
    """Only three kinds are valid: weekly_wed, weekly_fri, monthly.
    'weekly' (legacy) is gone — frontend's isWeekly check must use a prefix
    test or membership check."""
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    assert set(i["kind"] for i in items) <= {"weekly_wed", "weekly_fri", "monthly"}


def test_list_active_contracts_no_same_day_collision_with_monthly():
    """When monthly settles on a Wednesday (always 3rd Wed), do NOT also emit
    a weekly_wed for that day — the monthly contract represents that strike
    set in FinMind (W3 is implicit in monthly settlement)."""
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    by_sett: dict[str, list[str]] = {}
    for i in items:
        by_sett.setdefault(i["settlement"], []).append(i["kind"])
    for sett, kinds in by_sett.items():
        if "monthly" in kinds:
            assert "weekly_wed" not in kinds, \
                f"{sett}: monthly + weekly_wed collide on the same day"


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


def test_parse_strike_volume_returns_all_active_strikes_sorted_by_strike_asc():
    """options-page-v2 §1.4(該變 assertion,原「volume>0 only」):保留
    volume>0 OR oi>0 的 strike — OI 牆常落在零成交大 OI 檔位,RangeMap 的
    分布與牆標記必須共享同一 strike 集合。"""
    from services.finmind_options import parse_strike_volume
    today = "2026-06-23"
    rows = [
        _od_row(today, "202607", "call", 53500, 1200, 8410),
        _od_row(today, "202607", "call", 50000,  165, 1240),
        _od_row(today, "202607", "call", 52000,  240, 2680),
        _od_row(today, "202607", "call", 51000,    0, 1380),  # zero vol, oi>0 -- KEEP
        _od_row(today, "202607", "put",  51500,  209, 5180),
        _od_row(today, "202607", "put",  50000,  364, 8120),
    ]
    out = parse_strike_volume(rows, "202607")  # NOTE: no top_n
    assert [c["strike"] for c in out["call"]] == [50000, 51000, 52000, 53500]
    assert [p["strike"] for p in out["put"]]  == [50000, 51500]
    assert out["as_of_date"] == today


def test_parse_strike_volume_keeps_all_volume_rows_sorted_asc():
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
    out = parse_strike_volume(rows, "202607")
    assert [c["strike"] for c in out["call"]] == [21800, 21900, 22000, 22100]
    assert [p["strike"] for p in out["put"]]  == [21000, 21500]
    assert out["call"][2]["volume"] == 18500  # strike 22000 -> vol 18500


def test_parse_strike_volume_sums_trading_sessions():
    """position + after_market both contribute to volume; OI takes max."""
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000, 12000, 35200, session="position"),
        _od_row("2026-06-23", "202607", "call", 22000,  6500, 35400, session="after_market"),
    ]
    out = parse_strike_volume(rows, "202607")
    assert out["call"][0]["volume"] == 12000 + 6500
    assert out["call"][0]["oi"] == 35400  # max of (35200, 35400)


def test_parse_strike_volume_computes_oi_change_against_prev_day():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-20", "202607", "call", 22000, 14000, 33100),
        _od_row("2026-06-23", "202607", "call", 22000, 18500, 35200),
    ]
    out = parse_strike_volume(rows, "202607")
    assert out["call"][0]["oi_change"] == 35200 - 33100


def test_parse_strike_volume_first_day_oi_change_zero():
    from services.finmind_options import parse_strike_volume
    rows = [_od_row("2026-06-23", "202607", "call", 22000, 18500, 35200)]
    out = parse_strike_volume(rows, "202607")
    assert out["call"][0]["oi_change"] == 0


def test_parse_strike_volume_filters_by_contract_date():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000, 99999, 35200),
        _od_row("2026-06-23", "202608", "call", 22000, 18500, 30000),
    ]
    out = parse_strike_volume(rows, "202607")
    assert out["call"][0]["volume"] == 99999


def test_parse_strike_volume_filters_by_option_id():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000, 99_999, 30000, option_id="TEO"),
        _od_row("2026-06-23", "202607", "call", 22000,    100, 35200, option_id="TXO"),
    ]
    out = parse_strike_volume(rows, "202607", option_id="TXO")
    assert out["call"][0]["volume"] == 100


def test_parse_strike_volume_keeps_zero_volume_positive_oi_drops_dead_rows():
    """options-page-v2 §1.4(該變 assertion,原 drops_zero_volume_rows):
    volume=0 但 oi>0 保留(牆檔位);volume=0 且 oi=0 才 drop。"""
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000,  10, 5),
        _od_row("2026-06-23", "202607", "call", 22100,   0, 7),   # zero vol, oi>0 → keep
        _od_row("2026-06-23", "202607", "call", 22200,   0, 0),   # dead → drop
    ]
    out = parse_strike_volume(rows, "202607")
    assert [c["strike"] for c in out["call"]] == [22000, 22100]
    assert out["call"][1]["volume"] == 0
    assert out["call"][1]["oi"] == 7


def test_parse_strike_volume_today_falls_back_to_last_oi_day():
    """options-page-v2 §1.4 / R10:交易日早晨僅夜盤 rows(volume>0、OI 全 0)
    時,`today` 必須退回最近「有 OI」的日子 — 與 fetch_oi_walls 的 F7
    fallback 同準則,RangeMap 疊圖(牆 vs 分布)基準日才一致。"""
    from services.finmind_options import parse_strike_volume
    rows = [
        # D-1:正常盤後資料(有 OI)
        _od_row("2026-06-25", "202607", "call", 22000, 500, 3000),
        _od_row("2026-06-25", "202607", "put",  21000, 400, 2500),
        # D:早晨僅夜盤 rows — 有量但 OI 全 0
        _od_row("2026-06-26", "202607", "call", 22000, 120, 0, session="after_market"),
        _od_row("2026-06-26", "202607", "put",  21000,  80, 0, session="after_market"),
    ]
    out = parse_strike_volume(rows, "202607")
    assert out["as_of_date"] == "2026-06-25"
    assert out["call"][0]["oi"] == 3000


def test_parse_strike_volume_empty_returns_empty_lists():
    from services.finmind_options import parse_strike_volume
    out = parse_strike_volume([], "202607")
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
    out = parse_strike_volume(rows, "202607")
    assert out["as_of_date"] == "2026-06-19"


def test_parse_strike_volume_empty_as_of_date_is_none():
    from services.finmind_options import parse_strike_volume
    out = parse_strike_volume([], "202607")
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


def _mock_http_by_start_date(rows_by_date):
    """side_effect that returns rows keyed by the request's `start_date` param.

    `TaiwanOptionOpenInterestLargeTraders` ignores `end_date` upstream, so the
    client fans out one call per cal day. This helper returns the rows scoped
    to whatever single date the client asked for; unknown dates → empty rows.
    """
    c = AsyncMock()

    async def fake_get(url, params=None, **_kw):
        d = (params or {}).get("start_date", "")
        return _fm_resp(rows_by_date.get(d, []))

    c.get = AsyncMock(side_effect=fake_get)
    return c


# _reset_singleton moved to tests/conftest.py (design v4 T1)


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_writes_cache_and_returns_shape():
    """FinMind ignores end_date for OI-large-traders, so the client fans out
    30 single-date calls. The mock routes by start_date; only the two dates
    we populate produce rows, the rest return empty."""
    from services.finmind import FinMindClient
    by_date = {
        "2026-06-20": [
            _oi_row("2026-06-20", "call",
                    buy_top10_trader_open_interest=17500,
                    sell_top10_trader_open_interest=11500),
            _oi_row("2026-06-20", "put",
                    buy_top10_trader_open_interest=8500,
                    sell_top10_trader_open_interest=12800),
        ],
        "2026-06-23": [
            _oi_row("2026-06-23", "call",
                    buy_top10_trader_open_interest=18000,
                    sell_top10_trader_open_interest=12000),
            _oi_row("2026-06-23", "put",
                    buy_top10_trader_open_interest=9000,
                    sell_top10_trader_open_interest=13000),
        ],
    }
    mc = _mock_http_by_start_date(by_date)
    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202607", "contract_type": "202607"}
    out = await fm.fetch_oi_large_traders(contract, "2026-06-23")
    assert out["contract"] == "TXO202607"
    assert out["date"] == "2026-06-23"
    # current top10_all.net = (call.buy + put.sell) - (call.sell + put.buy)
    #                       = (18000 + 13000) - (12000 + 9000) = 31000 - 21000 = 10000
    assert out["current"]["top10_all"]["net"] == 10000
    assert len(out["series"]) == 2  # 2026-06-20 + 2026-06-23
    # 30 single-date HTTP calls fan out (end day + 29 prior cal days).
    assert mc.get.await_count == 30
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / "TXO202607_2026-06-23_oi_lt.json").exists()


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_returns_cached_on_second_call():
    from services.finmind import FinMindClient
    by_date = {
        "2025-01-01": [_oi_row("2025-01-01", "call",
                                buy_top10_trader_open_interest=100,
                                sell_top10_trader_open_interest=50)],
    }
    mc = _mock_http_by_start_date(by_date)
    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202501", "contract_type": "202501"}
    first = await fm.fetch_oi_large_traders(contract, "2025-01-01")  # past date → permanent
    second = await fm.fetch_oi_large_traders(contract, "2025-01-01")
    assert first == second
    # First call: 30 fan-out fetches. Second call: served entirely from cache.
    assert mc.get.await_count == 30


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_concurrent_refresh_does_not_dedup_into_non_refresh():
    """Regression guard: a concurrent refresh=True call MUST NOT await an
    in-flight refresh=False task — otherwise the refresh caller silently
    receives stale cached data (force_today logic is skipped). The fix is
    `_r{int(refresh)}` in the _run_once dedup key."""
    import asyncio
    from services.finmind import FinMindClient
    by_date = {
        "2025-01-15": [_oi_row("2025-01-15", "call",
                                buy_top10_trader_open_interest=100,
                                sell_top10_trader_open_interest=50)],
    }

    saw_get_calls: list[dict] = []

    async def fake_get(url, params=None, **_kw):
        # Yield once so both concurrent callers race through _run_once before either resolves.
        await asyncio.sleep(0)
        saw_get_calls.append(dict(params or {}))
        d = (params or {}).get("start_date", "")
        return _fm_resp(by_date.get(d, []))

    mc = AsyncMock()
    mc.get = AsyncMock(side_effect=fake_get)

    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202501", "contract_type": "202501"}

    # Concurrent refresh=False + refresh=True with identical (contract, date).
    # Pre-fix: both share dedup key, only one fan-out runs → 30 HTTP calls total.
    # Post-fix: separate dedup keys → both run → 60 HTTP calls total.
    await asyncio.gather(
        fm.fetch_oi_large_traders(contract, "2025-01-15", refresh=False),
        fm.fetch_oi_large_traders(contract, "2025-01-15", refresh=True),
    )
    assert mc.get.await_count == 60


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_per_day_cache_write_failure_does_not_crash_gather():
    """S2 per-day cache write is best-effort: a single OSError from one
    fetch_one task must not crash the asyncio.gather across the 30-day
    fan-out. Pre-S2-guard: gather() had no return_exceptions and any disk
    failure killed the whole request.
    """
    from services.finmind import FinMindClient

    by_date = {
        "2025-01-15": [_oi_row("2025-01-15", "call",
                                buy_top10_trader_open_interest=100,
                                sell_top10_trader_open_interest=50)],
    }
    mc = _mock_http_by_start_date(by_date)
    fm = FinMindClient()
    fm._http = mc

    # Make ONLY the per-day write fail; outer aggregate write is unrelated
    # to the S2 guard (pre-existing code) so swap the instance method to
    # raise on the per-day key prefix only.
    original_write = fm._write_cache_v

    def selective_write(key, payload, version):
        if key.startswith("oi_lt_day_"):
            raise OSError("simulated per-day disk full")
        return original_write(key, payload, version)

    fm._write_cache_v = selective_write  # type: ignore[assignment]

    contract = {"option_id": "TXO", "contract_date": "202501", "contract_type": "202501"}
    out = await fm.fetch_oi_large_traders(contract, "2025-01-15")
    # Per-day write failure must not surface — caller still gets aggregate.
    assert out["contract"] == "TXO202501"
    assert "current" in out
    assert "series" in out


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_per_day_cache_amortises_date_step():
    """S2 perf: switching date by one day should only re-fetch the one new day
    (the prior 29 days overlap and hit per-day cache). Pre-S2 every call
    re-ran all 30 fan-out fetches."""
    from services.finmind import FinMindClient
    # Each date returns a stable single row so we can tell calls apart.
    by_date = {
        f"2025-01-{i:02d}": [
            _oi_row(f"2025-01-{i:02d}", "call",
                    buy_top10_trader_open_interest=100 + i,
                    sell_top10_trader_open_interest=50 + i),
        ]
        for i in range(1, 32)
    }
    mc = _mock_http_by_start_date(by_date)
    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202501", "contract_type": "202501"}
    # First call: 30 fan-out fetches for [2025-01-15, ..., 2024-12-17].
    await fm.fetch_oi_large_traders(contract, "2025-01-15")
    first_count = mc.get.await_count
    assert first_count == 30
    # Second call: end shifts +1 day. 29 of 30 days overlap → cached.
    # Only the new tip (2025-01-16) misses cache → 1 extra fetch.
    await fm.fetch_oi_large_traders(contract, "2025-01-16")
    assert mc.get.await_count == first_count + 1


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
    out = await fm.fetch_strike_volume(contract, today)
    assert out["contract"] == "TXO202607"
    assert out["date"] == today
    # strike asc (no top_n)
    assert [c["strike"] for c in out["call"]] == [22000, 22100]
    assert out["call"][0]["oi_change"] == 35200 - 33100
    assert [p["strike"] for p in out["put"]] == [21500]
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / "TXO202607_2026-06-23_strike_vol.json").exists()


# ---------------------------------------------------------------------------
# Task 3: parse_spot (台指期 spot from TaiwanFuturesDaily)
# ---------------------------------------------------------------------------


def _tx_row(date_, close, *, volume=10000,
            trading_session="position", contract_date="202607"):
    """TaiwanFuturesDaily TX row -- Phase 0b confirmed field names.

    Defaults to position session + pure-YYYYMM contract_date (the front-month);
    tests override these to exercise filter behavior.
    """
    return {"date": date_, "data_id": "TX",
            "trading_session": trading_session,
            "contract_date": contract_date,
            "open": close - 30, "max": close + 50, "min": close - 80,
            "close": close, "volume": volume, "settlement_price": close}


def test_parse_spot_picks_latest_close_and_computes_change():
    from services.finmind_options import parse_spot
    rows = [
        _tx_row("2026-06-19", 53300.0),
        _tx_row("2026-06-22", 53420.0),
    ]
    out = parse_spot(rows)
    assert out["spot"] == 53420.0
    assert out["prev_close"] == 53300.0
    assert out["change"] == pytest.approx(120.0)
    assert out["change_pct"] == pytest.approx(120.0 / 53300.0 * 100, rel=1e-4)
    assert out["as_of_date"] == "2026-06-22"
    assert out["as_of_session"] == "position"


def test_parse_spot_single_row_change_is_zero():
    from services.finmind_options import parse_spot
    out = parse_spot([_tx_row("2026-06-22", 53420.0)])
    assert out["spot"] == 53420.0
    assert out["prev_close"] is None
    assert out["change"] == 0.0
    assert out["change_pct"] == 0.0
    assert out["as_of_date"] == "2026-06-22"
    assert out["as_of_session"] == "position"


def test_parse_spot_empty_returns_none_fields():
    from services.finmind_options import parse_spot
    out = parse_spot([])
    assert out == {
        "spot": None, "prev_close": None,
        "change": None, "change_pct": None,
        "as_of_date": None, "as_of_session": None,
    }


def test_parse_spot_includes_after_market_with_position_priority_within_date():
    """Within the same date, position (13:45 close) is chronologically AFTER
    after_market (05:00 close) under FinMind's end-date convention, so the
    day-session close wins when both exist for the latest date."""
    from services.finmind_options import parse_spot
    rows = [
        _tx_row("2026-06-22", 53200.0, trading_session="after_market"),
        _tx_row("2026-06-22", 53420.0, trading_session="position"),
    ]
    out = parse_spot(rows)
    assert out["spot"] == 53420.0
    assert out["as_of_date"] == "2026-06-22"
    assert out["as_of_session"] == "position"
    # prev_close is the night session of the same date (one step earlier)
    assert out["prev_close"] == 53200.0


def test_parse_spot_picks_after_market_when_position_missing_for_latest_date():
    """If FinMind has published today's after_market (5am close) but the
    day-session row hasn't landed yet (typical 2hr publication lag after
    13:45), the dashboard should show the night close rather than fall
    back to yesterday's day session — that was the visible-staleness bug."""
    from services.finmind_options import parse_spot
    rows = [
        _tx_row("2026-06-25", 46544.0, trading_session="position"),
        _tx_row("2026-06-26", 45805.0, trading_session="after_market"),
        # Note: no 2026-06-26 position row — FinMind has not yet published it
    ]
    out = parse_spot(rows)
    assert out["spot"] == 45805.0  # 6/26 night, not 6/25 day
    assert out["as_of_date"] == "2026-06-26"
    assert out["as_of_session"] == "after_market"
    assert out["prev_close"] == 46544.0  # previous = 6/25 day session
    assert out["change"] == pytest.approx(-739.0)


def test_parse_spot_filters_spread_contract_dates():
    """Rows with spread contract_date like '202606/202607' must be dropped --
    only pure ^\\d{6}$ pattern (single-month contracts) count."""
    from services.finmind_options import parse_spot
    rows = [
        _tx_row("2026-06-22", 53420.0, contract_date="202607"),
        _tx_row("2026-06-22", 88888.0, contract_date="202606/202607"),
        _tx_row("2026-06-22", 77777.0, contract_date="202607/202608"),
    ]
    out = parse_spot(rows)
    assert out["spot"] == 53420.0


def test_parse_spot_picks_front_month_when_multiple_pure_yyyymm():
    """When 202607 and 202608 both exist for the same date, take the
    smallest contract_date (front-month) as the spot."""
    from services.finmind_options import parse_spot
    rows = [
        _tx_row("2026-06-22", 53420.0, contract_date="202607"),
        _tx_row("2026-06-22", 53480.0, contract_date="202608"),
        _tx_row("2026-06-19", 53300.0, contract_date="202607"),
        _tx_row("2026-06-19", 53360.0, contract_date="202608"),
    ]
    out = parse_spot(rows)
    assert out["spot"] == 53420.0  # 202607 wins over 202608
    assert out["prev_close"] == 53300.0  # same: 202607 on 2026-06-19
    assert out["as_of_date"] == "2026-06-22"


_SPOT_DATA_ID = "TX"  # Phase 0b confirmed -- change if probe found different


@pytest.mark.asyncio
async def test_fetch_spot_writes_cache_and_returns_shape():
    from services.finmind import FinMindClient
    rows = [
        _tx_row("2026-06-19", 53300.0),
        _tx_row("2026-06-22", 53420.0),
    ]
    mc = _mock_http(_fm_resp(rows))
    fm = FinMindClient()
    fm._http = mc
    out = await fm.fetch_spot("2026-06-22")
    assert out["date"] == "2026-06-22"
    assert out["spot"] == 53420.0
    assert out["prev_close"] == 53300.0
    assert out["change"] == pytest.approx(120.0)
    assert out["as_of_date"] == "2026-06-22"
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / f"{_SPOT_DATA_ID}_2026-06-22_spot.json").exists()


@pytest.mark.asyncio
async def test_fetch_spot_returns_cached_on_second_call():
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_resp([_tx_row("2025-01-02", 50000.0)]))
    fm = FinMindClient()
    fm._http = mc
    first = await fm.fetch_spot("2025-01-02")
    second = await fm.fetch_spot("2025-01-02")
    assert first == second
    assert mc.get.await_count == 1  # cache hit, no second HTTP call


# ============================================================================
# Backfill fetches (Phase 6 prep): settlement_history + tx_close_history
# ============================================================================

@pytest.mark.asyncio
async def test_fetch_settlement_history_parses_date_contract_price():
    """fetch_settlement_history → {date: {contract_date, price}}.
    Accepts either 'final_settlement_price' or 'settlement_price' field name
    (real schema TBD pending SC-0 probe; R14)."""
    from datetime import date as _date
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_resp([
        {"date": "2026-05-21", "contract_date": "202605",
         "final_settlement_price": 22150.0},
        {"date": "2026-04-16", "contract_date": "202604",
         "settlement_price": 21450.0},  # alternate field name
    ]))
    fm = FinMindClient()
    fm._http = mc
    result = await fm.fetch_settlement_history(_date(2026, 6, 25))
    assert result[_date(2026, 5, 21)] == {"contract_date": "202605", "price": 22150.0}
    assert result[_date(2026, 4, 16)] == {"contract_date": "202604", "price": 21450.0}


@pytest.mark.asyncio
async def test_fetch_settlement_history_caches():
    from datetime import date as _date
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_resp([
        {"date": "2026-05-21", "contract_date": "202605",
         "final_settlement_price": 22150.0},
    ]))
    fm = FinMindClient()
    fm._http = mc
    first = await fm.fetch_settlement_history(_date(2026, 6, 25))
    second = await fm.fetch_settlement_history(_date(2026, 6, 25))
    assert first == second
    assert mc.get.await_count == 1  # cache hit


@pytest.mark.asyncio
async def test_fetch_tx_close_history_filters_day_session_front_month():
    """fetch_tx_close_history → {date: front-month TX close}.
    Filters out night session + spread contracts, picks lowest contract_date
    per date (front month)."""
    from datetime import date as _date
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_resp([
        # Day-session, front-month should win
        {"date": "2026-06-23", "data_id": "TX", "contract_date": "202606",
         "trading_session": "position", "close": 22000.0},
        # Day-session, back-month — same date but later contract → dropped
        {"date": "2026-06-23", "data_id": "TX", "contract_date": "202607",
         "trading_session": "position", "close": 22100.0},
        # Night session — dropped
        {"date": "2026-06-23", "data_id": "TX", "contract_date": "202606",
         "trading_session": "after_market", "close": 22050.0},
        # Spread (non-YYYYMM) — dropped
        {"date": "2026-06-23", "data_id": "TX", "contract_date": "202606/202607",
         "trading_session": "position", "close": -100.0},
        # Day 2
        {"date": "2026-06-24", "data_id": "TX", "contract_date": "202606",
         "trading_session": "position", "close": 22050.0},
    ]))
    fm = FinMindClient()
    fm._http = mc
    closes = await fm.fetch_tx_close_history(_date(2026, 6, 25))
    assert closes == {_date(2026, 6, 23): 22000.0, _date(2026, 6, 24): 22050.0}


def test_tx_returns_from_closes_basic():
    from datetime import date as _date
    from services.finmind import FinMindClient
    closes = {
        _date(2026, 6, 23): 22000.0,
        _date(2026, 6, 24): 22050.0,  # +0.227%
        _date(2026, 6, 25): 22100.0,  # +0.227%
    }
    returns = FinMindClient._tx_returns_from_closes(closes)
    # The LATEST date has no t+1, so it's dropped (caller skip-on-missing)
    assert set(returns.keys()) == {_date(2026, 6, 23), _date(2026, 6, 24)}
    assert returns[_date(2026, 6, 23)] == pytest.approx((22050 - 22000) / 22000)
    assert returns[_date(2026, 6, 24)] == pytest.approx((22100 - 22050) / 22050)


def test_tx_returns_from_closes_skips_zero_or_negative_base():
    from datetime import date as _date
    from services.finmind import FinMindClient
    closes = {
        _date(2026, 6, 23): 0.0,        # zero base → skip
        _date(2026, 6, 24): 22050.0,
        _date(2026, 6, 25): 22100.0,
    }
    returns = FinMindClient._tx_returns_from_closes(closes)
    assert _date(2026, 6, 23) not in returns
    assert _date(2026, 6, 24) in returns


# ============================================================================
# SC-1 / SC-5: Max Pain (design v4 §4.1, brainstorm SC-1/SC-5)
# ============================================================================

def _option_row(contract_date: str, strike: int, side: str, oi: int, *,
                option_id: str = "TXO", session: str = "position",
                day: str = "2026-06-25") -> dict:
    """Synthetic TaiwanOptionDaily row matching real-schema fields."""
    return {
        "date": day, "option_id": option_id, "contract_date": contract_date,
        "strike_price": float(strike), "call_put": side,
        "open_interest": oi, "volume": 0, "trading_session": session,
    }


def test_parse_max_pain_basic():
    """SC-1: symmetric OI distribution → Max Pain at ATM strike."""
    from services.finmind_options import parse_max_pain
    rows = [
        _option_row("202607", 20000, "call", oi=100),
        _option_row("202607", 21000, "call", oi=500),
        _option_row("202607", 22000, "call", oi=300),
        _option_row("202607", 20000, "put",  oi=300),
        _option_row("202607", 21000, "put",  oi=500),
        _option_row("202607", 22000, "put",  oi=100),
    ]
    result = parse_max_pain(rows, contract_date="202607")
    assert result["max_pain"] == 21000
    assert result["strike_count"] == 3


def test_parse_max_pain_union_strikes_asymmetric_otm():
    """SC-1 / design F1: candidate K = union(call_strikes, put_strikes).

    Without union (naive intersection), deep-OTM strikes that trade on only
    one side get dropped → Max Pain biased toward center. Real TXO data
    routinely has one-sided deep OTM strikes.
    """
    from services.finmind_options import parse_max_pain
    rows = [
        _option_row("202607", 18000, "put",  oi=400),   # put-only deep OTM
        _option_row("202607", 21000, "call", oi=200),
        _option_row("202607", 21000, "put",  oi=200),
        _option_row("202607", 24000, "call", oi=400),   # call-only deep OTM
    ]
    result = parse_max_pain(rows, contract_date="202607")
    assert result["max_pain"] == 21000
    assert result["strikes_with_call_oi_only"] == 1
    assert result["strikes_with_put_oi_only"] == 1
    assert result["strike_count"] == 3


def test_parse_max_pain_strict_contract_filter():
    """SC-1 / design F2: strict contract_date equality filter.

    Without it, monthly OI bleeds into weekly Max Pain (and vice versa).
    """
    from services.finmind_options import parse_max_pain
    rows = [
        # Monthly OI — would shift Max Pain if leaked in
        _option_row("202607",   20000, "call", oi=10000),
        _option_row("202607",   20000, "put",  oi=10000),
        # Weekly contract (the filter target) — symmetric at 22000
        _option_row("202607W2", 21000, "call", oi=100),
        _option_row("202607W2", 22000, "call", oi=200),
        _option_row("202607W2", 23000, "call", oi=100),
        _option_row("202607W2", 21000, "put",  oi=100),
        _option_row("202607W2", 22000, "put",  oi=200),
        _option_row("202607W2", 23000, "put",  oi=100),
    ]
    result = parse_max_pain(rows, contract_date="202607W2")
    assert result["max_pain"] == 22000


def test_parse_max_pain_total_loss_includes_multiplier_50():
    """SC-1 / design F14: TXO multiplier = NT$50 per point; total_loss_ntd
    must be in NTD (not raw OI-point units).

    Setup: at K=21000 (the ATM-ish optimum), call_loss = 100×1000 = 100k
    points, put_loss = 100×1000 = 100k points, total 200k points × 50 = 10M NTD.
    """
    from services.finmind_options import parse_max_pain
    rows = [
        _option_row("202607", 20000, "call", oi=100),
        _option_row("202607", 21000, "call", oi=100),
        _option_row("202607", 21000, "put",  oi=100),
        _option_row("202607", 22000, "put",  oi=100),
    ]
    result = parse_max_pain(rows, contract_date="202607")
    assert result["max_pain"] == 21000  # unique minimum (200k pts vs 300k at 20000/22000)
    assert result["total_loss_ntd"] == 10_000_000  # 200_000 points × NT$50


def test_parse_max_pain_hit_rate_uses_t_minus_1():
    """SC-5 / design F3: avoid look-ahead bias by aligning settlement_t
    against max_pain_(t-1), NOT max_pain_t. Settlement-day OI collapses,
    making max_pain_t mechanically ≈ settlement (false 100% hit)."""
    from services.finmind_options import parse_max_pain_hit_rate
    oi_by_trading_day = {
        date(2026, 6, 16): [  # t-1: bias toward 21000
            _option_row("202606", 21000, "call", oi=500, day="2026-06-16"),
            _option_row("202606", 22000, "call", oi=100, day="2026-06-16"),
            _option_row("202606", 21000, "put",  oi=100, day="2026-06-16"),
            _option_row("202606", 22000, "put",  oi=500, day="2026-06-16"),
        ],
        date(2026, 6, 17): [  # t: OI collapsed, max_pain_t ≈ settlement_t
            _option_row("202606", 22000, "call", oi=10, day="2026-06-17"),
            _option_row("202606", 22000, "put",  oi=10, day="2026-06-17"),
        ],
    }
    settlements = {date(2026, 6, 17): {"contract_date": "202606", "price": 22000.0}}
    result = parse_max_pain_hit_rate(
        oi_by_trading_day=oi_by_trading_day, settlements=settlements,
    )
    assert result["samples"] == 1
    h = result["history"][0]
    assert h["max_pain_at_t_minus_1"] == 21000  # NOT 22000
    assert abs(h["deviation_pct"]) > 0.04  # ≈ 4.5%, not 0
    assert result["hit_within_1pct"] == 0.0
    assert result["hit_within_2pct"] == 0.0


def test_parse_max_pain_hit_rate_excludes_pending_settlement():
    """SC-5 / design F10: settlement_price=None → exclude, flag pending."""
    from services.finmind_options import parse_max_pain_hit_rate
    oi_by_trading_day = {
        date(2026, 6, 16): [_option_row("202606", 22000, "call", oi=100, day="2026-06-16")],
    }
    settlements = {
        date(2026, 6, 17): {"contract_date": "202606", "price": None},
    }
    result = parse_max_pain_hit_rate(
        oi_by_trading_day=oi_by_trading_day, settlements=settlements,
    )
    assert result["samples"] == 0
    assert result["latest_settlement_pending"] is True


def test_parse_max_pain_hit_rate_empty_inputs():
    """SC-5 insufficient_data path."""
    from services.finmind_options import parse_max_pain_hit_rate
    result = parse_max_pain_hit_rate(oi_by_trading_day={}, settlements={})
    assert result["samples"] == 0
    assert result["history"] == []
    assert result["latest_settlement_pending"] is False


# ============================================================================
# SC-2 / SC-6: OI Walls (design v4 §4.2)
# ============================================================================

def test_parse_oi_walls_static_tie_break_by_spot():
    """SC-2 / F16 + options-page-v2 SC-1(該變):tie-break 在**價外側候選**內
    取最近 spot;價內側大 OI 不再參賽。"""
    from services.finmind_options import parse_oi_walls
    rows_today = [
        _option_row("202607", 21000, "call", oi=900),  # below spot — excluded (OTM rule)
        _option_row("202607", 22500, "call", oi=500),
        _option_row("202607", 23500, "call", oi=500),  # tie at 500
        _option_row("202607", 20000, "put", oi=300),
    ]
    result = parse_oi_walls(
        rows_today=rows_today, rows_history=[], contract_date="202607",
        delta_window=5, spot=22000.0,
    )
    # OTM candidates {22500, 23500} tie at 500 — closer to spot 22500 wins
    assert result["static_call_wall"]["strike"] == 22500
    assert result["static_call_wall"]["oi"] == 500


def test_parse_oi_walls_static_call_wall_otm_only():
    """options-page-v2 SC-1:Call Wall 只從 strike >= spot 找 — 行情大漲後
    價內殘留大 OI 不能再被標成「壓力」。"""
    from services.finmind_options import parse_oi_walls
    rows_today = [
        _option_row("202607", 20000, "call", oi=9000),  # ITM leftovers, biggest OI
        _option_row("202607", 22500, "call", oi=400),
        _option_row("202607", 21000, "put", oi=300),
    ]
    result = parse_oi_walls(
        rows_today=rows_today, rows_history=[], contract_date="202607",
        delta_window=5, spot=22000.0,
    )
    assert result["static_call_wall"]["strike"] == 22500


def test_parse_oi_walls_static_put_wall_otm_only():
    """options-page-v2 SC-1:Put Wall 只從 strike <= spot 找。"""
    from services.finmind_options import parse_oi_walls
    rows_today = [
        _option_row("202607", 23000, "put", oi=9000),  # above spot — excluded
        _option_row("202607", 21500, "put", oi=400),
        _option_row("202607", 22500, "call", oi=300),
    ]
    result = parse_oi_walls(
        rows_today=rows_today, rows_history=[], contract_date="202607",
        delta_window=5, spot=22000.0,
    )
    assert result["static_put_wall"]["strike"] == 21500


def test_parse_oi_walls_no_otm_candidate_returns_none_with_warning():
    """options-page-v2 SC-1:該側無價外 OI → wall None + 分側 warning;
    band_width_pct 為 None(不是 0,也不是負數)。"""
    from services.finmind_options import parse_oi_walls
    rows_today = [
        _option_row("202607", 20000, "call", oi=500),  # all call OI below spot
        _option_row("202607", 21000, "put", oi=300),
    ]
    result = parse_oi_walls(
        rows_today=rows_today, rows_history=[], contract_date="202607",
        delta_window=5, spot=22000.0,
    )
    assert result["static_call_wall"] is None
    assert result["static_put_wall"]["strike"] == 21000
    assert result["band_width_pct"] is None
    assert "static_wall_no_otm_candidate_call" in result["data_quality_warnings"]


def test_parse_oi_walls_band_width_non_negative():
    """options-page-v2 SC-1:OTM 限制後 band_width_pct 有值恆 >= 0。"""
    from services.finmind_options import parse_oi_walls
    rows_today = [
        _option_row("202607", 22500, "call", oi=500),
        _option_row("202607", 21500, "put", oi=400),
    ]
    result = parse_oi_walls(
        rows_today=rows_today, rows_history=[], contract_date="202607",
        delta_window=5, spot=22000.0,
    )
    assert result["band_width_pct"] is not None
    assert result["band_width_pct"] >= 0
    assert result["static_call_wall"]["strike"] >= result["static_put_wall"]["strike"]


def test_parse_oi_walls_spot_none_returns_all_walls_none_only_no_spot_warning():
    """options-page-v2 SC-1 / R1+R2:spot 缺(TX 未發布)→ 四面牆全 None、
    band None,warnings 只含 oi_walls_no_spot — 不得出現側別 no_otm_candidate
    (缺 spot ≠ 無候選)也不得出現 dynamic_wall_no_net_increase。"""
    from services.finmind_options import parse_oi_walls
    rows_today = [
        _option_row("202607", 22500, "call", oi=500),
        _option_row("202607", 21500, "put", oi=400),
    ]
    result = parse_oi_walls(
        rows_today=rows_today, rows_history=[], contract_date="202607",
        delta_window=5, spot=None,
    )
    assert result["static_call_wall"] is None
    assert result["static_put_wall"] is None
    assert result["dynamic_call_wall"] is None
    assert result["dynamic_put_wall"] is None
    assert result["band_width_pct"] is None
    assert result["data_quality_warnings"] == ["oi_walls_no_spot"]


def test_parse_oi_walls_dynamic_net_increase_first_last_diff():
    """options-page-v2 SC-2(該變,原 activity Σ|Δ| 語意反轉):dynamic wall =
    window 首尾**淨增倉** max(oi_end − oi_start, 只取正)。建倉平倉互抵的
    高活動 strike(churn)不再被選 — 語意 = 新錢正在進駐的價位。"""
    from services.finmind_options import parse_oi_walls
    # Strike A: OI ramps 100→500 (net +400). Strike B: churns 100→500→100→500→100
    # (net 0). Old activity metric picked B; net-increase must pick A.
    history = [
        [_option_row("202607", 21000, "call", oi=100, day="2026-06-19"),
         _option_row("202607", 22000, "call", oi=100, day="2026-06-19")],
        [_option_row("202607", 21000, "call", oi=200, day="2026-06-20"),
         _option_row("202607", 22000, "call", oi=500, day="2026-06-20")],
        [_option_row("202607", 21000, "call", oi=300, day="2026-06-23"),
         _option_row("202607", 22000, "call", oi=100, day="2026-06-23")],
        [_option_row("202607", 21000, "call", oi=400, day="2026-06-24"),
         _option_row("202607", 22000, "call", oi=500, day="2026-06-24")],
    ]
    today = [
        _option_row("202607", 21000, "call", oi=500),
        _option_row("202607", 22000, "call", oi=100),
    ]
    result = parse_oi_walls(
        rows_today=today, rows_history=history, contract_date="202607",
        delta_window=5, spot=21500.0,
    )
    assert result["dynamic_call_wall"]["strike"] == 21000  # A = net-increase king
    assert result["dynamic_call_wall"]["window_net_increase_oi"] == 400
    assert "window_activity_oi" not in result["dynamic_call_wall"]  # renamed contract


def test_parse_oi_walls_dynamic_all_nonpositive_returns_none():
    """options-page-v2 SC-2:全部 strike 淨增倉 <= 0 → dynamic wall None +
    dynamic_wall_no_net_increase warning(取代舊 dynamic_wall_no_activity)。"""
    from services.finmind_options import parse_oi_walls
    today = [_option_row("202607", 22000, "call", oi=300)]
    history = [
        [_option_row("202607", 22000, "call", oi=500, day="2026-06-23")],
        [_option_row("202607", 22000, "call", oi=400, day="2026-06-24")],
    ]
    result = parse_oi_walls(
        rows_today=today, rows_history=history, contract_date="202607",
        delta_window=2, spot=22000.0,
    )
    assert result["dynamic_call_wall"] is None
    warnings = result["data_quality_warnings"]
    assert "dynamic_wall_no_net_increase" in warnings
    assert "dynamic_wall_no_activity" not in warnings


def test_parse_oi_walls_dynamic_new_listing_strike_full_increase():
    """options-page-v2 SC-2 / impl-review R5:window 起點沒掛牌的 strike 視
    oi_start=0,今日 OI 全額算淨增倉(語意=新錢);partial_window 沿用。"""
    from services.finmind_options import parse_oi_walls
    history = [
        [_option_row("202607", 21000, "call", oi=300, day="2026-06-24")],  # B 未掛牌
    ]
    today = [
        _option_row("202607", 21000, "call", oi=350),   # net +50
        _option_row("202607", 22000, "call", oi=800),   # new listing → net +800
    ]
    result = parse_oi_walls(
        rows_today=today, rows_history=history, contract_date="202607",
        delta_window=5, spot=21500.0,
    )
    assert result["dynamic_call_wall"]["strike"] == 22000
    assert result["dynamic_call_wall"]["window_net_increase_oi"] == 800
    assert result["dynamic_call_wall"]["partial_window"] is True


def test_parse_oi_walls_partial_window_for_young_weekly():
    """SC-2 / N4: young weekly with days_since_listing < delta_window →
    partial_window=true; warning emitted."""
    from services.finmind_options import parse_oi_walls
    today = [_option_row("202607W2", 22000, "call", oi=500)]
    history = [
        [_option_row("202607W2", 22000, "call", oi=300, day="2026-06-23")],
    ]  # only 1 day of history (contract just listed yesterday)
    result = parse_oi_walls(
        rows_today=today, rows_history=history, contract_date="202607W2",
        delta_window=5, spot=22000.0,
    )
    assert result["dynamic_call_wall"]["partial_window"] is True
    warnings = result.get("data_quality_warnings", [])
    assert "dynamic_wall_partial_window" in warnings


async def test_fetch_oi_walls_spot_missing_passes_none_not_zero(monkeypatch):
    """options-page-v2 R1(P0 lock,mutation-verified):fetch_oi_walls 在
    spot 缺時必須把 None 傳進 parser — 舊 `or 0.0` coercion 會讓 put 側
    候選恆空,產出假 static_wall_no_otm_candidate_put + 未過濾 call wall。"""
    import services.trading_calendar as tc
    from services.finmind import get_finmind

    client = get_finmind()

    async def fake_days(end, n):
        return [date(2026, 6, 25), date(2026, 6, 26)]

    async def fake_window(dates, end_date, refresh=False):
        return {
            "2026-06-25": [
                _option_row("202607", 22000, "call", oi=500, day="2026-06-25"),
                _option_row("202607", 21000, "put", oi=400, day="2026-06-25"),
            ],
        }

    async def fake_spot(date_str, refresh=False):
        return {"spot": None, "as_of_date": None}

    async def fake_settlements(end, refresh=False):
        return {}

    async def fake_closes(end, refresh=False):
        return {}

    monkeypatch.setattr(tc, "get_trading_days", fake_days)
    monkeypatch.setattr(client, "fetch_taiwan_option_daily_window", fake_window)
    monkeypatch.setattr(client, "fetch_spot", fake_spot)
    monkeypatch.setattr(client, "fetch_settlement_history", fake_settlements)
    monkeypatch.setattr(client, "fetch_tx_close_history", fake_closes)

    out = await client.fetch_oi_walls(
        {"option_id": "TXO", "contract_date": "202607"}, "2026-06-26",
    )
    cur = out["current"]
    assert cur["static_call_wall"] is None
    assert cur["static_put_wall"] is None
    assert cur["dynamic_call_wall"] is None
    assert cur["dynamic_put_wall"] is None
    assert cur["band_width_pct"] is None
    assert "oi_walls_no_spot" in out["data_quality_warnings"]
    assert "static_wall_no_otm_candidate_call" not in out["data_quality_warnings"]
    assert "static_wall_no_otm_candidate_put" not in out["data_quality_warnings"]


def test_parse_oi_walls_hit_rate_t_minus_1():
    """SC-6 / F3(該變:closes_by_date 改必要語意):settlement inside
    [put_wall, call_wall] computed on T-1,牆選擇以 T-1 close 為 spot。"""
    from services.finmind_options import parse_oi_walls_hit_rate
    oi_by_trading_day = {
        # 2026-06-16: walls put=20000, call=22000 (settlement_price 21000 inside)
        date(2026, 6, 16): [
            _option_row("202606", 20000, "put",  oi=500, day="2026-06-16"),
            _option_row("202606", 22000, "call", oi=500, day="2026-06-16"),
        ],
        date(2026, 6, 17): [  # T (settlement day) - OI collapsed (irrelevant)
            _option_row("202606", 22000, "call", oi=10, day="2026-06-17"),
        ],
    }
    settlements = {date(2026, 6, 17): {"contract_date": "202606", "price": 21000.0}}
    result = parse_oi_walls_hit_rate(
        oi_by_trading_day=oi_by_trading_day, settlements=settlements,
        closes_by_date={date(2026, 6, 16): 21000.0},
    )
    assert result["samples"] == 1
    assert result["pct_settled_inside_band"] == 1.0
    assert result["history"][0]["inside_band"] is True
    assert result["history"][0]["put_wall_at_t_minus_1"] == 20000
    assert result["history"][0]["call_wall_at_t_minus_1"] == 22000
    assert result["dropped_no_close"] == 0


def test_parse_oi_walls_hit_rate_otm_restricted_uses_t1_close():
    """options-page-v2 SC-3:T-1 牆選擇套 SC-1 側別限制(以 T-1 close 為
    spot)— 價外規則下,高於 close 的大 put OI 不能當 Put Wall。"""
    from services.finmind_options import parse_oi_walls_hit_rate
    oi_by_trading_day = {
        date(2026, 6, 16): [
            _option_row("202606", 23000, "put",  oi=900, day="2026-06-16"),  # above close → excluded
            _option_row("202606", 20000, "put",  oi=500, day="2026-06-16"),
            _option_row("202606", 22000, "call", oi=500, day="2026-06-16"),
        ],
    }
    settlements = {date(2026, 6, 17): {"contract_date": "202606", "price": 21000.0}}
    result = parse_oi_walls_hit_rate(
        oi_by_trading_day=oi_by_trading_day, settlements=settlements,
        closes_by_date={date(2026, 6, 16): 21000.0},
    )
    assert result["samples"] == 1
    assert result["history"][0]["put_wall_at_t_minus_1"] == 20000  # NOT 23000
    assert result["history"][0]["inside_band"] is True


def test_parse_oi_walls_hit_rate_drops_samples_without_close():
    """options-page-v2 SC-3 / R9:t-1 無 close 的樣本剔除並計入
    dropped_no_close(固定欄位;warning 字串由 fetch 層附加)。"""
    from services.finmind_options import parse_oi_walls_hit_rate
    oi_by_trading_day = {
        date(2026, 6, 16): [
            _option_row("202606", 20000, "put",  oi=500, day="2026-06-16"),
            _option_row("202606", 22000, "call", oi=500, day="2026-06-16"),
        ],
        date(2026, 7, 14): [
            _option_row("202607", 20500, "put",  oi=500, day="2026-07-14"),
            _option_row("202607", 22500, "call", oi=500, day="2026-07-14"),
        ],
    }
    settlements = {
        date(2026, 6, 17): {"contract_date": "202606", "price": 21000.0},
        date(2026, 7, 15): {"contract_date": "202607", "price": 21500.0},
    }
    # closes only for the first sample's T-1
    result = parse_oi_walls_hit_rate(
        oi_by_trading_day=oi_by_trading_day, settlements=settlements,
        closes_by_date={date(2026, 6, 16): 21000.0},
    )
    assert result["samples"] == 1
    assert result["dropped_no_close"] == 1
    assert result["history"][0]["settlement_date"] == "2026-06-17"


# ============================================================================
# SC-3 / SC-7: PCR walk-forward + next-day TX return stats (design v4 §4.3/4.4)
# ============================================================================

def _pcr_row(contract_date: str, strike: int, side: str, oi: int, day: str) -> dict:
    return _option_row(contract_date, strike, side, oi, day=day)


def test_parse_pcr_history_per_contract_vs_all_months():
    """SC-3: per_contract restricts to one contract_date; all_months sums all."""
    from services.finmind_options import parse_pcr_history
    rows_by_day = {
        date(2026, 6, 25): [
            _pcr_row("202607", 21000, "call", 200, "2026-06-25"),
            _pcr_row("202607", 21000, "put",  300, "2026-06-25"),
            _pcr_row("202608", 21000, "call", 100, "2026-06-25"),
            _pcr_row("202608", 21000, "put",  500, "2026-06-25"),
        ],
    }
    out_per = parse_pcr_history(rows_by_day, scope="per_contract", contract_date="202607")
    assert out_per == [(date(2026, 6, 25), 300 / 200)]

    out_all = parse_pcr_history(rows_by_day, scope="all_months", contract_date=None)
    # all puts = 300+500=800, all calls = 200+100=300
    assert out_all == [(date(2026, 6, 25), 800 / 300)]


def test_parse_pcr_walk_forward_no_lookahead():
    """SC-3 / F4: percentile_t computed strictly against past window.
    Adversarial fixture: a tiny series where today is the MAX. If naive
    impl includes today in its own past window, percentile would be 100.
    Walk-forward must exclude today → no rank-vs-self contamination."""
    from services.finmind_options import parse_pcr_walk_forward_percentile
    # Tiny series where last value is the max
    pcr_history = [
        (date(2026, 6, 1), 0.5),
        (date(2026, 6, 2), 0.6),
        (date(2026, 6, 3), 0.7),
        (date(2026, 6, 4), 0.8),
        (date(2026, 6, 5), 0.9),
        (date(2026, 6, 6), 1.0),
        (date(2026, 6, 9), 2.0),  # extreme high, but should percentile correctly
    ]
    classified, _ = parse_pcr_walk_forward_percentile(
        pcr_history, high_pct=70.0, low_pct=30.0, min_samples=5,
    )
    # Need to find 2026-06-09 entry — first 5 dates skipped due to min_samples
    by_date = {d: (p, pct, r) for d, p, pct, r in classified}
    # 2026-06-09: past_window = 6 values [0.5..1.0], 2.0 is far above max
    # percentile = 100 (above all past)
    p, pct, region = by_date[date(2026, 6, 9)]
    assert p == 2.0
    assert pct == 100.0  # 2.0 > all of past_window → top of distribution
    assert region == "high"


def test_parse_pcr_walk_forward_emits_single_warmup_warning_not_per_day():
    """SC-3 / F14: warmup days emit ONE consolidated warning, not N per-day strings."""
    from services.finmind_options import parse_pcr_walk_forward_percentile
    pcr_history = [
        (date(2026, 6, d), 0.5 + d * 0.1) for d in range(1, 11)  # 10 days
    ]
    _, warnings = parse_pcr_walk_forward_percentile(
        pcr_history, high_pct=70.0, low_pct=30.0, min_samples=5,
    )
    # First 5 days skip; warmup_skipped warning with count=5
    warmup_warns = [w for w in warnings if w.startswith("pcr_walk_forward_warmup_skipped_first_")]
    assert len(warmup_warns) == 1
    assert "5" in warmup_warns[0]


def test_parse_pcr_next_day_stats_no_pnl_no_sharpe():
    """SC-7 / F2-testability: payload contains stats per region, NOT P&L curve or Sharpe."""
    from services.finmind_options import parse_pcr_next_day_stats
    classified = [
        (date(2026, 6, 1), 0.5, 20.0, "low"),
        (date(2026, 6, 2), 0.9, 80.0, "high"),
    ]
    tx_returns = {date(2026, 6, 1): -0.01, date(2026, 6, 2): 0.02,
                  date(2026, 6, 3): 0.005}
    result, _ = parse_pcr_next_day_stats(classified, tx_returns)
    assert "pnl_curve" not in result
    assert "cumulative_strategy_pnl" not in result
    assert "sharpe" not in result


def test_parse_pcr_next_day_stats_payload_schema_exact():
    """SC-7 / F17: positive schema lock — region dicts have exactly
    {mean_pct, std_pct, hit_positive, samples}."""
    from services.finmind_options import parse_pcr_next_day_stats
    classified = [(date(2026, 6, d), 0.7, 75.0, "high") for d in range(1, 12)]
    tx_returns = {date(2026, 6, d): 0.001 * d for d in range(1, 13)}
    result, _ = parse_pcr_next_day_stats(classified, tx_returns)
    expected_keys = {"mean_pct", "std_pct", "hit_positive", "samples"}
    assert set(result["high_region"].keys()) == expected_keys
    assert set(result["neutral_region"].keys()) == expected_keys
    assert set(result["low_region"].keys()) == expected_keys


def test_parse_pcr_next_day_stats_emits_low_power_warning_when_samples_lt_30():
    """SC-7 / N8: samples < 30 in any region → pcr_stats_low_power_{region}."""
    from services.finmind_options import parse_pcr_next_day_stats
    classified = [
        (date(2026, 6, 1), 0.9, 80.0, "high"),
        (date(2026, 6, 2), 0.5, 25.0, "low"),
    ]
    tx_returns = {date(2026, 6, 1): 0.01, date(2026, 6, 2): -0.005,
                  date(2026, 6, 3): 0.01}
    _, warnings = parse_pcr_next_day_stats(classified, tx_returns)
    assert "pcr_stats_low_power_high" in warnings
    assert "pcr_stats_low_power_low" in warnings


def test_parse_pcr_next_day_stats_handles_missing_tx_returns_t_plus_1():
    """SC-7 / N9: tx_returns missing for t (next-day return uncomputable
    because t+1 TaiwanFuturesDaily row absent) → caller omits the key,
    parser drops sample silently. Warning if > 5% dropped.

    Convention: caller pre-aligns tx_returns[t] = ret(t → t+1). If t+1 close
    is missing, caller omits tx_returns[t]. Parser just does dict lookup.
    """
    from services.finmind_options import parse_pcr_next_day_stats
    classified = [
        (date(2026, 6, 1), 0.7, 75.0, "high"),
        (date(2026, 6, 2), 0.8, 78.0, "high"),  # tx_returns[06-02] absent
    ]
    tx_returns = {date(2026, 6, 1): 0.01}  # 06-02 omitted (06-03 close missing)
    result, warnings = parse_pcr_next_day_stats(classified, tx_returns)
    # 1 of 2 samples dropped = 50% > 5% → warning
    assert result["high_region"]["samples"] == 1
    assert "next_day_stats_dropped_samples_5pct" in warnings


# ============================================================================
# SC-4 / SC-8: Institutional + foreign correlation (design v4 §4.5 / §4.6)
# ============================================================================


def _inst_row(date_s: str, institution: str, side: str, buy: int, sell: int) -> dict:
    """Build a synthetic TaiwanOptionInstitutionalInvestors[AfterHours] row.

    Schema based on FinMind option_id + put_call + buy/sell open interest
    convention. Note: real field names TBD pending SC-0 token refresh
    (R14 / R6 — parser docstring carries field_name_unverified marker).
    """
    return {
        "date": date_s, "option_id": "TXO", "institution": institution,
        "put_call": side, "buy_open_interest": buy, "sell_open_interest": sell,
    }


def test_parse_institutional_uses_dealer_not_prop():
    """SC-4 / F3-integration: 自營商 keyed as 'dealer' (matches existing
    chip-data.ts convention), NOT 'prop'."""
    from services.finmind_options import parse_institutional
    rows_day = [
        _inst_row("2026-06-25", "外資", "call", 1000, 500),
        _inst_row("2026-06-25", "外資", "put",  300, 800),
        _inst_row("2026-06-25", "自營商", "call", 200, 100),
        _inst_row("2026-06-25", "自營商", "put",  150, 50),
        _inst_row("2026-06-25", "投信", "call", 80, 40),
        _inst_row("2026-06-25", "投信", "put",  20, 60),
    ]
    result = parse_institutional(
        rows_day=rows_day, rows_night=[], target_date=date(2026, 6, 25),
    )
    # Key names: foreign / dealer / trust (NOT prop, NOT trust_investment)
    assert set(result["current"].keys()) >= {"foreign", "dealer", "trust"}
    assert "prop" not in result["current"]
    assert result["current"]["foreign"]["call_net"] == 1000 - 500
    assert result["current"]["dealer"]["call_net"] == 200 - 100


def test_parse_institutional_after_hours_none_pre_2021_10():
    """SC-4 / F12: AfterHours unavailable before 2021-10-13.
    Target date pre-cutoff → session_breakdown.after_hours = None."""
    from services.finmind_options import parse_institutional
    rows_day = [_inst_row("2020-06-25", "外資", "call", 100, 50)]
    result = parse_institutional(
        rows_day=rows_day, rows_night=None,
        target_date=date(2020, 6, 25),  # before 2021-10-13 cutoff
    )
    assert result["current"]["session_breakdown"]["after_hours"] is None


def test_parse_institutional_correlation_excludes_dealer_trust_from_correlation_payload():
    """SC-8 / F10-testability scope guard: correlation dict has ONLY foreign-vs-TX,
    NEVER dealer/trust correlations leak in. Even with dealer/trust in
    input fixture, output stays scoped to foreign."""
    from services.finmind_options import parse_institutional_correlation
    foreign_history = [
        {"date": date(2026, 6, d), "foreign_call_net": d * 10,
         "dealer_call_net": d * 5, "trust_call_net": d * 2}
        for d in range(1, 31)
    ]
    tx_returns = {date(2026, 6, d): 0.001 * d for d in range(1, 31)}
    result, _ = parse_institutional_correlation(
        foreign_history=foreign_history, tx_returns=tx_returns, corr_window=20,
    )
    assert "dealer" not in result
    assert "trust" not in result
    assert "dealer_correlation" not in result
    assert "trust_correlation" not in result


def test_parse_institutional_correlation_uses_raw_flow_default():
    """SC-8 / N3: feature_transformation defaults to 'raw_flow' (foreign.call_net
    directly correlated with next_day TX return)."""
    from services.finmind_options import parse_institutional_correlation
    foreign_history = [
        {"date": date(2026, 6, d), "foreign_call_net": d * 10}
        for d in range(1, 31)
    ]
    tx_returns = {date(2026, 6, d): 0.001 * d for d in range(1, 31)}
    result, _ = parse_institutional_correlation(
        foreign_history=foreign_history, tx_returns=tx_returns, corr_window=20,
    )
    assert result["feature_transformation"] == "raw_flow"


def test_parse_institutional_correlation_emits_sample_small_warning():
    """SC-8: < 30 effective samples → correlation_sample_small warning."""
    from services.finmind_options import parse_institutional_correlation
    foreign_history = [
        {"date": date(2026, 6, d), "foreign_call_net": d * 10}
        for d in range(1, 11)  # only 10 days
    ]
    tx_returns = {date(2026, 6, d): 0.001 * d for d in range(1, 11)}
    _, warnings = parse_institutional_correlation(
        foreign_history=foreign_history, tx_returns=tx_returns, corr_window=10,
    )
    assert "correlation_sample_small" in warnings
