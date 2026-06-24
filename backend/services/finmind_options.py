"""Pure helpers for TXO options: contract enumeration + dataset parsing.

Sister to services/finmind.py; that module owns HTTP + cache + rate-limit,
this one owns the data-shape logic so it can be unit-tested without I/O.
"""

from __future__ import annotations

import re
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


def _next_friday(d: date) -> date:
    """Smallest Friday strictly greater than d. Friday weekday() == 4."""
    return d + timedelta(days=((4 - d.weekday()) % 7) or 7)


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


_DEFAULT_HORIZON_DAYS = 35  # ~5 weeks of weekly contracts (Wed + Fri)


def list_active_contracts(
    today: date, horizon_days: int = _DEFAULT_HORIZON_DAYS,
) -> list[dict]:
    """Active TXO contracts sorted by settlement date ascending.

    Three kinds:
      - "monthly":     3rd-Wednesday of month. contract_date = "YYYYMM".
                       contract_type = "YYYYMM".
      - "weekly_wed":  every other Wednesday. contract_date = "YYYYMMW{n}"
                       where n = (day-1)//7+1 (1-based week-of-month).
      - "weekly_fri":  every Friday (TXO Fri weeklies, 上市 2025/06/27).
                       contract_date = "YYYYMMF{n}".

    All three share option_id="TXO" — FinMind packs them all into the same
    data_id. The two weekly kinds share contract_type="week"; FinMind's
    TaiwanOptionOpenInterestLargeTraders aggregates Wed + Fri under that
    single label (verified via 2026-06-23 probe).

    Same-day collision rule: when a Wednesday is the 3rd-Wed monthly
    settlement, do NOT emit a duplicate "weekly_wed" for that day — the
    monthly contract represents it. Friday settlements never collide with
    monthly (different weekday).

    Both weekly enumerations exclude `today` strictly (next-weekday helpers
    return >today). A contract whose settlement falls on `today` has already
    settled and is dropped.
    """
    horizon = today + timedelta(days=horizon_days)

    # --- monthlies ----------------------------------------------------------
    m0_settle = _third_wednesday(today.year, today.month)
    if today > m0_settle:
        m0_anchor = _add_months(date(today.year, today.month, 1), 1)
    else:
        m0_anchor = date(today.year, today.month, 1)
    anchors = [m0_anchor, _add_months(m0_anchor, 1), _add_months(m0_anchor, 3)]
    monthlies: list[dict] = []
    for anchor in anchors:
        sett = _third_wednesday(anchor.year, anchor.month)
        yyyymm = f"{anchor.year:04d}{anchor.month:02d}"
        monthlies.append({
            "kind": "monthly",
            "option_id": "TXO",
            "contract_date": yyyymm,
            "contract_type": yyyymm,
            "label": f"{anchor.year}/{anchor.month:02d} 月選",
            "settlement": sett.isoformat(),
        })
    monthly_setts = {m["settlement"] for m in monthlies}

    # --- weekly Wednesdays (excluding monthly-settlement days) --------------
    weekly_wed: list[dict] = []
    cursor = today
    while True:
        nxt = _next_wednesday(cursor)
        cursor = nxt
        if nxt > horizon:
            break
        if nxt.isoformat() in monthly_setts:
            continue
        ordinal = (nxt.day - 1) // 7 + 1
        weekly_wed.append({
            "kind": "weekly_wed",
            "option_id": "TXO",
            "contract_date": f"{nxt.year:04d}{nxt.month:02d}W{ordinal}",
            "contract_type": "week",
            "label": f"{nxt.month:02d}/{nxt.day:02d} 週三選",
            "settlement": nxt.isoformat(),
        })

    # --- weekly Fridays -----------------------------------------------------
    weekly_fri: list[dict] = []
    cursor = today
    while True:
        nxt = _next_friday(cursor)
        cursor = nxt
        if nxt > horizon:
            break
        ordinal = (nxt.day - 1) // 7 + 1
        weekly_fri.append({
            "kind": "weekly_fri",
            "option_id": "TXO",
            "contract_date": f"{nxt.year:04d}{nxt.month:02d}F{ordinal}",
            "contract_type": "week",
            "label": f"{nxt.month:02d}/{nxt.day:02d} 週五選",
            "settlement": nxt.isoformat(),
        })

    return sorted(
        monthlies + weekly_wed + weekly_fri,
        key=lambda c: c["settlement"],
    )


