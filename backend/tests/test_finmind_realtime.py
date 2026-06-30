"""SC-1 / SC-3 — fetch_market_snapshot + helpers."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

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
