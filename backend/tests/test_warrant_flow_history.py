"""warrant_flow_history service 單元測試(design warrant-flow-net-history v3)。

Stub 策略同 test_warrant_flow.py:per-module wrap monkeypatch + clock 凍結;
cleanup 面(retention 窗)直接測 warrant_flow._cleanup_flow_caches。
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from fastapi import HTTPException

import services.warrant_flow as wf
import services.warrant_flow_history as wfh
from utils.cache import atomic_write_json, chip_cache_dir

TODAY = date(2026, 7, 14)  # Tue
# TODAY 往回的 weekday 序(掃描槽位序):07-14, 07-13, 07-10, 07-09, ...
D = {
    0: "2026-07-14",  # Tue(today;報表 T+1 → 常 missing)
    1: "2026-07-13",  # Mon(recent floor)
    2: "2026-07-10",  # Fri
    3: "2026-07-09",  # Thu
    4: "2026-07-08",  # Wed
    5: "2026-07-07",  # Tue
    6: "2026-07-06",  # Mon
    7: "2026-07-03",  # Fri
}


def _days_ago(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


def _snap() -> dict:
    return {
        "as_of_date": D[1],
        "by_underlying": {
            "2330": [
                {
                    "warrant_id": "030011",
                    "name": "台積凱基61購01",
                    "kind": "call",
                    "underlying_name": "台積電",
                }
            ]
        },
    }


def _seed_result_cache(stock_id: str, d: str, call_net: float | None = 1000.0) -> dict:
    """預鋪單日 result cache(versioned),回傳 summary 供 assertion 對照。"""
    summary = {
        "call": {"trade_value": 5_000_000.0, "external_net": call_net},
        "put": {"trade_value": 0.0, "external_net": None},
    }
    atomic_write_json(
        wf._result_cache_path(stock_id, d),
        {
            "as_of_date": d,
            "truncated": False,
            "total_traded": 1,
            "analyzed": 1,
            "unmapped_count": 0,
            "empty_reason": None,
            "summary": summary,
            "top_buy_branches": [],
            "top_sell_branches": [],
            "warrants": [],
            "_cache_version": wf._CACHE_VERSION,
        },
    )
    return summary


class StubFinMind:
    """記帳 stub(test_warrant_flow 同構縮版):dumps per date、reports per (wid)。"""

    def __init__(self, dumps: dict[str, list], reports: dict[str, Any] | None = None):
        self.dumps = dumps
        self.reports = reports or {}
        self.dump_calls: list[str] = []
        self.report_calls: list[tuple[str, str]] = []

    async def stock_price_universe_day(self, d: str) -> list:
        self.dump_calls.append(d)
        return self.dumps.get(d, [])

    async def fetch_warrant_trading_daily_report(self, wid: str, d: str) -> list:
        self.report_calls.append((wid, d))
        val = self.reports.get(wid, [])
        if isinstance(val, Exception):
            raise val
        # _fetch_report caller 會過濾 row["date"] == d(open-ended 多日語意)—
        # stub 以查詢日蓋章,模擬「該日有資料」
        return [{**row, "date": d} for row in val]


DUMP_ROW = [{"stock_id": "030011", "Trading_money": 5_000_000, "close": 2.0}]
REPORT_ROWS = [
    {
        "date": "",
        "securities_trader_id": "9200",
        "securities_trader": "凱基",
        "price": 2.0,
        "buy": 100,
        "sell": 600,
    }
]


@pytest.fixture(autouse=True)
def _history_env(monkeypatch):
    monkeypatch.setattr(wf, "_inflight", {})
    monkeypatch.setattr(wf.clock, "today", lambda: TODAY)


def _install(monkeypatch, stub: StubFinMind, snap: dict | Exception | None = None) -> None:
    monkeypatch.setattr(wf, "get_finmind", lambda: stub)

    async def fake_snapshot(refresh: bool = False) -> dict:
        s = snap if snap is not None else _snap()
        if isinstance(s, Exception):
            raise s
        return s

    monkeypatch.setattr(wfh.warrants, "get_snapshot", fake_snapshot)


# ---------------------------------------------------------------- 槽位掃描(SC-1 / SC-2)


async def test_scan_reads_cached_summaries(monkeypatch):
    stub = StubFinMind({})
    _install(monkeypatch, stub)
    s10 = _seed_result_cache("2330", D[2])
    s09 = _seed_result_cache("2330", D[3], call_net=-250.0)
    payload = await wfh.get_flow_history("2330")
    assert payload["window"] == wfh.HISTORY_SLOTS
    assert len(payload["days"]) == wfh.HISTORY_SLOTS
    # days 舊→新:最後一槽 = today
    assert payload["days"][-1]["date"] == D[0]
    by_date = {s["date"]: s for s in payload["days"]}
    assert by_date[D[2]]["status"] == "built"
    assert by_date[D[2]]["call"] == s10["call"]
    assert by_date[D[3]]["call"] == s09["call"]
    assert by_date[D[0]]["status"] == "missing"
    assert by_date[D[0]]["call"] is None
    assert payload["built"] == 2
    assert payload["missing_count"] == wfh.HISTORY_SLOTS - 2
    assert payload["backfilled"] == 0
    assert payload["empty_reason"] is None


async def test_cache_only_zero_finmind_calls(monkeypatch):
    stub = StubFinMind({D[2]: DUMP_ROW})
    _install(monkeypatch, stub)
    _seed_result_cache("2330", D[2])
    await wfh.get_flow_history("2330", backfill=False)
    assert stub.dump_calls == []
    assert stub.report_calls == []


# ---------------------------------------------------------------- backfill(SC-3 / R8)


async def test_backfill_caps_at_three_newest_first(monkeypatch):
    dumps = {D[i]: DUMP_ROW for i in range(2, 8)}
    stub = StubFinMind(dumps, {"030011": REPORT_ROWS})
    _install(monkeypatch, stub)
    payload = await wfh.get_flow_history("2330", backfill=True)
    # 候選 = missing 且 < today−1,新→舊:07-10, 07-09, 07-08
    assert stub.dump_calls == [D[2], D[3], D[4]]
    assert payload["backfilled"] == 3
    assert payload["built"] == 3
    # 再呼叫續補下一批(07-07, 07-06, 07-03)
    payload2 = await wfh.get_flow_history("2330", backfill=True)
    assert stub.dump_calls[3:] == [D[5], D[6], D[7]]
    assert payload2["built"] == 6


async def test_backfill_skips_recent_days(monkeypatch):
    # today no_dump + 昨日 report_pending 均不可解:候選直接排除 d >= today−1(R8),
    # 名額全數用在較舊缺日
    dumps = {D[0]: [], D[1]: DUMP_ROW, **{D[i]: DUMP_ROW for i in range(2, 5)}}
    stub = StubFinMind(dumps, {"030011": REPORT_ROWS})
    _install(monkeypatch, stub)
    payload = await wfh.get_flow_history("2330", backfill=True)
    assert D[0] not in stub.dump_calls
    assert D[1] not in stub.dump_calls
    assert payload["backfilled"] == 3


async def test_backfill_marks_nontrading_and_refills(monkeypatch):
    # 07-10(< today−1)dump 空 → marker + 槽遞補;07-09 / 07-08 正常建
    dumps = {D[2]: [], D[3]: DUMP_ROW, D[4]: DUMP_ROW}
    stub = StubFinMind(dumps, {"030011": REPORT_ROWS})
    _install(monkeypatch, stub)
    payload = await wfh.get_flow_history("2330", backfill=True)
    assert wf._read_versioned(wfh._marker_path(D[2])) is not None
    dates = [s["date"] for s in payload["days"]]
    assert D[2] not in dates  # marker 日不佔槽
    assert len(dates) == wfh.HISTORY_SLOTS  # 尾端遞補滿窗
    assert payload["backfilled"] == 2


async def test_backfill_report_pending_no_marker(monkeypatch):
    # 07-10 dump 有、報表 probe 空 → 不寫 marker、槽保持 missing
    dumps = {D[2]: DUMP_ROW, D[3]: DUMP_ROW, D[4]: DUMP_ROW}
    stub = StubFinMind(dumps, {"030011": []})
    _install(monkeypatch, stub)
    payload = await wfh.get_flow_history("2330", backfill=True)
    assert not wfh._marker_path(D[2]).exists()
    by_date = {s["date"]: s for s in payload["days"]}
    assert by_date[D[2]]["status"] == "missing"
    assert payload["backfilled"] == 0


async def test_backfill_rereads_cache_before_build(monkeypatch):
    # R-D 雙建防護:候選日在掃描後、建置前已被(並發)建好 → 零建置呼叫、槽轉 built
    stub = StubFinMind({})
    _install(monkeypatch, stub)
    slots = [{"date": D[2], "status": "missing", "call": None, "put": None}]
    _seed_result_cache("2330", D[2])

    async def _boom(*a: Any, **k: Any):
        raise AssertionError("try_build_day should not be called")

    monkeypatch.setattr(wf, "try_build_day", _boom)
    built = await wfh._backfill("2330", slots, _snap(), {})
    assert built == 1
    assert slots[0]["status"] == "built"


# ---------------------------------------------------------------- 邊界 / shape


async def test_no_volume_day_counts_built_with_null(monkeypatch):
    stub = StubFinMind({})
    _install(monkeypatch, stub)
    atomic_write_json(
        wf._result_cache_path("2330", D[2]),
        {**wf._empty_payload("no_volume", D[2], 0), "_cache_version": wf._CACHE_VERSION},
    )
    payload = await wfh.get_flow_history("2330")
    by_date = {s["date"]: s for s in payload["days"]}
    assert by_date[D[2]]["status"] == "built"
    assert by_date[D[2]]["call"] == {"trade_value": 0.0, "external_net": None}


async def test_no_warrants_payload_shape(monkeypatch):
    stub = StubFinMind({})
    _install(monkeypatch, stub, snap={"as_of_date": D[1], "by_underlying": {}})
    payload = await wfh.get_flow_history("2330")
    assert payload == {
        "window": wfh.HISTORY_SLOTS,
        "built": 0,
        "missing_count": 0,
        "backfilled": 0,
        "empty_reason": "no_warrants",
        "days": [],
    }


async def test_snapshot_error_502(monkeypatch):
    stub = StubFinMind({})
    _install(monkeypatch, stub, snap=httpx.ConnectError("boom"))
    with pytest.raises(HTTPException) as exc_info:
        await wfh.get_flow_history("2330")
    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == {"error": "warrant_upstream"}


async def test_scan_cap_truncates_window(monkeypatch):
    # 大量 marker → 掃滿 SCAN_WEEKDAY_CAP 即止,days.length < window(R11)
    stub = StubFinMind({})
    _install(monkeypatch, stub)
    d = TODAY
    markers = 0
    while markers < 15:
        if d.weekday() < 5:
            atomic_write_json(
                wfh._marker_path(d.isoformat()),
                {"_cache_version": wf._CACHE_VERSION, "non_trading": True},
            )
            markers += 1
        d -= timedelta(days=1)
    payload = await wfh.get_flow_history("2330")
    assert len(payload["days"]) == wfh.SCAN_WEEKDAY_CAP - 15
    assert payload["missing_count"] == len(payload["days"])


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
