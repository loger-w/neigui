"""EOD 權證快照 service 測試(warrant-selector design §1.2)。

fixture 形狀 = 2026-07-11 Phase 0 probe 真實 payload 縮樣(欄名/髒點原樣)。
"""

from __future__ import annotations

import asyncio
from datetime import date as date_type

import pytest
from fastapi import HTTPException

from services import clock
from services import warrants as ws
from services.warrant_pricing import RISK_FREE_RATE, implied_vol
from utils.cache import atomic_write_json, chip_cache_dir, read_json


@pytest.fixture(autouse=True)
def _reset_warrants_state(monkeypatch):
    """module-level state reset 慣例(同 test_daytrade_fee)。

    test-infra:post-build archive(warrant-iv-drift)在本檔一律 no-op —
    本檔測快照邏輯,archive/drift 供給鏈由 test_warrant_iv_history 覆蓋;
    不 no-op 會在每測試殘留 pending background task。
    """
    from services import warrant_iv_history as ivh

    monkeypatch.setattr(ws, "_client", None)
    monkeypatch.setattr(ws, "_snapshot_mem", None)
    monkeypatch.setattr(ws, "_last_build_attempt", None)
    ws._inflight.clear()
    monkeypatch.setattr(ivh, "ensure_post_build_task", lambda snap: None)
    monkeypatch.setattr(ivh, "_drift_mem", None)
    ivh._series_lru.clear()
    ivh._inflight.clear()


@pytest.fixture(autouse=True)
def _freeze_today(monkeypatch):
    """clock.today() → 2026-07-11(週六;最近交易日 07-09,07-10 颱風假)。"""
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 11))


# ---------------------------------------------------------------- raw row helpers


def twse_market_row(
    wid: str = "030012",
    close: str = "0.08",
    bid: str = "0.03",
    ask: str = "0.08",
    uid: str = "6781",
    uclose: str = "1,130.00",
) -> list:
    return [
        "", wid, "AES凱基57購02", "57,000", "10", "1,900",
        "0.08", "0.08", "0.03", close, "<p> </p>", "0.00",
        bid, "50", ask, "124", "1,130.00", uid, "AES-KY", uclose,
    ]


def twse_terms_row(
    wid: str = "030012",
    kind: str = "認購",
    strike: str = "1475.4100",
    per_thousand: str = "7.00",
    ltd: str = "1150728",
    category: str = "一般型",
) -> dict:
    return {
        "出表日期": "1150710",
        "權證代號": wid,
        "權證簡稱": "AES凱基57購02",
        "權證類型": kind,
        "類別": category,
        "最後交易日": ltd,
        "履約截止日": "1150730",
        "標的證券/指數": "AES-KY",
        "最新標的履約配發數量(每仟單位權證)": per_thousand,
        "最新履約價格(元)/履約指數": strike,
    }


def tpex_quts_row(
    wid: str = "72124U", close: str = "0.31", uid: str = "8086", date: str = "1150709",
) -> dict:
    return {
        "Date": date,
        "Code": wid,
        "Name": "宏捷科群益58售01",
        "Close": close,
        "UnderlyingStockCode": uid,
        "UnderlyingStock": "宏捷科",
        "UnderlyingStockClosePrice": "91.05",
    }


def tpex_close_row(wid: str = "72124U", bid: str = "0.30", ask: str = "0.32") -> dict:
    return {"SecuritiesCompanyCode": wid, "LatestBidPrice": bid, "LatesAskPrice": ask}


def tpex_issue_row(
    wid: str = "72124U",
    kind: str = "認售",
    ratio_key: str = "Latest ExerciseRatio",
    ratio: str = "0.162",
    reset: str = "N",
    expiry: str = "20260818",
) -> dict:
    return {
        "Date": "1150709",
        "Code": wid,
        "Name": "宏捷科群益58售01",
        "ListedDate": "20250819",
        "ExpiryDate": expiry,
        "UnderlyingStockCode": "8086",
        "UnderlyingStock": "宏捷科",
        "Type": kind,
        "Reset": reset,
        "LatestExercisePrice": "91.05",
        ratio_key: ratio,
    }


