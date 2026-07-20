"""Pure helpers for TXO options: contract enumeration + dataset parsing.

Sister to services/finmind.py; that module owns HTTP + cache + rate-limit,
this one owns the data-shape logic so it can be unit-tested without I/O.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import date, timedelta

_CACHE_VERSION_OPTIONS = 1
_CACHE_VERSION_OPTIONS_CHIP = 2  # bumped: options-page-v2 SC-1/2/3 (OTM walls / net-increase / hit-rate)
# strike_volume 專用(options-page-v2 §1.4 R11):從 2 起跳使共用 _CACHE_VERSION_OPTIONS=1
# 時代的舊 entry 失效;spot / oi_large_traders 沿用 _CACHE_VERSION_OPTIONS 不波及。
_CACHE_VERSION_STRIKE_VOL = 2
# per-day slim window cache(txo_slim_*,perf 2026-07-20):預聚合 5 欄 columnar,
# 取代 raw txo_daily_*。bump 即整窗重抓 FinMind(~250 req),歷史日無 raw 可回退。
_CACHE_VERSION_OPTIONS_SLIM = 1
# strike_volume per-day cache(txo_sv_*,perf 2026-07-20 S2):per (oid, cd, cp, k)
# 的 {vol 加總, oi 取 MAX}(parse_strike_volume 的 session 語意,與 txo_slim 的
# OI 加總不同構,不可共用)。bump 即 8 日範圍重抓。
_CACHE_VERSION_STRIKE_VOL_DAY = 1


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

    Redesign 2026-06-24: returns ALL active strikes sorted by strike asc
    (no longer top-N by volume). Frontend's RangeMap is the consumer.

    options-page-v2 §1.4 changes:
    - Keep strikes with volume > 0 OR oi > 0 (walls often sit on zero-volume
      deep-OTM strikes; the OI profile must share the oi_walls strike set).
      Rows with volume == 0 AND oi == 0 are dropped.
    - `today` = the most recent date carrying ANY positive OI (aligned with
      fetch_oi_walls' F7 non-empty-OI fallback, R10) — mornings where only
      the night session has published (volume>0, OI all 0) fall back to the
      previous OI day so the RangeMap overlay shares one basis date.
    - oi_change = today aggregated OI − previous OI-day aggregated OI.

    Unchanged rules:
    - Filter on option_id (default TXO) AND contract_date.
    - Sum volume across trading_session ∈ {position, after_market}; take MAX
      of OI across sessions.
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
    # R10: prefer the most recent date with ANY positive OI (same criterion
    # as fetch_oi_walls' F7 fallback); degenerate all-zero-OI data keeps the
    # plain last date.
    dates_with_oi = sorted({d for (d, _cp, _s), v in agg.items() if v["oi"] > 0})
    today = dates_with_oi[-1] if dates_with_oi else dates[-1]
    prev = next((d for d in reversed(dates_with_oi) if d < today), None)

    def side(cp_value: str) -> list[dict]:
        items = [(strike, v) for (d, cp, strike), v in agg.items()
                 if d == today and cp == cp_value and (v["volume"] > 0 or v["oi"] > 0)]
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
    """Parse TaiwanFuturesDaily TX rows into front-month spot + change.

    Includes BOTH session types — FinMind uses an end-date convention:
      - position (day session):     09:00–13:45 close, dated D
      - after_market (night sess.): 15:00 D−1 – 05:00 D close, dated D
    Within the same date D, the night session ENDS earlier (05:00) than the
    day session (13:45), so chronological rank is after_market < position.

    Filters:
      1. trading_session in {position, after_market} — drops anything else
      2. contract_date matches ^\\d{6}$ (single-month; drops calendar
         spreads like "202606/202607")

    Among rows passing both filters, group by (date, session_rank) and pick
    the smallest contract_date as the front-month for that bucket. `spot` =
    front-month close on the latest (date, session) pair; `prev_close` =
    front-month close on the second-latest pair (None if only one).

    Why this matters: if today's day session has not yet been published by
    FinMind (typical lag of a couple hours after 13:45), the latest data
    point is today's after_market (5am close). Filtering it out leaves the
    user stuck on yesterday's day-session close — visibly stale.
    """
    # Within the same date: position (afternoon) is later than after_market (5am)
    SESSION_RANK = {"after_market": 0, "position": 1}

    none_result = {
        "spot": None, "prev_close": None,
        "change": None, "change_pct": None,
        "as_of_date": None, "as_of_session": None,
    }
    if not rows:
        return none_result

    filtered = [
        r for r in rows
        if r.get("trading_session") in SESSION_RANK
        and _PURE_YYYYMM.fullmatch(str(r.get("contract_date", "")))
    ]
    if not filtered:
        return none_result

    by_key: dict[tuple[str, int], list[dict]] = {}
    for r in filtered:
        d = r.get("date", "")
        if not d:
            continue
        rank = SESSION_RANK[r["trading_session"]]
        by_key.setdefault((d, rank), []).append(r)
    if not by_key:
        return none_result

    sorted_keys = sorted(by_key.keys())  # (date, rank) ascending

    def front_close(date_rows: list[dict]) -> float:
        front = min(date_rows, key=lambda r: str(r.get("contract_date", "")))
        try:
            return float(front.get("close", 0))
        except (TypeError, ValueError):
            return 0.0

    latest_date, latest_rank = sorted_keys[-1]
    latest_session = "position" if latest_rank == 1 else "after_market"
    spot = front_close(by_key[sorted_keys[-1]])

    prev_close = (
        front_close(by_key[sorted_keys[-2]]) if len(sorted_keys) >= 2 else None
    )
    change = (spot - prev_close) if prev_close is not None else 0.0
    change_pct = (change / prev_close * 100) if prev_close else 0.0

    return {
        "spot": spot,
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "as_of_date": latest_date,
        "as_of_session": latest_session,
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


def _pick_static_wall(oi_map: dict[float, int], spot: float, side: str) -> dict | None:
    """Max-OI strike on the OTM side of spot; ties broken by proximity to spot.

    options-page-v2 SC-1: Call Wall candidates = strikes >= spot, Put Wall
    candidates = strikes <= spot — a wall on the wrong side of spot cannot be
    labelled 壓力/支撐. Empty OTM side → None (caller emits the per-side
    ``static_wall_no_otm_candidate_{side}`` warning).
    """
    if side == "call":
        otm = {s: oi for s, oi in oi_map.items() if s >= spot}
    else:
        otm = {s: oi for s, oi in oi_map.items() if s <= spot}
    if not otm:
        return None
    max_oi = max(otm.values())
    candidates = [s for s, oi in otm.items() if oi == max_oi]
    chosen = min(candidates, key=lambda s: abs(s - spot))
    return {
        "strike": int(chosen) if chosen.is_integer() else chosen,
        "oi": max_oi,
    }


def _pick_dynamic_wall(
    net_increase_map: dict[float, int], spot: float,
) -> dict | None:
    """Strike with max positive net OI increase over the window (first→last
    diff); ties broken by proximity to spot.

    options-page-v2 SC-2: replaces the Σ|ΔOI| activity metric — churn
    (build-then-unwind) no longer wins; the semantic is "where new money is
    parking". All net increases <= 0 → None (caller emits
    ``dynamic_wall_no_net_increase``).
    """
    positive = {s: v for s, v in net_increase_map.items() if v > 0}
    if not positive:
        return None
    max_inc = max(positive.values())
    candidates = [s for s, v in positive.items() if v == max_inc]
    chosen = min(candidates, key=lambda s: abs(s - spot))
    return {
        "strike": int(chosen) if chosen.is_integer() else chosen,
        "window_net_increase_oi": int(max_inc),
        "partial_window": False,
    }


def parse_oi_walls(
    rows_today: list[dict],
    rows_history: list[list[dict]],
    contract_date: str,
    delta_window: int,
    spot: float | None,
    option_id: str = "TXO",
) -> dict:
    """Static + dynamic OI walls per side (call / put).

    options-page-v2 revision (design v3 §1.1/§1.2 over the v4 base):
    - static walls are OTM-side restricted (see _pick_static_wall);
    - dynamic walls use window first→last net increase (see _pick_dynamic_wall);
    - ``spot=None`` (TX not published) → ALL four walls None, band None, and
      warnings contain ONLY ``oi_walls_no_spot`` — no side/dynamic warnings,
      missing spot ≠ missing candidates (R2);
    - ``band_width_pct`` is ``None`` whenever either static wall is missing
      (0 is a legitimate narrow-band value), and >= 0 otherwise.

    Args:
        rows_today: TaiwanOptionDaily rows for end_date.
        rows_history: rows per past trading day, oldest-first, length ≤ delta_window.
        contract_date: strict equality filter.
        delta_window: requested window in trading days. If history shorter,
            partial_window flag is set on dynamic walls + warning emitted.
        spot: index spot for OTM split + tie-break; None when unavailable.

    Returns:
        ``{static_call_wall, static_put_wall, dynamic_call_wall,
          dynamic_put_wall, band_width_pct, data_quality_warnings}``.
    """
    if spot is None:
        return {
            "static_call_wall": None,
            "static_put_wall": None,
            "dynamic_call_wall": None,
            "dynamic_put_wall": None,
            "band_width_pct": None,
            "data_quality_warnings": ["oi_walls_no_spot"],
        }

    warnings: list[str] = []

    today_call_oi, today_put_oi = _per_side_oi(rows_today, contract_date, option_id)

    static_call = _pick_static_wall(today_call_oi, spot, side="call")
    static_put = _pick_static_wall(today_put_oi, spot, side="put")
    if today_call_oi and static_call is None:
        warnings.append("static_wall_no_otm_candidate_call")
    if today_put_oi and static_put is None:
        warnings.append("static_wall_no_otm_candidate_put")

    # net_increase = window first→last diff — only the FIRST history day needs
    # aggregating (code-review CR4: aggregating every day wasted delta_window−1
    # full _per_side_oi passes on a hot endpoint); today's maps already exist.
    start_call_oi, start_put_oi = (
        _per_side_oi(rows_history[0], contract_date, option_id)
        if rows_history
        else (today_call_oi, today_put_oi)
    )

    partial_window = len(rows_history) < delta_window
    if partial_window:
        warnings.append("dynamic_wall_partial_window")

    # net_increase(K) = oi_end(K) − oi_start(K). Strikes not yet listed at
    # window start count from 0 → full OI counts as new money (design §1.2).
    def net_increase_for_side(side_key: str) -> dict[float, int]:
        start_map = start_call_oi if side_key == "call" else start_put_oi
        end_map = today_call_oi if side_key == "call" else today_put_oi
        return {K: end_map[K] - start_map.get(K, 0) for K in end_map}

    dynamic_call = _pick_dynamic_wall(net_increase_for_side("call"), spot)
    dynamic_put = _pick_dynamic_wall(net_increase_for_side("put"), spot)

    if dynamic_call:
        dynamic_call["partial_window"] = partial_window
    if dynamic_put:
        dynamic_put["partial_window"] = partial_window

    if dynamic_call is None and dynamic_put is None and (today_call_oi or today_put_oi):
        warnings.append("dynamic_wall_no_net_increase")

    band_width_pct: float | None = None
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
    closes_by_date: dict[date, float] | None = None,
    option_id: str = "TXO",
) -> dict:
    """Settlement-day hit rate using **T-1 day's** OI walls (design v4 §4 / F3).

    options-page-v2 SC-3: wall selection applies the SC-1 OTM-side rule with
    T-1's TX close as spot — strictly no look-ahead. ``closes_by_date`` is
    semantically REQUIRED: samples whose T-1 close is missing (or whose OTM
    side carries no candidate) are dropped and counted in
    ``dropped_no_close`` (the fetch layer appends the fixed warning string
    ``hit_rate_samples_dropped_no_close`` when > 0). The old anchor=0.0
    fallback is removed — a zero anchor under the OTM rule degenerates the
    put side to an always-empty candidate set.

    Returns:
        ``{samples, pct_settled_inside_band, avg_band_width_pct,
          history: [{settlement_date, put_wall_at_t_minus_1,
                     call_wall_at_t_minus_1, settlement_price, inside_band}],
          dropped_no_close, latest_settlement_pending}``
    """
    if not oi_by_trading_day or not settlements:
        return {
            "samples": 0, "pct_settled_inside_band": 0.0,
            "avg_band_width_pct": 0.0, "history": [],
            "dropped_no_close": 0,
            "latest_settlement_pending": False,
        }

    sorted_trading_days = sorted(oi_by_trading_day.keys())
    history: list[dict] = []
    latest_settlement_pending = False
    dropped_no_close = 0
    closes = closes_by_date or {}
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
        t1_close = closes.get(t_minus_1)
        if t1_close is None:
            dropped_no_close += 1
            continue
        call_oi, put_oi = _per_side_oi(
            oi_by_trading_day[t_minus_1], contract_date, option_id,
        )
        call_wall = _pick_static_wall(call_oi, spot=float(t1_close), side="call")
        put_wall = _pick_static_wall(put_oi, spot=float(t1_close), side="put")
        if not call_wall or not put_wall:
            dropped_no_close += 1
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
            "dropped_no_close": dropped_no_close,
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
        "dropped_no_close": dropped_no_close,
        "latest_settlement_pending": latest_settlement_pending,
    }


# ============================================================================
# SC-3 / SC-7: PCR walk-forward + next-day TX return stats (design v4 §4.3/4.4)
# ============================================================================


def _aggregate_pcr_for_day(
    rows: list[dict], scope: str, contract_date: str | None,
    option_id: str = "TXO",
) -> float | None:
    """Compute PCR for one day's rows under the given scope."""
    call_oi = 0
    put_oi = 0
    for row in rows:
        if row.get("option_id") != option_id:
            continue
        if scope == "per_contract" and str(row.get("contract_date", "")) != (contract_date or ""):
            continue
        try:
            oi = int(row.get("open_interest", 0) or 0)
        except (TypeError, ValueError):
            continue
        if oi <= 0:
            continue
        side = row.get("call_put")
        if side == "call":
            call_oi += oi
        elif side == "put":
            put_oi += oi
    if call_oi == 0:
        return None
    return put_oi / call_oi


