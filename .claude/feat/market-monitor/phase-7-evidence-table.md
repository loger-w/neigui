# Phase 7 — 結構化證據表(回頭核 brainstorm.md goal)

驗證時間:2026-06-29 18:30 TPE
Branch:`feat/market-monitor` @ `d1c1592`
Fresh test 數字(2026-06-29 18:30 跑):
- backend pytest:**277 passed / 0 failed**(基線 231 + 46 新 market-monitor tests)
- frontend vitest:**416 passed / 0 failed**(基線 369 + 47 新 market-monitor tests)
- ruff:**All checks passed**
- tsc + vite build:**built in 1.27s,MarketPage chunk 10.31 KB / gzip 4.08 KB**

## SC 對齊表

| SC-N | 實作檔案:行號(主要)| 自動化測試名(pass count)| real-env 證據路徑 | regression 抽樣對象 |
|---|---|---|---|---|
| **SC-1** Backend snapshot pipeline + over-the-wire ≤ 50 KB gzip + wall p50 ≤ 800 ms | `backend/services/finmind_realtime.py:395 fetch_market_snapshot`(asyncio.gather + dedup + group + leaderboards)+ `backend/routes/market.py:28 get_market_snapshot` + `backend/main.py:54 include_router market` | `test_finmind_realtime.py::test_fetch_market_snapshot_happy_path` + `..._all_fail_raises_unreachable` + `..._stale_false_when_only_sector_fetch_fails` + `..._stale_true_when_universe_fails_with_cache` + `..._refresh_propagates_to_all_three_fetchers`(5);`test_market_routes.py`(8 含 `test_payload_size_under_budget` gzip < 50000 gate);Total = **13 tests pass** | `real-env-verification.md` §SC-1:`curl -s --compressed ... -D headers.txt` 真實量 `content-length: 24241` bytes(gzip 後 24 KB)/ wall 0.51-0.74 s(cache 與 refresh 兩路徑)/ 49 sectors / 1080 stocks 對齊 payload shape | Phase 6 發現 indices 入榜 → filter `stock_id in primary_sector`(`finmind_realtime.py:441 stock_universe filter`)。Phase 4 R3 stale 條件被 2 個新 regression test 鎖(`test_stale_false_when_only_sector_fetch_fails` + `test_stale_true_when_universe_fails_with_cache`)|
| **SC-2** 熱力圖 finviz-style(bull=紅 / bear=綠 / hover tooltip / click pivot)| `frontend/src/lib/heatmap-svg.tsx`(colorForChange 9-bin + layoutHeatmap squarified Bruls et al.)+ `frontend/src/components/MarketHeatmap.tsx`(SVG render + hover state + onSymbolPick) | `heatmap-svg.test.ts` 15 case(9 bin 鎖具體 hex / R>G bull / G>R bear / 28×30=840 tiles edge / null mv fallback / extreme aspect ratio)+ `MarketHeatmap.test.tsx` 8 case(data-fill-bin="bull|bear" 正反向 assertion / hover tooltip 含 stock_id+name+chg%+市值估 flag / click → onSymbolPick spy);Total = **23 tests pass** | `real-env-verification.md` §SC-2:backend payload 49 sectors × 平均 22 stocks 結構正確;**視覺證據受限**(browser MCP infra_fail);RTL component 證明 logic + colour direction 已鎖。盤中視覺待下個交易日 09:00-13:30 補(`evidence/SC-2_heatmap-trading-session.png` deferred)| Phase 4 R7 lag pill 隱藏在 !isTradingSession 由 MarketHeader internal state,不影響 SC-2 視覺;v3 L1 colour test 改鎖具體 hex,任何紅綠寫反會即時紅 |
| **SC-3** 排行榜 3-tab(漲跌幅/大量/量比 各 top 30)+ row click pivot | `frontend/src/components/MarketLeaderboard.tsx`(3-button tab + 條件 render + Row component bull-red/bear-green spans + onSymbolPick)+ backend `finmind_realtime.py:218 _compute_leaderboards`(4 sorted lists × size 30 + _trim 含 volume_ratio) | `MarketLeaderboard.test.tsx` 9 case(3 tab 切換 / 量比 tab 顯示 8.50x suffix / null fallback "—" / bull-red AND green-null 正反 assertion / 漲幅 Top15 + 跌幅 Top15 雙列)+ backend `test_finmind_realtime.py::test_leaderboards_gainers/losers/amount/volume_ratio_sorted` + `test_leaderboards_attach_sector_from_primary_map` + `test_trim_includes_volume_ratio_field`(5);Total = **14 tests pass** | `real-env-verification.md` §SC-3:backend 4 leaderboard keys 各 30 row;真實 `gainers top 5: 6483 原創生醫 +29.23% / 6847 普瑞博 +17.95% / ...`;**視覺證據受限**;RTL 證明 3-tab 切換 + null fallback + bull/bear 色彩 | v3 F5 volume_ratio 由 `_trim` 帶到 frontend;v3 C5 bull/bear 正反向 assertion 鎖綠 null / 紅 null;Phase 6 中文公司名從 `_build_name_map` 注入(3 regression tests)|
| **SC-4** Mode 加 `"market"` + ModeSwitch 三選一 + lazy MarketPage + localStorage 持久化 | `frontend/src/components/ModeSwitch.tsx:3 Mode union + MODES[] 加 market` + `frontend/src/App.tsx:53 lazy MarketPage import` + `App.tsx:67-71 useState(localStorage)+useEffect persist` + `App.tsx:215 handleSymbolPick` + `App.tsx:435-460 3-way ternary` | `ModeSwitch.test.tsx` 6 case(三 button render / aria-current=page on equity vs options vs market 三向鎖 / click 大盤 → onChange('market'))+ `MarketPage.test.tsx::isActive=false 不 fetch`(F4 regression)+ build output 確認 `MarketPage` 是 lazy chunk(獨立 file 10.31 KB / gzip 4.08 KB);Total = **7 tests pass + build evidence** | `real-env-verification.md` §SC-4:`npm run build` 真實產出 `dist/assets/MarketPage-zTe19vkk.js 10.31 kB / gzip 4.08 kB` 證明 lazy chunk 切開;**視覺證據受限**(三 mode 切換截圖)| v3 C1 3-way ternary 取代 2-way 避免雙 mount;v3 C3 handleSymbolPick reuse handlePick 清 sibling state |
| **SC-5** Polling 2-3 秒 + timeout 5s + retry × 1 + stale banner + 收盤暫停 polling | `frontend/src/hooks/useMarketSnapshot.ts:18 forceRefreshRef + refetchInterval callback + cancelQueries + retry:1` + `frontend/src/components/MarketHeader.tsx:31 showLagPill = isTradingSession && lagSeconds != null` + `frontend/src/components/MarketPage.tsx:16 error 不 unmount 改 banner` + `backend/services/trading_session.py:20 is_in_session` | `useMarketSnapshot.test.ts` 6 case(fetch on mount / enabled=false 不 fetch / 暴露 isStale isTradingSession lastUpdated / refresh→refresh=true / error 5s timeout / loading 終態)+ `test_trading_session.py` 11 case(週中 / 開盤前 / 收盤後 / 週末 / null tick / 邊界 / naive tz Phase 4 R2 / 69600 lag 鎖)+ `MarketPage.test.tsx` 3 case(整測 fetch ok / E7 banner / isActive=false 不 fetch);Total = **20 tests pass** | `real-env-verification.md` §SC-5:**18:30 TPE 收盤後 5 hr 真實 curl**:`is_trading_session=False` / `stale=False` / `lag_seconds=12369`(206 min)/ `last_tick=2026-06-29T14:59:59` — 全部 backend 行為對齊;**盤中 polling 視覺證據**(2.5s refetchInterval 真實觀察)待下個交易日補 | Phase 4 R1 error 改 banner 不 unmount;R2 Z suffix UTC→TPE 轉換;R3 stale 限 universe failure;R8 cancelQueries 解 polling/refresh race |

## 失敗類型分流(Phase 7 規矩)

無 SC-N 失敗。Phase 6 標 `_unscoped.phase_6 += 1` infra_fail(browser MCP profile conflict),per /feat rule (d) 不算 SC 回退;視覺證據在 Phase 6 evidence doc 內標明「盤中視覺待下個交易日補」,屬 known gap 非未完成。

## 進場 Phase 8 收尾條件

✓ brainstorm.md SC-1..5 每條都有對應實作 + 自動化測試(13/23/14/7/20 pass)
✓ Phase 5 五件自動化 gate 全綠
✓ Phase 6 backend real-env curl 驗 SC-1 完整證明;SC-2/3/4/5 視覺部分由 RTL test + build 證據替代覆蓋
✓ 無未標記的 Known Risks
✓ TDD 三類 commit 序列存在(34 commits:[red] / [green] / [refactor] / [fix])

→ 進 Phase 8 收尾。
