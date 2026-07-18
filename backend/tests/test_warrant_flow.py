"""warrant_flow service 單元測試(design v3 §2.5 測項 1-12 + PLAN B4)。

Stub 策略:per-module get_finmind wrap + warrants.get_snapshot monkeypatch,
clock.today 固定 2026-07-14(Tue);FinMind 呼叫全走 StubFinMind 記帳。
"""

from __future__ import annotations

import asyncio
import json
from datetime import date
from typing import Any

import httpx
import pytest
from fastapi import HTTPException

import services.warrant_flow as wf
from utils.cache import chip_cache_dir

TODAY = date(2026, 7, 14)  # Tue
D0 = "2026-07-14"
D1 = "2026-07-13"  # Mon
D2 = "2026-07-10"  # Fri


def _snap(by_underlying: dict) -> dict:
    return {"as_of_date": D1, "by_underlying": by_underlying}


def _w(wid: str, kind: str = "call", name: str | None = None) -> dict:
    # underlying_name 全稱、name 縮寫前綴(台積)— 直接覆蓋 _issuer_brand 前綴容錯路徑
    return {
        "warrant_id": wid,
        "name": name or f"權證{wid}",
        "kind": kind,
        "underlying_name": "台積電",
    }


SNAP_2330 = _snap(
    {
        "2330": [
            _w("030011", "call", "台積凱基61購01"),
            _w("030012", "call", "台積元大61購02"),
            _w("03001P", "put", "台積國泰61售01"),
            _w("030013", "call", "台積富邦61購03"),  # 零成交
        ]
    }
)

DUMP_D1 = [
    {"stock_id": "030011", "Trading_money": 5_000_000, "close": 2.0},
    {"stock_id": "030012", "Trading_money": 3_000_000},
    {"stock_id": "03001P", "Trading_money": 1_200_000},
    {"stock_id": "030013", "Trading_money": 0},
    {"stock_id": "2330", "Trading_money": 80_000_000},  # 4 碼普通股不計 unmapped
    {"stock_id": "03998B", "Trading_money": 600_000},  # 快照外權證形狀 → unmapped
    {"stock_id": "710001", "Trading_money": 400_000},  # 71 prefix 不是權證形狀
]


def _row(tid: str, tname: str, price: float, buy: int, sell: int, d: str = D1) -> dict:
    return {
        "date": d,
        "securities_trader_id": tid,
        "securities_trader": tname,
        "price": price,
        "buy": buy,
        "sell": sell,
    }


REPORTS_D1: dict[str, list[dict]] = {
    # seat 命名對齊真實 FinMind:分點 = brand+地名(920A 凱基台北)、HO 總公司 =
    # brand 精確名(9200 凱基 / 9800 元大)。external_net = −(該權證發行商 HO net)。
    "030011": [  # 凱基發行
        _row("920A", "凱基台北", 2.0, 1000, 0),
        _row("920A", "凱基台北", 2.1, 500, 0),  # 同分點多價位
        _row("9800", "元大", 2.0, 0, 500),  # 他券商 HO 名 — 非本權證發行商,只是外部 seat
        _row("9600", "富邦", 1.5, 200, 200),  # net 0 → 兩欄皆不入
        _row("9200", "凱基", 2.0, 0, 1500),  # 發行商 HO:net −3000 → external +3000
    ],
    "030012": [  # 元大發行 → 9800 元大 即 HO(030011/03001P 視角它只是外部 seat)
        _row("920A", "凱基台北", 1.0, 900, 100),
        _row("9800", "元大", 1.0, 120, 640),  # HO net −520 → external +520
    ],
    "03001P": [  # 國泰發行 → 無「國泰綜合」seat → external_net None
        _row("5850", "統一", 0.5, 800, 0),
        _row("9800", "元大", 0.5, 0, 200),
    ],
}


