"""BS 歐式定價 / IV 反解 — 純函式零 IO(warrant-selector design §1.1)。

無外部依賴:norm CDF 用 math.erf,IV 反解用 bracket 二分法(不引 scipy)。
權證欄位計算的 per-share 換算(P / 行使比例)由 caller 負責,本模組只看單股。
"""

from __future__ import annotations

import math
from typing import Literal

RISK_FREE_RATE = 0.016  # 無風險利率(spec §4 具名常數)

_IV_LO = 1e-4
_IV_HI = 5.0
_IV_TOL = 1e-8
_IV_MAX_ITER = 100

Kind = Literal["call", "put"]


def _norm_cdf(x: float) -> float:
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0


def bs_price(s: float, k: float, t: float, r: float, sigma: float, kind: Kind) -> float:
    if t <= 0.0:
        intrinsic = s - k if kind == "call" else k - s
        return max(0.0, intrinsic)
    d1 = (math.log(s / k) + (r + sigma * sigma / 2.0) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    if kind == "call":
        return s * _norm_cdf(d1) - k * math.exp(-r * t) * _norm_cdf(d2)
    return k * math.exp(-r * t) * _norm_cdf(-d2) - s * _norm_cdf(-d1)


def bs_delta(s: float, k: float, t: float, r: float, sigma: float, kind: Kind) -> float:
    if t <= 0.0:
        # 到期階梯:call 0/1,put 0/-1(impl-spec R5)
        if kind == "call":
            return 1.0 if s > k else 0.0
        return -1.0 if s < k else 0.0
    d1 = (math.log(s / k) + (r + sigma * sigma / 2.0) * t) / (sigma * math.sqrt(t))
    call_delta = _norm_cdf(d1)
    return call_delta if kind == "call" else call_delta - 1.0


def implied_vol(price: float, s: float, k: float, t: float, r: float, kind: Kind) -> float | None:
    if price <= 0.0 or t <= 0.0 or s <= 0.0 or k <= 0.0:
        return None
    lo, hi = _IV_LO, _IV_HI
    f_lo = bs_price(s, k, t, r, lo, kind) - price
    f_hi = bs_price(s, k, t, r, hi, kind) - price
    if f_lo * f_hi > 0.0:
        # 價格在 [σ_lo, σ_hi] 可達區間外(低於無套利下界 / 高於上界)→ 解不出
        return None
    for _ in range(_IV_MAX_ITER):
        mid = (lo + hi) / 2.0
        f_mid = bs_price(s, k, t, r, mid, kind) - price
        if abs(f_mid) < _IV_TOL or (hi - lo) / 2.0 < _IV_TOL:
            return mid
        if f_lo * f_mid <= 0.0:
            hi = mid
        else:
            lo = mid
            f_lo = f_mid
    return (lo + hi) / 2.0
