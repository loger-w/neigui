"""Tests for fetch_taiwan_option_daily_window cross-end_date persistent cache.

Behaviour contract (perf 2026-06-26):
- First fetch fans out one FinMind call per trading_date.
- Second fetch with overlapping trading_dates re-uses cached per-day rows;
  only NEW days trigger a FinMind call.
- ``refresh=True`` re-fetches the most-recent ~2 days (today + yesterday) to
  pick up publication-lag updates, but does NOT re-fetch frozen historical
  days.
- Return shape is ``{date_iso: list[dict]}``; rows are the slim 5-field form
  (perf 2026-07-20): aggregated OI per (option_id, contract_date, call_put,
  strike_price) across trading_session, zero-OI entries dropped. Consumers
  (max_pain / oi_walls / pcr parsers) only ever read those 5 fields and
  re-aggregate additively, so slim rows are semantically equivalent to raw.
"""

from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest


def _row(d: date, strike: int = 21000, oi: int = 100) -> dict:
    return {
        "date": d.isoformat(),
        "option_id": "TXO",
        "contract_date": "202607",
        "call_put": "call",
        "strike_price": strike,
        "open_interest": oi,
        "trading_session": "position",
    }


def _slim_row(strike: int = 21000, oi: int = 100) -> dict:
    """Expected materialized slim row for a single ``_row`` fetch."""
    return {
        "option_id": "TXO",
        "contract_date": "202607",
        "call_put": "call",
        "strike_price": float(strike),
        "open_interest": oi,
    }


@pytest.fixture
def patched_finmind(monkeypatch, bypass_finmind_rate_limiter):
    """Build a FinMindClient with `_get` patched to record per-call args.

    Returns a tuple (client, get_mock). Each call to client._get(url, params)
    returns the rows associated with params["start_date"].
    """
    import services.finmind as fm

    client = fm.get_finmind()

    async def fake_get(url: str, params: dict) -> list:
        d = date.fromisoformat(params["start_date"])
        return [_row(d)]

    get_mock = AsyncMock(side_effect=fake_get)
    monkeypatch.setattr(client, "_get", get_mock)
    return client, get_mock


async def test_window_first_fetch_calls_finmind_once_per_date(patched_finmind):
    client, get_mock = patched_finmind
    end = date(2026, 6, 26)
    dates = [end - timedelta(days=i) for i in range(5)]  # 5 trading days

    out = await client.fetch_taiwan_option_daily_window(
        sorted(dates),
        end_date=end,
        refresh=False,
    )

    assert get_mock.await_count == 5
    assert set(out.keys()) == {d.isoformat() for d in dates}
    for d in dates:
        assert out[d.isoformat()] == [_slim_row()]


async def test_window_second_fetch_overlap_only_refetches_new_days(
    patched_finmind,
):
    """The killer use-case: yesterday's window cache must still help when the
    user opens the dashboard the next morning. Only the new (uncovered) days
    should hit FinMind.
    """
    client, get_mock = patched_finmind
    monday = date(2026, 6, 22)
    week_one = [monday + timedelta(days=i) for i in range(5)]  # Mon..Fri
    await client.fetch_taiwan_option_daily_window(
        week_one,
        end_date=week_one[-1],
        refresh=False,
    )
    first_calls = get_mock.await_count
    assert first_calls == 5

    # Next call: window slides one day forward. 4 days overlap, 1 new.
    next_monday = monday + timedelta(days=7)
    week_two = [next_monday + timedelta(days=i) for i in range(5)]
    overlap_dates = sorted(set(week_one[1:]) | set(week_two))
    await client.fetch_taiwan_option_daily_window(
        overlap_dates,
        end_date=overlap_dates[-1],
        refresh=False,
    )
    # 4 of week_one[1:] are cached → 5 new (week_two) should have been fetched
    new_calls = get_mock.await_count - first_calls
    assert new_calls == 5, f"expected 5 new FinMind calls for week_two; got {new_calls}"


async def test_window_returns_same_shape_as_before(patched_finmind):
    """Compatibility: callers iterate the returned dict by ISO date string."""
    client, _ = patched_finmind
    end = date(2026, 6, 26)
    dates = [end - timedelta(days=i) for i in range(3)]
    out = await client.fetch_taiwan_option_daily_window(
        sorted(dates),
        end_date=end,
        refresh=False,
    )
    assert isinstance(out, dict)
    for k, v in out.items():
        assert isinstance(k, str) and len(k) == 10
        assert isinstance(v, list)


