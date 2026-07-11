"""warrant_iv_history service 測試(warrant-iv-drift SC-1/2,design v4)。

wn1430 fixture 形狀 = 2026-07-11 mini-probe 真實 payload 縮樣(欄名原樣,
含 2023 舊年份「千股」欄名變體);archive/backfill 走 monkeypatch fetch。
"""

from __future__ import annotations

from datetime import date as date_type

import pytest

from services import clock
from services import warrant_iv_history as ivh
from services import warrants as ws
from utils.cache import atomic_write_json, chip_cache_dir, read_json


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """module-level state reset 慣例(同 test_warrants_service)。"""
    monkeypatch.setattr(ivh, "_client", None)
    monkeypatch.setattr(ivh, "_drift_mem", None)
    monkeypatch.setattr(ivh, "_rebuild_generation", 0)
    monkeypatch.setattr(ivh, "_post_build_task", None)
    monkeypatch.setattr(ivh, "_backfill_task", None)
    monkeypatch.setattr(ivh, "_rebuild_bg_task", None)
    ivh._series_lru.clear()
    ivh._inflight.clear()


@pytest.fixture(autouse=True)
def _freeze_today(monkeypatch):
    """clock.today() → 2026-07-11(週六;07-10 颱風假、最近交易日 07-09)。"""
    monkeypatch.setattr(clock, "today", lambda: date_type(2026, 7, 11))


# ---------------------------------------------------------------- helpers


def make_warrant(
    wid: str = "030012",
    market: str = "twse",
    uid: str = "6781",
    bid: float | None = 0.65,
    ask: float | None = 0.70,
    close: float | None = 0.68,
    s: float | None = 100.0,
    strike: float | None = 95.0,
    ratio: float | None = 0.1,
    ltd: str = "2026-12-30",
    kind: str = "call",
    is_reset: bool = False,
) -> dict:
    return {
        "warrant_id": wid,
        "name": "測試權證",
        "kind": kind,
        "market": market,
        "underlying_id": uid,
        "underlying_name": "測試標的",
        "strike": strike,
        "exercise_ratio": ratio,
        "last_trading_date": ltd,
        "maturity_date": ltd,
        "is_reset": is_reset,
        "eod_close": close,
        "eod_bid": bid,
        "eod_ask": ask,
        "underlying_eod_close": s,
        "iv_prev": None,
    }


def make_snap(
    warrants: list[dict] | None = None,
    as_of: str = "2026-07-09",
    tpex_date: str | None = "2026-07-09",
) -> dict:
    by_underlying: dict[str, list] = {}
    for w in warrants if warrants is not None else [make_warrant()]:
        by_underlying.setdefault(w["underlying_id"], []).append(w)
    return {
        "_cache_version": 1,
        "as_of_date": as_of,
        "fetched_on": "2026-07-11",
        "tpex_date": tpex_date,
        "by_underlying": by_underlying,
    }


def day_file(date_iso: str):
    return chip_cache_dir() / ivh.HISTORY_DIR / f"{date_iso}.json"


def write_day(date_iso: str, warrants: dict, terms_approx: bool = False, version: int | None = None) -> None:
    atomic_write_json(
        day_file(date_iso),
        {
            "_cache_version": version if version is not None else ivh._CACHE_VERSION,
            "date": date_iso,
            "terms_approx": terms_approx,
            "warrants": warrants,
        },
    )


# ---------------------------------------------------------------- SC-1 archive


