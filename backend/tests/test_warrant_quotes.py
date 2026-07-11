"""盤中 quotes 層測試(warrant-selector design §1.3)。

MIS msgArray 髒點形狀 = 2026-07-11 Phase 0 probe 實測(尾綴 `_`、`z="-"`、
`-` 佔位、五檔 `_` 分隔)。
"""

from __future__ import annotations

import asyncio
from datetime import date as date_type

import pytest

from services import clock
from services import warrant_quotes as wq
from services import warrants as ws
from services.warrant_pricing import RISK_FREE_RATE, bs_delta, bs_price, implied_vol


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setattr(wq, "_client", None)
    wq._inflight.clear()
    wq._cooldown.clear()


@pytest.fixture(autouse=True)
def _freeze_today(monkeypatch):
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 10))


# ---------------------------------------------------------------- helpers


def term(
    wid: str = "030012",
    kind: str = "call",
    strike: float = 95.0,
    ratio: float = 0.1,
    ltd: str = "2026-07-28",
    market: str = "twse",
    is_reset: bool = False,
    iv_prev: float | None = 0.30,
    ueod: float = 100.0,
) -> dict:
    return {
        "warrant_id": wid,
        "name": f"測試{wid}",
        "kind": kind,
        "market": market,
        "underlying_id": "2330",
        "underlying_name": "台積電",
        "strike": strike,
        "exercise_ratio": ratio,
        "last_trading_date": ltd,
        "maturity_date": ltd,
        "is_reset": is_reset,
        "eod_close": 1.0,
        "eod_bid": 0.99,
        "eod_ask": 1.01,
        "underlying_eod_close": ueod,
        "iv_prev": iv_prev,
    }


def mis_row(
    code: str = "030012",
    z: str = "1.30",
    a: str = "1.31_1.32_1.33_1.34_1.35_",
    b: str = "1.29_1.28_1.27_1.26_1.25_",
    f: str = "124_50_60_70_80_",
    g: str = "50_40_30_20_10_",
    tlong: str = "1783574200000",
    ex: str = "tse",
) -> dict:
    return {
        "c": code, "n": f"測試{code}", "z": z, "y": "1.25",
        "o": "1.26", "h": "1.35", "l": "1.24",
        "a": a, "b": b, "f": f, "g": g,
        "d": "20260710", "t": "13:30:00", "tlong": tlong, "ex": ex,
    }


def patch_snapshot(monkeypatch, warrants: list, as_of: str = "2026-07-09") -> dict:
    counter = {"snapshot": 0}

    async def fake_get(stock_id: str, refresh: bool = False) -> dict:
        counter["snapshot"] += 1
        return {"as_of_date": as_of, "warrants": warrants}

    monkeypatch.setattr(ws, "get_underlying_warrants", fake_get)
    return counter


def patch_mis(monkeypatch, rows_by_code: dict[str, dict]) -> dict:
    counter = {"calls": 0, "batches": []}

    async def fake_mis(ex_ch: str) -> list:
        counter["calls"] += 1
        codes = [seg.split("_", 1)[1].removesuffix(".tw") for seg in ex_ch.split("|")]
        counter["batches"].append(len(codes))
        return [rows_by_code[c] for c in codes if c in rows_by_code]

    monkeypatch.setattr(wq, "_fetch_mis_raw", fake_mis)
    return counter


# ---------------------------------------------------------------- MIS normalize


class TestParseMisRow:
    def test_dirty_fields(self) -> None:
        q = wq._parse_mis_row(mis_row())
        assert q is not None
        assert q["z"] == pytest.approx(1.30)
        assert q["bid"] == pytest.approx(1.29)  # 五檔取第一檔
        assert q["ask"] == pytest.approx(1.31)
        assert q["bid_vol"] == 50
        assert q["ask_vol"] == 124
        assert q["quote_date"] == "2026-07-10"
        assert q["quote_time"] == "13:30"

    def test_no_trade_and_placeholders(self) -> None:
        q = wq._parse_mis_row(mis_row(z="-", a="-", b="-", f="-", g="-"))
        assert q is not None
        assert q["z"] is None
        assert q["bid"] is None and q["ask"] is None
        assert q["bid_vol"] is None and q["ask_vol"] is None


# ---------------------------------------------------------------- 計算欄位


