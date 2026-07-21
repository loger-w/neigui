"""Backend test suite shared fixtures (design v4 §6.0 / T1 / F15 / F22).

Centralises:
- FinMindClient singleton reset between tests (was duplicated in
  test_finmind.py and test_finmind_options.py as module-local
  _reset_singleton autouse fixtures).
- FINMIND_TOKEN + CHIP_DATA_DIR env scaffolding so tests don't need to
  set them individually (FinMindClient.__init__ raises if token empty).
- NoOpBucket + opt-in bypass_finmind_rate_limiter fixture for integration
  tests that fan out 90+ FinMind calls; without this the token bucket
  serialises them through 5 req/s sleeps in CI.

Tests that intentionally probe the empty-token path should
``monkeypatch.setenv("FINMIND_TOKEN", "")`` inside the test body — the
autouse fixture sets a non-empty default first, then test-local monkeypatch
overrides it (pytest fixture ordering guarantees this).
"""

from __future__ import annotations

import pytest


# Re-export NoOpBucket from services/rate_limiter — production needs it for
# FAKE_FINMIND skip path(R3-P1-NOOPBUCKET);tests/ 反向 import 是 layering
# 違規,所以 NoOpBucket 已搬到 services/rate_limiter.py,此處只 re-export
# 維持既有 19 個 backend test 的 `from tests.conftest import NoOpBucket` 簽名。
from services.rate_limiter import NoOpBucket  # noqa: F401, E402


@pytest.fixture(autouse=True)
def _reset_finmind_singleton_and_env(monkeypatch, tmp_path):
    """Reset module-level FinMindClient singleton + scaffold env.

    Replaces former module-local _reset_singleton fixtures in
    test_finmind.py / test_finmind_options.py (which must be deleted in
    the same commit to avoid double-application).
    """
    monkeypatch.setenv("FINMIND_TOKEN", "test-token")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    # CI 全域 FAKE_FINMIND=1(e2e job)會 leak 進 tests/(它們不預期 fake)。
    # 此 autouse 主動 delenv,讓既有 19 tests 跑 real path(用 mocked httpx
    # / TaiwanFuturesDaily wide mocks)。tests_e2e/conftest.py 會自己再 setenv
    # FAKE_FINMIND=1 — 兩邊 conftest 互不汙染。
    monkeypatch.delenv("FAKE_FINMIND", raising=False)
    monkeypatch.delenv("FAKE_TODAY", raising=False)
    import services.finmind as fm

    monkeypatch.setattr(fm, "_client", None)
    monkeypatch.setattr(fm, "_fm_limiter", None)


@pytest.fixture(autouse=True)
def _reset_symbols_load_task(monkeypatch):
    """symbols 共用載入 task 殘留會綁死舊 event loop(bare TestClient 每請求
    各開一個 loop),跨測試 await 到它會 hang / RuntimeError — 每測試起點清空。"""
    import routes.symbols as symbols_mod

    monkeypatch.setattr(symbols_mod, "_load_task", None)


@pytest.fixture(autouse=True)
def _reset_warrant_prewarm_task(monkeypatch):
    """warrants._prewarm_task 同款跨 event loop 殘留問題(見上)— 每測試清空。"""
    import services.warrants as ws

    monkeypatch.setattr(ws, "_prewarm_task", None)


@pytest.fixture(autouse=True)
def _reset_realtime_task_registries():
    """全部模組級 task registry(_inflight)跨 event loop 殘留 — 每測試起點統一清空。

    負載下背景 task 若留在模組級 registry;pytest-asyncio 的 loop teardown
    不 cancel pending task,下一測試(新 loop)同 key 撿到死 loop 的 task →
    RuntimeError "got Future attached to a different loop" 連環炸
    (2026-07-07/11/14/17 四次 pre-push 實證)。原本只清 market snapshot 鏈
    (finmind_realtime / market_universe),warrant* / daytrade_fee /
    industry_chain 由各測試檔自清 — 2026-07-20 集中到這裡,suite 全域防護
    (檔內自清只保護該檔自己的測試順序)。
    **新增模組級 task registry 時必須加進下方 module tuple。**
    注意用 .clear() 不用 monkeypatch.setattr({}):setattr 會在 teardown 還原
    「原 dict 物件」,殘留條目跟著回魂。
    """
    import asyncio

    import services.broker_flows as bfl
    import services.daytrade_fee as df
    import services.finmind_realtime as fr
    import services.industry_chain as ic
    import services.market_universe as mu
    import services.warrant_flow as wf
    import services.warrant_iv_history as ivh
    import services.warrant_quotes as wq
    import services.warrants as ws

    def _drop_silently(tasks) -> None:
        # 死 loop 的 pending task 無法 cancel(cancel 會 call_soon 到已關閉
        # 的 loop → RuntimeError),只能丟引用;先關掉 Task.__del__ 的
        # "Task was destroyed but it is pending!" 警告 — 這裡的丟棄是已知
        # 安全(該 task 永遠不可能再跑),留噪音只會誤導 triage(review P1)。
        for t in tasks:
            if isinstance(t, asyncio.Task) and not t.done():
                t._log_destroy_pending = False  # type: ignore[attr-defined]  # CPython 私有旗標

    # entry 兩種形狀並存:{"task": Task, "refs": int}(_run_once 同構)或裸 Task
    for mod in (fr, mu, ic, wf, ivh, wq, ws, df, bfl):
        _drop_silently(e.get("task") if isinstance(e, dict) else e for e in mod._inflight.values())
        mod._inflight.clear()
    yield


@pytest.fixture
def bypass_finmind_rate_limiter(monkeypatch):
    """Opt-in: swap the rate limiter for a no-op + force client rebuild.

    F15 修: FinMindClient.__init__ binds self._limiter at construction, so
    we must patch get_finmind_rate_limiter and reset _client to None so the
    next get_finmind() call rebuilds with the NoOp limiter.
    """
    import services.finmind as fm

    monkeypatch.setattr(fm, "get_finmind_rate_limiter", lambda: NoOpBucket())
    monkeypatch.setattr(fm, "_client", None)
