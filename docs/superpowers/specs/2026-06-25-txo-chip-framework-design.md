# txo-chip-framework — Design Spec (v1)

> /feat slug: `txo-chip-framework` | Phase 0/1 artifact | 2026-06-25

## 0. 背景與來源

**Why this feature exists**:把目前 options 系統(只有大戶 OI strip + 量能 ladder)升級為完整的「日級籌碼觀察清單」,涵蓋研究檔的 4 個核心指標(Max Pain / OI Wall / PCR / 三大法人買賣權),並對每個指標附歷史 hit rate 監控以對沖反身性「公開即失效」風險。

**Sources**:
1. 主藍圖:`compass_artifact_wf-73a978b0...md`(研究檔,2025 Q1-Q2)
2. 2026-06-25 校準:`/deep-research` 多源同儕論文驗證(workflow `wqm7dpah3`)— 核心修正:
   - **PCR 採 Lo & Liu 2025**(PBFJ SSCI Q1, IF 5.4)高/低 PCR asymmetric switching 邏輯
   - **Gamma squeeze 敘事降溫**(Cboe 2025 同儕論文):做市商 gamma 多數時間 dampening 而非 amplifying → GEX 模組留 MVP2
   - FinMind sponsor tier 7 dataset 在 2026-06 全可用(v2.0.3 = 2026-06-15)

**Out of scope of this spec**:GEX / Vanna / Charm / IV / Skew / VIX / 即時 Tick / 多指標共振 / 失效告警 alert(留 MVP2/MVP3)。

## 1. 架構(High-level)

**設計原則**:沿用 trash-cmoney 既有 layered pattern,**不重構**(YAGNI)。新功能完全 additive,既有 `OptionsLargeTradersStrip` + `OptionsStrikeLadder` 不動。

```
┌─────────────────────────────────────────────────────────────┐
│ OptionsPage.tsx                                              │
│   - OptionsHeader (既有: 合約選擇 + 日期 + spot)              │
│   - ⬇️ OptionsChipPanel (NEW: 4 個指標卡片 grid)            │
│       ├─ OptionsMaxPainCard      (SC-1, SC-5)              │
│       ├─ OptionsOIWallsCard      (SC-2, SC-6)              │
│       ├─ OptionsPCRCard          (SC-3, SC-7)              │
│       └─ OptionsInstitutionalCard (SC-4, SC-8)             │
│   - OptionsLargeTradersStrip (既有, 不動)                    │
│   - OptionsStrikeLadder      (既有, 不動)                    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  (4 個獨立 hook, parallel fetch, failure isolation)
┌──────────────────────────────────────────────────────────────┐
│ FastAPI Backend                                              │
│   routes/options.py                                          │
│     - /api/options/max_pain          (NEW)                  │
│     - /api/options/oi_walls          (NEW)                  │
│     - /api/options/pcr               (NEW)                  │
│     - /api/options/institutional     (NEW)                  │
│   services/finmind.py                                        │
│     - fetch_max_pain (含 OI 全履約價 + N 期 hit-rate fanout) │
│     - fetch_oi_walls (含 ΔOI + N 期 hit-rate)               │
│     - fetch_pcr (含 90 天 lookback)                         │
│     - fetch_institutional (日盤 + 夜盤)                      │
│   services/finmind_options.py                                │
│     - parse_max_pain / parse_max_pain_hit_rate              │
│     - parse_oi_walls / parse_oi_walls_hit_rate              │
│     - parse_pcr / parse_pcr_backtest                        │
│     - parse_institutional / parse_institutional_corr        │
└──────────────────────────────────────────────────────────────┘
        │
        ▼  (FinMind sponsor tier datasets)
TaiwanOptionDaily + TaiwanOptionInstitutionalInvestors[AfterHours] +
TaiwanFuturesDaily(TX 算次日報酬) +
TaiwanOptionFinalSettlementPrice(算 Max Pain hit rate)
```

**Cache 版本**:bump `_CACHE_VERSION_OPTIONS` from 1 → 2(parser schema 變動)。每個 endpoint 獨立 cache key,失敗隔離。

**Lazy + cache 策略**:hit rate 抓 90 天歷史 → 冷啟動慢(~30-90 sec / endpoint due to FinMind 單日限制 + token bucket serialize)。第二次後 cache hit ~30 ms。**MVP1 不做 backfill job**,user 第一次打開承擔 cold load。前端在每個卡片獨立顯示 loading skeleton。