class TestComputedFields:
    async def test_call_numbers_locked_to_pricing_module(self, monkeypatch) -> None:
        w = term()
        patch_snapshot(monkeypatch, [w])
        patch_mis(monkeypatch, {
            "030012": mis_row(),
            "2330": mis_row(code="2330", z="100.50", a="100.51_-_-_-_-_", b="100.49_-_-_-_-_"),
        })
        payload = await wq.get_quotes("2330")
        q = payload["quotes"]["030012"]
        s_now = 100.50
        t_years = (date_type(2026, 7, 28) - date_type(2026, 7, 10)).days / 365.0
        iv = implied_vol(1.30 / 0.1, s_now, 95.0, t_years, RISK_FREE_RATE, "call")
        assert iv is not None
        assert q["iv"] == pytest.approx(iv, abs=1e-9)
        delta = bs_delta(s_now, 95.0, t_years, RISK_FREE_RATE, iv, "call")
        assert q["delta"] == pytest.approx(delta, abs=1e-9)
        lev = abs(delta) * s_now * 0.1 / 1.30
        assert q["leverage"] == pytest.approx(lev, abs=1e-9)
        spread = (1.31 - 1.29) / 1.29
        assert q["spread_ratio"] == pytest.approx(spread, abs=1e-9)
        assert q["spread_lev_ratio"] == pytest.approx(spread / lev, abs=1e-9)
        theo = bs_price(s_now, 95.0, t_years, RISK_FREE_RATE, 0.30, "call") * 0.1
        assert q["theo_price"] == pytest.approx(theo, abs=1e-9)
        assert q["mispricing_pct"] == pytest.approx((1.30 - theo) / theo, abs=1e-9)
        assert q["moneyness"] == pytest.approx((s_now - 95.0) / 95.0, abs=1e-9)
        assert q["days_left"] == 18  # T 基準 = clock.today()(R5),非 as_of
        assert payload["underlying_price"] == pytest.approx(100.50)
        assert payload["quote_date"] == "2026-07-10"

    async def test_mispricing_labels(self, monkeypatch) -> None:
        # iv_prev 造出理論價,現價 z 拉開 ±10% 外 → 標籤
        w_exp = term(wid="030001")
        w_cheap = term(wid="030002")
        w_fair = term(wid="030003")
        patch_snapshot(monkeypatch, [w_exp, w_cheap, w_fair])
        t_years = (date_type(2026, 7, 28) - date_type(2026, 7, 10)).days / 365.0
        theo = bs_price(100.0, 95.0, t_years, RISK_FREE_RATE, 0.30, "call") * 0.1
        patch_mis(monkeypatch, {
            "030001": mis_row(code="030001", z=f"{theo * 1.25:.4f}"),
            "030002": mis_row(code="030002", z=f"{theo * 0.75:.4f}"),
            "030003": mis_row(code="030003", z=f"{theo * 1.02:.4f}"),
            "2330": mis_row(code="2330", z="100.00"),
        })
        qs = (await wq.get_quotes("2330"))["quotes"]
        assert qs["030001"]["mispricing_label"] == "expensive"
        assert qs["030002"]["mispricing_label"] == "cheap"
        assert qs["030003"]["mispricing_label"] == "fair"

    async def test_no_price_yields_null_fields_but_row_present(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [term()])
        patch_mis(monkeypatch, {
            "030012": mis_row(z="-", a="-", b="-", f="-", g="-"),
            "2330": mis_row(code="2330", z="100.00"),
        })
        q = (await wq.get_quotes("2330"))["quotes"]["030012"]
        assert q["price"] is None
        assert q["iv"] is None and q["leverage"] is None
        assert q["spread_lev_ratio"] is None and q["theo_price"] is None
        assert q["days_left"] == 18  # 條款欄仍算

    async def test_reset_warrant_iv_null(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [term(is_reset=True, iv_prev=None)])
        patch_mis(monkeypatch, {
            "030012": mis_row(),
            "2330": mis_row(code="2330", z="100.00"),
        })
        q = (await wq.get_quotes("2330"))["quotes"]["030012"]
        assert q["iv"] is None and q["theo_price"] is None
        assert q["price"] == pytest.approx(1.30)  # 現價照列

    async def test_s_now_fallback_to_eod_close(self, monkeypatch) -> None:
        # R6:標的 MIS 無 z 無五檔 → 退 underlying_eod_close(=100.0)
        patch_snapshot(monkeypatch, [term()])
        patch_mis(monkeypatch, {
            "030012": mis_row(),
            "2330": mis_row(code="2330", z="-", a="-", b="-"),
        })
        payload = await wq.get_quotes("2330")
        assert payload["underlying_price"] == pytest.approx(100.0)
        assert payload["quotes"]["030012"]["iv"] is not None

    async def test_top_timestamp_fallback_to_max_tlong(self, monkeypatch) -> None:
        # R2-4:標的 MIS 記錄整筆缺 → 取批次 max tlong
        patch_snapshot(monkeypatch, [term(wid="030001"), term(wid="030002")])
        patch_mis(monkeypatch, {
            "030001": mis_row(code="030001", tlong="1783570000000"),
            "030002": mis_row(code="030002", tlong="1783574200000"),
        })
        payload = await wq.get_quotes("2330")
        assert payload["quote_date"] == "2026-07-10"
        assert payload["quote_time"] == "13:30"