class StubFinMind:
    """記帳 stub:dumps per date、reports per (wid, date);value 可為 Exception。"""

    def __init__(self, dumps: dict[str, list], reports: dict[str, Any]):
        self.dumps = dumps
        self.reports = reports
        self.dump_calls: list[str] = []
        self.report_calls: list[tuple[str, str]] = []
        self.cancelled: list[str] = []

    async def stock_price_universe_day(self, d: str) -> list:
        self.dump_calls.append(d)
        return self.dumps.get(d, [])

    async def fetch_warrant_trading_daily_report(self, wid: str, d: str) -> list:
        self.report_calls.append((wid, d))
        val = self.reports.get(wid, [])
        if isinstance(val, Exception):
            raise val
        # 模擬 FinMind start_date open-ended 回多日 rows(caller 過濾)
        return val


@pytest.fixture(autouse=True)
def _flow_env(monkeypatch):
    monkeypatch.setattr(wf, "_inflight", {})
    monkeypatch.setattr(wf.clock, "today", lambda: TODAY)


def _install(monkeypatch, stub: StubFinMind, snap: dict | Exception = SNAP_2330) -> None:
    monkeypatch.setattr(wf, "get_finmind", lambda: stub)

    async def fake_snapshot(refresh: bool = False) -> dict:
        if isinstance(snap, Exception):
            raise snap
        return snap

    monkeypatch.setattr(wf.warrants, "get_snapshot", fake_snapshot)


def _default_stub() -> StubFinMind:
    return StubFinMind({D1: DUMP_D1}, dict(REPORTS_D1))


# ---------------------------------------------------------------- 測項 1:聚合數值鎖


async def test_aggregation_values(monkeypatch):
    stub = _default_stub()
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")

    assert payload["as_of_date"] == D1
    assert payload["empty_reason"] is None
    assert payload["total_traded"] == 3
    assert payload["analyzed"] == 3
    assert payload["truncated"] is False
    # summary:trade_value = mapped 有量權證 Σ Trading_money(未 cap);
    # external_net = Σ 非 null(call:030011 +3000、030012 +520;put 全 null → None)
    assert payload["summary"]["call"] == {"trade_value": 8_000_000.0, "external_net": 3520.0}
    assert payload["summary"]["put"] == {"trade_value": 1_200_000.0, "external_net": None}
    # top_buy:920A net 3850、5850 net 400;9600 net 0 不入(branch 層邏輯不變)
    buy_ids = [b["broker_id"] for b in payload["top_buy_branches"]]
    assert buy_ids == ["920A", "5850"]
    b920a = payload["top_buy_branches"][0]
    assert b920a["broker_name"] == "凱基台北"
    assert b920a["buy_value"] == 3950.0
    assert b920a["sell_value"] == 100.0
    assert b920a["net_value"] == 3850.0
    # 分點內 warrants 依 abs(net) 降序:030011(3050)> 030012(800)
    assert [w["warrant_id"] for w in b920a["warrants"]] == ["030011", "030012"]
    assert b920a["warrants"][0]["net_value"] == 3050.0
    assert b920a["warrants"][0]["kind"] == "call"
    # top_sell:9200(凱基 HO)net −3000、9800 net = 120 − 1740 = −1620;
    # HO seat 照常入 branch 排行(branch 層白名單,只有 external_net 口徑排除它)
    sell_ids = [b["broker_id"] for b in payload["top_sell_branches"]]
    assert sell_ids == ["9200", "9800"]
    assert payload["top_sell_branches"][0]["net_value"] == -3000.0
    assert payload["top_sell_branches"][1]["net_value"] == -1620.0
    # 明細表:trading_money 降序 + per-warrant external_net(null 不冒充 0)
    assert [w["warrant_id"] for w in payload["warrants"]] == ["030011", "030012", "03001P"]
    assert payload["warrants"][0]["external_net"] == 3000.0  # −(凱基 HO −3000)
    assert payload["warrants"][1]["external_net"] == 520.0  # −(元大 HO −520)
    assert payload["warrants"][2]["external_net"] is None  # 無國泰 HO seat
    assert all("net_value" not in w for w in payload["warrants"])
    assert payload["warrants"][0]["trading_money"] == 5_000_000