def patch_upstream(
    monkeypatch,
    mi_by_date: dict[tuple[str, str], list] | None = None,
    terms: list | None = None,
    quts: list | None = None,
    tclose: list | None = None,
    issue: list | None = None,
) -> dict:
    """六個 fetch 全 monkeypatch;回 counter dict 供斷言打了幾次。"""
    counter = {"mi": 0, "terms": 0, "quts": 0, "tclose": 0, "issue": 0}

    async def fake_mi(date_iso: str, type_code: str) -> list:
        counter["mi"] += 1
        return (mi_by_date or {}).get((date_iso, type_code), [])

    async def fake_terms() -> list:
        counter["terms"] += 1
        return terms or []

    async def fake_quts() -> list:
        counter["quts"] += 1
        return quts or []

    async def fake_tclose() -> list:
        counter["tclose"] += 1
        return tclose or []

    async def fake_issue() -> list:
        counter["issue"] += 1
        return issue or []

    monkeypatch.setattr(ws, "fetch_mi_index", fake_mi)
    monkeypatch.setattr(ws, "fetch_t187ap37", fake_terms)
    monkeypatch.setattr(ws, "_fetch_tpex_quts", fake_quts)
    monkeypatch.setattr(ws, "_fetch_tpex_close", fake_tclose)
    monkeypatch.setattr(ws, "fetch_tpex_issue", fake_issue)
    return counter


def default_upstream(monkeypatch) -> dict:
    """標準情境:07-11(today)空、07-10 空(颱風假)、07-09 有料。"""
    mi = {
        ("2026-07-09", "0999"): [twse_market_row()],
        ("2026-07-09", "0999P"): [],
    }
    return patch_upstream(
        monkeypatch,
        mi_by_date=mi,
        terms=[twse_terms_row()],
        quts=[tpex_quts_row()],
        tclose=[tpex_close_row()],
        issue=[tpex_issue_row()],
    )


# ---------------------------------------------------------------- normalize 髒點


class TestNormalize:
    def test_roc_compact_to_iso(self) -> None:
        assert ws._roc_compact_to_iso("1150728") == "2026-07-28"

    def test_row_get_stripped_key_both_variants(self) -> None:
        # S-2:官方欄名 leading space 有無皆可解
        assert ws._row_get({" Latest ExerciseRatio": "0.05"}, "Latest ExerciseRatio") == "0.05"
        assert ws._row_get({"Latest ExerciseRatio": "0.05"}, "Latest ExerciseRatio") == "0.05"
        assert ws._row_get({}, "Latest ExerciseRatio") is None

    def test_price_basis_rejects_crossed_quote(self) -> None:
        # code-review CR-1:bid > ask 倒掛報價不得餵進 IV 反解 → None
        assert ws._warrant_price_basis(None, 5.25, 5.10) is None
        assert ws._warrant_price_basis(None, 1.20, 1.30) == pytest.approx(1.25)

    def test_parse_price_dirty_values(self) -> None:
        assert ws._parse_price("1,130.00") == pytest.approx(1130.0)
        assert ws._parse_price("") is None
        assert ws._parse_price("---") is None
        assert ws._parse_price("-") is None
        assert ws._parse_price("    ") is None

    def test_extract_mi_table_picks_20_field_table(self) -> None:
        body = {
            "stat": "OK",
            "tables": [
                {"fields": [], "data": []},
                {"fields": ["a"] * 8, "data": [["牛熊表"]]},
                {"fields": ["f"] * 20, "data": [twse_market_row()]},
            ],
        }
        assert ws._extract_mi_table(body) == [twse_market_row()]

    def test_extract_mi_table_empty_day(self) -> None:
        # S-1:非交易日 stat OK 但全表空
        assert ws._extract_mi_table({"stat": "OK", "tables": [{}] * 10}) == []

    def test_normalize_twse_market_row(self) -> None:
        row = ws.normalize_twse_market_row(twse_market_row())
        assert row == {
            "warrant_id": "030012",
            "name": "AES凱基57購02",
            "close": pytest.approx(0.08),
            "bid": pytest.approx(0.03),
            "ask": pytest.approx(0.08),
            "underlying_id": "6781",
            "underlying_name": "AES-KY",
            "underlying_close": pytest.approx(1130.0),
        }

    def test_normalize_twse_market_row_bad_row_returns_none(self) -> None:
        assert ws.normalize_twse_market_row(["only", "two"]) is None

    def test_normalize_twse_terms_row(self) -> None:
        row = ws.normalize_twse_terms_row(twse_terms_row())
        assert row is not None
        assert row["kind"] == "call"
        assert row["strike"] == pytest.approx(1475.41)
        # S-2:行使比例 = 每仟單位配發數量 / 1000(備註鐵證 7.00 → 0.0070)
        assert row["exercise_ratio"] == pytest.approx(0.007)
        assert row["last_trading_date"] == "2026-07-28"
        assert row["is_reset"] is False

    def test_normalize_twse_terms_reset_category(self) -> None:
        row = ws.normalize_twse_terms_row(twse_terms_row(category="一般型;重設型-單一單價"))
        assert row is not None
        assert row["is_reset"] is True

    def test_normalize_tpex_issue_row_leading_space_key(self) -> None:
        row = ws.normalize_tpex_issue_row(tpex_issue_row(ratio_key=" Latest ExerciseRatio"))
        assert row is not None
        assert row["kind"] == "put"
        assert row["exercise_ratio"] == pytest.approx(0.162)
        assert row["maturity_date"] == "2026-08-18"  # 西元緊湊(與民國混用)
        assert row["is_reset"] is False

    def test_normalize_tpex_quts_zero_trade_close(self) -> None:
        row = ws.normalize_tpex_quts_row(tpex_quts_row(close="---"))
        assert row is not None
        assert row["close"] is None
        assert row["date"] == "2026-07-09"