def parse_pcr_history(
    rows_by_trading_day: dict[date, list[dict]],
    scope: str,  # "per_contract" | "all_months"
    contract_date: str | None,
    option_id: str = "TXO",
) -> list[tuple[date, float]]:
    """Compute per-day PCR series for the lookback window.

    Returns ascending-by-date list of ``(trading_day, pcr_value)`` tuples.
    Days where total call_oi == 0 (no data) are dropped silently.
    """
    out: list[tuple[date, float]] = []
    for d in sorted(rows_by_trading_day.keys()):
        pcr = _aggregate_pcr_for_day(
            rows_by_trading_day[d], scope=scope, contract_date=contract_date,
            option_id=option_id,
        )
        if pcr is not None:
            out.append((d, pcr))
    return out


def _percentile_strictly_past(past_values: list[float], target: float) -> float:
    """percentileofscore with kind='mean' on a strictly-past sample."""
    if not past_values:
        return 0.0
    n = len(past_values)
    below = sum(1 for v in past_values if v < target)
    equal = sum(1 for v in past_values if v == target)
    return (below + equal / 2) / n * 100


def parse_pcr_walk_forward_percentile(
    pcr_history: list[tuple[date, float]],
    high_pct: float = 70.0,
    low_pct: float = 30.0,
    min_samples: int = 30,
) -> tuple[list[tuple[date, float, float, str | None]], list[str]]:
    """Walk-forward percentile (design v4 §4.3 / F4 / F15).

    For each historical day t:
        past_window = [pcr_s for s in pcr_history if s < t]  # STRICTLY past
        if len(past_window) < min_samples: skip (region=None)
        else: percentile = percentileofscore(past_window, pcr_t, kind="mean")
              region = "high" if percentile >= high_pct
                     else "low" if percentile <= low_pct
                     else "neutral"

    Returns ``(classified_list, warnings)`` where classified_list is
    ``[(date, pcr, percentile, region_or_None), ...]`` ascending by date.

    Warmup days (skipped) emit ONE consolidated warning string:
    ``pcr_walk_forward_warmup_skipped_first_{N}_days`` (F14).
    """
    classified: list[tuple[date, float, float, str | None]] = []
    skipped = 0
    sorted_history = sorted(pcr_history, key=lambda t: t[0])
    for i, (d, pcr) in enumerate(sorted_history):
        past = [v for j, (_, v) in enumerate(sorted_history) if j < i]
        if len(past) < min_samples:
            classified.append((d, pcr, 0.0, None))
            skipped += 1
            continue
        percentile = _percentile_strictly_past(past, pcr)
        region = (
            "high" if percentile >= high_pct
            else "low" if percentile <= low_pct
            else "neutral"
        )
        classified.append((d, pcr, percentile, region))
    warnings: list[str] = []
    if skipped > 0:
        warnings.append(f"pcr_walk_forward_warmup_skipped_first_{skipped}_days")
    return classified, warnings