class TestArchive:
    async def test_archive_writes_day_file(self) -> None:
        snap = make_snap([make_warrant(), make_warrant(wid="72124U", market="tpex", uid="8086")])
        assert await ivh.archive_from_snapshot(snap) is True
        payload = read_json(day_file("2026-07-09"))
        assert payload["_cache_version"] == ivh._CACHE_VERSION
        assert payload["terms_approx"] is False
        entry = payload["warrants"]["030012"]
        assert set(entry) == {"b", "a", "c", "s", "ivb", "iva"}
        assert entry["b"] == pytest.approx(0.65)
        assert entry["s"] == pytest.approx(100.0)
        # bid 0.65/ratio 0.1 = 6.5/股,call s=100 k=95 t~0.47y → IV 可解
        assert entry["ivb"] is not None and 0.01 < entry["ivb"] < 5.0
        assert entry["iva"] is not None and entry["iva"] > entry["ivb"]
        assert "72124U" in payload["warrants"]

    async def test_archive_idempotent_returns_false(self) -> None:
        snap = make_snap()
        assert await ivh.archive_from_snapshot(snap) is True
        assert await ivh.archive_from_snapshot(snap) is False

    async def test_archive_skips_tpex_on_lag(self) -> None:
        # R3:tpex_date != as_of → TPEx 列不得寫進 as_of 檔(immutable 錯位不可自癒)
        snap = make_snap(
            [make_warrant(), make_warrant(wid="72124U", market="tpex", uid="8086")],
            tpex_date="2026-07-08",
        )
        await ivh.archive_from_snapshot(snap)
        payload = read_json(day_file("2026-07-09"))
        assert "030012" in payload["warrants"]
        assert "72124U" not in payload["warrants"]

    async def test_archive_inverted_quote_both_none(self) -> None:
        # R8:bid > ask 倒掛是 pair 層級無效 → ivb/iva 皆 None(對齊 _warrant_price_basis)
        snap = make_snap([make_warrant(bid=0.70, ask=0.65)])
        await ivh.archive_from_snapshot(snap)
        entry = read_json(day_file("2026-07-09"))["warrants"]["030012"]
        assert entry["ivb"] is None and entry["iva"] is None
        assert entry["b"] == pytest.approx(0.70)  # raw 照存

    async def test_archive_reset_warrant_no_iv(self) -> None:
        snap = make_snap([make_warrant(is_reset=True)])
        await ivh.archive_from_snapshot(snap)
        entry = read_json(day_file("2026-07-09"))["warrants"]["030012"]
        assert entry["ivb"] is None and entry["iva"] is None

    async def test_archive_prunes_old_files(self) -> None:
        # R7:僅保留最新 PRUNE_KEEP 檔
        for i in range(ivh.PRUNE_KEEP + 5):
            write_day(f"2025-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}", {})
        await ivh.archive_from_snapshot(make_snap())
        files = sorted(p.name for p in (chip_cache_dir() / ivh.HISTORY_DIR).glob("*.json"))
        assert len(files) == ivh.PRUNE_KEEP
        assert files[-1] == "2026-07-09.json"
        assert "2025-01-01.json" not in files

    async def test_post_build_skips_rebuild_when_archive_false(self, monkeypatch) -> None:
        # R21:refresh 重跑 build 不得重跑 rebuild(輸入 day files 未變)
        calls = {"rebuild": 0}

        async def fake_rebuild() -> dict:
            calls["rebuild"] += 1
            return {}

        monkeypatch.setattr(ivh, "rebuild_drift_summary", fake_rebuild)
        snap = make_snap()
        ivh.ensure_post_build_task(snap)
        assert ivh._post_build_task is not None
        await ivh._post_build_task
        assert calls["rebuild"] == 1
        ivh.ensure_post_build_task(snap)  # 同日再 build(refresh)→ archive False
        await ivh._post_build_task
        assert calls["rebuild"] == 1


# ---------------------------------------------------------------- wn1430 parse


WN1430_FIELDS = [
    "代號", "名稱", "收盤 ", "漲跌", "開盤 ", "最高 ", "最低", "成交股數  ",
    " 成交金額(元)", " 成交筆數 ", "最後買價", "最後買量<br>(張數)", "最後賣價",
    "最後賣量<br>(張數)", "發行股數 ", "次日漲停價 ", "次日跌停價",
]
# 2023 舊年份變體:量欄名「千股」(probe 實測;本 feature 不取量欄,欄序同)
WN1430_FIELDS_2023 = [f.replace("張數", "千股") for f in WN1430_FIELDS]


def wn1430_body(fields: list[str], rows: list[list], date: str = "20260709") -> dict:
    return {"date": date, "stat": "ok", "tables": [{"fields": fields, "data": rows}]}