## 2. Components(逐項合約)

### 2.1 Backend Routes(`backend/routes/options.py`)

四個新 endpoint,沿用既有 `_resolve_contract` + `_is_stale_for_requested` + `HTTPException(detail={"error": "..."})` 慣例。

#### `GET /api/options/max_pain`
- **Query params**:`contract` (required, e.g. `TXO202607`), `date` (optional, default today), `refresh` (optional bool), `lookback` (optional int, default 20 = N 期 hit-rate 樣本)
- **Returns**:
  ```ts
  {
    contract: string,
    date: string,
    fetched_at: string,
    as_of_date: string,
    no_trading_day?: boolean,
    current: {
      max_pain: number,                    // Max Pain 履約價
      total_loss: number,                  // 該 K 的總賠付
      strike_count: number                 // 計算用的履約價數
    },
    hit_rate: {                            // 過去 N 期結算日的回測
      samples: number,                     // 實際樣本數(可能 < lookback)
      median_abs_deviation_pct: number,    // |結算價-Max Pain|/結算價 中位數
      hit_within_1pct: number,             // ±1% 命中率
      hit_within_2pct: number,             // ±2% 命中率
      history: Array<{ date, max_pain, settlement, deviation_pct }>
    } | null,                              // null 若樣本不足
    insufficient_data?: { reason: string, required_days: number }
  }
  ```

#### `GET /api/options/oi_walls`
- **Query params**:`contract`, `date`, `refresh`, `lookback`(default 20), `delta_window`(default 5,動態 Wall 用幾日 ΔOI)
- **Returns**:
  ```ts
  {
    contract: string, date: string, fetched_at: string, as_of_date: string,
    no_trading_day?: boolean,
    current: {
      static_call_wall: { strike: number, oi: number },
      static_put_wall: { strike: number, oi: number },
      dynamic_call_wall: { strike: number, delta_oi: number },  // 過去 delta_window 日 ΔOI 最大的 call strike
      dynamic_put_wall: { strike: number, delta_oi: number },
      band_width_pct: number              // (static_call - static_put) / spot
    },
    hit_rate: {
      samples: number,
      pct_settled_inside_band: number,    // 結算價在 [put_wall, call_wall] 區間的比例
      avg_band_width_pct: number,
      history: Array<{ date, put_wall, call_wall, settlement, inside_band }>
    } | null,
    insufficient_data?: { ... }
  }
  ```

#### `GET /api/options/pcr`
- **Query params**:`date`, `refresh`, `scope`(`per_contract` | `all_months`, default `all_months`), `contract`(僅當 scope=per_contract 必填), `lookback`(default 90)
- **Returns**:
  ```ts
  {
    date: string, fetched_at: string, as_of_date: string,
    scope: "per_contract" | "all_months",
    contract?: string,                    // 僅當 scope=per_contract
    no_trading_day?: boolean,
    current: {
      pcr: number,                        // 未平倉 PCR = Σ Put OI / Σ Call OI
      percentile: number,                 // 在 lookback 視窗的分位 (0-100)
      region: "high" | "neutral" | "low", // P70+ | else | P30-
      strategy_hint: string               // "高 PCR 區 → 滿倉做多" / "中性 → 觀望" / "低 PCR 區 → 賣選收 income"
    },
    backtest: {                           // 90 天 Lo & Liu 模擬
      samples: number,
      high_region_avg_next_day_return: number,  // 高 PCR 日次日 TX 報酬均值
      low_region_avg_next_day_return: number,
      neutral_region_avg_next_day_return: number,
      cumulative_strategy_pnl: Array<{ date, pnl }>,  // 累計曲線
      sharpe: number | null                          // 樣本不足時 null
    } | null,
    insufficient_data?: { ... }
  }
  ```

