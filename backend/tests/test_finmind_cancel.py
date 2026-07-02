"""Tests for `_run_once` subscriber-refcount cancel semantics.

Ensures:
1. 兩個並發 caller 用 shared inflight task,其中一個被 cancel 不會殺
   底層 task(其他 caller 還在 await)。
2. 最後一個 caller 被 cancel(refs -> 0)時,底層 task 立即 cancel,
   釋放 rate slot / httpx socket。
3. Task 已完成後才被 access,不會 double-pop。

Ties into /perf api-cancel-and-rate-boost round 2 — 用戶回報「切股票中途
切走,新股票載入很久」root cause 之一:orphan fan-out 繼續吃 rate token。
"""

from __future__ import annotations

import asyncio

import pytest

from services.finmind import FinMindClient


@pytest.fixture
def client() -> FinMindClient:
    # conftest 已處理 FINMIND_TOKEN + rate limiter 初始化;直接 new。
    return FinMindClient()


@pytest.mark.asyncio
async def test_shared_inflight_survives_one_caller_cancel(client: FinMindClient):
    """Caller A cancel 時,Caller B 應該仍能拿到結果(shared task 保留)。"""
    fetched = 0

    async def slow():
        nonlocal fetched
        await asyncio.sleep(0.1)
        fetched += 1
        return "ok"

    task_a = asyncio.create_task(client._run_once("k1", slow))
    task_b = asyncio.create_task(client._run_once("k1", slow))
    await asyncio.sleep(0.01)  # 讓兩者 subscribe 進 refs

    task_a.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task_a

    # B 應該正常拿到結果 — 底層 task 沒被 A 的 cancel 殺
    result_b = await task_b
    assert result_b == "ok"
    assert fetched == 1  # dedup 語意保留


@pytest.mark.asyncio
async def test_last_caller_cancel_cancels_underlying_task(client: FinMindClient):
    """所有 caller 都 cancel 時,底層 task 應該被 cancel(避免 orphan)。"""
    cancelled_marker = asyncio.Event()

    async def slow():
        try:
            await asyncio.sleep(10)  # 遠超測試時間
            return "should-not-return"
        except asyncio.CancelledError:
            cancelled_marker.set()
            raise

    task = asyncio.create_task(client._run_once("k2", slow))
    await asyncio.sleep(0.01)  # 讓 refs=1

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # 底層 task 應在下個 event loop tick 被 cancel
    await asyncio.wait_for(cancelled_marker.wait(), timeout=1.0)
    # inflight dict 應該被 pop 掉,下次同 key 進來走全新 task
    assert "k2" not in client._inflight


@pytest.mark.asyncio
async def test_completed_task_pops_cleanly(client: FinMindClient):
    """Task 正常完成時,inflight dict 應該被 pop,下次同 key 走 fresh task。"""
    call_count = 0

    async def once():
        nonlocal call_count
        call_count += 1
        return call_count

    r1 = await client._run_once("k3", once)
    assert r1 == 1
    assert "k3" not in client._inflight

    r2 = await client._run_once("k3", once)
    assert r2 == 2  # 新 task,不是 cache


@pytest.mark.asyncio
async def test_dedup_preserved_under_concurrent_callers(client: FinMindClient):
    """既有 dedup 契約 — 3 個並發同 key call 只實跑 1 次(regression lock)。"""
    call_count = 0

    async def slow():
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return call_count

    results = await asyncio.gather(
        client._run_once("k4", slow),
        client._run_once("k4", slow),
        client._run_once("k4", slow),
    )
    assert call_count == 1
    assert results == [1, 1, 1]