WN1430_ROW = [
    "72124U", "宏捷科群益58售01", "0.31", "+0.01", "0.30", "0.32", "0.29",
    "20,000", "6,200", "5", "0.30", "22", "0.32", "10", "10,000,000",
    "9,999.95", "0.01",
]


class TestWn1430Parse:
    def test_parse_normalizes_key_columns(self) -> None:
        rows = ivh.parse_wn1430(wn1430_body(WN1430_FIELDS, [WN1430_ROW]), "2026-07-09")
        assert rows == [{"warrant_id": "72124U", "close": 0.31, "bid": 0.30, "ask": 0.32}]

    def test_parse_2023_field_variant(self) -> None:
        rows = ivh.parse_wn1430(wn1430_body(WN1430_FIELDS_2023, [WN1430_ROW]), "2026-07-09")
        assert rows[0]["warrant_id"] == "72124U"

    def test_parse_zero_trade_dashes(self) -> None:
        row = list(WN1430_ROW)
        row[2] = "---"
        rows = ivh.parse_wn1430(wn1430_body(WN1430_FIELDS, [row]), "2026-07-09")
        assert rows[0]["close"] is None

    def test_parse_rejects_echo_date_mismatch(self) -> None:
        # echo date 校驗:回的不是指定日 → 視為空
        assert ivh.parse_wn1430(wn1430_body(WN1430_FIELDS, [WN1430_ROW]), "2026-07-08") == []

    def test_parse_rejects_bad_stat(self) -> None:
        body = wn1430_body(WN1430_FIELDS, [WN1430_ROW])
        body["stat"] = "error"
        assert ivh.parse_wn1430(body, "2026-07-09") == []

    def test_parse_incomplete_fields_returns_empty_not_raise(self) -> None:
        # CR-A1:欄位變體缺「最後賣價」時不得 ValueError 穿透逐日 catch
        # (非 httpx 例外會中止整段 backfill,打破「單日壞不炸整段」)
        fields = [f for f in WN1430_FIELDS if f.strip() != "最後賣價"]
        row = WN1430_ROW[: len(fields)]
        assert ivh.parse_wn1430(wn1430_body(fields, [row]), "2026-07-09") == []


# ---------------------------------------------------------------- 序列組裝 / drift map


class TestSeriesAssembly:
    async def test_series_axis_fills_missing_dates(self, monkeypatch) -> None:
        # R24:檔存在但權證缺席 → 補 (date, None, None),不壓縮 x 軸
        write_day("2026-07-07", {"030012": {"b": 0.6, "a": 0.65, "c": 0.62, "s": 100.0, "ivb": 0.41, "iva": 0.45}})
        write_day("2026-07-08", {})  # 該權證缺席日
        write_day("2026-07-09", {"030012": {"b": 0.55, "a": 0.60, "c": 0.57, "s": 100.0, "ivb": 0.38, "iva": 0.42}}, terms_approx=True)
        snap = make_snap()

        async def fake_get_snapshot(refresh: bool = False) -> dict:
            return snap

        monkeypatch.setattr(ws, "get_snapshot", fake_get_snapshot)
        out = await ivh.get_iv_history("030012")
        assert out is not None
        assert [p["date"] for p in out["series"]] == ["2026-07-07", "2026-07-08", "2026-07-09"]
        assert out["series"][1] == {"date": "2026-07-08", "iv_bid": None, "iv_ask": None}
        assert out["series"][0]["iv_bid"] == pytest.approx(0.41)
        assert out["terms_approx_dates"] == ["2026-07-09"]
        assert out["drift"]["label"] == "insufficient"  # 3 日 < MIN_VALID_POINTS
        if ivh._rebuild_bg_task is not None:
            await ivh._rebuild_bg_task

    async def test_unknown_warrant_returns_none(self, monkeypatch) -> None:
        snap = make_snap()

        async def fake_get_snapshot(refresh: bool = False) -> dict:
            return snap

        monkeypatch.setattr(ws, "get_snapshot", fake_get_snapshot)
        assert await ivh.get_iv_history("999999") is None

    async def test_series_lru_discarded_on_generation_mismatch(self, monkeypatch) -> None:
        # R12:組裝期間 rebuild 完成(generation 前進)→ 結果照回但不入 LRU
        write_day("2026-07-09", {"030012": {"b": 0.6, "a": 0.65, "c": 0.62, "s": 100.0, "ivb": 0.41, "iva": 0.45}})
        snap = make_snap()

        async def fake_get_snapshot(refresh: bool = False) -> dict:
            return snap

        monkeypatch.setattr(ws, "get_snapshot", fake_get_snapshot)
        real_load = ivh._load_day_archives

        async def bumping_load(*args, **kwargs):
            ivh._rebuild_generation += 1  # 模擬 backfill 完成觸發的 rebuild
            return await real_load(*args, **kwargs)

        monkeypatch.setattr(ivh, "_load_day_archives", bumping_load)
        out = await ivh.get_iv_history("030012")
        assert out is not None and len(out["series"]) == 1
        assert len(ivh._series_lru) == 0
        if ivh._rebuild_bg_task is not None:
            await ivh._rebuild_bg_task