# ---------------------------------------------------------------- IV 百分位


class TestIvPercentile:
    async def test_small_group_returns_null(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [term(wid="030001"), term(wid="030002")])
        patch_mis(monkeypatch, {
            "030001": mis_row(code="030001"),
            "030002": mis_row(code="030002"),
            "2330": mis_row(code="2330", z="100.00"),
        })
        qs = (await wq.get_quotes("2330"))["quotes"]
        assert qs["030001"]["iv_percentile"] is None  # 樣本 < 5

    async def test_group_of_five_and_kind_separation(self, monkeypatch) -> None:
        calls = [term(wid=f"03000{i}") for i in range(1, 6)]
        put = term(wid="03001P", kind="put", strike=105.0)
        patch_snapshot(monkeypatch, calls + [put])
        rows = {w["warrant_id"]: mis_row(code=w["warrant_id"], z=f"{1.0 + i * 0.1:.2f}")
                for i, w in enumerate(calls)}
        rows["03001P"] = mis_row(code="03001P", z="0.50")
        rows["2330"] = mis_row(code="2330", z="100.00")
        patch_mis(monkeypatch, rows)
        qs = (await wq.get_quotes("2330"))["quotes"]
        pcts = [qs[w["warrant_id"]]["iv_percentile"] for w in calls]
        assert all(p is not None for p in pcts)
        assert pcts == sorted(pcts)  # 價越高 IV 越高 → 百分位遞增
        assert qs["03001P"]["iv_percentile"] is None  # put 只有 1 檔,不混 call 組


# ---------------------------------------------------------------- cooldown / 批次 / 併發


class TestCooldownAndBatching:
    async def test_cooldown_hit_skips_mis(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [term()])
        counter = patch_mis(monkeypatch, {
            "030012": mis_row(), "2330": mis_row(code="2330", z="100.00"),
        })
        t = {"now": 1000.0}
        monkeypatch.setattr(wq, "_monotonic", lambda: t["now"])
        await wq.get_quotes("2330")
        first = counter["calls"]
        t["now"] += 5.0
        await wq.get_quotes("2330")  # cooldown 內
        assert counter["calls"] == first
        t["now"] += 6.0
        await wq.get_quotes("2330")  # 過 10s
        assert counter["calls"] > first

    async def test_refresh_bypasses_and_writes_back(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [term()])
        counter = patch_mis(monkeypatch, {
            "030012": mis_row(), "2330": mis_row(code="2330", z="100.00"),
        })
        t = {"now": 1000.0}
        monkeypatch.setattr(wq, "_monotonic", lambda: t["now"])
        await wq.get_quotes("2330")
        first = counter["calls"]
        t["now"] += 5.0
        await wq.get_quotes("2330", refresh=True)  # 跳 cooldown
        assert counter["calls"] == first + 1
        t["now"] += 5.0
        await wq.get_quotes("2330")  # refresh 寫回 → 新 cooldown 窗內
        assert counter["calls"] == first + 1

    async def test_cooldown_dict_capped(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [])
        patch_mis(monkeypatch, {})
        for i in range(wq.QUOTES_COOLDOWN_MAX + 3):
            await wq.get_quotes(f"23{i:02d}")
        assert len(wq._cooldown) == wq.QUOTES_COOLDOWN_MAX

    async def test_batching_capped_at_100(self, monkeypatch) -> None:
        warrants = [term(wid=f"03{i:04d}") for i in range(150)]
        patch_snapshot(monkeypatch, warrants)
        counter = patch_mis(monkeypatch, {})
        await wq.get_quotes("2330")
        assert all(n <= wq.MIS_BATCH_SIZE for n in counter["batches"])
        assert sum(counter["batches"]) == 151  # 150 權證 + 標的

    async def test_empty_warrants_no_mis_call(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [])
        counter = patch_mis(monkeypatch, {})
        payload = await wq.get_quotes("9999")
        assert payload["quotes"] == {}
        assert counter["calls"] == 0

    async def test_concurrent_same_underlying_dedup(self, monkeypatch) -> None:
        patch_snapshot(monkeypatch, [term()])
        counter = patch_mis(monkeypatch, {
            "030012": mis_row(), "2330": mis_row(code="2330", z="100.00"),
        })
        await asyncio.gather(wq.get_quotes("2330"), wq.get_quotes("2330"))
        assert counter["calls"] == 1  # _run_once 合流(S-7)
