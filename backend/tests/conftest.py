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