async def test_aggregation_skips_bad_rows(monkeypatch):
    reports = dict(REPORTS_D1)
    reports["030012"] = REPORTS_D1["030012"] + [
        {"date": D1, "securities_trader_id": "9999", "securities_trader": "壞列", "buy": 1},
        _row("9998", "壞價", None, 10, 0),  # type: ignore[arg-type]
    ]
    stub = StubFinMind({D1: DUMP_D1}, reports)
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")
    # 壞 rows 被 skip,總數不變
    assert payload["summary"]["call"] == {"trade_value": 8_000_000.0, "external_net": 3520.0}
    assert all(b["broker_id"] not in ("9999", "9998") for b in payload["top_buy_branches"])


# ---------------------------------------------------------------- external_net null 條款(SC-C)


async def test_external_net_null_when_report_empty(monkeypatch):
    # 報表當日空(FinMind 部分權證 T+1 上料 lag)→ null,不冒充 0
    reports = {**REPORTS_D1, "030012": []}
    stub = StubFinMind({D1: DUMP_D1}, reports)
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")
    by_id = {w["warrant_id"]: w for w in payload["warrants"]}
    assert by_id["030012"]["external_net"] is None
    # summary 只加非 null(030011 +3000);trade_value 不受報表缺影響
    assert payload["summary"]["call"] == {"trade_value": 8_000_000.0, "external_net": 3000.0}


async def test_external_net_null_when_brand_unknown(monkeypatch):
    # 發行商不在 alias 白名單(如華南)→ null,即使場上有同名 seat(防錯配)
    snap = _snap({"2330": [_w("030099", "call", "台積華南61購09")]})
    dump = [{"stock_id": "030099", "Trading_money": 1_000_000}]
    reports = {"030099": [_row("6110", "華南", 1.0, 100, 900)]}
    stub = StubFinMind({D1: dump}, reports)
    _install(monkeypatch, stub, snap)
    payload = await wf.get_flow("2330")
    assert payload["warrants"][0]["external_net"] is None
    assert payload["summary"]["call"] == {"trade_value": 1_000_000.0, "external_net": None}


async def test_external_net_masterlink_brand_maps_to_taishin_ho(monkeypatch):
    # 元富證券 2026-04-06 併入台新證券(存續)— 元富 brand 權證的 HO seat 實測為
    # 9B00「台新證券」(2026-07-18 probe:4 檔 × 2 日,6/6 樣本 9B00 造市、零「元富」seat)
    snap = _snap({"2330": [_w("030097", "call", "台積元富61購07")]})
    dump = [{"stock_id": "030097", "Trading_money": 2_000_000}]
    reports = {
        "030097": [
            _row("9B00", "台新證券", 1.0, 120, 640),  # HO net −520 → external +520
            _row("9B2Q", "台新敦南", 1.0, 300, 0),  # 分點不入 HO 口徑
        ]
    }
    stub = StubFinMind({D1: dump}, reports)
    _install(monkeypatch, stub, snap)
    payload = await wf.get_flow("2330")
    assert payload["warrants"][0]["external_net"] == 520.0
    assert payload["summary"]["call"] == {"trade_value": 2_000_000.0, "external_net": 520.0}


async def test_external_net_null_when_brand_unextractable(monkeypatch):
    # 權證名不含標的前綴(brand 抽不出)→ null
    snap = _snap({"2330": [_w("030098", "call", "怪名購01")]})
    dump = [{"stock_id": "030098", "Trading_money": 500_000}]
    reports = {"030098": [_row("9200", "凱基", 1.0, 100, 0)]}
    stub = StubFinMind({D1: dump}, reports)
    _install(monkeypatch, stub, snap)
    payload = await wf.get_flow("2330")
    assert payload["warrants"][0]["external_net"] is None


# ---------------------------------------------------------------- 測項 2:cap / truncated


