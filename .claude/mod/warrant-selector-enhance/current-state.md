# current-state — mod/warrant-selector-enhance(Phase 1,2026-07-14)

依據:docs/research/warrant-selection.md(deep-research + 時效性審計)。Baseline:backend 702 passed / 1 skipped;frontend 81 檔 / 755 tests 全綠(2026-07-14 12:49)。

## 1. 現況資料鏈(事實,含行號)

### Selector 鏈
- `backend/services/warrants.py:501` `get_underlying_warrants(stock_id, refresh)` → `{"as_of_date", "warrants":[WarrantTerm...]}`;`:514` merge `iv_drift` label(shallow copy,不烙快照)。
- `backend/routes/warrants.py:44-53` `GET /api/warrants/{stock_id}`;`:56-63` `GET .../quotes`(盤中五檔+計算欄);`:82-91` `GET .../flow`。
- frontend:`lib/api.ts:224-238`(warrants / warrantQuotes,quotes 恆 noCache)→ `hooks/useWarrants.ts` + `useWarrantQuotes.ts`(15s 輪詢)→ `components/WarrantSelector.tsx:79`(同掛 useWarrants + useWarrantQuotes + useWarrantBrokers)。
- 合成列:`WarrantRow = WarrantTerm & Partial<WarrantQuote>`(`lib/warrant-data.ts:66`),`mergeWarrantRows`(`lib/warrant-utils.ts:120`)以 warrant_id join。

### 欄位清單
- `WarrantTerm`(terms 端點):warrant_id / name / kind / market / underlying_id / underlying_name / strike / exercise_ratio / last_trading_date / maturity_date / is_reset / eod_close / eod_bid / eod_ask / underlying_eod_close / iv_prev / iv_drift。
- `WarrantQuote`(quotes 端點):price / best_bid / best_ask / best_bid_vol / best_ask_vol(僅第一檔,`warrant_quotes.py:130-137`)/ moneyness / **days_left(日曆日**,`warrant_quotes.py:178`,基準 last_trading_date)/ iv / delta / leverage / spread_ratio(=(ask−bid)/bid,`:206`)/ spread_lev_ratio(差槓比,`:208`)/ theo_price / mispricing_pct / mispricing_label / iv_percentile / quote_time。

### 篩選器現況(全前端)
- `WarrantFilters`(`lib/warrant-utils.ts:12-32`):kind / minDaysLeft / moneynessMin·Max / mispricingMin·Max / ivPctlMax / requireBidVol。
- `filterWarrants`(`:36-66`):啟用中 filter 對 null 欄位一律剔除。排序預設 spread_lev_ratio asc。
- **spread_ratio / spread_lev_ratio 目前只是顯示欄+排序鍵,不是篩選條件**。
- Backend 無篩選參數(照舊,本次不動)。

### iv_history / drift
- 每日 archive `warrant_iv_history/{date}.json`:per wid `{b,a,c,s,ivb,iva}`(`warrant_iv_history.py:221-232`);讀取窗 60 檔、保留 90(`:38-39`)。
- `warrant_iv_drift_latest.json`:`{built_from:[dates], drift:{wid:{label,slope_bid,slope_ask,n_valid}}}`(`:292-298`)。
- drift 演算法:Theil-Sen + consistency,60 日窗(`warrant_iv_drift.py`)— **非官方「兩週 std」**;兩者是不同統計量(趨勢斜率 vs 波動度),本次新模組用官方口徑另算,不動 drift。

### flow(分點)
- per-warrant 層欄位:warrant_id / name / kind / trading_money / net_value(`warrant_flow.py:264-273`)。
- cache `warrant_flow_{stock_id}_{date}.json`;fan-out FinMind cap 200(首抓貴,之後 per (stock,date) cache 命中)。
- 前端 `useWarrantFlow(stockId, active)` queryKey `["warrant-flow", stockId]` — 與 selector 不同 tab、不同 hook,**共 queryKey 可天然共享 TanStack cache**。

