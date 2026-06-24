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


def test_parse_strike_volume_returns_all_volume_strikes_sorted_by_strike_asc():
    """Redesign drops top_n - return every volume>0 strike, sorted by strike asc."""
    from services.finmind_options import parse_strike_volume
    today = "2026-06-23"
    rows = [
        _od_row(today, "202607", "call", 53500, 1200, 8410),
        _od_row(today, "202607", "call", 50000,  165, 1240),
        _od_row(today, "202607", "call", 52000,  240, 2680),
        _od_row(today, "202607", "call", 51000,    0, 1380),  # zero -- drop
        _od_row(today, "202607", "put",  51500,  209, 5180),
        _od_row(today, "202607", "put",  50000,  364, 8120),
    ]
    out = parse_strike_volume(rows, "202607")  # NOTE: no top_n
    # All call strikes with volume > 0, sorted ascending
    assert [c["strike"] for c in out["call"]] == [50000, 52000, 53500]
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


def test_parse_strike_volume_drops_zero_volume_rows():
    """Phase 0 noted ~70% of TXO rows have volume=0 (illiquid OTM strikes).
    Those should never appear in the output."""
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000,  10, 5),
        _od_row("2026-06-23", "202607", "call", 22100,   0, 7),
        _od_row("2026-06-23", "202607", "call", 22200,   0, 9),
    ]
    out = parse_strike_volume(rows, "202607")
    assert len(out["call"]) == 1
    assert out["call"][0]["strike"] == 22000


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


@pytest.fixture(autouse=True)
def _reset_singleton(tmp_path, monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "test-token")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    import services.finmind as mod
    mod._client = None
    mod._fm_limiter = None


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


def test_parse_spot_single_row_change_is_zero():
    from services.finmind_options import parse_spot
    out = parse_spot([_tx_row("2026-06-22", 53420.0)])
    assert out["spot"] == 53420.0
    assert out["prev_close"] is None
    assert out["change"] == 0.0
    assert out["change_pct"] == 0.0
    assert out["as_of_date"] == "2026-06-22"


def test_parse_spot_empty_returns_none_fields():
    from services.finmind_options import parse_spot
    out = parse_spot([])
    assert out == {
        "spot": None, "prev_close": None,
        "change": None, "change_pct": None,
        "as_of_date": None,
    }


def test_parse_spot_filters_after_market_session():
    """Rows with trading_session=after_market are ignored: night session
    has settlement_price=0 noise and we want only the day-session close."""
    from services.finmind_options import parse_spot
    rows = [
        _tx_row("2026-06-22", 53420.0, trading_session="position"),
        _tx_row("2026-06-22", 99999.0, trading_session="after_market"),
    ]
    out = parse_spot(rows)
    assert out["spot"] == 53420.0
    assert out["as_of_date"] == "2026-06-22"


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
