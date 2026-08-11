"""Clock indirection — 讓 E2E 凍 today() for fixture stability。

Production:  today() == datetime.now(TAIPEI).date();  now() == datetime.now(TAIPEI)
FAKE_FINMIND=1 + FAKE_TODAY=YYYY-MM-DD:  today() == date.fromisoformat(FAKE_TODAY)
                                          now()   == datetime.fromisoformat(f"{FAKE_TODAY}T13:30:00+08:00")

兩個分支的 now() 都回 tz-aware(+08:00)datetime — 部署在 UTC 主機時,裸
date.today() 會在台北 00:00–08:00 窗口回前一天,交易日判斷因此偏移。

設計依據:.claude/feat/e2e-tests/design.md §1, §2 (R2-P0-3 + R3-P1-CLOCK-ROUTES)
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

# 台灣無 DST,固定 +08:00 即正確;刻意不用 zoneinfo(Windows 下要多拉 tzdata)。
TAIPEI = timezone(timedelta(hours=8))


def today() -> date:
    if os.getenv("FAKE_FINMIND") == "1":
        s = os.getenv("FAKE_TODAY", "")
        if s:
            return date.fromisoformat(s)
    return datetime.now(TAIPEI).date()


def now() -> datetime:
    if os.getenv("FAKE_FINMIND") == "1":
        s = os.getenv("FAKE_TODAY", "")
        if s:
            return datetime.fromisoformat(f"{s}T13:30:00+08:00")
    return datetime.now(TAIPEI)
