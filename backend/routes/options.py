"""Options chip API routes.

Error handling lives in main.py via global @app.exception_handler — httpx
errors and ValueErrors propagate; the canonical 502 / 503 / detail.error
shape comes back from those handlers.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from services.finmind import get_finmind
from services.finmind_options import list_active_contracts

router = APIRouter()


def _resolve_contract(contract: str) -> dict | None:
    """Match the flat ID `<option_id><contract_date>` (e.g. `TXO202607` or
    `TXO202607W2`) against the seven slots produced by list_active_contracts."""
    if not contract:
        return None
    today = date.today()
    for c in list_active_contracts(today):
        if f"{c['option_id']}{c['contract_date']}" == contract:
            return c
    return None


def _today_str() -> str:
    return date.today().isoformat()


def _is_stale_for_requested(payload: dict, requested_date: str) -> bool:
    """A payload is "stale" for the requested date when the parser's actual
    data is from a different date (or there is no data at all). This is the
    canonical signal for non-trading-day / pre-publish UX banners.

    See spec §2.5: any time the user's selected date does not correspond
    to a real FinMind trading row, surface no_trading_day=true so the
    frontend can render the grey "[date] 無交易" banner.
    """
    as_of = payload.get("as_of_date")
    return as_of is None or as_of != requested_date


def _require_contract(contract: str) -> dict:
    """Two-step contract guard shared by every endpoint that needs one."""
    if not contract:
        raise HTTPException(status_code=400, detail={"error": "contract_required"})
    c = _resolve_contract(contract)
    if c is None:
        raise HTTPException(status_code=400, detail={"error": "invalid_contract"})
    return c


@router.get("/api/options/oi_large_traders")
async def get_oi_large_traders(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    c = _require_contract(contract)
    d = date or _today_str()
    out = await get_finmind().fetch_oi_large_traders(c, d, refresh)
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/spot")
async def get_spot(
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today_str()
    out = await get_finmind().fetch_spot(d, refresh)
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/strike_volume")
async def get_strike_volume(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    c = _require_contract(contract)
    d = date or _today_str()
    out = await get_finmind().fetch_strike_volume(c, d, refresh)
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


# -- txo-chip-framework MVP1 --------------------------------------------------

CHIP_WINDOW_TD = 250  # canonical shared TaiwanOptionDaily window (design v4 §1)


def _validate_lookback(lookback: int, period_days: int) -> None:
    """N11: route-layer guard — reject 400 if lookback × period > CHIP_WINDOW_TD.

    F8 修 (post-impl review): FastAPI's Query le=50 is the outer hard bound;
    this finer guard maps to a friendlier ``detail.error`` code so the
    frontend can show a meaningful banner. Effective cap = 25 settlements
    when period_days=10 (weekly+monthly mix).
    """
    if lookback * period_days > CHIP_WINDOW_TD:
        raise HTTPException(
            status_code=400,
            detail={"error": "lookback_exceeds_canonical_window"},
        )


@router.get("/api/options/max_pain")
async def get_max_pain(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    lookback: int = Query(default=20, ge=1, le=50),
) -> dict:
    """SC-1 / SC-5: Max Pain + T-1 hit rate (design v4 §2.1)."""
    c = _require_contract(contract)
    _validate_lookback(lookback, period_days=10)
    d = date or _today_str()
    out = await get_finmind().fetch_max_pain(c, d, lookback=lookback, refresh=refresh)
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/oi_walls")
async def get_oi_walls(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    lookback: int = Query(default=20, ge=1, le=50),
    delta_window: int = Query(default=5, ge=1, le=20),
) -> dict:
    """SC-2 / SC-6: OI Walls (static + dynamic) + T-1 hit rate."""
    c = _require_contract(contract)
    _validate_lookback(lookback, period_days=10)
    d = date or _today_str()
    out = await get_finmind().fetch_oi_walls(
        c, d, lookback=lookback, delta_window=delta_window, refresh=refresh,
    )
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/pcr")
async def get_pcr(
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    scope: str = Query(default="all_months"),
    contract: str = Query(default=""),
    lookback: int = Query(default=250, ge=30, le=250),
    high_pct: float = Query(default=70.0, ge=0.0, le=100.0),
    low_pct: float = Query(default=30.0, ge=0.0, le=100.0),
) -> dict:
    """SC-3 / SC-7: PCR walk-forward percentile + next-day stats.

    Validation matrix (design v4 §2.1):
    - scope=per_contract requires contract; reject 400 if missing
    - scope=all_months rejects contract; reject 400 if provided
    - scope=per_contract + weekly contract → 200 + warning (N5)
    """
    if scope not in ("per_contract", "all_months"):
        raise HTTPException(status_code=400, detail={"error": "invalid_scope"})
    c: dict | None = None
    if scope == "per_contract":
        if not contract:
            raise HTTPException(
                status_code=400,
                detail={"error": "missing_contract_for_per_contract_scope"},
            )
        c = _require_contract(contract)
    else:  # all_months
        if contract:
            raise HTTPException(
                status_code=400,
                detail={"error": "contract_not_applicable_for_scope"},
            )

    d = date or _today_str()
    out = await get_finmind().fetch_pcr(
        scope=scope, contract=c, date_str=d, lookback=lookback,
        high_pct=high_pct, low_pct=low_pct, refresh=refresh,
    )

    # N5: per_contract + weekly contract → emit warning (not 400).
    # F5 修: use the `kind` field already populated by list_active_contracts
    # ("weekly_wed" / "weekly_fri") instead of substring-sniffing contract_date.
    if c and str(c.get("kind", "")).startswith("weekly"):
        existing = out.get("data_quality_warnings", [])
        warning = "per_contract_pcr_unsupported_for_weekly_consider_all_months"
        if warning not in existing:
            out = {**out, "data_quality_warnings": existing + [warning]}

    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/institutional")
async def get_institutional(
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    lookback: int = Query(default=60, ge=10, le=250),
    corr_window: int = Query(default=60, ge=10, le=250),
) -> dict:
    """SC-4 / SC-8: 三大法人 + foreign correlation."""
    d = date or _today_str()
    out = await get_finmind().fetch_institutional(
        d, lookback=lookback, corr_window=corr_window, refresh=refresh,
    )
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out
