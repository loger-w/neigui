# Brainstorm — market-monitor-v2 P3 sector breadth heatmap + sector volume ratio

**Date**: 2026-07-01
**Type**: /feat(接 P2 McClellan/AD Line,執行 spec.md §6.2 / §6.5)
**Scope**: **M**(4 檔:1 service + 1 test 新;1 service + 1 test 改) — **不升 L**,雖然 finmind_realtime.py 屬 hot path,但本次改動為 append-only + F6 stale-lock 對齊 P2,不新增鑑權 / 加密 / 金流面

## Canonical source

| 角色 | 路徑 |
|---|---|
| 規格(等價 P0 brainstorm) | `docs/specs/market-monitor-v2/spec.md` §6.2 sector breadth heatmap 公式 + 色票 / §6.5 族群 volume ratio 公式 + 閾值 dot / §8 sector_breadth / sector_volume_ratio payload shape |
| 計劃(等價 P1 design) | `docs/specs/market-monitor-v2/plan.md` Phase 3 TDD 4 條 + 完成條件 |
| P2 樣板 | `backend/services/market_breadth.py`(cache trio + `_fetch_daily_prices_window` per-trading-day loop / `get_finmind` indirection / F6 stale-lock)|
| P1 樣板 | `backend/services/market_universe.py`(inflight dedup + cache 慣例) |
| Sector map source | `backend/services/finmind_realtime.py::_dedup_sector_map` + `_PRIMARY_INDUSTRY_OVERRIDE`(reuse 不重新推) |

## 成功條件(SC-N 編號 + 驗證方式)

| SC | 描述 | 驗證方式 |
|---|---|---|
| SC-1 | 純函式 `_compute_ma20(daily_closes: list[float]) -> float | None`:< 20 day → None;≥ 20 day → 最後 20 天算術平均 | unit test 1(`test_compute_ma20_hand_calc`, `test_compute_ma20_insufficient_returns_none`) |
| SC-2 | 純函式 `_aggregate_sector_breadth(prices, sector_map, universe, end_date)` → `list[SectorBreadthResult]`:per sector 對每個 member 算 close_last vs ma20;若 ma20 = None(新上市 < 20 day)→ 該股 skip(分母排除);若整個 sector member 皆 skip → 該 sector 不出現在 result | unit test 3(`test_aggregate_sector_breadth_basic`, `test_aggregate_skips_newly_listed_stock`, `test_aggregate_empty_sector_omitted`) |
| SC-3 | 純函式 `_aggregate_sector_volume_ratio(prices, sector_map, universe, end_date, avg_window=20)` → `list[SectorVolResult]`:per sector `today_vol_lots = sum(Trading_Volume on end_date for members)`,`vol_ratio = today_vol_lots / mean(daily_sector_vol_sum over past 20 trading days)`;若 20 天均值 0 → `vol_ratio = None`;若整 sector 今日無 volume → sector 不出現 | unit test 3(`test_aggregate_sector_volume_ratio_hand_calc`, `test_vol_ratio_zero_avg_returns_none`, `test_vol_ratio_missing_today_sector_omitted`) |
| SC-4 | orchestrator `compute_sector_breadth(end_date, universe, sector_map, lookback_days=30, refresh=False)` async 呼叫:內部 fetcher 走 P2 `market_breadth._fetch_daily_prices_window` 共用 cache_key(避免又一輪 ~257s cold fetch)→ 回 `list[SectorBreadthResult]`(依 pct 降序) | integration test 1(`test_compute_sector_breadth_shape`,monkeypatch `market_breadth._fetch_daily_prices_window` 注入 fixture)|
| SC-5 | orchestrator `compute_sector_volume_ratio(end_date, universe, sector_map, avg_window=20, refresh=False)` async 呼叫:同 SC-4 走同一 cache_key → 回 `list[SectorVolResult]`(依 vol_ratio 降序);vol_ratio > 1.5 → `flag="hot"`;vol_ratio < 0.7 → `flag="cold"`;其他 → `flag=None` | integration test 2(`test_compute_sector_volume_ratio_shape`, `test_vol_ratio_flag_hot_cold`) |
| SC-6 | 整合:`services/finmind_realtime.py` snapshot payload 追加 `sector_breadth` + `sector_volume_ratio` 兩欄位;失敗(`httpx.HTTPError` / `ValueError`)→ 對應欄位 = `None` 但**不動** `stale`(F6 sequel — 對齊 P2 breadth `stale` 契約);既有 4 panel + `universe_size` + `excluded_count` + `breadth` 完全不動 | integration test 1(`test_snapshot_payload_adds_sector_breadth_and_vol_ratio`)+ 既有 P1/P2 test 全綠 |

## Edge cases

