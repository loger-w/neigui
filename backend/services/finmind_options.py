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


# ============================================================================
# SC-1 / SC-5: Max Pain (design v4 §4.1)
# ============================================================================

TXO_POINT_MULTIPLIER = 50  # NT$ per index point; TXO contract spec


def parse_max_pain(
    rows: list[dict], contract_date: str, option_id: str = "TXO",
) -> dict:
    """Compute Max Pain (lowest-loss strike for option sellers) on one day.

    Algorithm (design v4 §4.1 / F1, F2, F14):
        1. Strict filter: row.option_id == option_id AND
           row.contract_date == contract_date.
        2. Aggregate OI per (strike, call_put) across trading_session.
        3. candidate_K = UNION of strikes appearing on either side with OI > 0
           (one-sided deep OTM strikes count — they shift Max Pain at the tails).
        4. loss_oi(K) = Σ call_oi_i × max(K − K_i, 0)
                     + Σ put_oi_j × max(K_j − K, 0).
        5. K* = argmin(loss_oi). On ties → lowest K (deterministic).
        6. total_loss_ntd = loss_oi(K*) × TXO_POINT_MULTIPLIER.
    """
    call_oi: dict[float, int] = {}
    put_oi: dict[float, int] = {}
    for row in rows:
        if row.get("option_id") != option_id:
            continue
        if str(row.get("contract_date", "")) != contract_date:
            continue
        try:
            strike = float(row.get("strike_price", 0))
            oi = int(row.get("open_interest", 0) or 0)
        except (TypeError, ValueError):
            continue
        if oi <= 0:
            continue
        side = row.get("call_put")
        bucket = call_oi if side == "call" else put_oi if side == "put" else None
        if bucket is None:
            continue
        bucket[strike] = bucket.get(strike, 0) + oi

    call_strikes = set(call_oi.keys())
    put_strikes = set(put_oi.keys())
    candidate_strikes = sorted(call_strikes | put_strikes)
    if not candidate_strikes:
        return {
            "max_pain": None, "total_loss_ntd": 0, "strike_count": 0,
            "strikes_with_call_oi_only": 0, "strikes_with_put_oi_only": 0,
        }

    def loss_at(k: float) -> int:
        call_loss = sum(oi * max(k - s, 0) for s, oi in call_oi.items())
        put_loss = sum(oi * max(s - k, 0) for s, oi in put_oi.items())
        return int(call_loss + put_loss)

    best_k = candidate_strikes[0]
    best_loss = loss_at(best_k)
    for k in candidate_strikes[1:]:
        loss = loss_at(k)
        if loss < best_loss:
            best_loss = loss
            best_k = k

    return {
        "max_pain": int(best_k) if best_k.is_integer() else best_k,
        "total_loss_ntd": best_loss * TXO_POINT_MULTIPLIER,
        "strike_count": len(candidate_strikes),
        "strikes_with_call_oi_only": len(call_strikes - put_strikes),
        "strikes_with_put_oi_only": len(put_strikes - call_strikes),
    }


def parse_max_pain_hit_rate(
    oi_by_trading_day: dict[date, list[dict]],
    settlements: dict[date, dict],
    *,
    option_id: str = "TXO",
) -> dict:
    """Settlement-day hit rate using **T-1 day's** Max Pain.

    Design v4 §4 / F3: settlement-day OI has already collapsed, so Max Pain
    computed on day T is mechanically ≈ settlement_t (look-ahead bias). The
    honest measurement is how far settlement landed from yesterday's
    Max Pain — i.e. the value a trader could have ACTED on.

    Args:
        oi_by_trading_day: ``{trading_day: TaiwanOptionDaily rows that day}``.
            Must contain at least the trading day immediately before each
            settlement_date in ``settlements``. Caller (services/trading_calendar)
            owns the "previous trading day" lookup.
        settlements: ``{settlement_date: {contract_date: str, price: float | None}}``.
            ``price=None`` on the *latest* settlement → ``latest_settlement_pending=True``
            and that sample is excluded.

    Returns:
        ``{samples, median_abs_deviation_pct, hit_within_1pct, hit_within_2pct,
          history, latest_settlement_pending}``
    """
    if not oi_by_trading_day or not settlements:
        return {
            "samples": 0, "median_abs_deviation_pct": None,
            "hit_within_1pct": 0.0, "hit_within_2pct": 0.0,
            "history": [], "latest_settlement_pending": False,
        }

    sorted_trading_days = sorted(oi_by_trading_day.keys())
    history: list[dict] = []
    latest_settlement_pending = False
    sorted_settlements = sorted(settlements.items())

    for idx, (settlement_date, info) in enumerate(sorted_settlements):
        contract_date = info.get("contract_date", "")
        price = info.get("price")
        if price is None:
            if idx == len(sorted_settlements) - 1:
                latest_settlement_pending = True
            continue
        t_minus_1 = next(
            (d for d in reversed(sorted_trading_days) if d < settlement_date), None,
        )
        if t_minus_1 is None:
            continue
        mp = parse_max_pain(
            oi_by_trading_day[t_minus_1], contract_date=contract_date,
            option_id=option_id,
        )
        if mp["max_pain"] is None:
            continue
        max_pain_val = float(mp["max_pain"])
        deviation_pct = (float(price) - max_pain_val) / float(price)
        history.append({
            "settlement_date": settlement_date.isoformat(),
            "max_pain_at_t_minus_1": int(max_pain_val) if max_pain_val.is_integer() else max_pain_val,
            "settlement_price": float(price),
            "deviation_pct": deviation_pct,
        })

    samples = len(history)
    if samples == 0:
        return {
            "samples": 0, "median_abs_deviation_pct": None,
            "hit_within_1pct": 0.0, "hit_within_2pct": 0.0,
            "history": [], "latest_settlement_pending": latest_settlement_pending,
        }
    abs_devs = sorted(abs(h["deviation_pct"]) for h in history)
    mid = samples // 2
    median = abs_devs[mid] if samples % 2 else (abs_devs[mid - 1] + abs_devs[mid]) / 2
    return {
        "samples": samples,
        "median_abs_deviation_pct": median,
        "hit_within_1pct": sum(1 for d in abs_devs if d <= 0.01) / samples,
        "hit_within_2pct": sum(1 for d in abs_devs if d <= 0.02) / samples,
        "history": history,
        "latest_settlement_pending": latest_settlement_pending,
    }


