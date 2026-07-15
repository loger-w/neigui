"""tests_e2e 共用 fixture — autouse FAKE_FINMIND + FAKE_TODAY + CHIP_DATA_DIR scope。

設計 design.md v6 §3 SC-7:
- FAKE_FINMIND=1 切 FakeFinMindClient
- FAKE_TODAY=2026-06-26 凍 backend 時鐘(R2-P0-3 / R3-P1-CLOCK-ROUTES)
- CHIP_DATA_DIR=tmp_path 隔離 fake-mode cache 跟 dev cache(R2-P0-4)
- ASGI in-process httpx client(不啟 server)

痛點:沒這套 fixture 隔離,fake mode 寫到 dev 的 chip_cache_dir(),
contaminate dev 環境。R2-P0-4 round 2 抓出來。
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
def _e2e_env(monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_FINMIND", "1")
    monkeypatch.setenv("FAKE_TODAY", "2026-06-26")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    # 重置 FinMindClient singleton 讓每個 test 拿乾淨 FakeFinMindClient instance
    import services.finmind as fm

    monkeypatch.setattr(fm, "_client", None)
    # symbols 共用載入 task 跨測試殘留會綁死舊 event loop(pytest-asyncio 每
    # 測試一個 loop)— 同 tests/conftest.py 的 reset,兩邊同步。
    import routes.symbols as symbols_mod

    monkeypatch.setattr(symbols_mod, "_load_task", None)


@pytest.fixture
async def client():
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
