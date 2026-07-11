"""BS 定價 / IV 反解純函式數值鎖(warrant-selector SC-2)。

教科書基準:Hull, Options, Futures and Other Derivatives —
S=42, K=40, T=0.5, r=0.10, sigma=0.20 → call 4.759422, put 0.808599。
"""

from __future__ import annotations

import math

import pytest

from services.warrant_pricing import RISK_FREE_RATE, bs_delta, bs_price, implied_vol


class TestBsPrice:
    def test_hull_textbook_call(self) -> None:
        assert bs_price(42.0, 40.0, 0.5, 0.10, 0.20, "call") == pytest.approx(4.759422, abs=1e-6)

    def test_hull_textbook_put(self) -> None:
        assert bs_price(42.0, 40.0, 0.5, 0.10, 0.20, "put") == pytest.approx(0.808599, abs=1e-6)

    def test_put_call_parity(self) -> None:
        s, k, t, r, sigma = 100.0, 95.0, 0.75, 0.016, 0.35
        call = bs_price(s, k, t, r, sigma, "call")
        put = bs_price(s, k, t, r, sigma, "put")
        assert call - put == pytest.approx(s - k * math.exp(-r * t), abs=1e-9)

    def test_expiry_returns_intrinsic_value(self) -> None:
        assert bs_price(105.0, 100.0, 0.0, 0.016, 0.3, "call") == pytest.approx(5.0)
        assert bs_price(105.0, 100.0, 0.0, 0.016, 0.3, "put") == pytest.approx(0.0)
        assert bs_price(90.0, 100.0, 0.0, 0.016, 0.3, "put") == pytest.approx(10.0)


class TestBsDelta:
    def test_call_delta_in_range_and_atm_near_half(self) -> None:
        d = bs_delta(100.0, 100.0, 0.5, 0.016, 0.25, "call")
        assert 0.5 < d < 0.6  # ATM call delta 略高於 0.5(d1 > 0)

    def test_put_delta_equals_call_minus_one(self) -> None:
        s, k, t, r, sigma = 80.0, 100.0, 0.3, 0.016, 0.4
        call_d = bs_delta(s, k, t, r, sigma, "call")
        put_d = bs_delta(s, k, t, r, sigma, "put")
        assert put_d == pytest.approx(call_d - 1.0, abs=1e-12)

    def test_expiry_step_function(self) -> None:
        # impl-spec R5:put 到期階梯是 0 / -1,不是 0 / 1
        assert bs_delta(105.0, 100.0, 0.0, 0.016, 0.3, "call") == 1.0
        assert bs_delta(95.0, 100.0, 0.0, 0.016, 0.3, "call") == 0.0
        assert bs_delta(95.0, 100.0, 0.0, 0.016, 0.3, "put") == -1.0
        assert bs_delta(105.0, 100.0, 0.0, 0.016, 0.3, "put") == 0.0


class TestImpliedVol:
    @pytest.mark.parametrize("sigma", [0.15, 0.35, 0.80])
    @pytest.mark.parametrize("kind", ["call", "put"])
    def test_round_trip_recovers_sigma(self, sigma: float, kind: str) -> None:
        s, k, t, r = 50.0, 55.0, 0.4, RISK_FREE_RATE
        price = bs_price(s, k, t, r, sigma, kind)
        iv = implied_vol(price, s, k, t, r, kind)
        assert iv is not None
        assert iv == pytest.approx(sigma, abs=1e-6)

    def test_zero_or_negative_price_returns_none(self) -> None:
        assert implied_vol(0.0, 50.0, 55.0, 0.4, 0.016, "call") is None
        assert implied_vol(-1.0, 50.0, 55.0, 0.4, 0.016, "call") is None

    def test_expired_returns_none(self) -> None:
        assert implied_vol(1.0, 50.0, 55.0, 0.0, 0.016, "call") is None

    def test_price_below_intrinsic_returns_none(self) -> None:
        # deep ITM call:價格低於無套利下界 → bracket 兩端同號 → None
        assert implied_vol(9.0, 60.0, 50.0, 0.5, 0.016, "call") is None

    def test_price_above_upper_bound_returns_none(self) -> None:
        # call 價格不可能超過標的價(sigma→5.0 仍到不了)→ None
        assert implied_vol(60.0, 50.0, 55.0, 0.5, 0.016, "call") is None
