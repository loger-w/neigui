"""Pure-function helpers for trading-day calendar arithmetic.

No I/O, no FinMind. Consumed by ``services.trading_calendar`` (which fetches
TaiwanFuturesDaily) and by hit-rate parsers that need to align on the
``settlement_date - 1 trading day`` rule (design v4 §4 / F3-correctness).
"""

from __future__ import annotations

from datetime import date


def count_back_trading_days(
    available_dates: list[date], end_date: date, n: int
) -> list[date]:
    """Return up to ``n`` most-recent trading days at or before ``end_date``.

    Args:
        available_dates: ascending-sorted list of dates that have data
            (e.g. TaiwanFuturesDaily rows). Caller is responsible for
            sorting — the helper trusts the contract (no defensive resort).
        end_date: target end. If ``end_date`` is past the latest available
            date (publication lag, R9), the latest available date is used
            as the working cap instead of erroring.
        n: number of trading days to return.

    Returns:
        A newest-first list. May be shorter than ``n`` if available history
        is insufficient. ``n == 0`` returns ``[]``.

    Raises:
        ValueError: when ``n`` is negative.
    """
    if n < 0:
        raise ValueError(f"n must be non-negative, got {n}")
    if n == 0:
        return []
    eligible = [d for d in available_dates if d <= end_date]
    if not eligible:
        return []
    tail = eligible[-n:]
    return list(reversed(tail))
