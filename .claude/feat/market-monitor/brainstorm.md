# market-monitor — Phase 0 Brainstorm

- 發起時間:2026-06-29(日盤後寫)
- Slug:`market-monitor`
- Branch:`feat/market-monitor` from `origin/main@611d9f0`(chip 0.17.0 release 之後)
- Prior art:`initial-design.md`(2026-06-26 v1,approved-with-fixes),本檔基於它收斂 + 校正
- 研究背書:`scratchpad/finmind_snapshot_v2.py` / `finmind_screener_heatmap.py` / `finmind_deep_dive.py` 三輪 probe 與壓測

---

## 1. 目標(WHY)

User 要的盤中(09:00-13:30 TPE)「整體市場掃描」工具,聚焦兩件:
- **熱力圖** — 一眼看 sector × 個股漲跌的視覺場景(finviz-style)
- **排行榜** — 漲跌幅 / 大量單 / 量比異常 top 30(三選一切換)

策略上是建立「snapshot 派生 pipeline」的基礎,後續可裝篩選器、亞洲熱錢 banner、外資代理等加值模組。

不做即時 5 檔 / 1 分 K / 逐筆 — 那要券商 API,本期 scope 之外。

---

## 2. 成功條件(SC,每條附驗證方式)

> 規矩:每條 SC 強制可驗證。「驗證方式」是 gate,寫不出 → SC 不合格。

### SC-1:Backend snapshot pipeline + 整盤 endpoint

**內容**:`GET /api/market/snapshot` 回派生 payload `{ as_of: ISO, is_trading_session: bool, stale: bool, last_tick: ISO, sectors: [{ id, name, member_count, avg_change_rate, total_amount, stocks: [{ stock_id, name, change_rate, total_amount, market_value }] }] }`,**over-the-wire size ≤ 50 KB(gzip 後)** `[amendment 2026-06-29: Phase 3 發現,原寫「gzip 前」是 measurement unit 漏。實際 raw ≈ 130 KB / gzip ≈ 22 KB,gzip-後 才是 user 實付 latency,改鎖 gzip-after 才正確]`,wall p50 ≤ 800 ms(後端 fetch + parse + aggregate)。

**驗證方式**:
- 自動化:`backend/tests/test_market_routes.py::test_snapshot_basic` — mock FinMind 三個 endpoint 回 fixture,assert payload shape + size + non-empty sectors
- 真實環境:`curl -s http://localhost:8000/api/market/snapshot | wc -c` < 50000(盤中跑)
- 真實環境:`curl -w '%{time_total}\n' -o /dev/null -s http://localhost:8000/api/market/snapshot` p50 < 0.8s(連跑 10 次)

### SC-2:熱力圖 frontend(finviz-style 單層 treemap)

**內容**:`MarketPage` 左 70% 顯示 treemap,sector 為 group、stock tile size = T-1 市值、color = `change_rate`(bull=紅 / bear=綠 / 平=灰),hover 顯示 stock_id + name + change_rate + total_amount tooltip,click stock → `setMode('equity') + setSymbol(stock_id)` 一鍵切到個股籌碼頁。

**驗證方式**:
- 自動化:`frontend/src/lib/heatmap-svg.test.ts` — 純 SVG 計算函式單測,assert tile rect 位置 / 配色 binding(bull=紅 用 data-testid)
- 自動化:`frontend/src/components/MarketHeatmap.test.tsx` — RTL,assert hover tooltip 內容、assert click → onSymbolPick callback 觸發
- 真實環境:chrome-devtools-mcp 截圖 `evidence/SC-2_heatmap-trading-session.png`,Console 0 errors,visual 確認 bull=紅 bear=綠不可顛倒

### SC-3:排行榜(三榜 tab 切換)