async def test_cap_truncated(monkeypatch):
    n = wf.FLOW_CAP + 1
    wids = [f"03{i:04d}" for i in range(n)]
    snap = _snap({"2330": [_w(w) for w in wids]})
    dump = [{"stock_id": w, "Trading_money": 1_000_000 - i} for i, w in enumerate(wids)]
    reports = {w: [_row("9200", "凱基-台北", 1.0, 10, 0)] for w in wids}
    stub = StubFinMind({D1: dump}, reports)
    _install(monkeypatch, stub, snap)
    payload = await wf.get_flow("2330")
    assert payload["total_traded"] == n
    assert payload["analyzed"] == wf.FLOW_CAP
    assert payload["truncated"] is True
    # summary trade_value 不受 cap 影響:Σ(1_000_000 − i) for i in 0..n−1
    assert payload["summary"]["call"]["trade_value"] == float(
        n * 1_000_000 - n * (n - 1) // 2
    )
    # fan-out 只打 cap 檔(probe 1 + 其餘 cap−1)
    assert len(stub.report_calls) == wf.FLOW_CAP
    # cap 內最低金額檔有入、cap 外沒入
    ids = {w["warrant_id"] for w in payload["warrants"]}
    assert wids[wf.FLOW_CAP - 1] in ids and wids[-1] not in ids


# ---------------------------------------------------------------- 測項 3:交集 + unmapped


async def test_intersection_and_unmapped(monkeypatch):
    stub = _default_stub()
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")
    # 030013 零成交不入;03998B unmapped 計 1;2330 4 碼、710001 prefix 71 不計
    assert payload["unmapped_count"] == 1
    ids = {w["warrant_id"] for w in payload["warrants"]}
    assert "030013" not in ids and "03998B" not in ids


# ---------------------------------------------------------------- 測項 4:候選日回退


async def test_fallback_when_dump_empty(monkeypatch):
    stub = StubFinMind({D0: [], D1: DUMP_D1}, dict(REPORTS_D1))
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")
    assert payload["as_of_date"] == D1
    assert stub.dump_calls[:2] == [D0, D1]


async def test_fallback_when_probe_empty(monkeypatch):
    # D1 報表未上料(probe 0 rows)→ 回退 D2
    dump_d2 = [{"stock_id": "030011", "Trading_money": 900_000}]
    reports = {"030011": [_row("9200", "凱基-台北", 2.0, 100, 0, d=D2)]}
    stub = StubFinMind({D1: DUMP_D1, D2: dump_d2}, reports)
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")
    assert payload["as_of_date"] == D2
    # 測項 10:D1 只花 1 個 probe request,fan-out 零呼叫
    d1_calls = [c for c in stub.report_calls if c[1] == D1]
    assert len(d1_calls) == 1


async def test_report_date_filter(monkeypatch):
    # FinMind start_date open-ended 回多日 rows → 只聚合查詢日。掛在 030012 的
    # HO seat(9800 元大):filter 若失守,external_net 會被 D0 大單炸歪
    reports = dict(REPORTS_D1)
    reports["030012"] = REPORTS_D1["030012"] + [_row("9800", "元大", 9.9, 99999, 0, d=D0)]
    stub = StubFinMind({D1: DUMP_D1}, reports)
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")
    assert payload["summary"]["call"] == {"trade_value": 8_000_000.0, "external_net": 3520.0}
    assert payload["summary"]["put"] == {"trade_value": 1_200_000.0, "external_net": None}


# ---------------------------------------------------------------- 測項 5:空狀態


async def test_empty_no_warrants(monkeypatch):
    stub = _default_stub()
    _install(monkeypatch, stub, _snap({}))
    payload = await wf.get_flow("2330")
    assert payload["empty_reason"] == "no_warrants"
    assert payload["as_of_date"] is None
    assert "no_trading_day" not in payload
    assert payload["summary"] == {
        "call": {"trade_value": 0.0, "external_net": None},
        "put": {"trade_value": 0.0, "external_net": None},
    }
    assert payload["top_buy_branches"] == [] and payload["top_sell_branches"] == []
    assert payload["warrants"] == [] and payload["truncated"] is False
    assert payload["total_traded"] == 0 and payload["analyzed"] == 0
    assert payload["unmapped_count"] == 0
    # 不落 result cache、零 FinMind 呼叫
    assert stub.dump_calls == []
    assert not list(chip_cache_dir().glob("warrant_flow_2330_*.json"))