#### `GET /api/options/institutional`
- **Query params**:`date`, `refresh`, `lookback`(default 60), `corr_window`(default 30)
- **Returns**:
  ```ts
  {
    date: string, fetched_at: string, as_of_date: string,
    no_trading_day?: boolean,
    current: {
      foreign: { call_net: number, put_net: number, total_net: number, day_change: number },
      prop: { ... },
      trust: { ... },
      session_breakdown: {
        day_session: { foreign: {...}, prop: {...}, trust: {...} },
        after_hours: { ... }
      }
    },
    correlation: {                       // 過去 lookback 日,corr_window rolling
      samples: number,
      latest_corr: number,               // 外資 Call Net 變動 vs 次日 TX 報酬 Spearman corr
      history: Array<{ date, corr }>,    // rolling 折線
      is_stale: boolean                  // |corr| < 0.1 視為失效
    } | null,
    insufficient_data?: { ... }
  }
  ```

### 2.2 Backend Services(`backend/services/`)

#### `finmind_options.py` — 新增 parser(純函式,可獨立單測)
- `parse_max_pain(rows: list[dict], contract_date: str) -> dict` — Max Pain 演算法
- `parse_max_pain_hit_rate(rows_by_date: dict[str, list[dict]], settlements: dict[str, float]) -> dict`
- `parse_oi_walls(rows_today: list[dict], rows_history: list[dict], contract_date: str, delta_window: int) -> dict`
- `parse_oi_walls_hit_rate(rows_by_date: dict, settlements: dict) -> dict`
- `parse_pcr(rows: list[dict], scope: str, contract: str | None) -> float`
- `parse_pcr_history(rows_by_date: dict, scope: str) -> list[tuple[str, float]]`
- `parse_pcr_backtest(pcr_history: list[tuple], tx_returns: dict[str, float]) -> dict`
- `parse_institutional(rows_day: list[dict], rows_night: list[dict]) -> dict`
- `parse_institutional_correlation(history: list[dict], tx_returns: dict, corr_window: int) -> dict`

**Max Pain 演算法**(SC-1 驗證):
```python
def parse_max_pain(rows, contract_date):
    # 1. Filter to contract_date + option_id == "TXO"
    # 2. Group by strike: collect (strike, call_oi, put_oi) — include all strikes with OI > 0 (even volume = 0)
    # 3. Build candidate K set = sorted unique strikes
    # 4. For each candidate K:
    #      loss(K) = sum(call_oi_i * max(K - K_i, 0)) + sum(put_oi_i * max(K_i - K, 0))
    # 5. Return K* with min loss(K), plus total_loss(K*) and strike_count
```

**注意**:`parse_strike_volume` 已抓 OI 但 drop volume=0 → Max Pain **不能直接複用**。需要新 parser 或修改既有 parser 加 `include_zero_volume` flag。設計選擇:新 parser(隔離,不動既有)。

**OI Wall 雙標**(SC-2):
- Static:max(call_oi) per side
- Dynamic:對每個 strike,delta_oi = oi_today - oi_(today - delta_window 交易日);max(abs(delta_oi)) per side

**PCR 分位**(SC-3, Lo & Liu):
- 當前 PCR vs 90 天歷史的 percentile
- region 切點:P70 / P30(可調)

#### `finmind.py` — 新增 `FinMindClient.fetch_*` 方法
四個 fetch 方法各自 cache,沿用既有 `_read_cache_v` / `_write_cache_v`,key 格式:
- `max_pain_{contract}_{date}_lb{lookback}`
- `oi_walls_{contract}_{date}_lb{lookback}_dw{delta_window}`
- `pcr_{scope}_{contract or 'all'}_{date}_lb{lookback}`
- `institutional_{date}_lb{lookback}_cw{corr_window}`

**注意**:每個 fetch 內部要平行抓 90 天歷史。FinMind `TaiwanOptionDaily` 單次只給一天 → fan-out 90 個 single-date call,token bucket 自動 serialize 到 5 req/sec(預設)。冷啟動上限 = `90/5 = 18 sec`(僅 OI 系列;institutional / TX returns 也類似)。

**OI Wall 的 delta 算法**:抓 `today` 與 `today - delta_window` 兩天即可(不是 5 天連續),減少 fetch 量。Hit rate 才需要 90 天。

### 2.3 Frontend(`frontend/src/`)

#### Hooks(`hooks/useOptions*.ts`)
四個新 hook,沿用既有 TanStack Query 模板(看 `useOptionsLargeTraders.ts` 為樣板):
- `useMaxPain(contract, date)`
- `useOptionsOIWalls(contract, date)`
- `useOptionsPCR(date, scope, contract?)`
- `useInstitutionalOptions(date)`

