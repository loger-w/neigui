"""Startup path contract: lifespan 不得 block 在 symbols 的 FinMind fetch 上(perf/cold-start)。

Background: lifespan 曾在 yield 前 await load_symbols() — FinMind TaiwanStockInfo
回應前 app 不 serve 任何流量,Railway sleep 喚醒 / redeploy 的每一發冷啟動都吃
整段 fetch(local 實測 0.7s,prod 被 US→TW RTT 放大)。
"""

from __future__ import annotations

import asyncio
import contextlib

import pytest

import routes.symbols as symbols_mod
from main import app


@pytest.fixture(autouse=True)
def _stub_warrant_prewarm(monkeypatch):
    """lifespan 會 spawn 權證快照預熱(真 TWSE 網路);本檔只驗 symbols 隔離 —
    stub 掉並記錄呼叫,防 unit test 在 cancel 競態窗內對 TWSE 發真請求
    (unit tests 的 conftest 刻意 delenv FAKE_FINMIND,不會走 FAKE no-op)。"""
    from services import warrants as ws

    calls = {"n": 0}
    monkeypatch.setattr(
        ws, "ensure_prewarm_task", lambda: calls.__setitem__("n", calls["n"] + 1)
    )
    return calls


async def test_lifespan_spawns_warrant_prewarm(_stub_warrant_prewarm, monkeypatch) -> None:
    # 痛點:lifespan 若漏接 ensure_prewarm_task,每日首開退回冷 build(46s 級)
    release = asyncio.Event()

    async def hanging_load() -> None:
        await release.wait()

    monkeypatch.setattr(symbols_mod, "load_symbols", hanging_load)
    cm = app.router.lifespan_context(app)
    await asyncio.wait_for(cm.__aenter__(), timeout=1.0)
    try:
        assert _stub_warrant_prewarm["n"] == 1
    finally:
        release.set()
        await cm.__aexit__(None, None, None)


async def test_lifespan_startup_not_blocked_by_symbols_load(monkeypatch) -> None:
    # 痛點:load_symbols 若卡住(FinMind 慢 / 網路 hang),app ready 不得被拖著走。
    # 用永不完成的 load 證明 startup 與 symbols 載入脫鉤。
    release = asyncio.Event()

    async def hanging_load() -> None:
        await release.wait()

    monkeypatch.setattr(symbols_mod, "load_symbols", hanging_load)
    cm = app.router.lifespan_context(app)
    entered = False
    try:
        await asyncio.wait_for(cm.__aenter__(), timeout=1.0)
        entered = True
    finally:
        release.set()
        if entered:
            await cm.__aexit__(None, None, None)


async def test_concurrent_ensure_loaded_shares_one_load(monkeypatch) -> None:
    # 痛點:並發空狀態曾各自打一次 FinMind(N 個請求 N 發);dedup 後只准一次。
    calls = 0

    async def slow_load() -> None:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.02)
        symbols_mod._symbols = [{"symbol": "2330", "name": "台積電"}]

    monkeypatch.setattr(symbols_mod, "_symbols", [])
    monkeypatch.setattr(symbols_mod, "load_symbols", slow_load)
    await asyncio.gather(symbols_mod._ensure_loaded(), symbols_mod._ensure_loaded())
    assert calls == 1


async def test_awaiter_cancel_does_not_cancel_shared_task(monkeypatch) -> None:
    # 痛點:client 斷線的 CancelledError 若傳導進共用 task,一個斷線請求會
    # 毒殺所有共乘請求(cancel-chain 慣例:inflight dedup 必須 shield)。
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_load() -> None:
        started.set()
        await release.wait()
        symbols_mod._symbols = [{"symbol": "2330", "name": "台積電"}]

    monkeypatch.setattr(symbols_mod, "_symbols", [])
    monkeypatch.setattr(symbols_mod, "load_symbols", slow_load)
    waiter = asyncio.create_task(symbols_mod._ensure_loaded())
    await started.wait()
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    shared = symbols_mod._load_task
    assert shared is not None
    assert not shared.cancelled()
    release.set()
    await shared
    assert symbols_mod._symbols


async def test_lifespan_shutdown_cancels_pending_load(monkeypatch) -> None:
    # 痛點:--reload / SIGTERM 落在載入窗口時,pending task 沒清會噴 traceback
    # 並跳過後續清理(finmind client close)。
    release = asyncio.Event()

    async def hanging_load() -> None:
        await release.wait()

    monkeypatch.setattr(symbols_mod, "load_symbols", hanging_load)
    cm = app.router.lifespan_context(app)
    await asyncio.wait_for(cm.__aenter__(), timeout=1.0)
    task = symbols_mod._load_task
    assert task is not None
    assert not task.done()
    await cm.__aexit__(None, None, None)
    assert task.cancelled()
    assert symbols_mod._load_task is None


def test_ensure_load_task_rebuilds_cross_loop_residue(monkeypatch) -> None:
    # 痛點:bare TestClient 每請求各開一個 event loop;綁死舊 loop 的 pending
    # 殘留 task 被新 loop await 會 hang / RuntimeError。stale 判準必須把它
    # 丟棄重建(conftest reset 之外的第二道保險)。
    loop_a = asyncio.new_event_loop()

    async def never() -> None:
        await asyncio.sleep(3600)

    stale = loop_a.create_task(never())
    loop_a.call_soon(loop_a.stop)
    loop_a.run_forever()  # 讓 never() 真正 start,stale 進入 pending
    assert not stale.done()
    monkeypatch.setattr(symbols_mod, "_load_task", stale)

    calls = 0

    async def fresh_load() -> None:
        nonlocal calls
        calls += 1
        symbols_mod._symbols = [{"symbol": "2330", "name": "台積電"}]

    monkeypatch.setattr(symbols_mod, "_symbols", [])
    monkeypatch.setattr(symbols_mod, "load_symbols", fresh_load)

    loop_b = asyncio.new_event_loop()  # 模擬下一個 request 的新 loop
    try:
        loop_b.run_until_complete(
            asyncio.wait_for(symbols_mod._ensure_loaded(), timeout=1.0)
        )
    finally:
        loop_b.close()
        stale.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            loop_a.run_until_complete(stale)
        loop_a.close()
    assert calls == 1
