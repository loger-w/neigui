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


def _is_zero_oi(payload: dict) -> bool:
    cur = payload.get("current", {})
    for grp in ("top5_prop", "top10_prop", "top5_all", "top10_all"):
        v = cur.get(grp, {})
        if v.get("long") or v.get("short"):
            return False
    return not payload.get("series")


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
    if d == _today_str() and _is_zero_oi(out):
        out = {**out, "no_trading_day": True}
    return out


@router.get("/api/options/strike_volume")
async def get_strike_volume(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    top_n: int = Query(default=10),
    refresh: bool = Query(default=False),
) -> dict:
    if not contract:
        raise HTTPException(status_code=400, detail={"error": "contract_required"})
    if top_n < 1 or top_n > 20:
        raise HTTPException(status_code=400, detail={"error": "top_n_out_of_range"})
    c = _resolve_contract(contract)
    if c is None:
        raise HTTPException(status_code=400, detail={"error": "invalid_contract"})
    d = date or _today_str()
    try:
        out = await get_finmind().fetch_strike_volume(c, d, top_n, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind options strike-vol error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected options strike-vol error")
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
    if d == _today_str() and not out.get("call") and not out.get("put"):
        out = {**out, "no_trading_day": True}
    return out