統一回傳:`{ data, loading, error, refresh, noTradingDay }`(專案慣例)。每個 hook 自帶 force-refresh ref(用 `?refresh=true`)。

#### Components(`components/`)
- `OptionsChipPanel.tsx` — container,4 個子卡片 grid(`grid-cols-1 md:grid-cols-2 xl:grid-cols-4`),各自獨立 loading/error skeleton
- `OptionsMaxPainCard.tsx` — 顯示 Max Pain + 乖離 % + 底部 hit rate 直方圖(`OptionsHitRateChart`)
- `OptionsOIWallsCard.tsx` — 顯示 4 個 wall(2 static + 2 dynamic)+ band width % + hit rate
- `OptionsPCRCard.tsx` — 顯示當前 PCR + percentile bar + region tag(高/中/低 三色 chip)+ Lo & Liu backtest mini chart
- `OptionsInstitutionalCard.tsx` — 3 家並列(grid-cols-3),外資加粗 + bg-accent/10 highlight + 底部 correlation rolling 折線
- `OptionsHitRateChart.tsx` — 共用 SVG 元件,純函式,接受 `history: Array<{ date, value }>` + 視覺型別

#### lib
- `lib/options-api.ts` — 加 4 個 `optionsApi.maxPain() / .oiWalls() / .pcr() / .institutional()`
- `lib/options-types.ts` — 加對應 TS interfaces(對應 backend 回傳 shape)
- `lib/options-chip-svg.tsx` — 純函式 SVG 計算:`maxPainBars()`, `pcrPercentileBar()`, `corrLine()`, `hitRateHistogram()`

### 2.4 OptionsPage 整合
```tsx
<OptionsPage>
  <OptionsHeader ... />
  <NoTradingDayBanner ... />
  <OptionsChipPanel contract={contractId} date={date} />  {/* NEW */}
  <OptionsLargeTradersStrip ... />                          {/* 既有, 不動 */}
  <OptionsStrikeLadder ... />                              {/* 既有, 不動 */}
</OptionsPage>
```

## 3. Data flow

**正常流(user 切合約 / 日期):**
1. `OptionsPage` state 更新 `contractId` / `date`
2. 4 個 hook 同時 invalidate(共享 query key 依賴)→ 並行打 4 個 endpoint
3. 每個 endpoint:check cache(version 2) → cache hit 直接回 / cache miss 跑 FinMind fan-out → cache write
4. 前端 4 個卡片各自獨立 render,有資料的先顯示、其他 loading skeleton

**Refresh 流**:點任一卡片 refresh button → 該 hook 帶 `?refresh=true`,backend 跳 cache 重抓。其他卡片不受影響(各自 hook 獨立)。

**Hit rate cache 策略**:90 天歷史 fetch 慢但變動小 → cache TTL 拉長(預設 60 分鐘 vs 即時資料 15 分鐘)。具體 TTL 在 Phase 2 文件化。

## 4. 指標演算法細節(逐 SC 對應)

### 4.1 Max Pain(SC-1)
```
For each candidate K in {all strikes with OI > 0}:
  loss(K) = Σ_i call_oi_i × max(K - K_i, 0) × 50    # multiplier 50, but cancels in argmin
         + Σ_j put_oi_j × max(K_j - K, 0) × 50
return K* = argmin(loss(K))
```
- 用 `TaiwanOptionDaily` 抓 contract_date == 當前合約的所有 strikes(包含 volume = 0 但 OI > 0)
- 乘數 50 在 argmin 中可省略,但 total_loss 需要回傳實際金額供 UI 顯示「賣方總賠付金額」

### 4.2 OI Wall(SC-2)
- **Static**:對當期合約 today 的 OI:`call_wall = strike with max call_oi`, `put_wall = strike with max put_oi`
- **Dynamic**:
  - 抓 today 與 (today - delta_window 交易日) 兩天的 OI per strike
  - `delta_oi_i = oi_today_i - oi_history_i`
  - `dynamic_call_wall = strike with max |delta_oi| where put_call == "call"`
  - `dynamic_put_wall = strike with max |delta_oi| where put_call == "put"`
- 視覺差異:UI 上 static = 實心 marker、dynamic = 虛線 marker