def parse_pcr_next_day_stats(
    classified: Sequence[tuple[date, float, float, str | None]],
    tx_returns: dict[date, float],
) -> tuple[dict, list[str]]:
    """Next-day TX return statistics by region. NO P&L, NO Sharpe (F2-testability).

    Args:
        classified: output of parse_pcr_walk_forward_percentile.
        tx_returns: ``{trading_day: next_day_return}`` — caller maps t → return on t+1.

    Returns:
        ``({high_region, neutral_region, low_region}, warnings)``
        Each region dict: ``{mean_pct, std_pct, hit_positive, samples}``.

    Warnings:
        - ``pcr_stats_low_power_{region}`` when region's samples < 30 (N8)
        - ``next_day_stats_dropped_samples_5pct`` when > 5% of region samples
          lack a tx_returns entry (N9)
    """
    by_region: dict[str, list[tuple[date, float]]] = {"high": [], "neutral": [], "low": []}
    for d, _, _, region in classified:
        if region is None:
            continue
        by_region[region].append((d, 0.0))  # placeholder; return looked up below

    result: dict = {}
    warnings: list[str] = []
    dropped_total = 0
    candidate_total = 0
    for region_name in ("high", "neutral", "low"):
        days = [d for d, _ in by_region[region_name]]
        candidate_total += len(days)
        with_return = [tx_returns[d] for d in days if d in tx_returns]
        dropped = len(days) - len(with_return)
        dropped_total += dropped
        samples = len(with_return)
        if samples == 0:
            result[f"{region_name}_region"] = {
                "mean_pct": 0.0, "std_pct": 0.0, "hit_positive": 0.0, "samples": 0,
            }
            continue
        mean_v = sum(with_return) / samples
        var = sum((v - mean_v) ** 2 for v in with_return) / samples
        std_v = var ** 0.5
        hit_pos = sum(1 for v in with_return if v > 0) / samples
        result[f"{region_name}_region"] = {
            "mean_pct": mean_v * 100,
            "std_pct": std_v * 100,
            "hit_positive": hit_pos,
            "samples": samples,
        }
        if samples < 30:
            warnings.append(f"pcr_stats_low_power_{region_name}")

    if candidate_total > 0 and (dropped_total / candidate_total) > 0.05:
        warnings.append("next_day_stats_dropped_samples_5pct")
    return result, warnings