async def test_window_refresh_only_refetches_recent_days(patched_finmind):
    """refresh=True must NOT re-fetch historical days (they're frozen).
    It re-fetches only the trailing ~2 days to pick up publication lag.
    """
    client, get_mock = patched_finmind
    end = date(2026, 6, 26)
    dates = sorted(end - timedelta(days=i) for i in range(10))
    # warm
    await client.fetch_taiwan_option_daily_window(dates, end_date=end, refresh=False)
    warmed = get_mock.await_count
    assert warmed == 10

    # refresh — should only re-fetch the trailing 2 days, not all 10
    await client.fetch_taiwan_option_daily_window(dates, end_date=end, refresh=True)
    refresh_calls = get_mock.await_count - warmed
    assert 1 <= refresh_calls <= 2, f"refresh should re-fetch ~2 trailing days, got {refresh_calls}"


async def test_window_today_30min_stale_window(monkeypatch, patched_finmind):
    """Today's per-day cache must respect a 30-min stale window so morning
    fetches don't pin stale data for the full trading session.
    """
    client, get_mock = patched_finmind
    today = date.today()
    dates = sorted(today - timedelta(days=i) for i in range(3))
    await client.fetch_taiwan_option_daily_window(
        dates,
        end_date=today,
        refresh=False,
    )
    assert get_mock.await_count == 3

    # Simulate today's cache being stale by patching _is_stale to always True
    monkeypatch.setattr(client, "_is_stale", lambda *_a, **_kw: True)

    await client.fetch_taiwan_option_daily_window(
        dates,
        end_date=today,
        refresh=False,
    )
    new = get_mock.await_count - 3
    # Only today's row should refetch (historical days remain final)
    assert new == 1, f"expected only today to refetch on stale, got {new}"


