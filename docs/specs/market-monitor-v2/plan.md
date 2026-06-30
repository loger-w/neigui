# Market Monitor V2 — Execution Plan

**Pre-reading**:`spec.md`(同 dir)
**估時**:6 phases ≈ 4-5 工作天

---

## Phase 1 — Universe filter service

### 目標
建 `market_universe.py` 提供 4 位數普通股清單(排 ETF / 權證 / 注意處置),被既有 + 新 services 共用。

### 動的檔
- 🟢 `backend/services/market_universe.py`(新)
- 🟢 `backend/tests/test_market_universe.py`(新)
- 🔵 `backend/services/finmind_realtime.py`(整合,在 build leaderboards / sectors 前套 filter)

### 實作要點
- API:
  ```python
  async def get_filtered_universe(refresh: bool = False) -> dict:
      """回傳 {universe: set[str], excluded: {etf, warrant, watch_list}}"""
  ```
- 排除規則:
  - `stock_id` startswith `00` → ETF
  - `stock_id` 長度 ≠ 4 或含非 digit → 權證 / 其他
  - 注意處置:**P1 先 probe FinMind 是否有 dataset**(可能名稱 `TaiwanStockTradingDate` 或新 dataset);若無 → fallback fetch TWSE OpenAPI `https://openapi.twse.com.tw/v1/announcement/sdss_alert`(或對應 endpoint)
- Cache:24 hr,因處置股清單 daily 更新

### TDD 順序
1. test: 0050 / 0056 / 00919 → excluded(ETF)
2. test: 6 位數 stock_id → excluded(warrant)
3. test: 3037 欣興 / 8046 南電 → included
4. test: 處置股 fixture → excluded(用 mock data 模擬)
5. test: refresh=True 跳 cache

### 完成條件
- pytest 新增 ≥ 5 test 全綠
- 既有 `routes/market.py` snapshot endpoint 還能正常回(整合 filter 後不 crash)
- `universe_size` 欄位出現在 snapshot payload

### 不能破壞
- 既有 4 panel(gainers/losers/amount/volume_ratio)payload 不變(只是 universe 縮)

---

## Phase 2 — McClellan + AD Line service

### 目標
從 TaiwanStockPrice daily 算每日上漲/下跌家數 → ratio-adjusted McClellan + 累計 AD Line + 訊號偵測。

### 動的檔
- 🟢 `backend/services/market_breadth.py`(新)
- 🟢 `backend/tests/test_market_breadth.py`(新)

### 實作要點
- API:
  ```python
  async def compute_breadth(
      end_date: str,
      universe: set[str],   # 從 P1
      lookback_days: int = 60,
  ) -> BreadthResult
  ```
- BreadthResult:
  - `ad_line_value: float`
  - `mcclellan_oscillator: float`
  - `ad_line_series: list[{date, value}]`(60 天供畫圖)
  - `mcclellan_series: list[{date, value}]`
  - `thrust_dot / centerline_cross / divergence_dot`
- 公式:見 spec §6.3
- Divergence vs 加權指數(stock_id `0001` / `TAIEX`):取 close 序列,跟 mcclellan_series 看 N 天內 indices 新高但 mcclellan 沒新高 → bearish dot
- Cache:24 hr by end_date

### TDD 順序
1. test: 給 known up/down 家數 fixture(eg 5 天 advances/declines)→ AD Line 累計正確
2. test: McClellan = 19-EMA(RANA) - 39-EMA(RANA),手算驗證
3. test: ±100 thrust 偵測
4. test: centerline cross
5. test: divergence detect(指數新高但 mcclellan 下降)
6. test: universe 為空 → graceful error

### 完成條件
- pytest 新增 ≥ 6 test 全綠
- `breadth` 欄位出現在 snapshot payload

### 不能破壞
- 既有 leaderboards / sectors payload 不變

---

## Phase 3 — Sector breadth + sector volume aggregation

### 目標
按 FinMind IndustryChain `industry`(32 大類)做 sector 聚合,算每 sector「% 個股 > 20MA」「volume aggregate」。