class TestDriftMap:
    async def test_drift_map_lazy_fake_builds_from_fixture(self, monkeypatch, tmp_path) -> None:
        # R1/R17:FAKE 供給鏈 — fixture → loader → rebuild(只寫 mem 不落檔)
        fx = tmp_path / "fx"
        days = {}
        d = date_type(2026, 6, 26)  # Fri(FAKE_TODAY 基準)
        ivb = 0.35  # 最新日最低;往回走遞增 → 升冪序列 = 遞減
        for _ in range(25):
            days[d.isoformat()] = {
                "terms_approx": False,
                "warrants": {"030012": {"b": 0.6, "a": 0.65, "c": 0.62, "s": 100.0, "ivb": round(ivb, 4), "iva": round(ivb + 0.02, 4)}},
            }
            ivb += 0.006
            d = date_type.fromordinal(d.toordinal() - 1)
            while d.weekday() >= 5:
                d = date_type.fromordinal(d.toordinal() - 1)
        atomic_write_json(fx / "warrants" / "iv_history.json", {"_cache_version": ivh._CACHE_VERSION, "days": days})
        monkeypatch.setenv("FAKE_FINMIND", "1")
        monkeypatch.setenv("FAKE_FINMIND_FIXTURES_DIR", str(fx))
        drift = await ivh.get_drift_map()
        assert drift["030012"]["label"] == "declining"
        assert not (chip_cache_dir() / ivh.DRIFT_FILE).exists()

    async def test_drift_map_real_missing_file_returns_empty_and_spawns(self, monkeypatch) -> None:
        # R14:真實模式檔缺 → 立即回空 + 背景 rebuild,不掛 request 路徑
        write_day("2026-07-09", {"030012": {"b": 0.6, "a": 0.65, "c": 0.62, "s": 100.0, "ivb": 0.41, "iva": 0.45}})
        drift = await ivh.get_drift_map()
        assert drift == {}
        assert ivh._rebuild_bg_task is not None
        await ivh._rebuild_bg_task
        drift2 = await ivh.get_drift_map()
        assert "030012" in drift2

    async def test_drift_map_stale_version_file_treated_missing(self, monkeypatch) -> None:
        # R18:latest.json 版本不符 → 走 rebuild(不吃舊 shape)
        atomic_write_json(chip_cache_dir() / ivh.DRIFT_FILE, {"_cache_version": 0, "drift": {"030012": {"label": "rising"}}})
        drift = await ivh.get_drift_map()
        assert drift == {}
        if ivh._rebuild_bg_task is not None:
            await ivh._rebuild_bg_task

    async def test_rebuild_skips_day_file_with_version_mismatch(self) -> None:
        # R18:day file 版本不符 → 視同缺檔
        write_day("2026-07-08", {"030012": {"b": 1, "a": 1, "c": 1, "s": 1, "ivb": 0.9, "iva": 0.9}}, version=0)
        write_day("2026-07-09", {"030012": {"b": 0.6, "a": 0.65, "c": 0.62, "s": 100.0, "ivb": 0.41, "iva": 0.45}})
        await ivh.rebuild_drift_summary()
        assert ivh._drift_mem is not None
        assert ivh._drift_mem["built_from"] == ["2026-07-09"]

    async def test_rebuild_reruns_once_on_fileset_change(self, monkeypatch) -> None:
        # R22:rebuild 窗內 backfill 寫檔完成 → 檔集合自檢後同 key 再跑一輪
        write_day("2026-07-08", {"030012": {"b": 0.62, "a": 0.67, "c": 0.64, "s": 100.0, "ivb": 0.42, "iva": 0.46}})
        write_day("2026-07-09", {"030012": {"b": 0.6, "a": 0.65, "c": 0.62, "s": 100.0, "ivb": 0.41, "iva": 0.45}})
        seq = [["2026-07-08"], ["2026-07-08", "2026-07-09"], ["2026-07-08", "2026-07-09"]]
        calls = {"n": 0}

        def fake_list() -> list[str]:
            out = seq[min(calls["n"], len(seq) - 1)]
            calls["n"] += 1
            return out

        monkeypatch.setattr(ivh, "_list_day_dates", fake_list)
        await ivh.rebuild_drift_summary()
        assert ivh._drift_mem["built_from"] == ["2026-07-08", "2026-07-09"]
        assert calls["n"] >= 3  # 首輪 list + 自檢 list + 次輪 list


