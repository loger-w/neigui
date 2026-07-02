"""Client-disconnect cancel propagation.

Starlette 預設 route handler 不會因 client disconnect 而 cancel;搭配
`FinMindClient._run_once` 用 `asyncio.ensure_future` 建 top-level task,
caller cancel 也不會 cascade 到底層 fan-out。結果:切股票後舊 fan-out
繼續吃 rate token slot,新 request 排隊。

`run_with_disconnect` spawn 一個輕量 watcher polling
`request.is_disconnected()`,一斷線就 cancel task。搭配 `_run_once` 的
subscriber refcount,單一 client 斷線且無其他 subscriber 時,底層
FinMind fan-out 才會被 cancel(否則 shared inflight task 保留給還
listening 的 client)。

設計 rationale:2026-07-03 /perf api-cancel-and-rate-boost round 2 用戶
回報「S1 (前端 abort) 之後仍然感覺切完卡很久」。verify:code 讀完
ensure_future + is_disconnected 缺失,推理 chain 直接落地,不用 probe。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Coroutine, TypeVar

from starlette.requests import Request

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Poll interval 短一點抓到 disconnect 更快但 CPU 稍多。250ms 是 Starlette
# 慣例,足夠捕捉 user rapid pick 之間的間隔。
_POLL_INTERVAL_SEC = 0.25


async def run_with_disconnect(request: Request, coro: Coroutine[Any, Any, T]) -> T:
    """跑 coro,期間 poll client disconnect;斷線則 cancel task。

    Task cancel 會 propagate 進 httpx `AsyncClient.get()` 的 await point
    → socket close → FinMind upstream 停接收 response(節流 rate slot)。
    """
    task = asyncio.create_task(coro)
    watcher = asyncio.create_task(_watch_disconnect(request, task))
    try:
        return await task
    finally:
        # Task 完成(成功或失敗)後 watcher 不需要繼續 poll
        watcher.cancel()


async def _watch_disconnect(request: Request, task: asyncio.Task) -> None:
    try:
        while not task.done():
            # Starlette 的 is_disconnected 內部 receive 一個 http.disconnect
            # message;normal case 幾乎瞬間 return False(receive 有 buffer)
            if await request.is_disconnected():
                logger.info("client disconnected — cancelling in-flight route task")
                task.cancel()
                return
            await asyncio.sleep(_POLL_INTERVAL_SEC)
    except asyncio.CancelledError:
        # Route task 正常結束時 watcher 被 outer finally cancel — swallow
        pass