### 發行商對映(Phase 1 新 probe,2026-07-14)
- **TWSE `t187ap36_L`**:出表日期/發行人代號/發行人名稱/權證代號/名稱/標的代號/標的名稱/申請發行日期,54,321 rows,零配額。
- **TPEx `mopsfin_t187ap36_O`**:同 schema,17,351 rows,發行人名稱已是簡稱(「第一金」)。
- TWSE 版發行人名稱是全稱(「第一金證券股份有限公司」)→ 需簡稱正規化(顯示用)。
- 現有 code **無任何 issuer 欄位**;t187ap37_L / tpex_warrant_issue 皆無發行人欄(probe 確認)。

## 2. Caller map(動哪裡會影響誰)

- `get_underlying_warrants`:routes/warrants.py:49、warrant_quotes.py:290、tests × ~30 處(test_warrants_service / routes / quotes monkeypatch)。**本次不改 signature,只可能加回傳欄位** → caller 全部向後相容。
- `WarrantFilters` / `filterWarrants`:WarrantSelector.tsx + warrant-utils.test.ts。**加欄位 = 🟢**;既有鍵不動。
- `WarrantRow` 型別:WarrantSelector.tsx / warrant-utils.ts / 測試。加 optional 欄位向後相容。
- e2e:equity.spec.ts 權證 tab(E9/E12/E13/E14 + 6 檔 count)、no-trading-day.spec.ts NTD2;selectors.ts 的 warrant-row 等 testid。**新增 badge/欄不得破壞既有 selector 斷言**。
- 新 service(issuer rank)= 純新增,無既有 caller。

## 3. 現況 vs 目標

| # | 目標 | 現況 | 改法(粗) | 對 caller 影響 | compat |
|---|---|---|---|---|---|
| 1 | 發行商信任排行 | 無 issuer 概念 | 新 service `warrant_issuers.py`:抓 36_L/36_O 對照(月級 cache)+ 讀 iv_history 60 日 archive 算 per-issuer 指標(兩週 bid-IV std 中位數 / declining 占比 / 價差比中位數)+ 新 route `GET /api/warrants/issuers/rank` + 前端新面板 | 無既有 caller | 純新增 |
| 2 | 波段 preset | 無 preset 概念 | 前端:`WARRANT_PRESETS` 常數(帶來源+日期)+ preset 按鈕套 filters;需先有 #5 的新 filter 鍵 | WarrantFilters 加鍵 | 加欄位 |
| 3 | 出場懸崖 badge | days_left 有(日曆日) | 前端 badge:days_left ≤ 21 日曆日(≈15 交易日 proxy,標注法規口徑)| WarrantRow 顯示層 | 純新增 |
| 4 | 近售罄 badge | best_ask/best_ask_vol 有 | 前端 badge:ask 缺 + bid 在 → 近售罄;懸崖區內抑制(confounder) | 顯示層 | 純新增 |
| 5 | 價差比/差槓比升級可篩 + 分點欄 | 只是顯示欄;flow 另一 tab | filters 加 spreadRatioMax / slrMax / minAskPrice;selector 內 join flow per-warrant net_value(共用 queryKey) | filterWarrants 加分支 | 加欄位 |

## 4. Backward compat / 風險清單

- 全部改動 = 加欄位 / 加分支 / 新檔;無 signature 變更、無 migration、無 cache version bump 需求(issuer 對照是新 cache 檔自帶版本)。
- 既有測試預期:**零紅**(無 🔴 類);新測試全 🟢。唯一 🔵 候補:無(不順手重構)。
- 風險 1:selector 內 join flow → 首次觸發 FinMind fan-out(cap 200/stock)的時機與配額(**Phase 2 待決策:自動 or 手動載入**)。
- 風險 2:issuer rank 讀 60 日 archive × 全市場權證,計算成本(iv_history rebuild 已有先例:26,248 序列可跑)→ 沿用 lazy + 檔 cache + 背景 rebuild 模式。
- 風險 3:TWSE 發行人全稱→簡稱正規化表(顯示用);寧可顯示全稱截斷也不硬編猜測。
- 風險 4:e2e fixtures 需補 36_L/36_O FAKE 檔(e2e-conventions:FAKE 三層)。

## 5. E2E 判準(e2e-conventions 預判,Phase 2 定案)

- 新 tab/panel(發行商排行)+ selector 新篩選鍵 + badge → 屬「使用者可感新功能」,grey zone 預設需要:E# selector 相關 spec 增量 + fixtures 補 36_L/36_O。
