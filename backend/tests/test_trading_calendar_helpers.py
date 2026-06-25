"""Tests for backend.utils.trading_calendar_helpers (SC-0 / R13 support).

Pure-function tests: no I/O, no FinMind. count_back_trading_days computes
'last n AVAILABLE trading days ending at end_date' from a precomputed list
of dates (typically from TaiwanFuturesDaily). The function must handle
publication lag (end_date later than latest available row) gracefully.
"""
from __future__ import annotations

from datetime import date

import pytest

from utils.trading_calendar_helpers import count_back_trading_days


def _d(s: str) -> date:
    return date.fromisoformat(s)


def test_returns_last_n_dates_from_available_list():
    dates = [_d(f"2026-06-{d}") for d in range(15, 26)]  # 15..25 inclusive
    out = count_back_trading_days(dates, end_date=_d("2026-06-25"), n=3)
    # newest first, then 2 days back
    assert out == [_d("2026-06-25"), _d("2026-06-24"), _d("2026-06-23")]


def test_walks_back_past_end_date_when_end_not_in_list_publication_lag(tmp_path):
    """R9 修 + N6 修:end_date 是 Sat 但 dataset 最後一筆是 Fri (publication lag).
    Helper should return Fri as 'latest available' and walk back from there."""
    dates = [_d(d) for d in ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"]]
    out = count_back_trading_days(dates, end_date=_d("2026-06-27"), n=2)  # Sat (no data)
    assert out == [_d("2026-06-25"), _d("2026-06-24")]


def test_skips_weekend_gaps_in_available_list():
    """available dates 自然不含 weekend; helper just walks the list."""
    dates = [_d(d) for d in [
        "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26",  # Mon-Fri
        "2026-06-29", "2026-06-30",                                              # Mon, Tue
    ]]
    out = count_back_trading_days(dates, end_date=_d("2026-06-30"), n=5)
    assert out == [
        _d("2026-06-30"), _d("2026-06-29"),
        _d("2026-06-26"), _d("2026-06-25"), _d("2026-06-24"),
    ]


def test_handles_n_larger_than_available_returns_all():
    dates = [_d("2026-06-22"), _d("2026-06-23")]
    out = count_back_trading_days(dates, end_date=_d("2026-06-25"), n=10)
    assert out == [_d("2026-06-23"), _d("2026-06-22")]


def test_returns_empty_when_end_before_any_available():
    dates = [_d("2026-06-22"), _d("2026-06-23")]
    out = count_back_trading_days(dates, end_date=_d("2025-01-01"), n=3)
    assert out == []


def test_handles_holiday_clusters_cny():
    """F9-correctness: Taiwan New Year typically 9 calendar days no trading.
    Available list has gap; helper just walks the list, returning what's available."""
    # 模擬 CNY 2026 假設 Feb 16-24 全部不交易
    dates = [_d(d) for d in [
        "2026-02-13",  # Fri before CNY
        "2026-02-25", "2026-02-26", "2026-02-27",  # post-CNY
    ]]
    out = count_back_trading_days(dates, end_date=_d("2026-02-27"), n=4)
    # 4 days requested but 4 days available — returns all 4 (newest first)
    assert out == [_d("2026-02-27"), _d("2026-02-26"), _d("2026-02-25"), _d("2026-02-13")]


def test_n_zero_returns_empty():
    dates = [_d("2026-06-25")]
    assert count_back_trading_days(dates, end_date=_d("2026-06-25"), n=0) == []


def test_negative_n_raises():
    with pytest.raises(ValueError):
        count_back_trading_days([_d("2026-06-25")], end_date=_d("2026-06-25"), n=-1)


def test_dates_must_be_sorted_ascending():
    """Caller guarantees ascending sort; helper trusts it (no defensive re-sort)."""
    dates = [_d("2026-06-25"), _d("2026-06-26")]  # ascending
    out = count_back_trading_days(dates, end_date=_d("2026-06-26"), n=2)
    assert out == [_d("2026-06-26"), _d("2026-06-25")]