# ---------------------------------------------------------------- build / 回退 / universe


class TestBuild:
    async def test_fallback_to_last_trading_day_no_flag(self, monkeypatch) -> None:
        # R1:盤中/假日回退是常態 → as_of 承載,無 no_trading_day key
        default_upstream(monkeypatch)
        payload = await ws.get_underlying_warrants("6781")
        assert payload["as_of_date"] == "2026-07-09"
        assert "no_trading_day" not in payload
        assert len(payload["warrants"]) == 1

    async def test_all_days_empty_no_cache_raises_404(self, monkeypatch) -> None:
        patch_upstream(monkeypatch)
        with pytest.raises(HTTPException) as ei:
            await ws.get_underlying_warrants("6781")
        assert ei.value.status_code == 404
        assert ei.value.detail == {"error": "no_data"}

    async def test_expired_warrant_filtered(self, monkeypatch) -> None:
        # S-4:t187ap37_L 含已到期(ltd < as_of)→ 剔除
        mi = {("2026-07-09", "0999"): [twse_market_row()]}
        patch_upstream(
            monkeypatch, mi_by_date=mi, terms=[twse_terms_row(ltd="1150528")],
        )
        payload = await ws.get_underlying_warrants("6781")
        assert payload["warrants"] == []

    async def test_expired_tpex_warrant_filtered(self, monkeypatch) -> None:
        # review P2 補鎖:到期剔除原僅 TWSE fixture 驗證 — TPEx 路徑
        # (ExpiryDate 已過 as_of)走同一 add_warrant 分支,補資料路徑直接證據
        mi = {("2026-07-09", "0999"): [twse_market_row()]}
        patch_upstream(
            monkeypatch,
            mi_by_date=mi,
            quts=[tpex_quts_row()],
            tclose=[tpex_close_row()],
            issue=[tpex_issue_row(expiry="20260601")],
        )
        payload = await ws.get_underlying_warrants("8086")
        assert payload["warrants"] == []

    async def test_market_row_without_terms_skipped(self, monkeypatch) -> None:
        # edge 8:新掛牌 race — 行情有、條款缺 → skip 不炸
        mi = {("2026-07-09", "0999"): [twse_market_row(), twse_market_row(wid="030099")]}
        patch_upstream(monkeypatch, mi_by_date=mi, terms=[twse_terms_row()])
        payload = await ws.get_underlying_warrants("6781")
        assert [w["warrant_id"] for w in payload["warrants"]] == ["030012"]

    async def test_tpex_merged_with_own_date(self, monkeypatch) -> None:
        # impl-R7:TPEx 日期 ≠ TWSE as_of 仍合併,tpex_date 記錄
        default_upstream(monkeypatch)
        payload = await ws.get_underlying_warrants("8086")
        assert len(payload["warrants"]) == 1
        w = payload["warrants"][0]
        assert w["market"] == "tpex"
        assert w["kind"] == "put"
        assert w["eod_bid"] == pytest.approx(0.30)
        assert w["eod_ask"] == pytest.approx(0.32)
        snap = ws._snapshot_mem
        assert snap is not None and snap["tpex_date"] == "2026-07-09"

    async def test_unknown_underlying_returns_empty(self, monkeypatch) -> None:
        default_upstream(monkeypatch)
        payload = await ws.get_underlying_warrants("2330")
        assert payload["warrants"] == []  # SC-7

    async def test_build_upstream_fetches_run_concurrently(self, monkeypatch) -> None:
        # perf/warrant-api-load S2:六個 upstream fetch 序列 ≈ 4.1s(E3 分解),
        # 並發後冷 build ≈ max(單路)+ IV;儀器 = in-flight 峰值 > 1
        state = {"inflight": 0, "peak": 0}

        def instrument(rows_fn):
            async def _fetch(*args) -> list:
                state["inflight"] += 1
                state["peak"] = max(state["peak"], state["inflight"])
                await asyncio.sleep(0.01)
                state["inflight"] -= 1
                return rows_fn(*args)

            return _fetch

        mi = {
            ("2026-07-09", "0999"): [twse_market_row()],
            ("2026-07-09", "0999P"): [],
        }
        monkeypatch.setattr(
            ws, "fetch_mi_index", instrument(lambda d, t: mi.get((d, t), []))
        )
        monkeypatch.setattr(ws, "fetch_t187ap37", instrument(lambda: [twse_terms_row()]))
        monkeypatch.setattr(ws, "_fetch_tpex_quts", instrument(lambda: [tpex_quts_row()]))
        monkeypatch.setattr(ws, "_fetch_tpex_close", instrument(lambda: [tpex_close_row()]))
        monkeypatch.setattr(ws, "fetch_tpex_issue", instrument(lambda: [tpex_issue_row()]))

        payload = await ws.get_underlying_warrants("6781")
        assert state["peak"] > 1
        assert len(payload["warrants"]) == 1  # 並發不得改變組裝結果