async def test_window_slim_migrates_from_raw_without_finmind_call(patched_finmind):
    """A pre-slim raw ``txo_daily_{d}`` cache must be converted to the slim
    form in place (slim file written, raw deleted) WITHOUT hitting FinMind —
    otherwise every deploy would re-burn a 250-call fan-out.
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

    client, get_mock = patched_finmind
    d = date(2026, 6, 24)
    raw_rows = [
        {**_row(d, strike=21000, oi=100), "trading_session": "position"},
        {**_row(d, strike=21000, oi=50), "trading_session": "after_market"},
        {**_row(d, strike=21200, oi=0)},  # zero-OI → dropped in slim
    ]
    client._write_cache_v(
        f"txo_daily_{d.isoformat()}",
        {"rows": raw_rows, "fetched_at": "2026-06-24T15:00:00"},
        _CACHE_VERSION_OPTIONS_CHIP,
    )

    out = await client.fetch_taiwan_option_daily_window(
        [d],
        end_date=d,
        refresh=False,
    )

    assert get_mock.await_count == 0, "migration must not call FinMind"
    assert out[d.isoformat()] == [_slim_row(strike=21000, oi=150)]
    assert client._cache_path(f"txo_slim_{d.isoformat()}").exists()
    assert not client._cache_path(f"txo_daily_{d.isoformat()}").exists(), (
        "raw per-day cache must be deleted after slim migration (402MB reclaim)"
    )

    # Second read must be served from the slim file alone.
    out2 = await client.fetch_taiwan_option_daily_window([d], end_date=d, refresh=False)
    assert get_mock.await_count == 0
    assert out2[d.isoformat()] == [_slim_row(strike=21000, oi=150)]


async def test_window_slim_aggregates_sessions_and_drops_zero_oi(
    monkeypatch,
    bypass_finmind_rate_limiter,
):
    """Fresh FinMind fetch → slim rows: OI summed across sessions per
    (option_id, contract_date, call_put, strike), zero-OI and unknown
    call_put entries dropped, deterministic sort order.
    """
    import services.finmind as fm

    client = fm.get_finmind()
    d = date(2026, 6, 25)

    async def fake_get(url: str, params: dict) -> list:
        base = {"date": d.isoformat(), "option_id": "TXO"}
        return [
            {
                **base,
                "contract_date": "202607",
                "call_put": "call",
                "strike_price": 21000,
                "open_interest": 100,
                "trading_session": "position",
            },
            {
                **base,
                "contract_date": "202607",
                "call_put": "call",
                "strike_price": 21000,
                "open_interest": 40,
                "trading_session": "after_market",
            },
            {
                **base,
                "contract_date": "202607",
                "call_put": "put",
                "strike_price": 20800,
                "open_interest": 7,
                "trading_session": "position",
            },
            {
                **base,
                "contract_date": "202607",
                "call_put": "call",
                "strike_price": 21400,
                "open_interest": 0,
                "trading_session": "position",
            },
            {
                **base,
                "contract_date": "202607",
                "call_put": "otc",
                "strike_price": 21000,
                "open_interest": 9,
                "trading_session": "position",
            },
            {
                **base,
                "contract_date": "202607",
                "call_put": "put",
                "strike_price": "bad",
                "open_interest": 5,
                "trading_session": "position",
            },
        ]

    monkeypatch.setattr(client, "_get", AsyncMock(side_effect=fake_get))

    out = await client.fetch_taiwan_option_daily_window([d], end_date=d, refresh=False)

    assert out[d.isoformat()] == [
        {
            "option_id": "TXO",
            "contract_date": "202607",
            "call_put": "call",
            "strike_price": 21000.0,
            "open_interest": 140,
        },
        {
            "option_id": "TXO",
            "contract_date": "202607",
            "call_put": "put",
            "strike_price": 20800.0,
            "open_interest": 7,
        },
    ]


# ---------------------------------------------------------------------------
# S2: strike_volume per-day cache (txo_sv_*) — perf/options-market-load
# ---------------------------------------------------------------------------


_SV_CONTRACT = {"option_id": "TXO", "contract_date": "202607", "contract_type": "202607"}


async def test_strike_volume_per_day_cache_only_refetches_today(patched_finmind):
    """First fetch fans out one call per calendar day in the 8-day range;
    sliding end_date forward one day re-uses 7 cached days → exactly 1 new
    FinMind call (mirrors the oi_lt / window per-day amortisation contract).
    """
    client, get_mock = patched_finmind
    end = date(2026, 6, 26)

    await client.fetch_strike_volume(_SV_CONTRACT, end.isoformat())
    first = get_mock.await_count
    assert first == 8, f"8-calendar-day range should fan out 8 per-day calls, got {first}"

    await client.fetch_strike_volume(_SV_CONTRACT, (end + timedelta(days=1)).isoformat())
    assert get_mock.await_count == first + 1, "7 overlapping days must come from txo_sv cache"


async def test_strike_volume_day_cache_vol_sum_oi_max(
    monkeypatch,
    bypass_finmind_rate_limiter,
):
    """Per-day slim keeps parse_strike_volume's session semantics — volume
    SUMMED, OI MAXed across trading_session — and drops rows whose own date
    differs from the requested day (defensive against upstream range bleed).
    """
    import services.finmind as fm

    client = fm.get_finmind()
    end = date(2026, 6, 25)

    async def fake_get(url: str, params: dict) -> list:
        d_iso = params["start_date"]
        if d_iso != end.isoformat():
            return []
        base = {
            "option_id": "TXO",
            "contract_date": "202607",
            "call_put": "call",
            "strike_price": 21000,
        }
        return [
            {
                **base,
                "date": d_iso,
                "volume": 10,
                "open_interest": 100,
                "trading_session": "position",
            },
            {
                **base,
                "date": d_iso,
                "volume": 5,
                "open_interest": 40,
                "trading_session": "after_market",
            },
            # range-bleed row: wrong date → must be excluded from this day
            {
                **base,
                "date": "2026-06-30",
                "volume": 99,
                "open_interest": 999,
                "trading_session": "position",
            },
        ]

    monkeypatch.setattr(client, "_get", AsyncMock(side_effect=fake_get))

    out = await client.fetch_strike_volume(_SV_CONTRACT, end.isoformat())

    assert out["as_of_date"] == end.isoformat()
    assert out["call"] == [
        {"strike": 21000, "volume": 15, "oi": 100, "oi_change": 0},
    ]