# ============================================================================
# SC-4 / SC-8: Institutional + foreign correlation (design v4 §4.5 / §4.6)
# ============================================================================

NIGHT_SESSION_AVAILABLE_FROM = date(2021, 10, 13)

# Map raw institution names to canonical English keys.
# Real FinMind field names PENDING SC-0 LIVE PROBE (R14/R6) — adjust here
# once token refresh allows verification.
_INSTITUTION_NAME_MAP = {
    "外資": "foreign",
    "自營商": "dealer",   # F3-integration: NOT 'prop'
    "投信": "trust",
}


def _aggregate_inst_session(rows: list[dict]) -> dict:
    """Aggregate one session's rows into {foreign, dealer, trust} dicts.

    Real FinMind schema (probed live 2026-06-26, R14 / SC-0 done):
      - institution name:  ``institutional_investors`` (e.g. "外資" / "自營商" / "投信")
      - side:              ``call_put``  (values: "買權" / "賣權")
      - long OI balance:   ``long_open_interest_balance_volume``
      - short OI balance:  ``short_open_interest_balance_volume``
    """
    out: dict[str, dict[str, int]] = {
        "foreign": {"call_net": 0, "put_net": 0},
        "dealer":  {"call_net": 0, "put_net": 0},
        "trust":   {"call_net": 0, "put_net": 0},
    }
    for row in rows:
        # Accept either schema for back-compat with hand-built fixtures
        inst_raw = row.get("institutional_investors") or row.get("institution", "")
        key = _INSTITUTION_NAME_MAP.get(inst_raw)
        if key is None:
            continue
        try:
            # Real-schema field names; falls back to the hand-built fixture names
            long_oi = int(
                row.get("long_open_interest_balance_volume")
                or row.get("buy_open_interest") or 0
            )
            short_oi = int(
                row.get("short_open_interest_balance_volume")
                or row.get("sell_open_interest") or 0
            )
        except (TypeError, ValueError):
            continue
        side = row.get("call_put") or row.get("put_call")
        # Real-schema values are 買權 / 賣權; hand-built fixtures use call / put
        if side in ("call", "買權"):
            out[key]["call_net"] += long_oi - short_oi
        elif side in ("put", "賣權"):
            out[key]["put_net"] += long_oi - short_oi
    return out