### 4.3 PCR(SC-3, Lo & Liu 邏輯)
```
PCR_t = Σ_{contract in scope} Σ_{strike} put_oi_{t,strike,contract}
      / Σ_{contract in scope} Σ_{strike} call_oi_{t,strike,contract}

history = [PCR_(t-89), PCR_(t-88), ..., PCR_t]            # 90 天
percentile_t = percentileofscore(history, PCR_t)          # 0-100
region_t = "high" if percentile_t >= 70
         else "low" if percentile_t <= 30
         else "neutral"
```
- scope:
  - `per_contract`:單一合約(monthly / weekly)的 OI
  - `all_months`:全 TXO 所有合約合計(更穩定,Lo & Liu 樣本實際做法)

### 4.4 PCR Backtest(SC-7)
對 90 天每日:
- 高 PCR 日 → 「滿倉做多 TX」次日報酬 = (TX_close_(t+1) - TX_close_t) / TX_close_t
- 低 PCR 日 → 「賣 ATM straddle」近似報酬 = -|TX_close_(t+1) - TX_close_t| / TX_close_t * leverage_factor(MVP1 簡化為固定 1.0,真實值依 straddle premium 動態,留 MVP2 精算)
- 中性 → 報酬 = 0
- 累計 P&L 曲線、Sharpe = mean(daily_returns) / std(daily_returns) × √252

**注意**:這是「近似 backtest」,真實 P&L 需 straddle 報價 + transaction cost,MVP1 不深究。UI 文字註明「近似估算」。

### 4.5 三大法人 Net(SC-4)
- `TaiwanOptionInstitutionalInvestors`(日盤)+ `TaiwanOptionInstitutionalInvestorsAfterHours`(夜盤)
- per institution per side(call/put):`net = buy_oi - sell_oi`
- session_breakdown 分日盤 / 夜盤
- 主面板顯示合計;展開 toggle 顯示日夜盤拆分

### 4.6 外資 correlation(SC-8)
- 抓過去 lookback 日(預設 60)的外資 Call Net + Put Net + TX_close
- `delta_call_net_t = call_net_t - call_net_(t-1)`
- `next_day_return_t = (TX_close_(t+1) - TX_close_t) / TX_close_t`
- rolling Spearman correlation,window = corr_window(預設 30)
- UI 顯示 rolling 折線 + 最新值;|corr| < 0.1 視為「目前無預測力」(視覺淡化)

## 5. Error handling

**所有錯誤走既有 `routes/options.py` 的 global handler pattern**(7P refactor 後 hoist 到 `main.py` 的 `@app.exception_handler`):
- 502:`httpx.HTTPStatusError` / `httpx.ConnectError` / `httpx.TimeoutException`(FinMind 故障)
- 503:`FinMind 未就緒`(env 缺 token)
- 400:`HTTPException(400, detail={"error": "missing_contract"})` 等
- 404:contract 不在 `list_active_contracts` 結果中
- 500:純 `logger.exception` + 500 generic

**前端錯誤呈現**:每個卡片獨立 catch error,失敗顯示「指標載入失敗 + 重試 button」,**不阻擋其他卡片**。

**Edge case 對應**:
- `no_trading_day` 沿用既有 `_is_stale_for_requested` 偵測;前端統一暴露 `noTradingDay` boolean,UI 顯示 banner + 卡片中性化(灰底)
- `insufficient_data`(歷史 < N 期)→ hit rate 區塊顯示「資料不足,需 X 天」灰底訊息,**不算 error**

## 6. Testing strategy

### 6.1 Backend(`backend/tests/`)
- **Pure parser tests**(`test_finmind_options.py` 擴充):
  - `TestParseMaxPain` — 演算法正確性 + 邊界(零 OI / 單一履約價 / 對稱分布)
  - `TestParseMaxPainHitRate` — 樣本不足 / 全命中 / 全 miss
  - `TestParseOIWalls` — static + dynamic 雙標
  - `TestParseOIWallsHitRate`
  - `TestParsePCR` — scope = per_contract / all_months
  - `TestParsePCRBacktest` — region classify + Sharpe
  - `TestParseInstitutional` — 日盤 + 夜盤合併
  - `TestParseInstitutionalCorrelation` — rolling Spearman