**內容**:`MarketPage` 右 30% 三個 tab(漲跌幅 / 大量 / 量比),預設「漲跌幅」,顯示 top 30(漲跌幅 tab 顯示 top 15 漲 + bottom 15 跌)。每列顯示 `stock_id / name / value / change_rate / total_amount`。Click row → 同 SC-2 pivot 到 equity mode。

**驗證方式**:
- 自動化:`backend/tests/test_market_routes.py::test_leaderboard_modes` — assert 三種 mode (gainers / amount / volume_ratio) 各回 top 30 + 正確排序
- 自動化:`frontend/src/components/MarketLeaderboard.test.tsx` — RTL,assert tab 切換 + 排序順序
- 真實環境:chrome-devtools-mcp 截圖 `evidence/SC-3_leaderboard-three-tabs.png`(三 tab 各一截)

### SC-4:第三 mode `market` 加進 ModeSwitch + lazy MarketPage

**內容**:`Mode` union 加 `"market"`,ModeSwitch 三選一(個股籌碼 / TXO選擇權 / 大盤掃描),`market` 切換用 `localStorage` 持久化(對齊 equity / options 慣例),`MarketPage` lazy + `<Suspense>` 包(對齊 OptionsPage 慣例)。

**驗證方式**:
- 自動化:`frontend/src/components/ModeSwitch.test.tsx` 補測 — assert 三 button 存在 + click `market` → mode prop 變動
- 自動化:`frontend/src/App.test.tsx`(新檔)— mode = "market" 時 render `MarketPage` lazy chunk
- 真實環境:`evidence/SC-4_mode-switch-three-states.png` 截三 mode 切換各一張

### SC-5:Polling 2-3 秒 + stale 狀態 + 收盤偵測

**內容**:`useMarketSnapshot` 用 TanStack Query `refetchInterval: 2500`,timeout 5s + 自動 retry × 1(retry on 5xx);後端 payload 帶 `is_trading_session` / `stale` / `last_tick`;前端 header 顯示 last_tick + lag,`stale=true` 顯示「資料停滯」banner,`is_trading_session=false`(收盤 / 假日 / 開盤前)顯示對應狀態 + 暫停 polling。

**驗證方式**:
- 自動化:`frontend/src/hooks/useMarketSnapshot.test.ts` — assert refetchInterval / retry config / stale flag 觸發 banner
- 自動化:`backend/tests/test_market_routes.py::test_is_trading_session_flag` — mock 不同時段 wall_clock 驗證 flag(09:30 = true / 14:30 = false / 週六 = false)
- 真實環境:chrome-devtools-mcp 盤中 + 盤後各跑一次,截 `evidence/SC-5_trading-session-live.png` + `SC-5_after-market-banner.png`,Network panel 確認盤後 polling 暫停

---

## 3. Edge cases(≥ 3 條,實際列 7)

- **E1**:約 90 檔 `stock_id` 對不到 `TaiwanStockInfo.industry_category`(新上市 / 特殊 ETF) → 歸「其他」一欄 group(不過濾不顯示,讓 user 知道存在)
- **E2**:約 470 檔對不到 `TaiwanStockMarketValue` → tile size 一律給 group 內 median 值(避免完全消失),tooltip 標「市值未提供」
- **E3**:snapshot 偶爾 1.6s outlier(實測) → backend timeout 5s + 1 次 retry;前端 stale fallback 收 cache + stale=true
- **E4**:同 `stock_id` 多 `industry_category` row(v1 R9:2330 = 半導體業 + 電子工業) → backend dedup 取 `type="twse"` 且最新 `date` 那筆當 primary sector,其他 row 丟棄(明確不採 1-to-many,避免某檔出現在多 sector tile)
- **E5**:收盤後 13:30+,snapshot 仍回資料但 tick_ts 不推進 → backend 算 lag,前端顯示「已收盤,last_tick HH:MM」banner + 暫停 polling
- **E6**:開盤前(< 09:00) / 假日 / 颱風天 → backend 透過 `services.trading_calendar.get_trading_days` 判斷是否交易日,`is_trading_session=false` 時 payload 仍回上一交易日資料(snapshot 會給),前端顯示「無交易日 / 未開盤,顯示 YYYY-MM-DD 收盤資料」+ 不 polling
- **E7**:FinMind 全掛 → 三個 endpoint 任一失敗 → backend 走 stale fallback(serve disk cache + `stale=true`),前端 banner 警示「資料 X 秒未更新」,polling 持續嘗試