async def test_empty_no_volume(monkeypatch):
    snap = _snap({"2330": [_w("030013")]})  # 只有零成交權證
    stub = StubFinMind({D1: DUMP_D1}, {})
    _install(monkeypatch, stub, snap)
    payload = await wf.get_flow("2330")
    assert payload["empty_reason"] == "no_volume"
    # no_volume 空態 summary 也是新 shape(_empty_payload 同一函式;reviewer R8)
    assert payload["summary"]["call"] == {"trade_value": 0.0, "external_net": None}
    assert payload["as_of_date"] == D1  # D1 是首個 dump 非空日;不回退
    # 全市場口徑:此 stub 快照只 mapped 030013 → 030011/030012/03001P/03998B 皆 unmapped
    assert payload["unmapped_count"] == 4
    assert stub.report_calls == []  # 零 fan-out
    # no_volume 是終態 → 落 result cache
    assert (chip_cache_dir() / f"warrant_flow_2330_{D1}.json").exists()


# ---------------------------------------------------------------- 測項 6:cache / refresh


async def test_result_cache_hit_and_refresh(monkeypatch):
    stub = _default_stub()
    _install(monkeypatch, stub)
    p1 = await wf.get_flow("2330")
    n_dump, n_report = len(stub.dump_calls), len(stub.report_calls)
    p2 = await wf.get_flow("2330")
    assert p2 == p1
    # 零 report fan-out;dump 允許 +1(D0=today 空 dump 不落 cache — 這是
    # 「T+0 晚間上料自動吃到」的偵測機制,by design)
    assert len(stub.report_calls) == n_report
    assert len(stub.dump_calls) - n_dump <= 1
    # refresh=true:result + day-dump 都重抓(R12)
    await wf.get_flow("2330", refresh=True)
    assert len(stub.dump_calls) > n_dump and len(stub.report_calls) > n_report


async def test_cache_version_mismatch_is_miss(monkeypatch):
    stub = _default_stub()
    _install(monkeypatch, stub)
    await wf.get_flow("2330")
    path = chip_cache_dir() / f"warrant_flow_2330_{D1}.json"
    stale = json.loads(path.read_text(encoding="utf-8"))
    stale["_cache_version"] = -1
    path.write_text(json.dumps(stale), encoding="utf-8")
    n_report = len(stub.report_calls)
    await wf.get_flow("2330")
    assert len(stub.report_calls) > n_report  # cache miss → 重抓


async def test_concurrent_refresh_not_joined_to_cached_inflight(monkeypatch):
    """R14:refresh 與非 refresh 併發,refresh 路徑必須真重抓(dedup key 隔離)。"""
    stub = _default_stub()
    _install(monkeypatch, stub)
    await wf.get_flow("2330")  # 暖 result + dump cache
    n_dump = len(stub.dump_calls)

    slow = asyncio.Event()
    orig = stub.stock_price_universe_day

    async def slow_dump(d: str) -> list:
        await asyncio.sleep(0.01)
        slow.set()
        return await orig(d)

    monkeypatch.setattr(stub, "stock_price_universe_day", slow_dump)
    r_plain, r_refresh = await asyncio.gather(
        wf.get_flow("2330"), wf.get_flow("2330", refresh=True)
    )
    assert r_plain["as_of_date"] == D1 and r_refresh["as_of_date"] == D1
    assert len(stub.dump_calls) > n_dump  # refresh 真的打了 dump


# ---------------------------------------------------------------- 測項 7:空 dump 快取條款(R15)