# ============================================================================
# SC-2 / SC-6: OI Walls (design v4 §4.2)
# ============================================================================


def _per_side_oi(
    rows: list[dict], contract_date: str, option_id: str = "TXO",
) -> tuple[dict[float, int], dict[float, int]]:
    """Extract per-strike OI for call and put sides (one day).

    Returns (call_oi, put_oi) dicts. Same filter rules as parse_max_pain.
    """
    call_oi: dict[float, int] = {}
    put_oi: dict[float, int] = {}
    for row in rows:
        if row.get("option_id") != option_id:
            continue
        if str(row.get("contract_date", "")) != contract_date:
            continue
        try:
            strike = float(row.get("strike_price", 0))
            oi = int(row.get("open_interest", 0) or 0)
        except (TypeError, ValueError):
            continue
        if oi <= 0:
            continue
        side = row.get("call_put")
        bucket = call_oi if side == "call" else put_oi if side == "put" else None
        if bucket is None:
            continue
        bucket[strike] = bucket.get(strike, 0) + oi
    return call_oi, put_oi


def _pick_static_wall(oi_map: dict[float, int], spot: float) -> dict | None:
    """Strike with max OI; ties broken by proximity to spot."""
    if not oi_map:
        return None
    max_oi = max(oi_map.values())
    candidates = [s for s, oi in oi_map.items() if oi == max_oi]
    chosen = min(candidates, key=lambda s: abs(s - spot))
    return {
        "strike": int(chosen) if chosen.is_integer() else chosen,
        "oi": max_oi,
    }


def _pick_dynamic_wall(
    activity_map: dict[float, int], spot: float,
) -> dict | None:
    """Strike with max activity (Σ|ΔOI|); ties broken by proximity to spot."""
    if not activity_map:
        return None
    max_act = max(activity_map.values())
    if max_act == 0:
        # All activity zero — still pick closest-to-spot for downstream
        chosen = min(activity_map.keys(), key=lambda s: abs(s - spot))
        return {
            "strike": int(chosen) if chosen.is_integer() else chosen,
            "window_activity_oi": 0,
            "partial_window": False,
        }
    candidates = [s for s, a in activity_map.items() if a == max_act]
    chosen = min(candidates, key=lambda s: abs(s - spot))
    return {
        "strike": int(chosen) if chosen.is_integer() else chosen,
        "window_activity_oi": int(max_act),
        "partial_window": False,
    }