---

## 4. Out of scope(明列以擋 scope creep)

以下**一律不做**,等本期上線跑一陣子收 feedback 再回來個別評估:

- 篩選器 condition picker(preset 6-8 條那一票 — 等本期 baseline)
- 亞洲熱錢 banner(需要日經 / KOSPI / HSI / 即時外資部位 — 跨資料源)
- 外資權值股代理 sub-view
- 自選股 watch list / 個股 follow
- 警示推送(LINE Notify / Email / Browser Push)
- 即時 5 檔深度(FinMind 沒有)
- 即時 1 分 K K 線(FinMind 沒有,要 server 端累)
- WebSocket / SSE push stream(REST polling 完全夠)
- 切到 sector 後 drill-down 看該 sector 全成分股(維持單層 treemap)
- 自定義熱力圖配色 / 自定義 size metric
- 後端 condition DSL / query 化
- 篩選回測 / backtest
- TXO chain 即時 monitor(屬 options mode 擴充,獨立 feature)
- equity mode 內嵌即時 ticker(維持兩 mode 隔離,點 stock 用 `setMode + setSymbol` 跨 mode)

---

## 5. S/M/L 分流

**評估**:跨前後端、≥ 5 個新檔、無安全 / 鑑權 / 金流 / 對外 API 風險、無 hot path 改動。

| 維度 | 評估 |
|---|---|
| 新檔數 | Backend 3-4 個(routes/market.py + services/finmind_realtime.py + sector cache util + 可能 trading_calendar 微擴);Frontend 6-8 個(MarketPage / MarketHeatmap / MarketLeaderboard / 兩個 hook / heatmap-svg lib / types) |
| 跨服務 | 前後端跨 |
| 安全邊界 / 鑑權 / 金流 / 對外 API | 全無(read-only / 內部 proxy) |
| 既有 hot path 改動 | App.tsx mode union 改 +1,ModeSwitch 多 1 button — 低風險 |
| 新外部依賴 | 無(TanStack Query 已用、d3-hierarchy 或 visx 二選一是 frontend 新 dep — 算次要新依賴) |

**→ L 級**(≥ 5 檔 + 跨前後端)

**Implication**:Phase 1/2 各 max 3 輪 sub-agent review,Phase 4 /code-review 走完整流程,Phase 6 真實環境驗證走 chrome-devtools-mcp + 盤中跑必須過。

---

## 6. Phase 0b 待跑(進 Phase 1 前 prereq)

從 v1 spec + 今日實測 follow-up 還沒驗的:

- **0b-1**:盤中(下個交易日 09:00-13:30)再 probe 一次 `taiwan_stock_tick_snapshot`,觀察 `date` field 在 live 期間的推進頻率,確認 2-3 秒 polling cadence 對齊 server tick(本期間在 11am 量過 2330 ~ 7.5 秒一個 tick,要看開盤熱門時段是否更密)。
- **0b-2**:probe `TaiwanStockInfo` 不帶 `data_id` 全市場拉,確認 R9 多 row(2330 兩個 industry_category)的 cardinality — 普遍存在?還是只有少數個股?dedup 策略要不要更精細(`type="twse"` 是否唯一)。
- **0b-3**:probe 開盤前(08:50)snapshot 行為 — 回上一交易日 frozen value?還是空 array?是否帶識別 flag?
- **0b-4**:probe 假日 / 颱風天 snapshot 行為(挑一週末 + 上次颱風日歷史 timestamp,用 wayback 或 backend log 對比)— 確認 `is_trading_session` 偵測邏輯應該基於 `trading_calendar` 還是 snapshot 自身 lag。