def parse_institutional(
    rows_day: list[dict],
    rows_night: list[dict] | None,
    target_date: date,
) -> dict:
    """Aggregate 三大法人 buy/sell open-interest by side + session.

    Args:
        rows_day: TaiwanOptionInstitutionalInvestors rows for target_date.
        rows_night: TaiwanOptionInstitutionalInvestorsAfterHours rows.
            ``None`` triggers ``session_breakdown.after_hours = None`` regardless
            of target_date.
        target_date: used to gate dates before NIGHT_SESSION_AVAILABLE_FROM
            (2021-10-13 — before which AfterHours dataset did not exist).

    Returns:
        ``{current: {foreign, dealer, trust, session_breakdown}}``
    """
    day_agg = _aggregate_inst_session(rows_day)

    # Pre-cutoff: AfterHours unavailable
    if target_date < NIGHT_SESSION_AVAILABLE_FROM or rows_night is None:
        after_hours_agg = None
    else:
        after_hours_agg = _aggregate_inst_session(rows_night)

    # Top-level totals = day + night (or just day if night None)
    totals: dict[str, dict] = {}
    for inst in ("foreign", "dealer", "trust"):
        cn = day_agg[inst]["call_net"]
        pn = day_agg[inst]["put_net"]
        if after_hours_agg is not None:
            cn += after_hours_agg[inst]["call_net"]
            pn += after_hours_agg[inst]["put_net"]
        totals[inst] = {
            "call_net": cn, "put_net": pn,
            "total_net": cn + pn, "day_change": 0,  # day_change populated by caller
        }

    return {
        "current": {
            **totals,
            "session_breakdown": {
                "day_session": day_agg,
                "after_hours": after_hours_agg,
            },
        },
    }