### 動的檔
- 🟢 `backend/services/sector_aggregation.py`(新)
- 🟢 `backend/tests/test_sector_aggregation.py`(新)

### 實作要點
- API:
  ```python
  async def compute_sector_breadth(
      end_date: str,
      universe: set[str],
      lookback_days: int = 30,  # 20MA 需 30 day buffer
  ) -> list[SectorBreadthResult]

  async def compute_sector_volume_ratio(
      end_date: str,
      universe: set[str],
      avg_window: int = 20,
  ) -> list[SectorVolResult]
  ```
- Sector map 從 `services/concept_universe.py` reuse(若 concept-cluster spec P1 已實作),否則 P3 內 inline 從 FinMind IndustryChain industry 推
- 每股取 30 day daily close + volume,算 MA20 + vol_avg_20
- Sector 聚合:loop sector → loop members → count `close > MA20` / sum volume
- Cache:24 hr

### TDD 順序
1. test: 給 fixture 3 sectors × 5 stocks,期望 sector_breadth 正確 ratio
2. test: 缺 MA20 資料的股票 skip(分母排除)
3. test: 空 sector → skip
4. test: sector_volume_ratio 公式驗證

### 完成條件
- pytest 新增 ≥ 4 test 全綠
- `sector_breadth` / `sector_volume_ratio` 出現在 snapshot payload

### 不能破壞
- 既有 sectors(原 heatmap)payload 暫時並存(V2 雙軌 1 release)

---

## Phase 4 — Sector amount share(XQ 風格資金流向)

### 目標
每 sector「今日成交值佔大盤比 + Δ vs 20MA」表。

### 動的檔
- 🟢 `backend/services/sector_aggregation.py`(P3 同檔,加 method)
- 🔵 `backend/tests/test_sector_aggregation.py`(同檔加 test)

### 實作要點
- API:
  ```python
  async def compute_sector_amount_share(
      end_date: str,
      universe: set[str],
      avg_window: int = 20,
  ) -> list[SectorAmountResult]
  ```
- 每 sector:sum(turnover_value)/ sum(market total turnover);Δ = today - mean(past 20 days)

### TDD 順序
1. test: fixture 3 sectors,各 turnover 算對 share
2. test: Δ vs 20MA 計算正確(過去 20 天均值)
3. test: today 為新上市 sector(無歷史)→ share 算正常,Δ 標 N/A

### 完成條件
- pytest 新增 ≥ 3 test 全綠
- `sector_amount_share` 出現在 snapshot payload

---

## Phase 5 — Frontend MarketPage V2 重組

### 目標
改既有 `MarketPage.tsx` layout,新元件 + 既有 panel 並列(V2 不刪舊)。

### 動的檔
- 🔴 `frontend/src/components/MarketPage.tsx`(改 layout)
- 🟢 `frontend/src/components/MarketBreadthPanel.tsx`(新,McClellan + AD Line 趨勢圖)
- 🟢 `frontend/src/components/MarketSectorBreadthHeatmap.tsx`(新,取代既有 MarketHeatmap 或並列)
- 🟢 `frontend/src/components/MarketSectorAmountShare.tsx`(新)
- 🟢 `frontend/src/components/MarketSectorVolRatio.tsx`(新)
- 🟢 `frontend/src/lib/breadth-svg.tsx`(純 SVG renderer for McClellan / AD Line 趨勢圖)
- 🟢 `frontend/src/lib/sector-breadth-svg.tsx`(純 SVG renderer for heatmap)
- 🔵 `frontend/src/hooks/useMarketSnapshot.ts`(擴 ReturnType,加新欄位)
- 🟢 colocated `*.test.{ts,tsx}` 每檔一個

### 實作要點
- 既有 `MarketHeatmap` / `MarketLeaderboard` **保留 1 release**(雙軌)
- 新元件用 semantic token(`ink-accent` 漸層,**避開 bull/bear**)
- McClellan / AD Line 用純 SVG polyline + 訊號 dot,**無方向性文案**
- Sector breadth heatmap 點 sector 觸發 callback `onSectorClick(sector_id)`(供 concept-drill spec 接)
- UI 文字嚴禁方向性:`expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull()`