# Phase 0 mapping: parser group → FinMind raw field stem
# (cat = "trader" for "all" traders; "specific" for "prop" / 特定法人)
_GROUPS = [
    ("top5_prop",  "top5",  "specific"),
    ("top10_prop", "top10", "specific"),
    ("top5_all",   "top5",  "trader"),
    ("top10_all",  "top10", "trader"),
]


def _zero_current() -> dict:
    return {g[0]: {"long": 0, "short": 0, "net": 0} for g in _GROUPS}


def _aggregate_call_put_pair(call: dict | None, put: dict | None) -> dict:
    """Delta-equivalent aggregation per spec §2.2.

    long  = call.buy_top{N}_{cat}_open_interest + put.sell_top{N}_{cat}_open_interest
    short = call.sell_top{N}_{cat}_open_interest + put.buy_top{N}_{cat}_open_interest
    """
    out = {}
    for group_name, top, cat in _GROUPS:
        c_buy  = int((call or {}).get(f"buy_{top}_{cat}_open_interest",  0))
        c_sell = int((call or {}).get(f"sell_{top}_{cat}_open_interest", 0))
        p_buy  = int((put  or {}).get(f"buy_{top}_{cat}_open_interest",  0))
        p_sell = int((put  or {}).get(f"sell_{top}_{cat}_open_interest", 0))
        long_oi  = c_buy  + p_sell
        short_oi = c_sell + p_buy
        out[group_name] = {
            "long": long_oi, "short": short_oi, "net": long_oi - short_oi,
        }
    return out


def parse_oi_large_traders(
    rows: list[dict], contract_type: str, option_id: str = "TXO",
) -> dict:
    """Parse TaiwanOptionOpenInterestLargeTraders rows. See spec §2.2 for
    the call/put delta-equivalent aggregation rule.
    """
    filtered = [
        r for r in rows
        if r.get("option_id") == option_id and r.get("contract_type") == contract_type
    ]
    if not filtered:
        return {"current": _zero_current(), "series": [], "as_of_date": None}

    # Group by date, then split call vs put within each date.
    by_date: dict[str, dict[str, dict]] = {}
    for r in filtered:
        d = r.get("date", "")
        if not d:
            continue
        leg = str(r.get("put_call", "")).lower()
        if leg not in ("call", "put"):
            continue
        by_date.setdefault(d, {})[leg] = r

    dates_sorted = sorted(by_date.keys())
    if not dates_sorted:
        return {"current": _zero_current(), "series": [], "as_of_date": None}

    last_date = dates_sorted[-1]
    current = _aggregate_call_put_pair(
        by_date[last_date].get("call"), by_date[last_date].get("put"),
    )

    series = []
    for d in dates_sorted:
        agg = _aggregate_call_put_pair(
            by_date[d].get("call"), by_date[d].get("put"),
        )
        series.append({
            "date": d,
            "top5_all_net":   agg["top5_all"]["net"],
            "top10_all_net":  agg["top10_all"]["net"],
            "top5_prop_net":  agg["top5_prop"]["net"],
            "top10_prop_net": agg["top10_prop"]["net"],
        })

    return {"current": current, "series": series, "as_of_date": last_date}


