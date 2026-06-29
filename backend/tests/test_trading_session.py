"""SC-5 — Trading session helper (services/trading_session.py).

Pure-function tests, no IO. Tests cover boundaries (open/close minute),
weekday filter, lag computation, naive-tz fallback.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.trading_session import TPE_TZ, is_in_session


def test_in_session_weekday_mid_morning() -> None:
    """SC-5: 週一 10:30 + 30s lag → (True, 30)。"""
    now = datetime(2026, 6, 29, 10, 30, tzinfo=TPE_TZ)
    last_tick = datetime(2026, 6, 29, 10, 29, 30, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    assert in_session is True
    assert lag == 30


def test_pre_open_returns_false() -> None:
    """SC-5: 週一 08:50 → (False, lag_to_prev_close)。"""
    now = datetime(2026, 6, 29, 8, 50, tzinfo=TPE_TZ)
    last_tick = datetime(2026, 6, 28, 13, 30, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    assert in_session is False
    assert lag is not None


def test_after_close_returns_false() -> None:
    """SC-5: 週一 14:00 + last_tick 13:30 → (False, 1800)。"""
    now = datetime(2026, 6, 29, 14, 0, tzinfo=TPE_TZ)
    last_tick = datetime(2026, 6, 29, 13, 30, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    assert in_session is False
    assert lag == 1800


def test_weekend_returns_false() -> None:
    """E6: 週日 → (False, lag)。2026-06-28 is Sunday."""
    now = datetime(2026, 6, 28, 10, 30, tzinfo=TPE_TZ)
    last_tick = datetime(2026, 6, 26, 13, 30, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    assert in_session is False
    assert lag is not None


def test_no_last_tick_returns_false() -> None:
    """E6 / E7: last_tick=None → (False, None)。"""
    now = datetime(2026, 6, 29, 10, 30, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, None)
    assert in_session is False
    assert lag is None


def test_stale_lag_in_window_returns_false() -> None:
    """SC-5: 週一 10:30 + last_tick 比 now 早 70s → in_session=False(lag > 60)。"""
    now = datetime(2026, 6, 29, 10, 30, tzinfo=TPE_TZ)
    last_tick = datetime(2026, 6, 29, 10, 28, 50, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    assert in_session is False
    assert lag == 70


def test_negative_lag_safe() -> None:
    """Defensive: last_tick > now → lag 負 → in_session=False。"""
    now = datetime(2026, 6, 29, 10, 0, tzinfo=TPE_TZ)
    last_tick = datetime(2026, 6, 29, 10, 5, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    assert in_session is False
    assert lag == -300


def test_session_open_boundary() -> None:
    """E5: 09:00:00 just open → in_session=True(lag ≤ 60)。"""
    now = datetime(2026, 6, 29, 9, 0, 0, tzinfo=TPE_TZ)
    last_tick = datetime(2026, 6, 29, 8, 59, 30, tzinfo=TPE_TZ)
    in_session, lag = is_in_session(now, last_tick)
    assert in_session is True
    assert lag == 30


def test_session_close_boundary() -> None:
    """E5: 13:30:00 just close → in_session=True(若 lag ≤ 60),13:30:01 → False(>13:30 不在窗)。"""
    now_close = datetime(2026, 6, 29, 13, 30, 0, tzinfo=TPE_TZ)
    last_tick_close = datetime(2026, 6, 29, 13, 29, 30, tzinfo=TPE_TZ)
    in_session, _ = is_in_session(now_close, last_tick_close)
    assert in_session is True

    now_after = datetime(2026, 6, 29, 13, 30, 1, tzinfo=TPE_TZ)
    in_session_after, _ = is_in_session(now_after, last_tick_close)
    assert in_session_after is False


def test_naive_last_tick_treated_as_tpe() -> None:
    """v3 B1: FinMind ISO string parse 通常無 tz。傳 naive datetime 不應 TypeError,
    且 lag 計算正確(視同 TPE wall clock)。"""
    now = datetime(2026, 6, 29, 10, 30, tzinfo=TPE_TZ)
    last_tick_naive = datetime(2026, 6, 29, 10, 29, 30)  # 無 tzinfo
    in_session, lag = is_in_session(now, last_tick_naive)
    assert in_session is True
    assert lag == 30


def test_pre_open_lag_value_locked() -> None:
    """v3 B2 / Phase 4 R9 修:
    週一 08:50 vs 上週五 13:30(真實 Friday = 2026-06-26)→
    lag = 約 67h20m = 242400s。"""
    now = datetime(2026, 6, 29, 8, 50, tzinfo=TPE_TZ)
    # 2026-06-26 是上週五 (2026-06-29 為週一);原 2026-06-28 為 Sunday
    last_tick = datetime(2026, 6, 26, 13, 30, tzinfo=TPE_TZ)
    _, lag = is_in_session(now, last_tick)
    # 67h20m = 242400
    assert lag == 242400
