"""IV drift 判定 — 純函式零 IO(warrant-iv-drift design v4 §5)。

Theil-Sen(pairwise 斜率中位數,抗單日 spike)+ 方向持續性檢定。
輸入序列的 index 即窗口內交易日 index(含 None 洞,不壓縮 — R5/R24);
label 一律中性(declining/rising/stable/insufficient),不做方向性指控文案。
"""

from __future__ import annotations

import statistics
from typing import Literal

MIN_VALID_POINTS = 20  # 有效點門檻(60 日窗)
REL_CHANGE_THRESHOLD = 0.15  # 窗口相對變化 |slope*span/median| 門檻
CONSISTENCY_MIN = 0.60  # 方向持續性:同號 pairwise 斜率占比

DriftLabel = Literal["declining", "rising", "stable", "insufficient"]


def _pairwise_slopes(points: list[tuple[int, float]]) -> list[float]:
    slopes: list[float] = []
    for i in range(len(points)):
        x1, y1 = points[i]
        for j in range(i + 1, len(points)):
            x2, y2 = points[j]
            if x2 != x1:
                slopes.append((y2 - y1) / (x2 - x1))
    return slopes


def theil_sen_slope(points: list[tuple[int, float]]) -> float:
    """Pairwise 斜率中位數;caller(detect_side)以 MIN_VALID_POINTS 保證 ≥2 點。"""
    return statistics.median(_pairwise_slopes(points))


def _consistency(slopes: list[float], direction: float) -> float:
    """與整體方向同號(零視為同向)的 pairwise 斜率占比。"""
    if not slopes:
        return 0.0
    agree = sum(1 for s in slopes if s == 0.0 or s * direction > 0.0)
    return agree / len(slopes)


def detect_side(series: list[float | None]) -> dict:
    """單側 IV 序列 → {"label", "slope", "n_valid"};x = list index(含洞)。"""
    points = [(i, v) for i, v in enumerate(series) if v is not None]
    n_valid = len(points)
    if n_valid < MIN_VALID_POINTS:
        return {"label": "insufficient", "slope": None, "n_valid": n_valid}
    slopes = _pairwise_slopes(points)
    slope = statistics.median(slopes)
    med = statistics.median(v for _, v in points)
    if med <= 0.0:
        return {"label": "insufficient", "slope": None, "n_valid": n_valid}
    span = points[-1][0] - points[0][0]
    rel = slope * span / med  # R5:以實際有效跨度計,稀疏序列不低估
    label: DriftLabel = "stable"
    if rel <= -REL_CHANGE_THRESHOLD and _consistency(slopes, slope) >= CONSISTENCY_MIN:
        label = "declining"
    elif rel >= REL_CHANGE_THRESHOLD and _consistency(slopes, slope) >= CONSISTENCY_MIN:
        label = "rising"
    return {"label": label, "slope": slope, "n_valid": n_valid}


def detect_drift(iv_bid: list[float | None], iv_ask: list[float | None]) -> dict:
    """雙側判定;overall 優先序 declining > rising >(雙側 insufficient)> stable。"""
    bid = detect_side(iv_bid)
    ask = detect_side(iv_ask)
    labels = (bid["label"], ask["label"])
    if "declining" in labels:
        label: DriftLabel = "declining"
    elif "rising" in labels:
        label = "rising"
    elif labels == ("insufficient", "insufficient"):
        label = "insufficient"
    else:
        label = "stable"
    return {"label": label, "bid": bid, "ask": ask}


def flatten_drift(d: dict) -> dict:
    """巢狀 detect_drift 結果 → summary/API 攤平 shape(R6:n_valid = max 兩側)。"""
    return {
        "label": d["label"],
        "slope_bid": d["bid"]["slope"],
        "slope_ask": d["ask"]["slope"],
        "n_valid": max(d["bid"]["n_valid"], d["ask"]["n_valid"]),
    }
