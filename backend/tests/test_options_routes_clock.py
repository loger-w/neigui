"""Anchor test for R3-P1-CLOCK-ROUTES timebomb(routes/options.py:24/32)。

routes/options.py 原本走 `today = date.today()` → `list_active_contracts(today)`。
過 2026-07-15 TXO202607 結算後,active list drop TXO202607 → _resolve_contract
('TXO202607') return None → 400 invalid_contract。

clock indirection swap 後 + FAKE_TODAY=2026-06-26 應使該行為**穩定**,無論
wall-clock 已過 7/15。本 test 鎖死此 invariant — 若 routes/options.py 任何一
行回退到 wall-clock,本 test 立即紅。

痛點(/goal):
- 此 test FAIL = routes/ 層的 date.today() 沒被 swap 成 clock.today() → 過
  7/15 後 SC-4 跟 SC-8 全部紅。本 test 在 7/15 前就會抓到 regression,而不
  是等使用者抱怨。
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _fake_today_env(monkeypatch):
    monkeypatch.setenv("FAKE_FINMIND", "1")
    monkeypatch.setenv("FAKE_TODAY", "2026-06-26")


def test_resolve_contract_uses_clock_not_wall_clock():
    """痛點:即使 wall clock 已過 2026-07-15(TXO202607 結算日),只要
    FAKE_TODAY=2026-06-26,_resolve_contract('TXO202607') 仍應回 dict。"""
    from routes.options import _resolve_contract

    contract = _resolve_contract("TXO202607")
    assert contract is not None, (
        "_resolve_contract returned None — 表 routes/options.py:24 走的不是 "
        "clock.today() (FAKE_TODAY=2026-06-26 下應該有 TXO202607),回頭檢查 "
        "Wave 2 的 date.today → clock.today swap 是否被 revert"
    )
    assert contract["option_id"] == "TXO"
    assert contract["contract_date"] == "202607"


def test_today_str_returns_fake_today():
    """痛點:routes/options.py:32 _today_str() 必須走 clock.today(),
    不能在 wall clock != fake_today 時 leak 出 wall clock 日期。"""
    from routes.options import _today_str

    assert _today_str() == "2026-06-26"


def test_chip_today_helper_returns_fake_today():
    """痛點:routes/chip.py 的 _today helper 同樣 must use clock."""
    from routes.chip import _today

    assert _today() == "2026-06-26"
