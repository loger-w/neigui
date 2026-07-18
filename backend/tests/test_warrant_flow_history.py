"""warrant_flow_history service 單元測試(design warrant-flow-net-history v3)。

Stub 策略同 test_warrant_flow.py:per-module wrap monkeypatch + clock 凍結;
cleanup 面(retention 窗)直接測 warrant_flow._cleanup_flow_caches。
"""

from __future__ import annotations

from datetime import date, timedelta

import services.warrant_flow as wf
from utils.cache import atomic_write_json, chip_cache_dir

TODAY = date(2026, 7, 14)  # Tue


def _days_ago(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


# ---------------------------------------------------------------- cleanup retention(impl R1)


def test_cleanup_retention_windows():
    # result cache:45 天 retention(30 → 45,20 交易日 ≈ 28-30 曆日貼邊);
    # nontrading marker:14 天 retention(誤標自癒窗,design review R12)
    cases = {
        "warrant_flow_2330_%s.json" % _days_ago(46): False,  # 過期 → 刪
        "warrant_flow_2330_%s.json" % _days_ago(40): True,  # 45 窗內 → 留
        "warrant_flow_2330_%s.json" % _days_ago(13): True,  # 近日 → 留
        "flow_nontrading_%s.json" % _days_ago(15): False,  # marker 過期 → 刪
        "flow_nontrading_%s.json" % _days_ago(13): True,  # marker 窗內 → 留
    }
    for name in cases:
        atomic_write_json(chip_cache_dir() / name, {"_cache_version": 2})
    wf._cleanup_flow_caches(TODAY)
    for name, kept in cases.items():
        assert (chip_cache_dir() / name).exists() is kept, name
