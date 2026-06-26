"""Tests for fetch_taiwan_option_daily_window cross-end_date persistent cache.

Behaviour contract (perf 2026-06-26):
- First fetch fans out one FinMind call per trading_date.
- Second fetch with overlapping trading_dates re-uses cached per-day rows;
  only NEW days trigger a FinMind call.
- ``refresh=True`` re-fetches the most-recent ~2 days (today + yesterday) to
  pick up publication-lag updates, but does NOT re-fetch frozen historical
  days.
- Return shape is unchanged: ``{date_iso: list[dict]}``.
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
        assert out[d.isoformat()] == [_row(d)]


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
