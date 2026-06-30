"""Trading-day calendar service (design v4 §2.2 + I2 + R13).

Owns the I/O + cache layer for TaiwanFuturesDaily-derived trading dates.
Pure arithmetic lives in ``utils.trading_calendar_helpers``.

**Why this module exists separately from services/finmind.FinMindClient**:
``services.finmind.fetch_taiwan_option_daily_window`` would need to know
*which* trading-days to fetch, which in turn requires this calendar
helper. Putting calendar I/O inside FinMindClient would create a circular
dependency in callers. Putting it in utils/ would violate the
"no I/O in utils" layering (cache.py confirmed). So: services/, with its
own httpx call that reuses the shared rate limiter.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta

import httpx

from services import clock
from services.finmind import _FINMIND_BASE, get_finmind_rate_limiter
from utils.cache import atomic_write_json, chip_cache_dir, read_json
from utils.trading_calendar_helpers import count_back_trading_days

_CACHE_KEY = "tx_trading_days_cache"
_CACHE_VERSION = 1  # bump if cache schema changes
_CACHE_TTL_SECONDS = 12 * 3600  # half-day: covers morning + afternoon openings;
# was 7 days but the cache stores the dates-list-as-of-fetch, so a week-old
# cache returns dates ending up to 6 days ago → all downstream window fetches
# silently skip recent trading days (data quality bug).
_BACKFILL_DAYS = 400  # fetch ~1 trading year + headroom


async def get_trading_days(end_date: date, n: int) -> list[date]:
    """Return up to ``n`` most-recent trading days at or before ``end_date``.

    Newest-first. Uses a 7-day filesystem cache to avoid hitting FinMind
    for trading-calendar lookups on every request.

    On publication lag (end_date > latest TaiwanFuturesDaily date),
    silently falls back to the latest available date (R9 / N6).
    """
    available = await _read_or_fetch_dates()
    return count_back_trading_days(available, end_date, n)


async def _read_or_fetch_dates() -> list[date]:
    """Cache layer in front of ``_fetch_raw_dates_from_finmind``."""
    cached = _read_cache()
    if cached is not None and not _is_stale(cached):
        return [date.fromisoformat(d) for d in cached["dates"]]
    dates = await _fetch_raw_dates_from_finmind()
    _write_cache(dates)
    return dates


def _read_cache() -> dict | None:
    payload = read_json(chip_cache_dir() / f"{_CACHE_KEY}.json", default=None)
    if not payload or payload.get("_cache_version") != _CACHE_VERSION:
        return None
    payload.pop("_cache_version", None)
    return payload


def _write_cache(dates: list[date]) -> None:
    atomic_write_json(
        chip_cache_dir() / f"{_CACHE_KEY}.json",
        {
            "_cache_version": _CACHE_VERSION,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "dates": [d.isoformat() for d in dates],
        },
    )


def _is_stale(cached: dict) -> bool:
    fetched = cached.get("fetched_at", "")
    if not fetched:
        return True
    try:
        dt = datetime.fromisoformat(fetched)
    except ValueError:
        return True
    return (datetime.now() - dt).total_seconds() > _CACHE_TTL_SECONDS


async def _fetch_raw_dates_from_finmind() -> list[date]:
    """Direct httpx call against TaiwanFuturesDaily (avoids FinMindClient
    to prevent a circular import; design v4 I2)。

    E2E fake-mode 旁路:讀 tests_e2e/fixtures/TaiwanFuturesDaily_TX_calendar.json
    取代 httpx 呼叫(R2-P0-3 / R3-P1-CLOCK-ROUTES)。
    """
    if os.getenv("FAKE_FINMIND") == "1":
        import json
        from pathlib import Path

        fixture_dir = Path(
            os.getenv(
                "FAKE_FINMIND_FIXTURES_DIR",
                str(Path(__file__).resolve().parent.parent / "tests_e2e" / "fixtures"),
            )
        )
        fixture = fixture_dir / "TaiwanFuturesDaily_TX_calendar.json"
        payload = json.loads(fixture.read_text(encoding="utf-8"))
        rows = payload.get("data", payload) if isinstance(payload, dict) else payload
        seen: set[date] = set()
        for row in rows:
            d_str = row.get("date")
            if d_str:
                try:
                    seen.add(date.fromisoformat(d_str))
                except ValueError:
                    continue
        return sorted(seen)
    token = os.environ.get("FINMIND_TOKEN", "").strip()
    if not token:
        raise ValueError("FINMIND_TOKEN env var is required")
    await get_finmind_rate_limiter().acquire_async()
    today = clock.today()
    start = today - timedelta(days=_BACKFILL_DAYS)
    params = {
        "dataset": "TaiwanFuturesDaily",
        "data_id": "TX",
        "start_date": start.isoformat(),
        "end_date": today.isoformat(),
    }
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30.0) as cli:
        resp = await cli.get(f"{_FINMIND_BASE}/data", params=params, headers=headers)
        resp.raise_for_status()
        body = resp.json()
    rows = body.get("data", [])
    seen: set[date] = set()
    for row in rows:
        d_str = row.get("date")
        if d_str:
            try:
                seen.add(date.fromisoformat(d_str))
            except ValueError:
                continue
    return sorted(seen)