def parse_foreign_total_net_series(rows_day: list[dict], limit: int = 20) -> list[dict]:
    """外資 per-date **delta 等效**淨部位 series(options-page-v2 SC-8 / R3a
    + code-review CR1)。

    delta 等效 = call_net − put_net(買 call / 賣 put 偏多;買 put / 賣 call
    偏空)— 與 ``_aggregate_call_put_pair`` 的大戶 OI 換向規則一致。純
    call_net + put_net 加總會把大買保護性 put 讀成偏多(方向相反),
    溫度計判讀句「淨多/淨空」依賴此符號。
    Returns ascending ``[{date, foreign_total_net}]``(≤ limit)。
    """
    per_date: dict[str, int] = {}
    for r in rows_day:
        d = r.get("date", "")
        inst_raw = r.get("institutional_investors") or r.get("institution", "")
        if not d or _INSTITUTION_NAME_MAP.get(inst_raw) != "foreign":
            continue
        side = r.get("call_put") or r.get("put_call")
        if side in ("call", "買權"):
            sign = 1
        elif side in ("put", "賣權"):
            sign = -1
        else:
            continue
        try:
            long_oi = int(
                r.get("long_open_interest_balance_volume")
                or r.get("buy_open_interest") or 0
            )
            short_oi = int(
                r.get("short_open_interest_balance_volume")
                or r.get("sell_open_interest") or 0
            )
        except (TypeError, ValueError):
            continue
        per_date[d] = per_date.get(d, 0) + sign * (long_oi - short_oi)
    return [
        {"date": d, "foreign_total_net": v}
        for d, v in sorted(per_date.items())[-limit:]
    ]


