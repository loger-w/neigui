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