這四件可在 Phase 1 design 之前用 scratchpad probe 補完,結果寫到 `phase-0b-probe.md` 入 artifact。

---

## 7. 跟 v1 spec 的差異(校正點)

v1 (`initial-design.md`) 跟本檔的關鍵差異:

| 主題 | v1 | 本期 |
|---|---|---|
| Cache TTL / polling | 10 秒 | 2-3 秒(2026-06-29 實測甜蜜點) |
| 範圍 | 含 SectorList + SectorMembersTable + RealtimeSnapshotPanel + per-symbol 5 個 component | 收斂到 MarketPage + MarketHeatmap + MarketLeaderboard 3 個 |
| 後端 endpoint | 5 個(universe / symbols slice / sectors list / sector members / sector snapshot) | 2 個(/api/market/snapshot 派生整盤 + /api/market/leaderboard 三 mode top 30)— 排行榜獨立是因為 client-side filter 30 筆 vs server filter 30 筆 payload 差 < 5 KB,不獨立但合在 snapshot 內也合理。**Phase 1 design 再決定:單 endpoint 還是雙 endpoint** |
| Sector dedup(R9) | 標 risk 待後續處理 | E4 明確採「twse + 最新 date 取一」 |
| TickType 含義 | 標 unknown | E5 明確不暴露 raw 給 frontend |
| 五檔 depth | 註 best-1 only | 已明列 out-of-scope |
| Polling thrash 防護 | refetchIntervalInBackground: false | 維持 + 加 `is_trading_session=false` 時暫停 |

---

## 8. 預估時程

| Phase | 內容 | 預估 |
|---|---|---|
| 0b probe | 盤中 + 開盤前 + 假日 行為驗證 | 0.5 天(下個交易日早上 09:00-10:00) |
| 1 design | spec 寫 + sub-agent review × 1-3 輪 | 1 天 |
| 2 impl spec | per-file detail + parallel review | 1 天 |
| 3 TDD | backend 服務 + routes + frontend hook + 元件 + treemap SVG | 4-5 天 |
| 4 code-review | /code-review + fixes | 0.5-1 天 |
| 5 自動化驗證 | pytest + vitest + tsc + build + ruff | 0.5 天 |
| 6 真實環境 | chrome-devtools-mcp 盤中跑 + 截圖 | 0.5 天(綁交易日) |
| 7 核 goal | 結構化證據表 | 0.5 天 |
| 8 收尾 | PR / merge / changelog | 0.5 天 |
| 8.5 沉澱 | memory + feat-improvements | 0.5 天 |

**Total:~9-11 天**(綁兩個交易日:0b + Phase 6)。

---

## 9. 開放 question(進 Phase 1 前要拍板)

1. **單 endpoint vs 雙 endpoint**:`/api/market/snapshot` 一隻派生(含 sector 結構 + 排行榜)還是 `/snapshot` + `/leaderboard` 分兩隻?payload size 差 < 5 KB(已估算),但獨立 endpoint 可獨立 cache + frontend 兩 hook 各自 polling。
2. **Treemap library**:`d3-hierarchy` 純算式(SVG 自己畫)還是 `@visx/hierarchy`(React 元件)?專案目前無 d3 / visx 依賴,自己寫 squarified treemap 算法也是選項(對齊 `lib/chip-svg.tsx` 自寫渲染慣例)。
3. **市值缺失 tile size 策略**(E2):用 sector 內 median 還是 min positive?median 視覺較公平,min 邊緣感更弱。
4. **收盤後 polling 行為**(SC-5 / E5):完全停 polling 還是降頻(改 30s 一次,讓 manual refresh 不必反應)?

**建議**:這 4 條保留到 Phase 1 design 階段討論並寫進 design.md。