# ---------------------------------------------------------------- SC-2 backfill


def patch_backfill_upstream(
    monkeypatch,
    mi_by_date: dict[tuple[str, str], list],
    terms: list | None = None,
    issue: list | None = None,
    wn1430_by_date: dict[str, list] | None = None,
) -> dict:
    counter: dict = {"mi": {}, "rebuild": 0}

    async def fake_mi(date_iso: str, type_code: str) -> list:
        counter["mi"][(date_iso, type_code)] = counter["mi"].get((date_iso, type_code), 0) + 1
        return mi_by_date.get((date_iso, type_code), [])

    async def fake_terms() -> list:
        return terms or []

    async def fake_issue() -> list:
        return issue or []

    async def fake_wn1430(date_iso: str) -> list:
        return (wn1430_by_date or {}).get(date_iso, [])

    async def fake_rebuild() -> dict:
        counter["rebuild"] += 1
        return {}

    monkeypatch.setattr(ws, "fetch_mi_index", fake_mi)
    monkeypatch.setattr(ws, "fetch_t187ap37", fake_terms)
    monkeypatch.setattr(ws, "fetch_tpex_issue", fake_issue)
    monkeypatch.setattr(ivh, "_fetch_wn1430_rows", fake_wn1430)
    monkeypatch.setattr(ivh, "rebuild_drift_summary", fake_rebuild)
    monkeypatch.setattr(ivh, "_NONTRADING_RETRY_SLEEP", 0.0)
    return counter


def twse_hist_row(wid: str = "030012", uid: str = "6781", uclose: str = "100.00") -> list:
    return [
        "", wid, "測試權證", "57,000", "10", "1,900",
        "0.68", "0.70", "0.60", "0.68", "<p> </p>", "0.00",
        "0.65", "50", "0.70", "124", "100.00", uid, "測試標的", uclose,
    ]


def twse_terms_raw(wid: str = "030012") -> dict:
    return {
        "權證代號": wid,
        "權證簡稱": "測試權證",
        "權證類型": "認購",
        "類別": "一般型",
        "最後交易日": "1151230",
        "履約截止日": "1151231",
        "最新標的履約配發數量(每仟單位權證)": "100.00",
        "最新履約價格(元)/履約指數": "95.00",
    }


def tpex_issue_raw(wid: str = "72124U", uid: str = "8086") -> dict:
    return {
        "Code": wid,
        "Name": "宏捷科群益58售01",
        "ExpiryDate": "20260818",
        "UnderlyingStockCode": uid,
        "UnderlyingStock": "宏捷科",
        "Type": "認售",
        "Reset": "N",
        "LatestExercisePrice": "91.05",
        "Latest ExerciseRatio": "0.162",
    }


