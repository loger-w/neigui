"""Inflight dedup(subscriber refcount + shield)— 全 backend 唯一實作。

2026-07-21 自 9 份模組級複本 + FinMindClient method 版收斂(spec F-3);
語意以 refcount 版為準(2026-07-03 prd 500 修正版,為裸 await 版的超集)。
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable


async def run_once(
    registry: dict[str, dict[str, Any]],
    key: str,
    coro_fn: Callable[[], Awaitable[Any]],
) -> Any:
    """Inflight dedup with subscriber refcount.

    `asyncio.shield` 讓 caller cancel(client disconnect)不會直接殺底層
    task — 因為可能有別的 caller 也在 await 同一個 shared fetch。改用
    refcount:每個 caller +1;caller 離開(正常回或被 cancel)-1;
    歸 0 才 cancel 底層 task。

    搭配 `utils.cancel.run_with_disconnect`:route handler 被 cancel →
    `run_once` raise CancelledError → refs 減 → 若無其他 subscriber
    則 cancel fan-out task → httpx / rate_limiter.acquire_async 內
    `asyncio.sleep(wait)` 拿到 CancelledError → 停止吃 rate token slot。

    entry 形狀 `{"task": Task, "refs": int}` 是測試契約(test_finmind_realtime
    直接斷言 refs);registry 保留各 caller 模組級(conftest
    `_reset_realtime_task_registries` 清理契約,新增模組級 registry 必掛進該 fixture)。
    """
    entry = registry.get(key)
    if entry is None:
        entry = {"task": asyncio.ensure_future(coro_fn()), "refs": 0}
        registry[key] = entry
    entry["refs"] += 1
    try:
        return await asyncio.shield(entry["task"])
    finally:
        entry["refs"] -= 1
        if entry["refs"] == 0:
            if not entry["task"].done():
                entry["task"].cancel()
            registry.pop(key, None)
