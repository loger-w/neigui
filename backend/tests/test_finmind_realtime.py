"""SC-1 / SC-3 — fetch_market_snapshot + helpers."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import asyncio
import pytest

from services.finmind_realtime import (
    _PRIMARY_INDUSTRY_OVERRIDE,
    _build_name_map,
    _compute_leaderboards,
    _dedup_sector_map,
    _group_by_sector,
    _max_tick_date,
    _trim,
    fetch_market_snapshot,
)


@pytest.fixture(autouse=True)
def _no_network_prices_window(monkeypatch):
    """bug test-finmind-realtime-flake:C3b prices prefetch(_fetch_eod_results
    →mb._fetch_daily_prices_window)是本檔 mock 佈局唯一沒蓋到的真實網路呼叫 —
    平時 test-token 400 快失敗掩蓋了它,多 session 燒配額 FinMind 變慢時
    >_EOD_INLINE_BUDGET_SEC → eod_pending 假紅 + pending task 留 registry。
    改 raise ConnectError = 與 400 同一條 httpx.HTTPError 降級路徑(prices=None),
    行為零差異但決定性、零網路。需要真 prices 的測試(test_eod_results_*)
    在測試體內 monkeypatch 覆蓋本 fixture。"""
    import httpx

    import services.market_breadth as mb

    async def _refuse_network(start, end, refresh=False):
        raise httpx.ConnectError("test isolation: no real FinMind call")

    monkeypatch.setattr(mb, "_fetch_daily_prices_window", _refuse_network)

# --------------------------------------------------------------------------
# _dedup_sector_map (E4 / F6 deterministic / v3 B4)
# --------------------------------------------------------------------------


def test_dedup_single_row_basic() -> None:
    """SC-1: 單筆 row → {stock_id: sector_name}。"""
    rows = [
        {"stock_id": "9001", "industry_category": "電子工業",
         "type": "twse", "date": "2026-06-26"},
    ]
    assert _dedup_sector_map(rows) == {"9001": "電子工業"}


def test_dedup_multi_row_same_stock_uses_latest_date() -> None:
    """E4: 同 stock_id 兩 row,date desc 取最新。"""
    rows = [
        {"stock_id": "9002", "industry_category": "電子工業",
         "type": "twse", "date": "2026-06-25"},
        {"stock_id": "9002", "industry_category": "半導體業",
         "type": "twse", "date": "2026-06-26"},
    ]
    assert _dedup_sector_map(rows)["9002"] == "半導體業"


def test_dedup_multi_row_same_date_uses_industry_asc() -> None:
    """E4: 同 date 時,industry_category 字典序 ASC 當 tie-breaker。"""
    rows = [
        {"stock_id": "9003", "industry_category": "電子工業",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "9003", "industry_category": "光電業",
         "type": "twse", "date": "2026-06-26"},
    ]
    # Tie-breaker: industry_category ASC -> 光電業 < 電子工業 (Unicode order)
    out = _dedup_sector_map(rows)["9003"]
    # Stable two-pass sorted(sorted(..., key=industry ASC), key=date DESC)
    # date 都同 → 第二 sort 不換,所以最前面是 industry asc 第一個
    sorted_industries = sorted(["電子工業", "光電業"])
    assert out == sorted_industries[0]


def test_dedup_override_table_wins() -> None:
    """E4: _PRIMARY_INDUSTRY_OVERRIDE 命中時無論 FinMind 回什麼皆此值。"""
    rows = [
        {"stock_id": "2330", "industry_category": "電子工業",
         "type": "twse", "date": "2026-06-26"},
    ]
    assert _dedup_sector_map(rows)["2330"] == _PRIMARY_INDUSTRY_OVERRIDE["2330"]
    assert _PRIMARY_INDUSTRY_OVERRIDE["2330"] == "半導體業"


# bug sector-override-phantom — override value 必須是 TaiwanStockInfo 真實
# industry_category 字串,否則 override 股自成幽靈 sector(2026-07-02 real
# payload:「金融保險業」2 檔 vs 真實「金融保險」30 檔並存)。
# 真實集合 snapshot:2026-07-02 FinMind TaiwanStockInfo probe(type ∈ twse/tpex,
# 56 distinct)。FinMind 改名時本 fixture 隨 §9 fixture rotation 政策更新。
_REAL_INDUSTRY_CATEGORIES_2026_07_02 = frozenset({
    "ETF", "ETN", "Index", "上櫃ETF", "上櫃指數股票型基金(ETF)", "光電業",
    "其他", "其他電子業", "其他電子類", "創新板股票", "創新版股票", "化學工業",
    "化學生技醫療", "半導體業", "受益證券", "塑膠工業", "大盤", "存託憑證",
    "居家生活", "居家生活類", "建材營造", "所有證券", "指數投資證券(ETN)",
    "數位雲端", "數位雲端類", "文化創意業", "橡膠工業", "水泥工業", "汽車工業",
    "油電燃氣業", "玻璃陶瓷", "生技醫療業", "紡織纖維", "綠能環保", "綠能環保類",
    "航運業", "觀光事業", "觀光餐旅", "貿易百貨", "資訊服務業", "農業科技業",
    "通信網路業", "造紙工業", "運動休閒", "運動休閒類", "金融保險", "金融業",
    "鋼鐵工業", "電器電纜", "電子商務業", "電子工業", "電子通路業", "電子零組件業",
    "電機機械", "電腦及週邊設備業", "食品工業",
})


def test_override_values_are_real_finmind_categories() -> None:
    """bug sector-override-phantom drift-lock:每個 override value 必須存在於
    真實 industry_category 集合,防手編字串 / FinMind 改名 silent drift。"""
    for sid, category in _PRIMARY_INDUSTRY_OVERRIDE.items():
        assert category in _REAL_INDUSTRY_CATEGORIES_2026_07_02, (
            f"override[{sid}] = {category!r} 不是真實 TaiwanStockInfo "
            f"industry_category,會自成幽靈 sector"
        )


def test_dedup_override_financial_stocks_join_real_sector() -> None:
    """bug sector-override-phantom 重現:override 股 (2882) 與非 override
    金融股 (2881) 必須落在同一個「金融保險」sector,不得分桶。"""
    rows = [
        {"stock_id": "2881", "industry_category": "金融保險",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "2882", "industry_category": "金融保險",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "2891", "industry_category": "金融保險",
         "type": "twse", "date": "2026-06-26"},
    ]
    out = _dedup_sector_map(rows)
    assert out["2882"] == out["2881"] == "金融保險"
    assert out["2891"] == "金融保險"


def test_dedup_filters_non_twse_tpex_keeps_both() -> None:
    """v3 B4: type='index'/'other' 過濾;type='twse' AND 'tpex' 皆保留(對稱)。"""
    rows = [
        {"stock_id": "9101", "industry_category": "半導體業",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "9102", "industry_category": "電子零組件業",
         "type": "tpex", "date": "2026-06-26"},
        {"stock_id": "TAIEX", "industry_category": "指數",
         "type": "index", "date": "2026-06-26"},
        {"stock_id": "OTHER", "industry_category": "?",
         "type": "other", "date": "2026-06-26"},
    ]
    out = _dedup_sector_map(rows)
    assert out["9101"] == "半導體業"
    assert out["9102"] == "電子零組件業"
    assert "TAIEX" not in out
    assert "OTHER" not in out


def test_dedup_missing_industry_falls_to_qita() -> None:
    """E1: industry_category 為 None / 空 → '其他'。"""
    rows = [
        {"stock_id": "9201", "industry_category": None,
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "9202", "industry_category": "",
         "type": "twse", "date": "2026-06-26"},
    ]
    out = _dedup_sector_map(rows)
    assert out["9201"] == "其他"
    assert out["9202"] == "其他"


# --------------------------------------------------------------------------
# _trim & _compute_leaderboards (SC-3 / F5)
# --------------------------------------------------------------------------


def _mk_row(sid: str, chg: float, amt: float, vr: float | None = None) -> dict:
    return {
        "stock_id": sid,
        "name": sid,
        "change_rate": chg,
        "total_amount": amt,
        "volume_ratio": vr,
        "sector": "電子工業",
    }


def test_trim_includes_volume_ratio_field() -> None:
    """v3 F5: _trim 必須含 volume_ratio key,None 也要保留。"""
    rows = [{"stock_id": "9999", "name": "X", "change_rate": 1.0,
             "total_amount": 1000, "volume_ratio": None,
             "sector": "電子工業"}]
    out = _trim(rows)
    assert "volume_ratio" in out[0]
    assert out[0]["volume_ratio"] is None


def test_leaderboards_gainers_sorted_desc() -> None:
    """SC-3: gainers by change_rate desc top size。"""
    universe = [
        {**_mk_row("A", 1.0, 100, 1.0)},
        {**_mk_row("B", 5.0, 200, 2.0)},
        {**_mk_row("C", 3.0, 300, 1.5)},
    ]
    out = _compute_leaderboards(universe, primary_sector={}, size=2)
    assert [r["stock_id"] for r in out["gainers"]] == ["B", "C"]


def test_leaderboards_losers_sorted_asc() -> None:
    """SC-3: losers by change_rate asc。"""
    universe = [
        {**_mk_row("A", 1.0, 100)},
        {**_mk_row("B", -5.0, 200)},
        {**_mk_row("C", -3.0, 300)},
    ]
    out = _compute_leaderboards(universe, primary_sector={}, size=2)
    assert [r["stock_id"] for r in out["losers"]] == ["B", "C"]


def test_leaderboards_amount_sorted_desc() -> None:
    """SC-3: amount by total_amount desc。"""
    universe = [
        {**_mk_row("A", 0, 1_000_000)},
        {**_mk_row("B", 0, 3_000_000)},
        {**_mk_row("C", 0, 2_000_000)},
    ]
    out = _compute_leaderboards(universe, primary_sector={}, size=2)
    assert [r["stock_id"] for r in out["amount"]] == ["B", "C"]


def test_leaderboards_volume_ratio_sorted_desc_null_as_zero() -> None:
    """SC-3 / F5: volume_ratio desc;None 視為 0。"""
    universe = [
        {**_mk_row("A", 0, 100, 5.0)},
        {**_mk_row("B", 0, 100, None)},
        {**_mk_row("C", 0, 100, 2.0)},
    ]
    out = _compute_leaderboards(universe, primary_sector={}, size=3)
    assert [r["stock_id"] for r in out["volume_ratio"]] == ["A", "C", "B"]


def test_leaderboards_attach_sector_from_primary_map() -> None:
    """SC-3: 排行榜每筆掛 sector 名(從 primary_sector lookup);未對到 → 其他。"""
    universe = [_mk_row("X", 1.0, 100, 1.0), _mk_row("Y", 0.5, 50, 0.8)]
    primary = {"X": "半導體業"}  # Y 沒在 primary
    out = _compute_leaderboards(universe, primary_sector=primary, size=2)
    sectors = {r["stock_id"]: r["sector"] for r in out["gainers"]}
    assert sectors["X"] == "半導體業"
    assert sectors["Y"] == "其他"


# --------------------------------------------------------------------------
# _group_by_sector (E1 / E2 / SC-2)
# --------------------------------------------------------------------------


def test_group_by_sector_caps_stocks() -> None:
    """SC-2: 每 sector cap 30 個(取 market_value 大者)。"""
    universe = [_mk_row(f"{i:04d}", 0, 1_000_000, 1.0) for i in range(50)]
    mv_map = {f"{i:04d}": (50 - i) * 1_000_000_000 for i in range(50)}
    # 全部歸同一 sector "電子工業"
    primary = {f"{i:04d}": "電子工業" for i in range(50)}
    sectors = _group_by_sector(universe, primary, mv_map, cap_per_sector=30)
    assert len(sectors) == 1
    assert sectors[0]["id"] == "電子工業"
    assert len(sectors[0]["stocks"]) == 30
    # 最大市值排在前(0000 mv=50e9 最大)
    assert sectors[0]["stocks"][0]["stock_id"] == "0000"


def test_group_by_sector_orphan_to_qita() -> None:
    """E1: primary_sector 沒 mapping 的 stock_id → 進 '其他'。"""
    universe = [_mk_row("orphan", 0, 100, 1.0)]
    sectors = _group_by_sector(universe, primary_sector={}, mv_map={"orphan": 100})
    sector_ids = [s["id"] for s in sectors]
    assert "其他" in sector_ids


def test_group_by_sector_market_value_fallback_to_median() -> None:
    """E2: 缺 market_value 的 stock → sector 內 median fallback;tile size 仍 > 0。"""
    universe = [
        _mk_row("A", 0, 100, 1.0),
        _mk_row("B", 0, 100, 1.0),
        _mk_row("C", 0, 100, 1.0),
    ]
    primary = {"A": "電子工業", "B": "電子工業", "C": "電子工業"}
    # C 缺 mv
    mv_map = {"A": 5_000_000_000, "B": 1_000_000_000}
    sectors = _group_by_sector(universe, primary, mv_map, cap_per_sector=30)
    stocks = sectors[0]["stocks"]
    c_tile = next(s for s in stocks if s["stock_id"] == "C")
    assert c_tile["market_value"] is None  # 仍標示 null 讓 frontend 知道是 fallback
    # 但 stock 仍在 list 內,不被砍掉
    assert {s["stock_id"] for s in stocks} == {"A", "B", "C"}


# --------------------------------------------------------------------------
# _build_name_map (Phase 6 real-env fix)
# --------------------------------------------------------------------------


def test_build_name_map_basic() -> None:
    """Phase 6: stock_id → stock_name from TaiwanStockInfo rows。"""
    rows = [
        {"stock_id": "2330", "stock_name": "台積電",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "2317", "stock_name": "鴻海",
         "type": "twse", "date": "2026-06-26"},
    ]
    name_map = _build_name_map(rows)
    assert name_map["2330"] == "台積電"
    assert name_map["2317"] == "鴻海"


def test_build_name_map_picks_latest_date() -> None:
    """Phase 6: 重複 stock_id 取最新 date(re-list 換名)。"""
    rows = [
        {"stock_id": "X", "stock_name": "舊名",
         "type": "twse", "date": "2024-01-01"},
        {"stock_id": "X", "stock_name": "新名",
         "type": "twse", "date": "2026-06-26"},
    ]
    assert _build_name_map(rows)["X"] == "新名"


def test_build_name_map_skips_missing_name() -> None:
    """Phase 6: stock_name 為 None / 空 → 不入 map。"""
    rows = [
        {"stock_id": "X", "stock_name": None,
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "X", "stock_name": "正常名",
         "type": "twse", "date": "2026-06-25"},
    ]
    assert _build_name_map(rows)["X"] == "正常名"


# --------------------------------------------------------------------------
# _max_tick_date (E5 / v3 B3)
# --------------------------------------------------------------------------


def test_max_tick_date_with_microseconds() -> None:
    """v3 B3: FinMind 真實 ISO `2026-06-29 13:29:50.123456` 能 parse。"""
    universe = [{"date": "2026-06-29 13:29:50.123456", "stock_id": "2330"}]
    ts = _max_tick_date(universe)
    assert ts is not None
    assert ts.microsecond == 123456


def test_max_tick_date_picks_latest() -> None:
    """v3 B3: 多 row 混順序 → 取 max。"""
    universe = [
        {"date": "2026-06-29 10:00:00", "stock_id": "A"},
        {"date": "2026-06-29 13:00:00", "stock_id": "B"},
        {"date": "2026-06-29 11:00:00", "stock_id": "C"},
    ]
    ts = _max_tick_date(universe)
    assert ts is not None
    assert ts.hour == 13


def test_max_tick_date_empty_returns_none() -> None:
    """v3 B3: 空 universe → None。"""
    assert _max_tick_date([]) is None


def test_max_tick_date_z_suffix_converts_utc_to_tpe() -> None:
    """Phase 4 R2: 帶 Z 尾的 ISO 視為 UTC,轉成 TPE 時間(+8h)。"""
    from services.trading_session import TPE_TZ

    universe = [{"date": "2026-06-29T05:00:00Z", "stock_id": "X"}]
    ts = _max_tick_date(universe)
    assert ts is not None
    # UTC 05:00 → TPE 13:00
    assert ts.tzinfo is not None
    assert ts.astimezone(TPE_TZ).hour == 13


# --------------------------------------------------------------------------
# fetch_market_snapshot integration (SC-1 / E7)
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_fetch_market_snapshot_happy_path() -> None:
    """SC-1: 三個 internal fetch 成功 → return shape 對齊 §4 contract。"""
    fake_universe = [
        {"stock_id": "2330", "open": 2300, "high": 2400, "low": 2300, "close": 2390,
         "change_rate": 1.92, "total_amount": 36e9, "volume_ratio": 1.14,
         "date": "2026-06-29 10:30:00.123456"},
    ]
    fake_sector_rows = [
        {"stock_id": "2330", "industry_category": "半導體業",
         "type": "twse", "date": "2026-06-26"},
    ]
    fake_mv_map = {"2330": 60_000_000_000_000}
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value=fake_mv_map)), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())):
        result = await fetch_market_snapshot(refresh=False)
    assert "as_of" in result
    assert result["last_tick"] is not None
    assert result["stale"] is False
    assert "sectors" in result
    assert "leaderboards" in result
    assert {"gainers", "losers", "amount", "volume_ratio"} <= set(result["leaderboards"].keys())


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_fetch_market_snapshot_all_fail_raises_unreachable() -> None:
    """E7: 全失敗 + 無 disk cache → raise ValueError('finmind_unreachable')。"""
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(side_effect=RuntimeError("upstream down"))), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(side_effect=RuntimeError("upstream down"))), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(side_effect=RuntimeError("upstream down"))):
        with pytest.raises(ValueError, match="finmind_unreachable"):
            await fetch_market_snapshot(refresh=False)


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_stale_false_when_sector_fetch_fails_with_disk_cache() -> None:
    """Phase 4 R3 + Audit X1:universe ok + sector_map fail BUT 有 disk cache 兜底
    → primary_sector 非空 → stale=False(daily-cache fallback 對 user 無感)。

    新增 Audit X1 對照 case `test_snapshot_sector_fail_no_cache_surfaces_stale_true`
    驗證「無 cache 兜底時 stale=True 拉 banner」。
    """
    from services.finmind_realtime import _write_cache

    # 預存 sector_map disk cache 模擬 fallback 可用
    _write_cache("realtime_sector_map", {
        "rows": [
            {"stock_id": "2330", "stock_name": "台積電",
             "industry_category": "半導體業", "type": "twse",
             "date": "2026-06-26"},
        ],
        "fetched_at": "2026-06-28T10:00:00+08:00",
    })

    fake_universe = [{
        "stock_id": "2330", "open": 2300, "high": 2400, "low": 2300,
        "close": 2390, "change_rate": 1.92, "total_amount": 36e9,
        "volume_ratio": 1.14, "date": "2026-06-29 10:30:00.123456",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(side_effect=RuntimeError("daily fail"))), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())):
        result = await fetch_market_snapshot(refresh=False)
    assert result["stale"] is False


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_stale_true_when_universe_fails_with_cache() -> None:
    """Phase 4 R3: universe fail + 有 disk cache 兜底 → stale=True 真實警示。"""
    # 直接 prime disk cache
    from services.finmind_realtime import _write_cache
    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    _write_cache("realtime_universe", {
        "rows": fake_universe, "fetched_at": "2026-06-29T10:30:00+08:00",
    })
    # universe fail,disk cache 兜底
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(side_effect=RuntimeError("blip"))), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=[])), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={})):
        result = await fetch_market_snapshot(refresh=False)
    assert result["stale"] is True


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_filters_indices_via_primary_sector_whitelist() -> None:
    """Audit X1 + X9 regression(whitelist 策略 + CLAUDE.md §9 lesson):

    taiwan_stock_tick_snapshot universe 含 ~49 個 3-digit index ID
    (001 / 036 / 040 等;FinMind TaiwanStockInfo 並沒有 type='index'),
    靠 `stock_id in primary_sector` whitelist 天然排除。本 test 鎖:
      - 指數 '001' '036' 不出現在 leaderboards / sectors
      - 普通個股 '2330' 正常顯示
    """
    fake_universe = [
        {"stock_id": "001", "change_rate": 0.5, "total_amount": 9e12,
         "volume_ratio": 1.0, "date": "2026-06-29 10:30:00"},
        {"stock_id": "036", "change_rate": 0.8, "total_amount": 3e11,
         "volume_ratio": 1.0, "date": "2026-06-29 10:30:00"},
        {"stock_id": "2330", "change_rate": 1.5, "total_amount": 5e10,
         "volume_ratio": 2.0, "date": "2026-06-29 10:30:00"},
    ]
    # 指數 001/036 不在 TaiwanStockInfo(empirical),只 2330 在
    fake_sector_rows = [
        {"stock_id": "2330", "stock_name": "台積電",
         "industry_category": "半導體業", "type": "twse", "date": "2026-06-26"},
    ]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())):
        result = await fetch_market_snapshot(refresh=False)
    all_lb_ids = {
        r["stock_id"]
        for lb in result["leaderboards"].values()
        for r in lb
    }
    all_sector_ids = {
        s["stock_id"]
        for sector in result["sectors"]
        for s in sector["stocks"]
    }
    assert "001" not in all_lb_ids, "Audit X1 / Phase 6: 指數 '001' 不應出現在排行榜"
    assert "036" not in all_lb_ids, "Audit X1 / Phase 6: 指數 '036' 不應出現在排行榜"
    assert "001" not in all_sector_ids
    assert "036" not in all_sector_ids
    assert "2330" in all_lb_ids
    assert "2330" in all_sector_ids
    # sector ok → stale=False
    assert result["stale"] is False


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_sector_fail_no_cache_surfaces_stale_true() -> None:
    """Audit X1 cold-start scenario:

    Universe ok + sector_map fail + 無 disk cache → primary_sector={} →
    whitelist filter drops 所有 stock → 空 sectors / leaderboards。
    為避免 silent empty dashboard,sector_degraded → stale=True,前端 banner
    會出現「資料停滯」提示。
    """
    fake_universe = [
        {"stock_id": "2330", "change_rate": 1.0, "total_amount": 1e9,
         "volume_ratio": 1.0, "date": "2026-06-29 10:30:00"},
        {"stock_id": "001", "change_rate": 0.5, "total_amount": 9e12,
         "volume_ratio": 1.0, "date": "2026-06-29 10:30:00"},
    ]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(side_effect=RuntimeError("upstream"))), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())):
        result = await fetch_market_snapshot(refresh=False)
    # Audit X1:cold-start sector fail → stale=True 拉 banner
    assert result["stale"] is True, "Audit X1: sector cold-start fail 應 surface stale=True"


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_market_value_uses_trading_calendar_t_minus_1() -> None:
    """Audit X3:_fetch_market_value_map 從 calendar T-1 改用 trading_calendar
    get_trading_days(today-1, 1)。當 today=Monday 時,T-1 應該是上週五,而非
    Sunday(原行為會回 FinMind 空資料,heatmap tile 全 fallback weight=1)。
    """
    from datetime import date
    from unittest.mock import patch
    from services.finmind_realtime import _fetch_market_value_map

    monday = date(2026, 6, 29)  # Monday
    last_friday = date(2026, 6, 26)  # Previous Friday

    # Mock get_trading_days → 回上週五,模擬 trading_calendar cache hit
    fake_client = AsyncMock()
    fake_client._get = AsyncMock(return_value=[
        {"stock_id": "2330", "market_value": 6e13},
    ])

    with patch("services.finmind_realtime.get_trading_days",
               new=AsyncMock(return_value=[last_friday])), \
         patch("services.finmind_realtime.get_finmind",
               return_value=fake_client):
        # refresh=True 跳 cache 確保走 fetch path
        result = await _fetch_market_value_map(today=monday, refresh=True)

    # 確認 FinMind 收到的是上週五,不是 calendar T-1 (Sunday)
    fake_client._get.assert_awaited_once()
    args, kwargs = fake_client._get.call_args
    params = args[1] if len(args) > 1 else kwargs.get("params") or args[-1]
    assert params["start_date"] == "2026-06-26", (
        f"Audit X3: 期望 trading_calendar 提供的上週五 2026-06-26,實際 {params['start_date']}"
    )
    assert params["end_date"] == "2026-06-26"
    assert result == {"2330": 60_000_000_000_000}


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_market_value_falls_back_to_calendar_when_trading_calendar_fails() -> None:
    """Audit X3 fallback:get_trading_days raise 任何 exception 時,
    code 不該整個 fail,要退到 calendar T-1 (today - 1 day) 保命。
    """
    from datetime import date
    from unittest.mock import patch
    from services.finmind_realtime import _fetch_market_value_map

    today = date(2026, 6, 29)
    expected_fallback = date(2026, 6, 28)  # calendar T-1

    fake_client = AsyncMock()
    fake_client._get = AsyncMock(return_value=[])

    with patch("services.finmind_realtime.get_trading_days",
               new=AsyncMock(side_effect=RuntimeError("calendar down"))), \
         patch("services.finmind_realtime.get_finmind",
               return_value=fake_client):
        result = await _fetch_market_value_map(today=today, refresh=True)

    fake_client._get.assert_awaited_once()
    args, kwargs = fake_client._get.call_args
    params = args[1] if len(args) > 1 else kwargs.get("params") or args[-1]
    assert params["start_date"] == expected_fallback.isoformat()
    assert result == {}


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_refresh_propagates_to_all_three_fetchers() -> None:
    """Phase 4 R4: refresh=True 帶到 universe / sector / market_value 三個 fetcher。"""
    u_mock = AsyncMock(return_value=[])
    s_mock = AsyncMock(return_value=[])
    m_mock = AsyncMock(return_value={})
    with patch("services.finmind_realtime._fetch_universe", new=u_mock), \
         patch("services.finmind_realtime._fetch_sector_map", new=s_mock), \
         patch("services.finmind_realtime._fetch_market_value_map", new=m_mock), \
         patch("services.finmind_realtime._fetch_watch_list", new=AsyncMock(return_value=set())):
        await fetch_market_snapshot(refresh=True)
    u_mock.assert_awaited_once_with(True)
    s_mock.assert_awaited_once_with(refresh=True)
    m_mock.assert_awaited_once_with(refresh=True)


# --------------------------------------------------------------------------
# market-monitor-v2 P1 integration: universe filter into snapshot
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_excludes_etf_warrant_watch_list_and_reports_counts() -> None:
    """market-monitor-v2 plan P1 完成條件:

    - snapshot payload 帶 `universe_size` + `excluded_count`
    - leaderboards 不再含 ETF prefix `00` / 6 位數權證 / 處置股
    - 4 位數普通股保留
    """
    fake_universe = [
        {"stock_id": "2330", "change_rate": 5.0, "total_amount": 1e10,
         "volume_ratio": 2.0, "date": "2026-06-29 10:30:00"},
        {"stock_id": "0050", "change_rate": 8.0, "total_amount": 5e10,
         "volume_ratio": 3.0, "date": "2026-06-29 10:30:00"},
        {"stock_id": "712345", "change_rate": 10.0, "total_amount": 1e8,
         "volume_ratio": 5.0, "date": "2026-06-29 10:30:00"},
        {"stock_id": "3037", "change_rate": 1.0, "total_amount": 1e10,
         "volume_ratio": 1.0, "date": "2026-06-29 10:30:00"},
        {"stock_id": "8046", "change_rate": -2.0, "total_amount": 1e10,
         "volume_ratio": 1.5, "date": "2026-06-29 10:30:00"},
    ]
    fake_sector_rows = [
        {"stock_id": "2330", "industry_category": "半導體業",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "0050", "industry_category": "ETF",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "712345", "industry_category": "認購權證",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "3037", "industry_category": "電子零組件業",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "8046", "industry_category": "電子零組件業",
         "type": "twse", "date": "2026-06-26"},
    ]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value={"8046"})):
        result = await fetch_market_snapshot(refresh=False)

    # universe_size = 2330 + 3037 (2 隻普通股)
    assert result["universe_size"] == 2
    assert result["excluded_count"] == {
        "etf": 1,
        "warrant": 1,
        "watch_list": 1,
    }
    all_lb_ids = {
        r["stock_id"]
        for lb in result["leaderboards"].values()
        for r in lb
    }
    all_sector_ids = {
        s["stock_id"]
        for sector in result["sectors"]
        for s in sector["stocks"]
    }
    # 排除
    assert "0050" not in all_lb_ids, "ETF 應被 P1 universe filter 排除"
    assert "712345" not in all_lb_ids, "權證應被 P1 universe filter 排除"
    assert "8046" not in all_lb_ids, "處置股應被 P1 universe filter 排除"
    assert "0050" not in all_sector_ids
    assert "712345" not in all_sector_ids
    assert "8046" not in all_sector_ids
    # 保留
    assert "2330" in all_lb_ids
    assert "3037" in all_lb_ids


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_watch_list_fetch_failure_does_not_block() -> None:
    """P1 健壯性:`_fetch_watch_list` 失敗 → 視為空 set,snapshot 仍正常回。

    Phase 4 P2 finding update:watch_list raise 時不只 graceful empty,還要拉
    `stale=True` — 否則 frontend 不知道處置股過濾失效,user 看到本該排除的 8046 / 1303
    等 disposition 個股,沒任何警示。
    """
    fake_universe = [
        {"stock_id": "2330", "change_rate": 1.0, "total_amount": 1e9,
         "volume_ratio": 1.0, "date": "2026-06-29 10:30:00"},
    ]
    fake_sector_rows = [
        {"stock_id": "2330", "industry_category": "半導體業",
         "type": "twse", "date": "2026-06-26"},
    ]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(side_effect=RuntimeError("disposition fetch down"))):
        result = await fetch_market_snapshot(refresh=False)

    assert result["universe_size"] == 1
    assert result["excluded_count"]["watch_list"] == 0
    all_lb_ids = {
        r["stock_id"]
        for lb in result["leaderboards"].values()
        for r in lb
    }
    assert "2330" in all_lb_ids
    # Phase 4 P2 fix:watch_list degradation 必須拉 stale=True
    assert result["stale"] is True, (
        "watch_list fetch fail 時 stale 必須 True,讓 frontend banner 警示"
        "處置股過濾不可用"
    )


# ---------------------------------------------------------------------------
# market-monitor-v2 P2 (SC-6) — breadth field integration
# Design: .claude/feat/market-breadth-mcclellan/design.md v2 §4.4
# ---------------------------------------------------------------------------


_FAKE_BREADTH_PAYLOAD = {
    "ad_line_value": 100.0,
    "mcclellan_oscillator": 20.0,
    "ad_line_series": [{"date": "2026-06-30", "value": 100.0}],
    "mcclellan_series": [{"date": "2026-06-30", "value": 20.0}],
    "thrust_dot": None,
    "centerline_cross": None,
    "divergence_dot": None,
    "known_gaps": [],
}


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_payload_adds_breadth() -> None:
    """SC-6: snapshot payload 追加 `breadth` 欄位 + 舊 4 panel 完整 + universe_size / excluded_count 完整。"""
    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)):
        result = await fetch_market_snapshot(refresh=False)

    # P2 new field
    assert result["breadth"] == _FAKE_BREADTH_PAYLOAD
    # P1 fields 完整
    assert "universe_size" in result
    assert "excluded_count" in result
    # 舊 4 panel 完整
    assert {"gainers", "losers", "amount", "volume_ratio"} <= set(result["leaderboards"].keys())
    # F6: breadth ok → stale 邏輯不變(此 case 都健康 → False)
    assert result["stale"] is False


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_breadth_fail_does_not_flip_stale() -> None:
    """F6: breadth compute fail → breadth=None,不拉 stale (EOD data ≠ intraday degradation)。"""
    import httpx

    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(side_effect=httpx.HTTPError("simulated"))):
        result = await fetch_market_snapshot(refresh=False)

    assert result["breadth"] is None
    assert result["stale"] is False  # F6 lock — breadth fail 不動 stale


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_breadth_value_error_does_not_flip_stale() -> None:
    """TC_F1 — F6 stale-lock ValueError branch(complements the HTTPError test above)。

    compute_breadth raises ValueError('universe_empty') if universe is empty
    (e.g. degraded filter cascade). caller's `except (httpx.HTTPError, ValueError)`
    must catch AND keep stale flag intact.
    """
    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(side_effect=ValueError("universe_empty"))):
        result = await fetch_market_snapshot(refresh=False)

    assert result["breadth"] is None
    assert result["stale"] is False  # F6 lock also covers ValueError arm


# ---------------------------------------------------------------------------
# market-monitor-v2 P3 (SC-6) — sector_breadth + sector_volume_ratio
# Design: .claude/feat/market-sector-breadth/design.md v2 §4.4
# ---------------------------------------------------------------------------


_FAKE_SECTOR_BREADTH_PAYLOAD = [
    {"sector": "半導體業", "members": 42, "above_ma20": 30, "pct": 0.714},
    {"sector": "其他電子業", "members": 20, "above_ma20": 10, "pct": 0.5},
]
_FAKE_SECTOR_VOL_PAYLOAD = [
    {"sector": "半導體業", "today_vol_lots": 12345, "vol_ratio": 1.62, "flag": "hot"},
    {"sector": "其他電子業", "today_vol_lots": 3456, "vol_ratio": 1.02, "flag": None},
]


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_payload_adds_sector_breadth_and_vol_ratio() -> None:
    """T-INT-1: happy path — both P3 fields present + shape correct + P1/P2 unchanged."""
    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)):
        result = await fetch_market_snapshot(refresh=False)

    # P3 new fields
    assert result["sector_breadth"] == _FAKE_SECTOR_BREADTH_PAYLOAD
    assert result["sector_volume_ratio"] == _FAKE_SECTOR_VOL_PAYLOAD
    # P1/P2 unchanged
    assert result["breadth"] == _FAKE_BREADTH_PAYLOAD
    assert "universe_size" in result
    assert "excluded_count" in result
    assert {"gainers", "losers", "amount", "volume_ratio"} <= set(result["leaderboards"].keys())
    assert result["stale"] is False


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_sector_breadth_fail_does_not_flip_stale() -> None:
    """T-INT-2: sector_breadth raise httpx.HTTPError → sector_breadth=None + stale=False (F6 sequel)."""
    import httpx

    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(side_effect=httpx.HTTPError("boom"))), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)):
        result = await fetch_market_snapshot(refresh=False)

    assert result["sector_breadth"] is None
    # sector_volume_ratio 獨立 try/except — 仍算對
    assert result["sector_volume_ratio"] == _FAKE_SECTOR_VOL_PAYLOAD
    assert result["stale"] is False  # F6 sequel


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_sector_vol_ratio_fail_independent_of_breadth() -> None:
    """T-INT-3: sector_breadth ok, vol_ratio raises → independent try/except keeps breadth list."""
    import httpx

    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(side_effect=httpx.HTTPError("boom"))):
        result = await fetch_market_snapshot(refresh=False)

    assert result["sector_breadth"] == _FAKE_SECTOR_BREADTH_PAYLOAD  # unaffected
    assert result["sector_volume_ratio"] is None
    assert result["stale"] is False


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_empty_universe_both_sector_fields_none() -> None:
    """T-INT-4: after universe filter allowed is empty → _fetch_sector_* returns None gate."""
    # empty tick snapshot → allowed set becomes empty via primary_sector filter fallout
    fake_universe: list[dict] = []
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=None)):
        # do NOT patch _fetch_sector_breadth / _fetch_sector_volume_ratio here —
        # they exist and their internal `if not universe: return None` gate must fire.
        result = await fetch_market_snapshot(refresh=False)

    assert result["sector_breadth"] is None
    assert result["sector_volume_ratio"] is None


# ---------------------------------------------------------------------------
# market-monitor-v2 P4 (SC-6) — sector_amount_share
# Design: .claude/feat/market-sector-amount-share/design.md v2 §4.4
# (docstring 編號帶 P4 前綴,避免與上方 P3 T-INT-1/2/3/4 撞名 — IG2)
# ---------------------------------------------------------------------------


_FAKE_SECTOR_AMOUNT_PAYLOAD = [
    {"sector": "半導體業", "today_share": 0.412, "share_delta_20ma": 0.034},
    {"sector": "其他電子業", "today_share": 0.126, "share_delta_20ma": None},
]


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_payload_adds_sector_amount_share() -> None:
    """P4 T-INT-1: happy path — sector_amount_share present + P1/P2/P3 intact."""
    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_amount_share",
               new=AsyncMock(return_value=_FAKE_SECTOR_AMOUNT_PAYLOAD)):
        result = await fetch_market_snapshot(refresh=False)

    # P4 new field
    assert result["sector_amount_share"] == _FAKE_SECTOR_AMOUNT_PAYLOAD
    # P1/P2/P3 unchanged
    assert result["breadth"] == _FAKE_BREADTH_PAYLOAD
    assert result["sector_breadth"] == _FAKE_SECTOR_BREADTH_PAYLOAD
    assert result["sector_volume_ratio"] == _FAKE_SECTOR_VOL_PAYLOAD
    assert "universe_size" in result
    assert "excluded_count" in result
    assert {"gainers", "losers", "amount", "volume_ratio"} <= set(result["leaderboards"].keys())
    assert result["stale"] is False
    # TS-5 (Phase 4 review) — key 位置鎖:append after sector_volume_ratio,
    # 既有 key 順序不動(FastAPI JSON 序列化保留 dict insertion order)
    keys = list(result.keys())
    assert keys[-1] == "sector_amount_share"
    assert keys[keys.index("sector_volume_ratio") + 1] == "sector_amount_share"


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_sector_amount_share_fail_does_not_flip_stale() -> None:
    """P4 T-INT-2: amount_share raise httpx.HTTPError → field None + stale=False
    + P3 twins intact (independent try/except; F6 sequel)."""
    import httpx

    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_amount_share",
               new=AsyncMock(side_effect=httpx.HTTPError("boom"))):
        result = await fetch_market_snapshot(refresh=False)

    assert result["sector_amount_share"] is None
    # P3 兩欄獨立 try/except — 不受影響
    assert result["sector_breadth"] == _FAKE_SECTOR_BREADTH_PAYLOAD
    assert result["sector_volume_ratio"] == _FAKE_SECTOR_VOL_PAYLOAD
    assert result["stale"] is False  # F6 sequel


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_sector_amount_share_value_error_propagates() -> None:
    """P4 T-INT-4 (TS-4): except 寬度鎖 — 只有 httpx.HTTPError 降級為 None,
    其他例外(ValueError)必須 fail-loud propagate(§E narrow except)。"""
    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_amount_share",
               new=AsyncMock(side_effect=ValueError("boom"))):
        with pytest.raises(ValueError, match="boom"):
            await fetch_market_snapshot(refresh=False)


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_amount_share_delegate_args() -> None:
    """P4 T-INT-5 (TS-2): helper 不 patch — 真實 delegate 路徑執行,
    spy compute_sector_amount_share 鎖 call-site args(allowed / primary_sector /
    refresh 傳達)。"""
    from services import clock

    fake_universe = [{
        "stock_id": "2330", "close": 2390, "change_rate": 1.92,
        "total_amount": 36e9, "volume_ratio": 1.14,
        "date": "2026-06-29 10:30:00.123456",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    sentinel = [{"sector": "半導體業", "today_share": 1.0, "share_delta_20ma": None}]
    spy = AsyncMock(return_value=sentinel)
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)), \
         patch("services.sector_aggregation.compute_sector_amount_share", new=spy):
        result = await fetch_market_snapshot(refresh=True)

    assert result["sector_amount_share"] == sentinel
    spy.assert_awaited_once()
    assert spy.await_args.args == (clock.today(), {"2330"}, {"2330": "半導體業"})
    # perf C2 該變 assertion(原鎖 refresh=True 傳達):C2 後 snapshot 的
    # refresh 不進 EOD compute,一律 False;C3b 起 kwargs 另含 prices 注入
    assert spy.await_args.kwargs["refresh"] is False
    assert "prices" in spy.await_args.kwargs


# ---------------------------------------------------------------------------
# perf snapshot-hot-path C1 — EOD result-level cache
# Plan: .claude/perf/snapshot-hot-path/optimize-plan.md
# Profile 2026-07-02:4 EOD compute = 37.1s 中 36.5s(98.4%),各含一次
# 7.9s re-parse 1.5GB prices cache → 結果以 (end_date, universe digest) 快取
# ---------------------------------------------------------------------------

_FAKE_AMOUNT_SHARE_PAYLOAD = [
    {"sector": "半導體業", "today_share": 55.0, "share_delta_20ma": 1.2},
]

_C1_FAKE_UNIVERSE = [{
    "stock_id": "2330", "close": 2390, "change_rate": 1.92,
    "total_amount": 36e9, "volume_ratio": 1.14,
    "date": "2026-06-29 10:30:00.123456",
}]
_C1_FAKE_SECTOR_ROWS = [{
    "stock_id": "2330", "industry_category": "半導體業",
    "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
}]


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_eod_result_cache_skips_recompute() -> None:
    """C1: 同 (end_date, universe) 第二次 snapshot 不重呼叫 4 個 EOD compute。"""
    breadth_mock = AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)
    sb_mock = AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)
    vr_mock = AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)
    amt_mock = AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=breadth_mock), \
         patch("services.finmind_realtime._fetch_sector_breadth", new=sb_mock), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio", new=vr_mock), \
         patch("services.finmind_realtime._fetch_sector_amount_share", new=amt_mock):
        r1 = await fetch_market_snapshot(refresh=False)
        r2 = await fetch_market_snapshot(refresh=False)

    # payload 完全一致(cache hit 不改變契約)
    assert r1["breadth"] == r2["breadth"] == _FAKE_BREADTH_PAYLOAD
    assert r2["sector_breadth"] == _FAKE_SECTOR_BREADTH_PAYLOAD
    assert r2["sector_volume_ratio"] == _FAKE_SECTOR_VOL_PAYLOAD
    assert r2["sector_amount_share"] == _FAKE_AMOUNT_SHARE_PAYLOAD
    # 4 個 compute 各只跑一次
    assert breadth_mock.await_count == 1
    assert sb_mock.await_count == 1
    assert vr_mock.await_count == 1
    assert amt_mock.await_count == 1


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_eod_result_cache_failure_not_pinned() -> None:
    """C1 invalidation:component compute 失敗(None)不得寫入 cache —
    backoff 窗口過後必須重算,不能 pin 失敗一整天;其餘成功 component 照常 cache。

    (bug eod-retry-backoff 修訂:原「下一 request 立即重算」放大 402 期間的
    配額燃燒,改為 _EOD_RETRY_BACKOFF_SEC 冷卻後重算 — docs/next-time.md
    事前標記的行為變更;本測試以手動清空窗口模擬過期。)"""
    import httpx

    import services.finmind_realtime as fr

    breadth_mock = AsyncMock(
        side_effect=[httpx.HTTPError("transient"), _FAKE_BREADTH_PAYLOAD]
    )
    sb_mock = AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)
    vr_mock = AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)
    amt_mock = AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=breadth_mock), \
         patch("services.finmind_realtime._fetch_sector_breadth", new=sb_mock), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio", new=vr_mock), \
         patch("services.finmind_realtime._fetch_sector_amount_share", new=amt_mock):
        r1 = await fetch_market_snapshot(refresh=False)
        fr._eod_backoff_until.clear()  # 模擬 backoff 窗口過期
        r2 = await fetch_market_snapshot(refresh=False)

    assert r1["breadth"] is None  # 第一次失敗 → None(F6 降級不變)
    assert r2["breadth"] == _FAKE_BREADTH_PAYLOAD  # 第二次重算成功,沒被 pin
    assert breadth_mock.await_count == 2
    assert sb_mock.await_count == 1  # 成功 component 照常 cache


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_eod_result_cache_universe_change_recomputes() -> None:
    """C1 invalidation guard:universe 變動(盤中 tick 覆蓋擴大)→ digest 變
    → 必須重算,不得拿舊 universe 的結果。(C1 前天然綠 — 鎖 over-caching)"""
    universe_2 = _C1_FAKE_UNIVERSE + [{
        "stock_id": "2317", "close": 100, "change_rate": 0.5,
        "total_amount": 1e9, "volume_ratio": 1.0,
        "date": "2026-06-29 10:31:00.000000",
    }]
    sector_rows = _C1_FAKE_SECTOR_ROWS + [{
        "stock_id": "2317", "industry_category": "其他電子業",
        "type": "twse", "date": "2026-06-26", "stock_name": "鴻海",
    }]
    breadth_mock = AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)
    sb_mock = AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)
    vr_mock = AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)
    amt_mock = AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(side_effect=[_C1_FAKE_UNIVERSE, universe_2])), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=breadth_mock), \
         patch("services.finmind_realtime._fetch_sector_breadth", new=sb_mock), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio", new=vr_mock), \
         patch("services.finmind_realtime._fetch_sector_amount_share", new=amt_mock):
        await fetch_market_snapshot(refresh=False)
        await fetch_market_snapshot(refresh=False)

    assert breadth_mock.await_count == 2
    # 第二次收到擴大後的 universe
    assert breadth_mock.await_args.args[1] == {"2330", "2317"}


# ---------------------------------------------------------------------------
# perf snapshot-hot-path C3b — recompute 共用一次 prices fetch
# 4 個 EOD compute 各自 _fetch_prices_window → 同一 window 4 次 parse;
# _fetch_eod_results 預抓一次注入,recompute 只付 1 次 parse。
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_eod_results_single_prices_fetch(monkeypatch) -> None:
    """C3b:_fetch_eod_results 對 prices window 只 fetch/parse 一次,
    且 window 與 P2 compute_breadth 自算的 (start, end) 完全相同(T36 慣例)。"""
    from datetime import date, timedelta as _td

    from services import finmind_realtime as fr
    from services import market_breadth as mb

    calls: list[tuple] = []
    base = date(2026, 4, 1)
    prices = []
    for i in range(60):
        d = (base + _td(days=i)).isoformat()
        prices.append({
            "stock_id": "2330", "date": d, "close": 100.0 + i,
            "Trading_Volume": 1000, "Trading_money": 100000.0,
        })

    async def fake_prices(start, end, refresh=False):
        calls.append((start, end))
        return prices

    async def fake_taiex(*a, **kw):
        return []

    monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
    monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)

    end_date = date(2026, 7, 2)
    result = await fr._fetch_eod_results(
        end_date, {"2330"}, {"2330": "半導體業"}, refresh=False
    )

    # 4 個 component 都有算出來(非 None)
    assert result["breadth"] is not None
    assert result["sector_breadth"] is not None
    assert result["sector_volume_ratio"] is not None
    assert result["sector_amount_share"] is not None
    # 關鍵:prices window 只 fetch 一次(修正前 = 4 次)
    assert len(calls) == 1, f"prices window fetched {len(calls)} times, expected 1"
    # window 對齊 P2 公式:pad = (lookback + slow_ema) * 2
    expected_pad = int((mb._DEFAULT_LOOKBACK_DAYS + mb._SLOW_EMA_PERIOD) * 2.0)
    assert calls[0] == (end_date - _td(days=expected_pad), end_date)


# ---------------------------------------------------------------------------
# perf snapshot-hot-path C6 (🟢) — top-level eod_as_of
# P5 前端要標「資料至 YYYY-MM-DD」;盤中四個 EOD panel 全是 T-1,
# 從 payload 直接給,不用前端從 series 反推(breadth null 時 series 不可得)。
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_eod_results_carries_eod_as_of(monkeypatch) -> None:
    """C6:eod_as_of = 四個 EOD compute 實際用的 prices window max date。"""
    from datetime import date, timedelta as _td

    from services import finmind_realtime as fr
    from services import market_breadth as mb

    base = date(2026, 4, 1)
    prices = []
    for i in range(60):
        d = (base + _td(days=i)).isoformat()
        prices.append({
            "stock_id": "2330", "date": d, "close": 100.0 + i,
            "Trading_Volume": 1000, "Trading_money": 100000.0,
        })

    async def fake_prices(start, end, refresh=False):
        return prices

    async def fake_taiex(*a, **kw):
        return []

    monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
    monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)

    result = await fr._fetch_eod_results(
        date(2026, 7, 2), {"2330"}, {"2330": "半導體業"}, refresh=False
    )
    assert result["eod_as_of"] == (base + _td(days=59)).isoformat()


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_payload_has_eod_as_of_key(monkeypatch) -> None:
    """C6:payload 一定有 eod_as_of key(值可 null — prices 不可得時)。"""
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_amount_share",
               new=AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)):
        result = await fetch_market_snapshot(refresh=False)

    assert "eod_as_of" in result


# ---------------------------------------------------------------------------
# perf snapshot-hot-path C2 (🔴) — refresh 語意:只 bust intraday,不進 EOD
# 「重新整理 = 看最新盤中」;EOD 是 T-1 資料,end_date 前進自然失效。
# 修正前 refresh=true 一路穿進 EOD fetcher = ~278s + 128 次 FinMind 呼叫。
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_refresh_hits_eod_result_cache() -> None:
    """C2: refresh=True 不 bypass EOD result cache — 已有當日結果就直接用。"""
    breadth_mock = AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)
    sb_mock = AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)
    vr_mock = AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)
    amt_mock = AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=breadth_mock), \
         patch("services.finmind_realtime._fetch_sector_breadth", new=sb_mock), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio", new=vr_mock), \
         patch("services.finmind_realtime._fetch_sector_amount_share", new=amt_mock):
        r1 = await fetch_market_snapshot(refresh=False)  # 建 result cache
        r2 = await fetch_market_snapshot(refresh=True)  # refresh 不得重算 EOD

    assert r1["breadth"] == r2["breadth"] == _FAKE_BREADTH_PAYLOAD
    assert breadth_mock.await_count == 1
    assert sb_mock.await_count == 1
    assert vr_mock.await_count == 1
    assert amt_mock.await_count == 1


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_refresh_not_forwarded_to_eod_compute() -> None:
    """C2: result cache miss 時(當日首個 request 就是 refresh),EOD compute
    收到的 refresh 必須是 False — 不觸發 128 次 FinMind window 重抓。"""
    breadth_mock = AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)
    sb_mock = AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)
    vr_mock = AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)
    amt_mock = AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=breadth_mock), \
         patch("services.finmind_realtime._fetch_sector_breadth", new=sb_mock), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio", new=vr_mock), \
         patch("services.finmind_realtime._fetch_sector_amount_share", new=amt_mock):
        await fetch_market_snapshot(refresh=True)

    assert breadth_mock.await_count == 1  # cache miss → 照算(用 EOD 自己的 24h cache)
    # C3b 該變:kwargs 多了 prices 注入,鎖 refresh=False 即可
    assert breadth_mock.await_args.kwargs["refresh"] is False
    assert sb_mock.await_args.kwargs["refresh"] is False
    assert vr_mock.await_args.kwargs["refresh"] is False
    assert amt_mock.await_args.kwargs["refresh"] is False


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_refresh_still_busts_intraday() -> None:
    """C2 guard:refresh=True 對 intraday 4 fetcher 照舊傳 refresh=True
    (「重新整理 = 看最新盤中」的正面路徑,防 C2 改過頭)。"""
    universe_mock = AsyncMock(return_value=_C1_FAKE_UNIVERSE)
    sector_mock = AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)
    mv_mock = AsyncMock(return_value={"2330": 6e13})
    watch_mock = AsyncMock(return_value=set())
    with patch("services.finmind_realtime._fetch_universe", new=universe_mock), \
         patch("services.finmind_realtime._fetch_sector_map", new=sector_mock), \
         patch("services.finmind_realtime._fetch_market_value_map", new=mv_mock), \
         patch("services.finmind_realtime._fetch_watch_list", new=watch_mock), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_amount_share",
               new=AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)):
        await fetch_market_snapshot(refresh=True)

    assert universe_mock.await_args.args == (True,)
    assert sector_mock.await_args.kwargs == {"refresh": True}
    assert mv_mock.await_args.kwargs == {"refresh": True}
    assert watch_mock.await_args.kwargs == {"refresh": True}


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_empty_universe_sector_amount_share_none() -> None:
    """P4 T-INT-3: allowed 收斂為空 → helper 的 empty-universe gate → None。"""
    fake_universe: list[dict] = []
    fake_sector_rows = [{
        "stock_id": "2330", "industry_category": "半導體業",
        "type": "twse", "date": "2026-06-26", "stock_name": "台積電",
    }]
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=None)):
        # 不 patch _fetch_sector_amount_share — 讓 `if not universe: return None`
        # gate 真實觸發(同上方 P3 T-INT-4 慣例)
        result = await fetch_market_snapshot(refresh=False)

    assert result["sector_amount_share"] is None


# ---------------------------------------------------------------------------
# prd 502/500 修正(2026-07-03)— cancel 鏈 × 冷啟動
# 根因:realtime _run_once 無 shield/refcount,第一個斷線請求(Vercel 30s
# 超時)cancel route task 時 asyncio 把取消直接傳進共用 inflight task,
# 其他共乘請求收 CancelledError → 500;且 EOD 冷啟動 4min 進度全丟。
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_run_once_shared_task_survives_subscriber_cancel() -> None:
    """共乘 subscriber 之一被 cancel(client 斷線)→ 其餘 subscriber 仍拿到結果。

    bug test-finmind-realtime-flake:原版 sleep(0.02) 賭 t2 掛上共用 task、
    sleep(0.2) 賭 cancel 先於完成,負載下時序漂移 → 改事件同步 + refs 實證,
    零 wall-clock 依賴且共乘條件從「賭中」升級為「驗證」。"""
    import services.finmind_realtime as fr

    started = asyncio.Event()
    release = asyncio.Event()

    async def slow() -> dict:
        started.set()
        await release.wait()
        return {"ok": True}

    key = "test_survive_cancel"

    async def subscribe() -> dict:
        return await fr._run_once(key, slow)

    t1 = asyncio.create_task(subscribe())
    await started.wait()
    t2 = asyncio.create_task(subscribe())
    await asyncio.sleep(0)  # 單步 yield:t2 同步跑到 await shield 掛上共用 task
    assert fr._inflight[key]["refs"] == 2  # 共乘成立(原版只能賭時序)
    t1.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t1  # 修正前:t1 的取消毒殺共用 task
    assert fr._inflight[key]["refs"] == 1  # 底層 task 仍活著,t2 還掛著
    release.set()
    assert await t2 == {"ok": True}


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_run_once_last_subscriber_cancel_cancels_underlying() -> None:
    """全部 subscriber 都斷線 → 底層 task 才被 cancel(對齊 finmind.py refcount 契約)。"""
    import services.finmind_realtime as fr

    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def slow() -> dict:
        started.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return {}

    key = "test_last_cancel"
    t1 = asyncio.create_task(fr._run_once(key, slow))
    await started.wait()
    t1.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t1
    # timeout 是純上限(正常 ms 級完成);1.0 在 pre-push 全套負載下曾被吃穿,
    # 放寬到 10.0 不影響綠路徑速度(bug test-finmind-realtime-flake)
    await asyncio.wait_for(cancelled.wait(), timeout=10.0)


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_eod_slow_compute_detaches_to_background(monkeypatch) -> None:
    """EOD 計算超過 inline 預算 → 立即回 partial(eod_pending=True),背景跑完
    寫 cache;下一個 request 拿完整結果且不重算。修 prd 冷啟動 4min ×
    Vercel 30s 超時的結構性衝突。"""
    import services.finmind_realtime as fr

    monkeypatch.setattr(fr, "_EOD_INLINE_BUDGET_SEC", 0.05)

    release = asyncio.Event()

    async def slow_breadth(*args, **kwargs):
        await release.wait()
        return _FAKE_BREADTH_PAYLOAD

    sb_mock = AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)
    vr_mock = AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)
    amt_mock = AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=slow_breadth), \
         patch("services.finmind_realtime._fetch_sector_breadth", new=sb_mock), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio", new=vr_mock), \
         patch("services.finmind_realtime._fetch_sector_amount_share", new=amt_mock):
        r1 = await fetch_market_snapshot(refresh=False)
        assert r1["eod_pending"] is True
        assert r1["breadth"] is None
        # 盤中資料照給(partial 降級,不是整包失敗)
        assert r1["sectors"]

        # 背景任務仍活著(request 已回但計算持續)
        bg_tasks = list(fr._eod_background.values())
        assert bg_tasks, "背景 EOD task 應該被保留引用"

        release.set()
        await asyncio.gather(*bg_tasks)

        r2 = await fetch_market_snapshot(refresh=False)

    assert r2["eod_pending"] is False
    assert r2["breadth"] == _FAKE_BREADTH_PAYLOAD


# ---------------------------------------------------------------------------
# bug eod-retry-backoff(2026-07-20)— EOD 失敗 retry 放大器
# 402 配額耗盡時 _fetch_eod_results 各 component 全 None、不落 cache,
# _cleanup 又把 task 自移除 → eod_pending 期間前端每 15s poll 都重觸發
# 全套 EOD fan-out(含 prices window prefetch),以配額再生速率持續燒。
# 修法:失敗 task 保留佔位 + backoff 窗口(_EOD_RETRY_BACKOFF_SEC)內
# 不重觸發;窗口內請求重用失敗 task 的(降級)結果 / 原樣 re-raise。
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_eod_failure_backoff_no_retrigger() -> None:
    """(紅測試)EOD compute 失敗後,backoff 窗口內的下一請求不重觸發計算。

    修正前:_cleanup 無條件自移除 + 失敗 component 不落 cache → 每次 poll
    全套重跑(await_count == 2)— 放大器本體。
    修正後:失敗 task 保留佔位,窗口內重用其降級結果,compute 只跑一次。"""
    import httpx

    breadth_mock = AsyncMock(side_effect=httpx.HTTPError("402 quota exhausted"))
    sb_mock = AsyncMock(side_effect=httpx.HTTPError("402 quota exhausted"))
    vr_mock = AsyncMock(side_effect=httpx.HTTPError("402 quota exhausted"))
    amt_mock = AsyncMock(side_effect=httpx.HTTPError("402 quota exhausted"))
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=breadth_mock), \
         patch("services.finmind_realtime._fetch_sector_breadth", new=sb_mock), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio", new=vr_mock), \
         patch("services.finmind_realtime._fetch_sector_amount_share", new=amt_mock):
        r1 = await fetch_market_snapshot(refresh=False)
        r2 = await fetch_market_snapshot(refresh=False)

    # 降級契約不變:失敗 component → None,盤中資料照給
    assert r1["breadth"] is None
    assert r2["breadth"] is None
    assert r2["eod_pending"] is False
    assert r2["sectors"]
    # 放大器判準:窗口內 4 個 compute 各只跑一次(修正前 = 2)
    assert breadth_mock.await_count == 1
    assert sb_mock.await_count == 1
    assert vr_mock.await_count == 1
    assert amt_mock.await_count == 1


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_eod_exception_backoff_reraises_without_recompute() -> None:
    """(紅測試)EOD task 以非 httpx 例外結束(fail-loud propagate 路徑)同樣
    進 backoff:窗口內請求重用同一失敗 task 原樣 re-raise,不重跑計算。"""
    boom = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=boom):
        with pytest.raises(RuntimeError, match="boom"):
            await fetch_market_snapshot(refresh=False)
        with pytest.raises(RuntimeError, match="boom"):
            await fetch_market_snapshot(refresh=False)

    # 原樣 re-raise 契約保留,但計算只跑一次(修正前 = 2)
    assert boom.await_count == 1


# ---------------------------------------------------------------------------
# bug test-finmind-realtime-flake(2026-07-19)— 模組級 task dict 跨 event loop 污染
#
# 負載下 wait_for(_EOD_INLINE_BUDGET_SEC) 超時 → pending EOD task 留在模組級
# _eod_background;pytest-asyncio 的 per-test loop teardown 只 shutdown_asyncgens
# + close,不 cancel pending task(0.26 plugin.py::_provide_event_loop)→ 死 loop
# 的 task 永遠 pending。下一測試(新 loop)_ensure_eod_task 以同 key 撿到它 →
# asyncio.shield → RuntimeError "got Future attached to a different loop";該檔
# ~20 個 snapshot 測試共用同一 key(today + digest({"2330"}))→ 連環炸 8-19 個
# (2026-07-07 / 07-11 / 07-14 / 07-17 四次 pre-push 實證,單檔重跑必綠)。
#
# 兩測試務必相鄰且依此定義順序(pytest 依定義序執行):A 走真實 timeout 路徑
# 製造污染;B 驗證下一測試免疫(conftest autouse registry 清理)。
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_pending_eod_task_pollution_setup(monkeypatch) -> None:
    """(pair A)模擬負載超時:EOD compute 慢於 inline budget → eod_pending 回傳
    後測試即結束,pending task 留在 _eod_background — flake 的第一張骨牌。
    本測試恆綠;它的職責是把污染留給 pair B 驗證免疫。"""
    import services.finmind_realtime as fr

    monkeypatch.setattr(fr, "_EOD_INLINE_BUDGET_SEC", 0.01)

    async def never_breadth(*args, **kwargs):
        await asyncio.Event().wait()  # 永不完成 = 負載下慢到超時的極限型

    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth", new=never_breadth):
        result = await fetch_market_snapshot(refresh=False)

    assert result["eod_pending"] is True
    # 污染已就位:pending task 以本測試的 event loop 掛在模組級 dict
    assert any(not t.done() for t in fr._eod_background.values())


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_immune_to_prior_test_pending_eod_task() -> None:
    """(pair B,紅測試)前一測試殘留的 pending EOD task 不得波及本測試。

    修正前:_ensure_eod_task 撿到死 loop 的 task → RuntimeError
    "got Future attached to a different loop"(四次 pre-push 連環炸的每一發)。
    修正後:conftest autouse 清 _inflight / _eod_background → 本測試照常全綠。"""
    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=_C1_FAKE_UNIVERSE)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=_C1_FAKE_SECTOR_ROWS)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 6e13})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=_FAKE_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_breadth",
               new=AsyncMock(return_value=_FAKE_SECTOR_BREADTH_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_volume_ratio",
               new=AsyncMock(return_value=_FAKE_SECTOR_VOL_PAYLOAD)), \
         patch("services.finmind_realtime._fetch_sector_amount_share",
               new=AsyncMock(return_value=_FAKE_AMOUNT_SHARE_PAYLOAD)):
        result = await fetch_market_snapshot(refresh=False)

    assert result["eod_pending"] is False
    assert result["breadth"] == _FAKE_BREADTH_PAYLOAD
    assert result["stale"] is False