### TDD 順序
1. test: `breadth-svg.test.ts` — 給 30 點 series,render 出對的 polyline + 訊號 dot
2. test: `sector-breadth-svg.test.ts` — 給 5 sectors,render 5 個 rect with 對的 fill
3. test: `MarketBreadthPanel.test.tsx` — 顯示數值 + 訊號 dot,文案無方向性
4. test: `MarketSectorBreadthHeatmap.test.tsx` — 點 sector emit callback
5. test: `MarketSectorAmountShare.test.tsx` — 表格降序 + Δ 顏色
6. test: `MarketSectorVolRatio.test.tsx` — vol_ratio > 1.5 標 dot
7. test: `MarketPage.test.tsx` — 整合 5 panel + 舊 panel 並列

### 完成條件
- npm test 新增 ≥ 15 test 全綠
- npm run build 過
- 既有 `MarketPage.test.tsx` 全綠

### 不能破壞
- equity / options mode 完全不變

---

## Phase 6 — 真實環境驗證 + lessons

### 目標
chrome-devtools 真實截圖 + verification.md + changelog + CLAUDE.md §9 lessons learned。

### 動的檔
- 🟢 `docs/specs/market-monitor-v2/screenshots/*.png`
- 🟢 `docs/specs/market-monitor-v2/verification.md`
- 🟢 `frontend/src/lib/changelog.ts`(MINOR bump 0.18.x → 0.19.0)
- 🔵 `CLAUDE.md §9 Lessons Learned`(加 lesson)

### 步驟
1. 啟動 backend + frontend dev
2. chrome-devtools navigate `:5173`,切大盤 mode
3. 截圖:
   - 全 5 panel + 舊 panel 並列(整頁)
   - sector breadth heatmap hover 某 sector(展示 tooltip)
   - McClellan ±100 thrust dot(若該日無,用 historical day fetch)
   - sector amount share Δ 顏色
   - universe filter banner(顯示「已排除 N 檔」)
4. verification.md 對應每張截圖
5. changelog entry:
   ```ts
   { date: '2026-MM-DD', kind: 'feature', scope: 'global',
     text: '大盤掃描頁新增族群參與度、市場廣度、族群資金流向指標,並過濾掉 ETF / 權證 / 注意處置股' }
   ```
6. CLAUDE.md §9 lessons learned 預計加:
   - McClellan ratio-adjusted 在台股 1000 issues 跟美股 3000 issues 的閾值差異
   - Sector breadth 用 FinMind industry(32 大類)vs sub_industry 的 trade-off
   - 注意/處置股清單在 FinMind 是否有 dataset 的最終答案

### 完成條件
- 截圖 ≥ 5 張
- verification.md 完整
- changelog bump
- CLAUDE.md §9 加 ≥ 2 lesson

---

## 整體驗證 gate(收尾前)

- [ ] `cd backend && python -m pytest -q` 全綠(新增 ≥ 18 test)
- [ ] `cd frontend && npm test` 全綠(新增 ≥ 15 test)
- [ ] `cd frontend && npm run build` 過
- [ ] chrome-devtools 截圖 ≥ 5 張
- [ ] 大盤頁 5 個 panel 並列無 scroll(1440x900)
- [ ] universe filter banner 顯示排除數
- [ ] changelog bump
- [ ] CLAUDE.md §9 加 ≥ 2 lesson
- [ ] 三類 commit 分開(🟢 backend services / 🔴 frontend layout / 🔵 docs)

---

## 陷阱注意

- 既有 `MarketHeatmap` 不刪!V2 並列,1 release 後依用戶反饋決定移除時點(spec §10 self-audit)
- McClellan ±100 閾值是美股校準,台股應 P5 加 historical backtest 紀錄(spec §9 known gap)
- Sector breadth heatmap 色票**不**用 bull/bear 紅綠(避免跟 K 線色票混淆)
- `useMarketSnapshot` 擴 ReturnType 要 backward-compat(既有 caller 不 break)
- `_CACHE_VERSION` 不要因 market_breadth / sector_aggregation 而 bump(會廢掉既有 chip / options cache)
