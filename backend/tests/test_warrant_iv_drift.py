"""Drift 判定純函式(warrant-iv-drift SC-3)。

合成序列五 case:遞減 / 遞增 / 平穩 / 平穩+單日 spike(不觸發)/ 點數不足;
另鎖 None 洞不壓縮 x index(design R5/R24)與攤平規則 n_valid=max(R6)。
"""

from __future__ import annotations

import pytest

from services.warrant_iv_drift import (
    MIN_VALID_POINTS,
    detect_drift,
    detect_side,
    flatten_drift,
    theil_sen_slope,
)


def _linear(start: float, end: float, n: int = 60) -> list[float]:
    step = (end - start) / (n - 1)
    return [start + step * i for i in range(n)]


class TestTheilSenSlope:
    def test_exact_linear_slope(self) -> None:
        pts = [(i, 1.0 + 0.5 * i) for i in range(10)]
        assert theil_sen_slope(pts) == pytest.approx(0.5)

    def test_single_outlier_does_not_move_median_slope(self) -> None:
        ys = [1.0 + 0.5 * i for i in range(21)]
        ys[10] = 99.0  # 單點 outlier
        assert theil_sen_slope(list(enumerate(ys))) == pytest.approx(0.5, abs=0.01)


class TestDetectSide:
    def test_declining_series(self) -> None:
        r = detect_side(_linear(0.50, 0.35))
        assert r["label"] == "declining"
        assert r["slope"] == pytest.approx(-0.15 / 59)
        assert r["n_valid"] == 60

    def test_rising_series(self) -> None:
        r = detect_side(_linear(0.35, 0.50))
        assert r["label"] == "rising"
        assert r["slope"] > 0

    def test_stable_series(self) -> None:
        # 微幅交替噪音,窗口相對變化遠低於門檻
        series = [0.45 + (0.001 if i % 2 else -0.001) for i in range(60)]
        assert detect_side(series)["label"] == "stable"

    def test_single_spike_stays_stable(self) -> None:
        # 事件性單日暴增不得觸發 rising(Theil-Sen 抗 outlier)
        series = [0.45] * 60
        series[30] = 0.90
        assert detect_side(series)["label"] == "stable"

    def test_insufficient_points(self) -> None:
        series: list[float | None] = [0.45] * (MIN_VALID_POINTS - 1) + [None] * 41
        r = detect_side(series)
        assert r["label"] == "insufficient"
        assert r["slope"] is None
        assert r["n_valid"] == MIN_VALID_POINTS - 1

    def test_gap_index_not_compressed(self) -> None:
        # 隔日缺值:x 用原始 index(含洞),斜率仍是 per-index 真值(R5/R24)
        full = _linear(0.50, 0.35)
        series: list[float | None] = [v if i % 2 == 0 else None for i, v in enumerate(full)]
        r = detect_side(series)
        assert r["label"] == "declining"
        assert r["slope"] == pytest.approx(-0.15 / 59)
        assert r["n_valid"] == 30


class TestDetectDrift:
    def test_declining_takes_priority_over_rising(self) -> None:
        r = detect_drift(_linear(0.50, 0.35), _linear(0.35, 0.50))
        assert r["label"] == "declining"
        assert r["bid"]["label"] == "declining"
        assert r["ask"]["label"] == "rising"

    def test_both_insufficient(self) -> None:
        short: list[float | None] = [0.45] * 5 + [None] * 55
        assert detect_drift(short, short)["label"] == "insufficient"

    def test_one_side_insufficient_other_stable(self) -> None:
        short: list[float | None] = [0.45] * 5 + [None] * 55
        stable = [0.45] * 60
        assert detect_drift(stable, short)["label"] == "stable"


class TestFlattenDrift:
    def test_flatten_n_valid_max(self) -> None:
        short: list[float | None] = [0.45] * 5 + [None] * 55
        flat = flatten_drift(detect_drift(_linear(0.50, 0.35), short))
        assert flat["label"] == "declining"
        assert flat["slope_bid"] == pytest.approx(-0.15 / 59)
        assert flat["slope_ask"] is None
        assert flat["n_valid"] == 60  # max(60, 5)
