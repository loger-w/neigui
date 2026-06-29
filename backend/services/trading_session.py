"""Pure trading-session helpers — no I/O.

Used by services/finmind_realtime.py to compute is_trading_session + lag.
Split out so the time-of-day / weekday logic is unit-testable without
touching FinMind, datetime mocking, or the universe cache.

design.md §5.4
"""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone

logger = logging.getLogger(__name__)

TPE_TZ = timezone(timedelta(hours=8))
SESSION_OPEN = time(9, 0)
SESSION_CLOSE = time(13, 30)
MAX_LAG_SECONDS_IN_SESSION = 60


def is_in_session(
    now: datetime,
    last_tick: datetime | None,
) -> tuple[bool, int | None]:
    """Compute (in_session, lag_seconds).

    in_session = (TPE weekday Mon-Fri) AND
                 (TPE 09:00 ≤ now ≤ 13:30) AND
                 (last_tick exists AND 0 ≤ lag ≤ MAX_LAG_SECONDS_IN_SESSION)

    `now` 必須 tz-aware。`last_tick` 為 naive 時(FinMind 的 `date` 欄位
    ISO string parse 通常無 tz),內部視為 TPE 本地時間 — 透過顯式
    normalisation 避免 naive - aware → TypeError(v3 review B1 修)。
    """
    if last_tick is None:
        return False, None

    # v3 B1 fix — explicit tzinfo normalisation
    if last_tick.tzinfo is None:
        last_tick = last_tick.replace(tzinfo=TPE_TZ)

    lag = int((now - last_tick).total_seconds())

    now_tpe = now.astimezone(TPE_TZ)
    weekday = now_tpe.weekday()  # Mon=0 .. Sun=6
    t = now_tpe.time()
    in_window = weekday < 5 and SESSION_OPEN <= t <= SESSION_CLOSE
    in_session = in_window and 0 <= lag <= MAX_LAG_SECONDS_IN_SESSION
    return in_session, lag