def parse_oi_walls(
    rows_today: list[dict],
    rows_history: list[list[dict]],
    contract_date: str,
    delta_window: int,
    spot: float,
    option_id: str = "TXO",
) -> dict:
    """Static + dynamic OI walls per side (call / put). Design v4 §4.2.

    Args:
        rows_today: TaiwanOptionDaily rows for end_date.
        rows_history: rows per past trading day, oldest-first, length ≤ delta_window.
            Each inner list is one day's rows.
        contract_date: strict equality filter.
        delta_window: requested window in trading days. If history shorter,
            partial_window flag is set on dynamic walls + warning emitted.
        spot: index spot for tie-break.

    Returns:
        ``{static_call_wall, static_put_wall, dynamic_call_wall,
          dynamic_put_wall, band_width_pct, data_quality_warnings}``.
    """
    warnings: list[str] = []

    today_call_oi, today_put_oi = _per_side_oi(rows_today, contract_date, option_id)

    static_call = _pick_static_wall(today_call_oi, spot)
    static_put = _pick_static_wall(today_put_oi, spot)

    # Build per-day OI snapshots for activity calculation
    daily_snapshots: list[tuple[dict[float, int], dict[float, int]]] = []
    for day_rows in rows_history:
        daily_snapshots.append(_per_side_oi(day_rows, contract_date, option_id))
    daily_snapshots.append((today_call_oi, today_put_oi))  # include today

    partial_window = len(rows_history) < delta_window
    if partial_window:
        warnings.append("dynamic_wall_partial_window")

    # Activity = Σ |oi_{d+1} - oi_d| over CONSECUTIVE day pairs only.
    # The initial "0 → first day" jump is NOT counted (it conflates "strike
    # newly listed" with "true activity"; design v4 §4.2 / N13).
    def activity_for_side(side_key: str) -> dict[float, int]:
        act: dict[float, int] = {}
        end_strikes = set(
            (today_call_oi if side_key == "call" else today_put_oi).keys()
        )
        for K in end_strikes:
            total = 0
            prev = None
            for c_oi, p_oi in daily_snapshots:
                cur = (c_oi if side_key == "call" else p_oi).get(K, 0)
                if prev is not None:
                    total += abs(cur - prev)
                prev = cur
            act[K] = total
        return act

    call_activity = activity_for_side("call")
    put_activity = activity_for_side("put")

    dynamic_call = _pick_dynamic_wall(call_activity, spot)
    dynamic_put = _pick_dynamic_wall(put_activity, spot)

    if dynamic_call:
        dynamic_call["partial_window"] = partial_window
    if dynamic_put:
        dynamic_put["partial_window"] = partial_window

    # no_activity warning (N13): max activity across both sides is 0
    max_call_act = max(call_activity.values()) if call_activity else 0
    max_put_act = max(put_activity.values()) if put_activity else 0
    if max_call_act == 0 and max_put_act == 0 and (call_activity or put_activity):
        warnings.append("dynamic_wall_no_activity")

    band_width_pct = 0.0
    if static_call and static_put and spot > 0:
        band_width_pct = (static_call["strike"] - static_put["strike"]) / spot * 100

    return {
        "static_call_wall": static_call,
        "static_put_wall": static_put,
        "dynamic_call_wall": dynamic_call,
        "dynamic_put_wall": dynamic_put,
        "band_width_pct": band_width_pct,
        "data_quality_warnings": warnings,
    }


def parse_oi_walls_hit_rate(
    oi_by_trading_day: dict[date, list[dict]],
    settlements: dict[date, dict],
    *,
    option_id: str = "TXO",
) -> dict:
    """Settlement-day hit rate using **T-1 day's** OI walls (design v4 §4 / F3).

    Returns:
        ``{samples, pct_settled_inside_band, avg_band_width_pct,
          history: [{settlement_date, put_wall_at_t_minus_1,
                     call_wall_at_t_minus_1, settlement_price, inside_band}],
          latest_settlement_pending}``
    """
    if not oi_by_trading_day or not settlements:
        return {
            "samples": 0, "pct_settled_inside_band": 0.0,
            "avg_band_width_pct": 0.0, "history": [],
            "latest_settlement_pending": False,
        }

    sorted_trading_days = sorted(oi_by_trading_day.keys())
    history: list[dict] = []
    latest_settlement_pending = False
    sorted_settlements = sorted(settlements.items())

    for idx, (settlement_date, info) in enumerate(sorted_settlements):
        contract_date = info.get("contract_date", "")
        price = info.get("price")
        if price is None:
            if idx == len(sorted_settlements) - 1:
                latest_settlement_pending = True
            continue
        t_minus_1 = next(
            (d for d in reversed(sorted_trading_days) if d < settlement_date), None,
        )
        if t_minus_1 is None:
            continue
        call_oi, put_oi = _per_side_oi(
            oi_by_trading_day[t_minus_1], contract_date, option_id,
        )
        call_wall = _pick_static_wall(call_oi, spot=float(price))
        put_wall = _pick_static_wall(put_oi, spot=float(price))
        if not call_wall or not put_wall:
            continue
        put_w = float(put_wall["strike"])
        call_w = float(call_wall["strike"])
        inside = put_w <= float(price) <= call_w
        history.append({
            "settlement_date": settlement_date.isoformat(),
            "put_wall_at_t_minus_1": put_wall["strike"],
            "call_wall_at_t_minus_1": call_wall["strike"],
            "settlement_price": float(price),
            "inside_band": bool(inside),
        })

    samples = len(history)
    if samples == 0:
        return {
            "samples": 0, "pct_settled_inside_band": 0.0,
            "avg_band_width_pct": 0.0, "history": [],
            "latest_settlement_pending": latest_settlement_pending,
        }
    inside_count = sum(1 for h in history if h["inside_band"])
    avg_band = sum(
        (h["call_wall_at_t_minus_1"] - h["put_wall_at_t_minus_1"])
        / h["settlement_price"] * 100
        for h in history
    ) / samples
    return {
        "samples": samples,
        "pct_settled_inside_band": inside_count / samples,
        "avg_band_width_pct": avg_band,
        "history": history,
        "latest_settlement_pending": latest_settlement_pending,
    }
