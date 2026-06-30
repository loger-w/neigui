"""Clock indirection — 讓 E2E 凍 today() for fixture stability。

Production:  today() == date.today();  now() == datetime.now()
FAKE_FINMIND=1 + FAKE_TODAY=YYYY-MM-DD:  today() == date.fromisoformat(FAKE_TODAY)
                                          now()   == datetime.fromisoformat(f"{FAKE_TODAY}T13:30:00+08:00")

設計依據:.claude/feat/e2e-tests/design.md §1, §2 (R2-P0-3 + R3-P1-CLOCK-ROUTES)
"""

from __future__ import annotations

import os
from datetime import date, datetime


def today() -> date:
    if os.getenv("FAKE_FINMIND") == "1":
        s = os.getenv("FAKE_TODAY", "")
        if s:
            return date.fromisoformat(s)
    return date.today()


def now() -> datetime:
    if os.getenv("FAKE_FINMIND") == "1":
        s = os.getenv("FAKE_TODAY", "")
        if s:
            return datetime.fromisoformat(f"{s}T13:30:00+08:00")
    return datetime.now()