class TestBackfill:
    async def test_backfill_skips_existing_and_nontrading(self, monkeypatch) -> None:
        write_day("2026-07-08", {})  # 已存在 → 不 fetch
        counter = patch_backfill_upstream(
            monkeypatch,
            mi_by_date={("2026-07-09", "0999"): [twse_hist_row()]},
            terms=[twse_terms_raw()],
        )
        monkeypatch.setenv("WARRANT_IV_BACKFILL_DAYS", "2")
        await ivh._backfill()
        assert day_file("2026-07-09").exists()
        # 07-10 空回 → retry 一次(R15)= 0999 打 2 次
        assert counter["mi"][("2026-07-10", "0999")] == 2
        # 已存在檔不 fetch
        assert ("2026-07-08", "0999") not in counter["mi"]
        assert counter["rebuild"] == 1
        payload = read_json(day_file("2026-07-09"))
        assert payload["terms_approx"] is True
        assert payload["warrants"]["030012"]["ivb"] is not None

    async def test_backfill_starts_yesterday(self, monkeypatch) -> None:
        # R23:今日檔留給 daily archive 路徑
        counter = patch_backfill_upstream(
            monkeypatch,
            mi_by_date={
                ("2026-07-11", "0999"): [twse_hist_row()],
                ("2026-07-09", "0999"): [twse_hist_row()],
            },
            terms=[twse_terms_raw()],
        )
        monkeypatch.setenv("WARRANT_IV_BACKFILL_DAYS", "1")
        await ivh._backfill()
        assert not any(d == "2026-07-11" for d, _ in counter["mi"])
        assert not day_file("2026-07-11").exists()
        assert day_file("2026-07-09").exists()

    async def test_backfill_fills_underlying_close_gap_via_finmind(self, monkeypatch) -> None:
        # R16:TPEx 權證標的價 TWSE 列查不到 → FinMind per-underlying range 一次
        wn_row = {"warrant_id": "72124U", "close": 0.31, "bid": 0.30, "ask": 0.32}
        patch_backfill_upstream(
            monkeypatch,
            mi_by_date={("2026-07-09", "0999"): [twse_hist_row()]},
            terms=[twse_terms_raw()],
            issue=[tpex_issue_raw()],
            wn1430_by_date={"2026-07-09": [wn_row]},
        )
        captured: dict = {}

        class FakeFm:
            async def stock_price_range(self, symbol: str, start: str, end: str) -> list:
                captured["args"] = (symbol, start, end)
                return [{"date": "2026-07-09", "close": 91.0}]

        monkeypatch.setattr(ivh, "get_finmind", lambda: FakeFm())
        monkeypatch.setenv("WARRANT_IV_BACKFILL_DAYS", "1")
        await ivh._backfill()
        entry = read_json(day_file("2026-07-09"))["warrants"]["72124U"]
        assert entry["s"] == pytest.approx(91.0)
        assert entry["ivb"] is not None
        assert captured["args"][0] == "8086"

    async def test_backfill_excludes_non_universe_codes(self, monkeypatch) -> None:
        # edge 7:se=EW 混入 ETF → 不在 issue universe 的代號不入 archive
        etf_row = {"warrant_id": "00679B", "close": 26.80, "bid": 26.80, "ask": 26.81}
        patch_backfill_upstream(
            monkeypatch,
            mi_by_date={("2026-07-09", "0999"): [twse_hist_row()]},
            terms=[twse_terms_raw()],
            issue=[tpex_issue_raw()],
            wn1430_by_date={"2026-07-09": [etf_row]},
        )

        class FakeFm:
            async def stock_price_range(self, symbol: str, start: str, end: str) -> list:
                return []

        monkeypatch.setattr(ivh, "get_finmind", lambda: FakeFm())
        monkeypatch.setenv("WARRANT_IV_BACKFILL_DAYS", "1")
        await ivh._backfill()
        assert "00679B" not in read_json(day_file("2026-07-09"))["warrants"]