async def test_empty_dump_not_cached_for_recent_days(monkeypatch):
    # D0(today)與 D1(today−1)空 → 皆不落檔;更早的空日落檔
    reports_d2 = {
        wid: [{**r, "date": D2} for r in rows] for wid, rows in REPORTS_D1.items()
    }
    stub = StubFinMind({D2: DUMP_D1}, reports_d2)
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330")
    assert payload["as_of_date"] == D2
    assert not (chip_cache_dir() / f"flow_prices_{D0}.json").exists()
    assert not (chip_cache_dir() / f"flow_prices_{D1}.json").exists()
    assert (chip_cache_dir() / f"flow_prices_{D2}.json").exists()


# ---------------------------------------------------------------- 測項 8:fan-out 失敗


async def test_fanout_failure_aborts_and_cancels(monkeypatch):
    hang_cancelled = asyncio.Event()

    class Hang(Exception):
        pass

    stub = _default_stub()
    orig = stub.fetch_warrant_trading_daily_report

    async def failing(wid: str, d: str) -> list:
        if wid == "030012":
            raise httpx.ConnectError("boom")
        if wid == "03001P":
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                hang_cancelled.set()
                raise
            raise Hang
        return await orig(wid, d)

    monkeypatch.setattr(stub, "fetch_warrant_trading_daily_report", failing)
    _install(monkeypatch, stub)
    with pytest.raises(httpx.HTTPError):
        await wf.get_flow("2330")
    assert hang_cancelled.is_set()  # TaskGroup 首錯取消 siblings
    assert not (chip_cache_dir() / f"warrant_flow_2330_{D1}.json").exists()


# ---------------------------------------------------------------- 測項 9:no_trading_day


async def test_no_trading_day_flag_with_explicit_date(monkeypatch):
    stub = StubFinMind({D0: [], D1: DUMP_D1}, dict(REPORTS_D1))
    _install(monkeypatch, stub)
    payload = await wf.get_flow("2330", date=D0)
    assert payload["as_of_date"] == D1
    assert payload["no_trading_day"] is True


async def test_no_flag_on_default_query_or_exact_date(monkeypatch):
    stub = StubFinMind({D0: [], D1: DUMP_D1}, dict(REPORTS_D1))
    _install(monkeypatch, stub)
    p_default = await wf.get_flow("2330")
    assert "no_trading_day" not in p_default
    p_exact = await wf.get_flow("2330", date=D1)
    assert "no_trading_day" not in p_exact


async def test_no_trading_day_on_no_volume_with_explicit_date(monkeypatch):
    """impl-R5 sub-case:no_volume 空態 + 顯式 date 回退 → flag 照貼。"""
    snap = _snap({"2330": [_w("030013")]})
    stub = StubFinMind({D0: [], D1: DUMP_D1}, {})
    _install(monkeypatch, stub, snap)
    payload = await wf.get_flow("2330", date=D0)
    assert payload["empty_reason"] == "no_volume"
    assert payload["no_trading_day"] is True


# ---------------------------------------------------------------- 測項 11:retention


async def test_cleanup_retention(monkeypatch):
    old_dump = chip_cache_dir() / "flow_prices_2026-06-01.json"
    old_result = chip_cache_dir() / "warrant_flow_9999_2026-05-01.json"
    old_dump.write_text("{}", encoding="utf-8")
    old_result.write_text("{}", encoding="utf-8")
    stub = _default_stub()
    _install(monkeypatch, stub)
    await wf.get_flow("2330")
    assert not old_dump.exists() and not old_result.exists()
    assert (chip_cache_dir() / f"flow_prices_{D1}.json").exists()
    assert (chip_cache_dir() / f"warrant_flow_2330_{D1}.json").exists()


# ---------------------------------------------------------------- 測項 12:快照錯誤轉包(R16)


async def test_snapshot_httpx_error_becomes_warrant_upstream(monkeypatch):
    stub = _default_stub()
    _install(monkeypatch, stub, httpx.ConnectError("twse down"))
    with pytest.raises(HTTPException) as exc:
        await wf.get_flow("2330")
    assert exc.value.status_code == 502
    assert exc.value.detail == {"error": "warrant_upstream"}