def _spearman_rho(xs: list[float], ys: list[float]) -> float:
    """Spearman rank correlation. Pure-python, no numpy dependency."""
    if len(xs) != len(ys) or len(xs) < 2:
        return 0.0

    def rank(values: list[float]) -> list[float]:
        indexed = sorted(range(len(values)), key=lambda i: values[i])
        ranks = [0.0] * len(values)
        i = 0
        while i < len(values):
            j = i
            while j + 1 < len(values) and values[indexed[j + 1]] == values[indexed[i]]:
                j += 1
            avg_rank = (i + j) / 2 + 1  # 1-based, midpoint of tie group
            for k in range(i, j + 1):
                ranks[indexed[k]] = avg_rank
            i = j + 1
        return ranks

    rx = rank(xs)
    ry = rank(ys)
    n = len(xs)
    mean_rx = sum(rx) / n
    mean_ry = sum(ry) / n
    num = sum((rx[i] - mean_rx) * (ry[i] - mean_ry) for i in range(n))
    den = (
        sum((rx[i] - mean_rx) ** 2 for i in range(n))
        * sum((ry[i] - mean_ry) ** 2 for i in range(n))
    ) ** 0.5
    return num / den if den > 0 else 0.0


def parse_institutional_correlation(
    foreign_history: list[dict],
    tx_returns: dict[date, float],
    *,
    corr_window: int = 60,
    permutation_n: int = 200,  # cheaper default for unit tests; production uses 1000
    feature_transformation: str = "raw_flow",
    seed: int = 42,
) -> tuple[dict, list[str]]:
    """Rolling Spearman correlation of foreign call_net vs next-day TX return,
    with permutation-test p-value (design v4 §4.6 / N2 / N3).

    Args:
        foreign_history: ascending list of ``{date, foreign_call_net, ...}``.
            Any other institution keys (dealer/trust) in the dict are IGNORED
            (F10-test scope guard — correlation payload is foreign-only).
        tx_returns: ``{date: next_day_TX_return}`` keyed by entry day t.
        corr_window: window length in days.
        permutation_n: # permutations for p-value.
        feature_transformation: 'raw_flow' (default, N3) uses call_net[t] directly;
            'first_difference' uses call_net[t] - call_net[t-1].
        seed: deterministic permutation seed for reproducibility.

    Returns:
        ``({samples, latest_corr, latest_p_value, history, is_significant,
            feature_transformation}, warnings)``.
        Note: ONLY foreign correlation in payload — dealer/trust never appear.
    """
    import random
    rng = random.Random(seed)
    warnings: list[str] = []

    # Extract aligned (call_net, next_return) pairs in date order
    sorted_hist = sorted(foreign_history, key=lambda r: r["date"])
    feature_series: list[tuple[date, float]] = []
    if feature_transformation == "first_difference":
        for i, row in enumerate(sorted_hist):
            if i == 0:
                continue
            prev = float(sorted_hist[i - 1].get("foreign_call_net", 0))
            cur = float(row.get("foreign_call_net", 0))
            feature_series.append((row["date"], cur - prev))
    else:  # raw_flow
        for row in sorted_hist:
            feature_series.append((row["date"], float(row.get("foreign_call_net", 0))))

    paired = [(d, f, tx_returns[d]) for d, f in feature_series if d in tx_returns]
    samples = len(paired)
    if samples < 30:
        warnings.append("correlation_sample_small")
    if samples < 2:
        return (
            {
                "samples": samples, "latest_corr": 0.0, "latest_p_value": 1.0,
                "history": [], "is_significant": False,
                "feature_transformation": feature_transformation,
            },
            warnings,
        )

    # Rolling correlation
    history: list[dict] = []
    for end_idx in range(corr_window - 1, samples):
        window = paired[end_idx - corr_window + 1: end_idx + 1] if end_idx >= corr_window - 1 else paired[: end_idx + 1]
        if len(window) < 2:
            continue
        xs = [w[1] for w in window]
        ys = [w[2] for w in window]
        r_obs = _spearman_rho(xs, ys)
        # Permutation test: shuffle ys, recompute r, count |r_perm| >= |r_obs|
        ge_count = 0
        for _ in range(permutation_n):
            ys_shuf = ys[:]
            rng.shuffle(ys_shuf)
            r_perm = _spearman_rho(xs, ys_shuf)
            if abs(r_perm) >= abs(r_obs):
                ge_count += 1
        p_val = (ge_count + 1) / (permutation_n + 1)
        history.append({
            "date": window[-1][0].isoformat(),
            "corr": r_obs,
            "p_value": p_val,
        })

    latest = history[-1] if history else {"corr": 0.0, "p_value": 1.0}
    return (
        {
            "samples": samples,
            "latest_corr": latest["corr"],
            "latest_p_value": latest["p_value"],
            "history": history,
            "is_significant": latest["p_value"] < 0.10,
            "feature_transformation": feature_transformation,
        },
        warnings,
    )