def parse_strike_volume(
    rows: list[dict], contract_date: str,
    option_id: str = "TXO",
) -> dict:
    """Parse TaiwanOptionDaily rows into per-strike volume + OI change.

    Redesign 2026-06-24: returns ALL volume>0 strikes sorted by strike asc
    (no longer top-N by volume). Frontend's Strike Ladder is the consumer.

    Phase-0 rules unchanged:
    - Filter on option_id (default TXO) AND contract_date.
    - Sum volume across trading_session ∈ {position, after_market}; take MAX
      of OI across sessions.
    - Drop strikes with summed volume == 0 (typically illiquid OTM).
    - oi_change = today aggregated OI − prev-trading-day aggregated OI for
      that strike; 0 if no prev row exists.
    """
    matched = [
        r for r in rows
        if r.get("option_id") == option_id
        and r.get("contract_date") == contract_date
    ]
    if not matched:
        return {"call": [], "put": [], "as_of_date": None}

    agg: dict[tuple[str, str, float], dict] = {}
    for r in matched:
        cp = str(r.get("call_put", "")).lower()
        if cp not in ("call", "put"):
            continue
        try:
            strike = float(r["strike_price"])
        except (KeyError, TypeError, ValueError):
            continue
        key = (r["date"], cp, strike)
        vol = int(r.get("volume", 0) or 0)
        oi = int(r.get("open_interest", 0) or 0)
        bucket = agg.setdefault(key, {"volume": 0, "oi": 0})
        bucket["volume"] += vol
        if oi > bucket["oi"]:
            bucket["oi"] = oi

    if not agg:
        return {"call": [], "put": [], "as_of_date": None}

    dates = sorted({k[0] for k in agg})
    today = dates[-1]
    prev = dates[-2] if len(dates) >= 2 else None

    def side(cp_value: str) -> list[dict]:
        items = [(strike, v) for (d, cp, strike), v in agg.items()
                 if d == today and cp == cp_value and v["volume"] > 0]
        items.sort(key=lambda t: t[0])  # strike asc (redesign)
        out: list[dict] = []
        for strike, v in items:
            prev_v = agg.get((prev, cp_value, strike), {"oi": 0}) if prev else {"oi": 0}
            out.append({
                "strike": int(strike) if strike == int(strike) else strike,
                "volume": v["volume"],
                "oi": v["oi"],
                "oi_change": (v["oi"] - prev_v["oi"]) if prev else 0,
            })
        return out

    return {"call": side("call"), "put": side("put"), "as_of_date": today}


_PURE_YYYYMM = re.compile(r"\d{6}")


def parse_spot(rows: list[dict]) -> dict:
    """Parse TaiwanFuturesDaily TX rows into front-month spot + day-over-day change.

    Phase 0b confirmed two filters are required (see spec addendum):
    1. trading_session == "position" (day-session close; 夜盤 settlement_price
       is 0 and would corrupt the spot).
    2. contract_date matches ^\\d{6}$ (single-month contract, excludes
       "202606/202607" spread / calendar-spread rows).

    Among rows passing both filters, group by date and pick the smallest
    contract_date as the front-month for that day. `spot` = front-month
    close on the latest date; `prev_close` = front-month close on the
    second-latest date (None if only one date).
    """
    none_result = {
        "spot": None, "prev_close": None,
        "change": None, "change_pct": None,
        "as_of_date": None,
    }
    if not rows:
        return none_result

    filtered = [
        r for r in rows
        if r.get("trading_session") == "position"
        and _PURE_YYYYMM.fullmatch(str(r.get("contract_date", "")))
    ]
    if not filtered:
        return none_result

    by_date: dict[str, list[dict]] = {}
    for r in filtered:
        d = r.get("date", "")
        if not d:
            continue
        by_date.setdefault(d, []).append(r)
    if not by_date:
        return none_result

    dates_sorted = sorted(by_date.keys())

    def front_close(date_rows: list[dict]) -> float:
        front = min(date_rows, key=lambda r: str(r.get("contract_date", "")))
        try:
            return float(front.get("close", 0))
        except (TypeError, ValueError):
            return 0.0

    today = dates_sorted[-1]
    spot = front_close(by_date[today])
    prev_close = (
        front_close(by_date[dates_sorted[-2]])
        if len(dates_sorted) >= 2 else None
    )
    change = (spot - prev_close) if prev_close is not None else 0.0
    change_pct = (change / prev_close * 100) if prev_close else 0.0
    return {
        "spot": spot,
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "as_of_date": today,
    }
