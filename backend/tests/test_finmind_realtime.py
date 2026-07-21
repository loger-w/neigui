"""SC-1 / SC-3 — fetch_market_snapshot + helpers."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import asyncio
import pytest

from services.finmind_realtime import (
    _PRIMARY_INDUSTRY_OVERRIDE,
    _build_name_map,
    _dedup_sector_map,
    _max_tick_date,
    fetch_market_snapshot,
)


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
# (MK-4 mod/batch-ui-update:_trim / _compute_leaderboards / _group_by_sector
# 隨經典檢視整刪,對應單元測試移除;snapshot keys 斷言改鎖「不得殘留」。)
# --------------------------------------------------------------------------


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
    # MK-4:sectors / leaderboards 已隨經典檢視刪除,不得殘留
    assert "sectors" not in result
    assert "leaderboards" not in result
    assert "index_strength" in result
    assert "cap_tiers" in result
    # MK-7:breadth 節(2330 上漲一檔)
    assert result["breadth"]["twse"]["up"] == 1
    assert result["breadth"]["rows"][0]["stock_id"] == "2330"


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
    靠 `stock_id in primary_sector` whitelist 天然排除。本 test 鎖(MK-4 後
    改以 universe_size 觀察):指數 '001' '036' 不進 universe,僅 '2330' 計入。
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
    # whitelist 把 001/036 剃掉 → universe 只剩 2330
    assert result["universe_size"] == 1
    # 001 仍作為 index row 進 index_strength(獨立抽取,不受 whitelist 約束)
    assert result["index_strength"]["twse"] is not None
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
    - ETF prefix `00` / 6 位數權證 / 處置股被 filter 排除(MK-4 後以
      universe_size / excluded_count 觀察,leaderboards 已刪)
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
    # Phase 4 P2 fix:watch_list degradation 必須拉 stale=True
    assert result["stale"] is True, (
        "watch_list fetch fail 時 stale 必須 True,讓 frontend banner 警示"
        "處置股過濾不可用"
    )


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


# ---------------------------------------------------------------------------
# mod/market-today-only(2026-07-20)— EOD 管線退役後的今日三卡 payload shape。
# breadth / sector_breadth / sector_volume_ratio / sector_amount_share /
# eod_pending / eod_as_of 六鍵隨 EOD 管線整段刪除;三個新鍵(index_strength /
# cap_tiers / sector_rotation)由 market_today 🟢 commit 接線出真值
# (change-spec.md §3 / §4 R15 commit 拆法)。
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_snapshot_payload_today_fields_shape() -> None:
    """SC-1/SC-4/SC-5: 舊六鍵移除;新三鍵接線後有真值 — 001/101 index rows
    在 fixture 內時 index_strength.twse/.tpex 非 null,cap_tiers/sector_rotation
    依 mv_map / chain 是否存在而定。"""
    fake_universe = [
        {"stock_id": "001", "close": 20100, "change_price": 100, "change_rate": 0.5,
         "date": "2026-06-29 10:30:00.123456"},
        {"stock_id": "101", "close": 200, "change_price": 1, "change_rate": -0.3,
         "date": "2026-06-29 10:30:00.123456"},
        {"stock_id": "2330", "close": 2390, "change_rate": 1.92,
         "total_amount": 36e9, "volume_ratio": 1.14,
         "date": "2026-06-29 10:30:00.123456"},
    ]
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
         patch("services.industry_chain.get_chain",
               new=AsyncMock(return_value=None)):
        result = await fetch_market_snapshot(refresh=False)

    # MK-7 註:EOD 舊 breadth 鍵 2026-07-20 移除後,MK-5/7 重新引入同名新契約
    # (今日 tick 口徑,shape 完全不同)— 不再列入「舊鍵不得殘留」。
    for k in ("sector_breadth", "sector_volume_ratio",
              "sector_amount_share", "eod_pending", "eod_as_of"):
        assert k not in result, f"EOD 舊鍵 {k} 應已隨管線移除"
    for k in ("index_strength", "cap_tiers", "breadth", "sector_rotation"):
        assert k in result, f"新鍵 {k} 應存在:{list(result.keys())}"

    # index_rows 有 001/101 → 兩側非 null(SC-1)
    assert result["index_strength"]["twse"] is not None
    assert result["index_strength"]["tpex"] is not None
    # mv_map 只有 2330 → cap_tiers 非 None(至少一桶)
    assert result["cap_tiers"] is not None
    # chain mocked 回 None → sector_rotation 降級 null(SC-5)
    assert result["sector_rotation"] is None