# ---------------------------------------------------------------- iv_prev


class TestIvPrev:
    async def test_iv_prev_from_close(self, monkeypatch) -> None:
        # 真實化參數:S=100, K=95, ratio=0.1, ltd 2026-07-28, as_of 2026-07-09
        mi = {
            ("2026-07-09", "0999"): [
                twse_market_row(close="1.25", bid="1.20", ask="1.30", uclose="100.00"),
            ],
        }
        patch_upstream(
            monkeypatch, mi_by_date=mi,
            terms=[twse_terms_row(strike="95.0000", per_thousand="100.00")],
        )
        payload = await ws.get_underlying_warrants("6781")
        w = payload["warrants"][0]
        t = (date_type(2026, 7, 28) - date_type(2026, 7, 9)).days / 365.0
        expected = implied_vol(1.25 / 0.1, 100.0, 95.0, t, RISK_FREE_RATE, "call")
        assert expected is not None
        assert w["iv_prev"] == pytest.approx(expected, abs=1e-9)

    async def test_iv_prev_zero_trade_uses_mid(self, monkeypatch) -> None:
        mi = {
            ("2026-07-09", "0999"): [
                twse_market_row(close="", bid="1.20", ask="1.30", uclose="100.00"),
            ],
        }
        patch_upstream(
            monkeypatch, mi_by_date=mi,
            terms=[twse_terms_row(strike="95.0000", per_thousand="100.00")],
        )
        w = (await ws.get_underlying_warrants("6781"))["warrants"][0]
        t = (date_type(2026, 7, 28) - date_type(2026, 7, 9)).days / 365.0
        expected = implied_vol(1.25 / 0.1, 100.0, 95.0, t, RISK_FREE_RATE, "call")
        assert w["iv_prev"] == pytest.approx(expected, abs=1e-9)

    async def test_iv_prev_none_when_no_price_or_reset(self, monkeypatch) -> None:
        mi = {
            ("2026-07-09", "0999"): [
                twse_market_row(close="", bid="", ask="", uclose="100.00"),
                twse_market_row(wid="030777", close="1.25", uclose="100.00"),
            ],
        }
        patch_upstream(
            monkeypatch, mi_by_date=mi,
            terms=[
                twse_terms_row(strike="95.0000", per_thousand="100.00"),
                twse_terms_row(wid="030777", category="重設型-單一單價",
                               strike="95.0000", per_thousand="100.00"),
            ],
        )
        ws_by_id = {
            w["warrant_id"]: w
            for w in (await ws.get_underlying_warrants("6781"))["warrants"]
        }
        assert ws_by_id["030012"]["iv_prev"] is None  # 無價
        assert ws_by_id["030777"]["iv_prev"] is None  # 重設型
        assert ws_by_id["030777"]["is_reset"] is True


# ---------------------------------------------------------------- cache 語意


