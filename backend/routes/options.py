"""Options chip API routes."""
from __future__ import annotations

import logging
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Query

from services.finmind import get_finmind
from services.finmind_options import list_active_contracts

logger = logging.getLogger(__name__)
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


@router.get("/api/options/oi_large_traders")
async def get_oi_large_traders(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    if not contract:
        raise HTTPException(status_code=400, detail={"error": "contract_required"})
    c = _resolve_contract(contract)
    if c is None:
        raise HTTPException(status_code=400, detail={"error": "invalid_contract"})
    d = date or _today_str()
    try:
        out = await get_finmind().fetch_oi_large_traders(c, d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind options OI error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected options OI error")
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/spot")
async def get_spot(
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today_str()
    try:
        out = await get_finmind().fetch_spot(d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind spot error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected spot error")
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/strike_volume")
async def get_strike_volume(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    if not contract:
        raise HTTPException(status_code=400, detail={"error": "contract_required"})
    c = _resolve_contract(contract)
    if c is None:
        raise HTTPException(status_code=400, detail={"error": "invalid_contract"})
    d = date or _today_str()
    try:
        out = await get_finmind().fetch_strike_volume(c, d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind options strike-vol error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected options strike-vol error")
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out
