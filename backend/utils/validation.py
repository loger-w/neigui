"""Request query-param 驗證 helpers(400 error contract `{"error": "<code>"}`)。

2026-07-21 自三處 date 驗證複本收斂(spec F-3):錯誤碼與嚴格度差異
以參數保留 — 統一是行為改動(/mod 候選,見 docs/next-time.md),不在收斂範圍。
"""

from __future__ import annotations

import re
from datetime import date

from fastapi import HTTPException

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_date_param(value: str, *, error_code: str = "bad_date", strict: bool = True) -> date:
    """YYYY-MM-DD query 參數 → `date`;非法 raise 400 `{"error": error_code}`。

    strict=True 加 regex 形狀驗(R2-2:擋 fromisoformat 接受的 `20260721` 等
    ISO 變體,與 `2026-13-99` 形狀合法但日曆非法分開處理);strict=False 僅
    fromisoformat — 保留 daytrade_fee / broker_flows 收斂前的寬鬆行為。
    """
    if strict and not _DATE_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail={"error": error_code})
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": error_code}) from exc