1. **Sector members = 0(整 sector universe 過濾後空)** → 該 sector 不出現在 result(SC-2/SC-3 覆蓋)
2. **Sector members < 5(小 sector 統計偏誤)** → 仍出現在 result 但 real-env verification 標 known gap;不在本輪硬性排除(spec §9 明列)
3. **新上市 < 20 trading day(無 MA20)** → SC-2 該股 skip(不計 up 也不計 down);SC-3 若 today 有 volume 仍計入(volume 不需 warm-up)
4. **`Trading_Volume` 缺欄(FinMind 某日 row 沒 volume)** → 該 (sid, date) 該欄位視為 0(SC-3 覆蓋)
5. **20-day mean sector volume = 0(新 sector / 全 members 皆新上市)** → `vol_ratio = None`(SC-3 test 覆蓋)
6. **Sector map 未覆蓋(股票在 universe 但 sector_map 沒 key)** → 歸「其他」sector,對齊 `finmind_realtime._group_by_sector` 慣例(SC-2/SC-3 orchestrator 層預設處理)
7. **連假 sparse trading day(fetch window 內某日無資料)** → 用實際 return date union,不填 NaN(對齊 P2 `_count_daily_ups_downs` F5)
8. **同 (sid, date) duplicate row(FinMind 撞 duplicate)** → per-stock keep last value(close + volume),對齊 P2 `_count_daily_ups_downs` F6
9. **`end_date` = 非交易日(週末 / 國定假)** → orchestrator 需先問 trading_calendar 拿最近 trading day;若不方便,fetcher 走 P2 pattern(`get_trading_days(end, 300)` 撈近 300 交易日 filter [start, end])→ 天然排除非交易日;`end_date` 落在非交易日時 orchestrator 用 fetcher 回傳的最新交易日作 `today` slot,若整窗口空 → 兩 result 皆 empty list
10. **finmind_realtime.py `_do_fetch_market_snapshot` `try/except` 邊界** → sector_breadth / sector_volume_ratio compute 失敗 → 對應欄位 = `None`,但 stale 不變(F6 sequel);兩者互相獨立 raise 不影響對方(**分兩個 try/except** 或用 asyncio.gather + return_exceptions=True,設計 phase 決)

## Out of scope(留 P4 / V2.5)

- Frontend `MarketSectorBreadthHeatmap.tsx` / `MarketSectorVolRatio.tsx`(spec.md Phase 5)
- Sector amount share(spec.md §6.4,plan.md Phase 4)
- 32 大類 sector 粒度是否要 sub-industry 細分(spec §9 openq,留 concept-drill spec)
- 舊 sectors payload 移除(V2 雙軌 1 release)
- 動態 min_members 閾值(V2.5 若 real-env 打紅偏誤 sector 太多 → 抽參數)
- Volume normalization by market cap(spec 未涉,V2.5)
- 中盤 dot 閾值(1.5 / 0.7)動態校準(V2.5 backtest)

## S/M/L 判定 = **M**

- 動的檔:
  - 🟢 `backend/services/sector_aggregation.py`(新)
  - 🟢 `backend/tests/test_sector_aggregation.py`(新)
  - 🔵 `backend/services/finmind_realtime.py`(**hot path,但 append-only** + F6 stale-lock 對齊 P2)
  - 🔵 `backend/tests/test_finmind_realtime.py` 或 `test_market_routes.py`(加 integration test 一條)
- 加新資料流(TaiwanStockPrice window with volume)但**共用** P2 cache_key(no 新 fetch)
- API contract add-only(2 新欄位,舊全部不動,對齊 §4 白名單)
- 碰 hot path 但**不**新增鑑權 / 加密 / 金流面 → 不升 L(對齊 P2 同判斷)

→ Phase 1/2 各 1 輪 review(M 分流);Phase 4 review **完整跑 multi-lens fan-out**(P2 抓到 1 P1 + 11 P2,ROI 明確,不省)

## Known gap(記 state.json + spec §9)

- **KG3(繼承 P2)**:若 P3 冷啟動 + P2 cache 過期 → 又一輪 ~257s per-trading-day loop;共用 cache_key 是 mitigation 但不能消除首次冷啟動代價
- **KG4(新)**:32 大類 sector 已知偏粗,半導體業 142 檔 dominate breadth pct → 標 spec §9,V2.5 用 sub-industry drill
- **KG5(新)**:volume ratio 閾值 1.5 / 0.7 hardcode 美股慣例,台股未校準 → 對齊 spec §9 P5 backtest 校準路線,V2.5 抽參數
- **KG6(新)**:「其他」sector 匯集所有 sector_map 未覆蓋股 → 若過於龐大會 dominate,real-env verification 檢查