class TestCache:
    async def test_refresh_skips_valid_cache(self, monkeypatch) -> None:
        counter = default_upstream(monkeypatch)
        await ws.get_underlying_warrants("6781")
        first = counter["terms"]
        await ws.get_underlying_warrants("6781")  # 同日 cache 命中
        assert counter["terms"] == first
        await ws.get_underlying_warrants("6781", refresh=True)
        assert counter["terms"] == first + 1

    async def test_cache_version_bump_invalidates(self, monkeypatch) -> None:
        counter = default_upstream(monkeypatch)
        atomic_write_json(
            chip_cache_dir() / ws.SNAPSHOT_FILE,
            {"_cache_version": 0, "as_of_date": "2026-07-09",
             "fetched_on": "2026-07-11", "tpex_date": None, "by_underlying": {}},
        )
        payload = await ws.get_underlying_warrants("6781")
        assert counter["terms"] == 1  # 舊版 cache 無效 → rebuild
        assert payload["warrants"]

    async def test_file_cache_survives_process_restart(self, monkeypatch) -> None:
        counter = default_upstream(monkeypatch)
        await ws.get_underlying_warrants("6781")
        monkeypatch.setattr(ws, "_snapshot_mem", None)  # 模擬重啟
        payload = await ws.get_underlying_warrants("6781")
        assert counter["terms"] == 1  # 檔案層命中,不重 build
        assert payload["warrants"]

    async def test_empty_upstream_does_not_overwrite_nonempty_cache(
        self, monkeypatch,
    ) -> None:
        counter = default_upstream(monkeypatch)
        await ws.get_underlying_warrants("6781")
        assert counter["terms"] == 1
        # 換成全空 upstream + refresh 強制 rebuild
        patch_upstream(monkeypatch)
        payload = await ws.get_underlying_warrants("6781", refresh=True)
        assert payload["warrants"]  # 回舊資料
        disk = read_json(chip_cache_dir() / ws.SNAPSHOT_FILE)
        assert disk is not None and disk["by_underlying"]  # 檔案未被空表覆寫

    async def test_build_backoff_within_window(self, monkeypatch) -> None:
        # R2-1:空回後 60s 內第二請求不重打 upstream
        counter = patch_upstream(monkeypatch)
        t = {"now": 1000.0}
        monkeypatch.setattr(ws, "_monotonic", lambda: t["now"])
        with pytest.raises(HTTPException):
            await ws.get_underlying_warrants("6781")
        mi_after_first = counter["mi"]
        t["now"] += 30.0
        with pytest.raises(HTTPException):
            await ws.get_underlying_warrants("6781")
        assert counter["mi"] == mi_after_first  # backoff 內不重試
        t["now"] += 61.0
        with pytest.raises(HTTPException):
            await ws.get_underlying_warrants("6781")
        assert counter["mi"] > mi_after_first  # 過窗重試

    async def test_stale_cache_served_during_backoff(self, monkeypatch) -> None:
        default_upstream(monkeypatch)
        t = {"now": 1000.0}
        monkeypatch.setattr(ws, "_monotonic", lambda: t["now"])
        await ws.get_underlying_warrants("6781")
        # 跨日:cache 失效(fetched_on != today),upstream 改為全空
        monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 12))
        counter2 = patch_upstream(monkeypatch)
        p1 = await ws.get_underlying_warrants("6781")  # backoff/空回 → 回 stale
        assert p1["warrants"]
        t["now"] += 10.0
        p2 = await ws.get_underlying_warrants("6781")  # backoff 內 → 直接 stale
        assert p2["warrants"]
        assert counter2["mi"] == 0  # backoff 期間零 upstream hit

    async def test_stale_fallback_populates_mem_cache(self, monkeypatch) -> None:
        # code-review CR-3:空回退回檔案 cache 時要回寫 _snapshot_mem,
        # 否則重啟後每請求多一次磁碟讀
        default_upstream(monkeypatch)
        await ws.get_underlying_warrants("6781")
        # 模擬重啟 + 跨日 + upstream 全空 → 走「空回不覆寫」回退
        monkeypatch.setattr(ws, "_snapshot_mem", None)
        monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 12))
        patch_upstream(monkeypatch)
        payload = await ws.get_underlying_warrants("6781")
        assert payload["warrants"]
        assert ws._snapshot_mem is not None  # mem 已回填

    async def test_concurrent_requests_single_build(self, monkeypatch) -> None:
        # R3:併發首請求合流單次 build
        counter = default_upstream(monkeypatch)
        await asyncio.gather(
            ws.get_underlying_warrants("6781"),
            ws.get_underlying_warrants("8086"),
        )
        assert counter["terms"] == 1
