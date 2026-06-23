"""Pure helpers for TXO options: contract enumeration + dataset parsing.

Sister to services/finmind.py; that module owns HTTP + cache + rate-limit,
this one owns the data-shape logic so it can be unit-tested without I/O.
"""

from __future__ import annotations

from datetime import date, timedelta

_CACHE_VERSION_OPTIONS = 1


def _third_wednesday(year: int, month: int) -> date:
    """Monthly TXO settlement = the third Wednesday of that month."""
    d = date(year, month, 1)
    # weekday(): Mon=0 .. Sun=6; Wed=2.
    first_wed = d + timedelta(days=(2 - d.weekday()) % 7)
    return first_wed + timedelta(days=14)


def _next_wednesday(d: date) -> date:
    """Smallest Wednesday strictly greater than d."""
    return d + timedelta(days=((2 - d.weekday()) % 7) or 7)


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


def list_active_contracts(today: date) -> list[dict]:
    """Return the seven contracts visible in the picker on `today`:
    weekly W1..W4 + monthly M0..M2. Weeks settled today are excluded.

    Phase 0 confirmed (spec §"Phase 0 Schema Validation Result"):
    - option_id is always "TXO" for TAIEX index options
    - monthly contract_date == YYYYMM, weekly contract_date == YYYYMMW{ordinal_in_month}
    - monthly contract_type == YYYYMM (same as date), weekly contract_type == "week"
      (FinMind aggregates all weekly OI under a single contract_type, no per-week split)
    """
    m0_settle = _third_wednesday(today.year, today.month)
    if today > m0_settle:
        m0_anchor = _add_months(date(today.year, today.month, 1), 1)
    else:
        m0_anchor = date(today.year, today.month, 1)
    m0 = m0_anchor
    m1 = _add_months(m0, 1)
    m2 = _add_months(m0, 3)
    monthlies = []
    for slot, anchor in [("M0", m0), ("M1", m1), ("M2", m2)]:
        sett = _third_wednesday(anchor.year, anchor.month)
        yyyymm = f"{anchor.year:04d}{anchor.month:02d}"
        monthlies.append({
            "slot": slot, "kind": "monthly",
            "option_id": "TXO",
            "contract_date": yyyymm,
            "contract_type": yyyymm,
            "label": f"{anchor.year}/{anchor.month:02d} 月選",
            "settlement": sett.isoformat(),
        })

    monthly_setts = {m["settlement"] for m in monthlies}
    cursor = today
    weeklies: list[dict] = []
    for i in range(1, 5):
        nxt = _next_wednesday(cursor)
        while nxt.isoformat() in monthly_setts:
            nxt = _next_wednesday(nxt)
        ordinal = (nxt.day - 1) // 7 + 1
        weeklies.append({
            "slot": f"W{i}", "kind": "weekly",
            "option_id": "TXO",
            "contract_date": f"{nxt.year:04d}{nxt.month:02d}W{ordinal}",
            "contract_type": "week",
            "label": f"{nxt.month:02d}/{nxt.day:02d} 週選 W{i}",
            "settlement": nxt.isoformat(),
        })
        cursor = nxt

    return weeklies + monthlies