async def test_snapshot_404_rewrapped_not_no_data(monkeypatch):
    stub = _default_stub()
    _install(monkeypatch, stub, HTTPException(status_code=404, detail={"error": "no_data"}))
    with pytest.raises(HTTPException) as exc:
        await wf.get_flow("2330")
    assert exc.value.status_code == 502
    assert exc.value.detail == {"error": "warrant_upstream"}


async def test_finmind_error_passes_through(monkeypatch):
    stub = StubFinMind({D1: DUMP_D1}, {"030011": httpx.ConnectError("finmind down")})
    _install(monkeypatch, stub)
    with pytest.raises(httpx.HTTPError):
        await wf.get_flow("2330")


# ---------------------------------------------------------------- 候選日耗盡 → 404 no_data


async def test_exhausted_candidates_404(monkeypatch):
    stub = StubFinMind({}, {})  # 全部日子 dump 空
    _install(monkeypatch, stub)
    with pytest.raises(HTTPException) as exc:
        await wf.get_flow("2330")
    assert exc.value.status_code == 404
    assert exc.value.detail == {"error": "no_data"}
    assert len(stub.dump_calls) == wf.FLOW_LOOKBACK_DAYS


# ---------------------------------------------------------------- fixture 一致性(R18 + impl-R4)


def test_e2e_fixture_consistency():
    """price_day 與各報表 fixture 的日期必須一致(日期錯與檔案缺對 probe 表現
    相同 = 0 rows,難 debug);920A 凱基台北 跨 fixture 聚合後必須淨買(E14 斷言
    存活);每權證守恆 Σnet≈0(RE-1 真實世界性質)+ 發行商 HO row 存在
    (external_net 非 null 的 FAKE 前提)。"""
    from pathlib import Path

    fixtures = Path(__file__).resolve().parents[1] / "tests_e2e" / "fixtures"
    price_day = fixtures / "warrants" / "price_day.json"
    if not price_day.exists():
        pytest.skip("price_day fixture not present")
    rows = json.loads(price_day.read_text(encoding="utf-8"))["data"]
    days = {r["date"] for r in rows}
    assert len(days) == 1
    d = days.pop()
    ho_name = {"030011": "凱基", "030012": "元大", "03001P": "國泰綜合"}
    kaiji_net = 0.0
    for wid in ("030011", "030012", "03001P"):
        f = fixtures / f"TaiwanStockWarrantTradingDailyReport_{wid}.json"
        assert f.exists(), f"有量 mapped 權證 {wid} 缺報表 fixture(R2 存活約束)"
        report_rows = json.loads(f.read_text(encoding="utf-8"))["data"]
        assert all(r["date"] == d for r in report_rows), f"{wid} fixture 日期 != {d}(R18)"
        conserved = sum(r["price"] * (r["buy"] - r["sell"]) for r in report_rows)
        assert abs(conserved) < 1e-6, f"{wid} 跨全分點 Σnet 應守恆為 0(RE-1),got {conserved}"
        assert any(
            r["securities_trader"] == ho_name[wid] for r in report_rows
        ), f"{wid} 缺發行商 HO seat「{ho_name[wid]}」row"
        for r in report_rows:
            if r["securities_trader_id"] == "920A":
                kaiji_net += r["price"] * (r["buy"] - r["sell"])
    assert kaiji_net > 0, "凱基台北 跨 fixture 聚合須淨買(E14 存活)"


# ---------------------------------------------------------------- B1:request shape 直測(impl-R2)


async def test_stock_price_universe_day_request_shape(monkeypatch):
    import services.finmind as fm

    captured: dict = {}

    async def fake_get(self, url: str, params: dict) -> list:
        captured["url"] = url
        captured["params"] = params
        return []

    monkeypatch.setattr(fm.FinMindClient, "_get", fake_get)
    client = fm.get_finmind()
    await client.stock_price_universe_day("2026-07-13")
    assert captured["params"]["dataset"] == "TaiwanStockPrice"
    assert captured["params"]["start_date"] == "2026-07-13"
    assert captured["params"]["end_date"] == "2026-07-13"
    assert "data_id" not in captured["params"]