- **Integration tests**(mock httpx, `monkeypatch`):
  - `TestFetchMaxPain` — cache miss + cache hit + 90 天 fanout
  - 其他 fetch_* 各 1-2 case
- **Route tests**(`test_options_routes.py` 擴充):
  - 4 個 endpoint 的 happy path + missing param + invalid contract + 502 propagation + no_trading_day flag + insufficient_data flag
  - `TestFailureModes`:其中 1 個 endpoint 失敗,其他不受影響(failure isolation,在 Frontend integration test 驗)

### 6.2 Frontend(`frontend/src/__tests__/`)
- **Pure SVG renderer tests**(`lib/options-chip-svg.test.ts`):
  - `maxPainBars()` 對固定輸入產出固定 SVG 結構
  - `pcrPercentileBar()` 對 0/50/100 分位產出 region 標
  - `corrLine()` 對 NaN / null / 正常陣列
  - `hitRateHistogram()` 對 empty / single / multi 樣本
- **Hook tests**(`hooks/use*.test.ts`,RTL + MSW):
  - 4 hook 各 happy path + error path + refresh trigger
- **Component tests**(`components/Options*.test.tsx`):
  - 4 卡片各 happy / loading / error / insufficient_data
  - `OptionsChipPanel` 整合 — 4 卡片獨立 loading state
- **E2E(DevTools MCP)**:
  - 開 `/options`,截圖確認版面層次
  - 切合約 → 新 panel 跟著刷新
  - 選非交易日 → no_trading_day banner + 卡片中性化
  - 模擬 1 個 endpoint 502 → 該卡片 error,其他正常

### 6.3 Verification commands(`auto-verify` 走專案 CLAUDE.md §1)
- `backend/`: `python -m pytest -q`
- `frontend/`: `npm test`(vitest run)+ `npm run build`(tsc -b + vite build)
- Lint: `cd backend && ruff check .` + `cd frontend && npm run lint`
- Type check(backend): `cd backend && pyright`

Phase 5 gate:四項全綠才進 Phase 6 真實環境驗證。

## 7. 反身性對沖設計(meta)

deep-research 校準後加入的設計準則(貫穿所有指標):
1. **不直接給看多看空訊號** — UI 顯示「指標讀數 + 歷史 hit rate + 分位脈絡」,user 自行判讀
2. **hit rate 監控隨指標常顯** — 每卡片底部固定 panel,不是 modal,讓「指標可能失效」進入第一眼視野
3. **PCR 採 Lo & Liu 邏輯**(2025 最新同儕論文)— 不採研究檔的混雜雙模型
4. **不過度浪漫化** — 沒有 Gamma squeeze 警報(MVP1 沒 GEX)、沒有「強烈訊號」字眼
5. **MVP2/MVP3 接續**:GEX 加進來後同樣維持「指標 + hit rate」原則,不變成 alert 系統

## 8. Known Risks(未解決,寫入 Phase 1 review 議題)
- **R1**:Lo & Liu 樣本期間未明,可能已被市場吃掉。MVP1 上線後需自做 TXO 2022-2025 backtest 確認 PCR alpha 仍存
- **R2**:Max Pain SPX 100 expirations 顯示 high-vol 期命中率僅 29%(advancedautotrades blog) — 本實作的 hit rate 即用來監控此衰減
- **R3**:夜盤法人資料起始日(2021-10?)deep-research 沒驗證通過 → 抓 lookback=60 天不會碰到歷史邊界,但 lookback > 1 年時可能 fail
- **R4**:外資 correlation rolling Spearman 對 60-90 天樣本可能不穩 → MVP1 顯示「樣本數」讓 user 判斷,Phase 2 評估是否要加 bootstrap 信心區間

## 9. 跨檔契約(對應專案 CLAUDE.md §4)
- API error JSON shape:`{ "detail": { "error": "<code>" } }`(既有,不變)
- `no_trading_day` flag:沿用既有,4 個 endpoint payload 都帶
- Refresh:`?refresh=true` query 跳 cache(既有)
- Cache version:bump `_CACHE_VERSION_OPTIONS` 1 → 2
- Contract ID:沿用 flat ID 格式 `TXO202607` / `TXO202607W2` / `TXO202607F1`

## 10. Changelog
- **v1** (2026-06-25):初版,涵蓋 SC-1 ~ SC-10
