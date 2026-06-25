# txo-chip-framework — Design Spec (v2)

> /feat slug: `txo-chip-framework` | Phase 0/1 artifact | v1 2026-06-25 → v2 2026-06-26

## Changelog
- **v1** (2026-06-25):初版,涵蓋 SC-1 ~ SC-10
- **v2** (2026-06-26):Phase 1 round 1 3-lens adversarial review 後重寫(41 findings,12 P0 + 16 P1 + 13 P2)。詳見 `.claude/feat/txo-chip-framework/design-review-round-1.json`。重點變更:
  - 修 5 條 P0 correctness:Max Pain 履約價 union、strict contract_date 過濾、hit rate 用 T-1 避免 look-ahead、PCR percentile walk-forward 避免 look-ahead、PCR 移除方向性 strategy_hint(改 stat panel)
  - 修 4 條 P0 integration:不 bump 既有 `_CACHE_VERSION_OPTIONS`,新增 `_CACHE_VERSION_OPTIONS_CHIP=1`;PCR 共用 fetch;`prop` → `dealer`;test class 命名對齊
  - 修 3 條 P0 testability:新增 SC-0(schema probe)、SC-10b(failure isolation E2E)、SC-11(data quality warnings)
  - 大幅修改 SC-7:降級為「次日 TX 報酬統計」(放棄 leverage=1.0 的偽 backtest)
  - 加 §6.0 fixture 規格、§9.1 Contract Type Matrix、調整 §1 cold-load math

## 0. 背景與來源

**Why this feature exists**:把目前 options 系統(只有大戶 OI strip + 量能 ladder)升級為完整的「日級籌碼觀察清單」,涵蓋研究檔的 4 個核心指標(Max Pain / OI Wall / PCR / 三大法人買賣權),並對每個指標附歷史 hit rate 監控以對沖反身性「公開即失效」風險。

**Sources**:
1. 主藍圖:`compass_artifact_wf-73a978b0...md`(研究檔,2025 Q1-Q2)
2. 2026-06-25 校準:`/deep-research` 多源同儕論文驗證(workflow `wqm7dpah3`)— 核心修正:
   - **PCR 採 Lo & Liu 2025**(PBFJ SSCI Q1, IF 5.4)— 但**僅作為文獻引用**,**不在 UI 推送方向性訊號**;MVP1 只呈現「分位 + 次日 TX 報酬統計」,user 自行判讀
   - **Gamma squeeze 敘事降溫**(Cboe 2025 同儕論文):做市商 gamma 多數時間 dampening 而非 amplifying → GEX 模組留 MVP2
   - FinMind sponsor tier 7 dataset 在 2026-06 全可用(v2.0.3 = 2026-06-15)
3. 2026-06-26 Phase 1 round 1 adversarial 3-lens review(`design-review-round-1.json`)

**專案慣例承襲**(已在 `CLAUDE.md` 文件化):
- §7 P0 採 TanStack Query,新 hook 不寫 `seqRef`(本 spec 沿用)
- §3 hidden attribute > 條件 render(本 spec 沿用)
- §3 紅 = up / 綠 = down(台股慣例),不套美股配色

**Out of scope of this spec**:GEX / Vanna / Charm / IV / Skew / VIX / 即時 Tick / 多指標共振 / 失效告警 alert / refresh 防 stampede(留 MVP2/MVP3,詳 §8 R7)。

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
│     - fetch_max_pain / fetch_oi_walls / fetch_pcr            │
│     - fetch_institutional                                    │
│     - 共用 fetch_taiwan_option_daily_window (NEW): N 天      │
│       TaiwanOptionDaily 一次抓 + cache,供 max_pain/oi_walls/│
│       pcr 三 endpoint reuse,避免重複 fan-out                │
│   services/finmind_options.py                                │
│     - parse_max_pain / parse_max_pain_hit_rate              │
│     - parse_oi_walls / parse_oi_walls_hit_rate              │
│     - parse_pcr / parse_pcr_history / parse_pcr_stats       │
│     - parse_institutional / parse_institutional_corr        │
│   utils/trading_calendar.py (NEW)                            │
│     - get_trading_days(end_date, n) → [date, ...]           │
│       derived from TaiwanFuturesDaily presence              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼  (FinMind sponsor tier datasets)
TaiwanOptionDaily(全契約全履約價 OI/量,1 call/day) +
TaiwanOptionInstitutionalInvestors[AfterHours](日盤 / 夜盤法人) +
TaiwanFuturesDaily(TX 算次日報酬 + 交易日推算) +
TaiwanOptionFinalSettlementPrice(算 hit rate)→ SC-0 probe 先驗
```

**Cache 版本**(F1-integration 修正):
- 既有 `_CACHE_VERSION_OPTIONS = 1` **不動**(舊 endpoint 的 cache 不失效)
- 新增 `_CACHE_VERSION_OPTIONS_CHIP = 1` 供 4 個新 endpoint 使用
- 兩者隔離;讀寫 helper 沿用 `_read_cache_v(key, version)` / `_write_cache_v(key, payload, version)`

**Cold-load math 校正**(F8-correctness + F11-integration):
- 4 個 endpoint 共用單一 `_fm_limiter` token bucket(目前 5 req/s,**Phase 2 前須 verify 真實 FinMind sponsor 限制**)
- **若全 4 個各自 fan-out 90 天**:4 × 90 = 360 calls / 5 req/s = **72 秒**(serialized through shared bucket)
- **優化**:共用 `fetch_taiwan_option_daily_window` 把 90 天 TaiwanOptionDaily 抓一次,供 max_pain/oi_walls/pcr 三 endpoint 從同一 cache key 讀取 → fan-out 降到 90 calls = 18 秒;institutional 自己抓 60 天 → 12 秒
- 兩 endpoint 並行 → cold load ~30 秒(視 bucket 飽和度)
- **不阻擋其他卡片**:institutional fetch 完先顯示;max_pain/oi_walls/pcr 依序解鎖

**Lazy 載入**(F8-integration 補):4 個新卡片**不**個別 lazy split(同頁同時顯示,split 沒效益)。`OptionsChipPanel` 隨 `OptionsPage` 整 chunk 載入。可接受 chunk 略增。

## 2. Components(逐項合約)

### 2.1 Backend Routes(`backend/routes/options.py`)

四個新 endpoint。沿用 `_resolve_contract` + `_is_stale_for_requested` + `HTTPException(detail={"error": "..."})`。

#### `GET /api/options/max_pain`
- Query:`contract` (required), `date` (optional), `refresh` (optional), `lookback` (optional int, default 20 settlement samples)
- Returns:
  ```ts
  {
    contract: string, date: string, fetched_at: string, as_of_date: string,
    no_trading_day?: boolean,
    current: {
      max_pain: number,                    // 整數履約價
      total_loss_ntd: number,              // = (Σ ...) × 50 (NTD, 含乘數)
      strike_count: number,
      strikes_with_call_oi_only: number,   // 透明資訊:多少履約價只有 call OI
      strikes_with_put_oi_only: number     // (深 OTM 常見)
    },
    hit_rate: {
      samples: number,                     // 排除 settlement_price 缺失的樣本
      median_abs_deviation_pct: number,
      hit_within_1pct: number,
      hit_within_2pct: number,
      history: Array<{
        settlement_date: string,
        max_pain_at_t_minus_1: number,     // 用結算前一交易日的 Max Pain
        settlement_price: number,
        deviation_pct: number
      }>
    } | null,
    latest_settlement_pending: boolean,    // 若最近預期結算的 settlement_price 尚未公布
    data_quality_warnings: string[],       // e.g., ["partial_history_first_week"]
    insufficient_data?: { reason: string, required_days: number }
  }
  ```
- Error codes:`missing_contract` / `invalid_contract` / `upstream_unavailable`(502)

#### `GET /api/options/oi_walls`
- Query:`contract`, `date`, `refresh`, `lookback`(default 20), `delta_window`(default 5 **trading days**)
- Returns:
  ```ts
  {
    contract: string, date: string, fetched_at: string, as_of_date: string,
    no_trading_day?: boolean,
    current: {
      static_call_wall: { strike: number, oi: number },
      static_put_wall: { strike: number, oi: number },
      dynamic_call_wall: {                 // 累計 ΔOI 過去 delta_window 個交易日
        strike: number,
        cumulative_delta_oi: number,
        partial_window: boolean            // true 若 days_since_listing < delta_window
      },
      dynamic_put_wall: { ... },
      band_width_pct: number               // (static_call - static_put) / spot
    },
    hit_rate: {
      samples: number,
      pct_settled_inside_band: number,
      avg_band_width_pct: number,
      history: Array<{
        settlement_date: string,
        put_wall_at_t_minus_1: number,
        call_wall_at_t_minus_1: number,
        settlement_price: number,
        inside_band: boolean
      }>
    } | null,
    latest_settlement_pending: boolean,
    data_quality_warnings: string[],
    insufficient_data?: { ... }
  }
  ```

#### `GET /api/options/pcr`
- Query:`date`, `refresh`, `scope`(`per_contract` | `all_months`, default `all_months`), `contract`(僅當 scope=per_contract 必填), `lookback`(default 90 **trading days**), `high_pct`(default 70), `low_pct`(default 30)
- **Validation**(F7-integration 補):
  - `scope=per_contract` 且 `contract` 缺 → 400 `{error: "missing_contract_for_per_contract_scope"}`
  - `scope=per_contract` 且 `contract` 不在 active list → 400 `{error: "invalid_contract"}`
  - `scope=all_months` 且 `contract` 提供 → 400 `{error: "contract_not_applicable_for_scope"}`(F17 補)
- Returns:
  ```ts
  {
    date: string, fetched_at: string, as_of_date: string,
    scope: "per_contract" | "all_months",
    contract?: string,                     // 僅當 scope=per_contract
    no_trading_day?: boolean,
    current: {
      pcr: number,
      percentile: number,                  // 0-100, 用 strictly past window [t-90, t-1]
      region: "high" | "neutral" | "low",  // ≥high_pct | else | ≤low_pct
      thresholds: { high_pct: number, low_pct: number }  // 透明回傳
    },
    next_day_stats: {                      // F2-testability + F11-correctness: 不寫 backtest, 只給 stat
      samples_high: number, samples_neutral: number, samples_low: number,
      high_region:    { mean_pct: number, std_pct: number, hit_positive: number },
      neutral_region: { mean_pct: number, std_pct: number, hit_positive: number },
      low_region:     { mean_pct: number, std_pct: number, hit_positive: number },
      // 各 region 過去 N 日「次日 TX 報酬」分佈統計;不做 P&L / Sharpe
    } | null,
    data_quality_warnings: string[],
    insufficient_data?: { ... }
  }
  ```
- **UI 文案準則**(F5-correctness):**禁用** "滿倉做多" / "賣選收 income" / "看多看空" 等方向字眼。卡片只顯示「分位 + region 標 + 次日報酬統計表」,user 自行判讀。

#### `GET /api/options/institutional`
- Query:`date`, `refresh`, `lookback`(default 60 **trading days**), `corr_window`(default 60,改長 F13)
- Returns:
  ```ts
  {
    date: string, fetched_at: string, as_of_date: string,
    no_trading_day?: boolean,
    current: {
      foreign: { call_net: number, put_net: number, total_net: number, day_change: number },
      dealer:  { ... },                    // 自營商(F3-integration: 用 dealer 不用 prop)
      trust:   { ... },                    // 投信
      session_breakdown: {
        day_session:  { foreign: {...}, dealer: {...}, trust: {...} },
        after_hours:  { ... } | null       // null 若 date < 2021-10-13
      }
    },
    correlation: {                         // 僅 foreign(F10-testability: 鎖單一輸入)
      samples: number,
      latest_corr: number,                 // 外資 Call Net 變動 vs 次日 TX 報酬
      latest_p_value: number,              // bootstrap 1000 次取 95% CI(F13)
      history: Array<{ date, corr, p_value }>,
      is_significant: boolean              // p_value < 0.10 視為有效
    } | null,
    data_quality_warnings: string[],       // e.g., ["after_hours_partial_coverage"]
    insufficient_data?: { ... }
  }
  ```

### 2.2 Backend Services(`backend/services/`)

#### `finmind_options.py` — 新增 parser(純函式,可獨立單測)

**parse_max_pain**(SC-1, F1+F2-correctness, F14):
```python
def parse_max_pain(rows: list[dict], contract_date: str, option_id: str = "TXO") -> dict:
    """
    rows: TaiwanOptionDaily 單日 dataset(包含所有 contract_date, 所有 strike, call_put)
    contract_date: strict equality filter, e.g. "202607" or "202607W2" or "202607F1"
    """
    # 1. Strict filter (F2): row.option_id == "TXO" AND row.contract_date == contract_date
    # 2. Aggregate per (strike, call_put): sum OI across trading_session (position + after_market)
    # 3. Build candidate K = UNION of strikes appearing in call rows OR put rows (F1)
    #    Missing side defaults to 0 OI.
    # 4. For each K in candidate set:
    #      loss_oi_points(K) = Σ call_oi_i × max(K − K_i, 0) + Σ put_oi_i × max(K_i − K, 0)
    # 5. K* = argmin(loss_oi_points)
    # 6. total_loss_ntd = loss_oi_points(K*) × 50  (F14: TXO 乘數 50)
    # Return: { max_pain: K*, total_loss_ntd, strike_count,
    #          strikes_with_call_oi_only, strikes_with_put_oi_only }
```

**parse_max_pain_hit_rate**(SC-5, F3-correctness):
```python
def parse_max_pain_hit_rate(
    oi_by_trading_day: dict[date, list[dict]],   # 每個交易日的 TaiwanOptionDaily rows
    settlements: dict[date, float],              # TaiwanOptionFinalSettlementPrice
    contract_date_history: list[str],            # 過去 lookback 個結算過的 contract_date
) -> dict:
    """
    For each settled contract:
      settlement_date = expiry date
      t_minus_1 = previous trading day  # F3: 避免 look-ahead
      max_pain_at_t_minus_1 = parse_max_pain(oi_by_trading_day[t_minus_1], contract_date)
      deviation = (settlement_price - max_pain_at_t_minus_1) / settlement_price
    Exclude samples where settlement_price missing (F10): set latest_settlement_pending=true
    Compute: median_abs_deviation_pct, hit_within_1pct, hit_within_2pct
    """
```

**parse_oi_walls**(SC-2, F6+F16):
```python
def parse_oi_walls(
    rows_today: list[dict],
    rows_history: list[list[dict]],   # 過去 delta_window 個 trading days 各日 rows
    contract_date: str,
    delta_window: int,
    spot: float,                       # 用於 tie-break
) -> dict:
    """
    Static walls (F16 tie-break):
      For each side:
        max_oi = max(oi per strike)
        candidates = strikes where oi == max_oi
        wall = strike from candidates closest to spot
    Dynamic walls (F6):
      For each strike: cumulative_delta_oi = sum of (oi_t - oi_{t-1}) over past delta_window days
      If days_since_listing < delta_window: partial_window=true; delta_window_used = days_since_listing
      Pick strike with max abs(cumulative_delta_oi) per side, tie-break by spot proximity
    """
```

**parse_oi_walls_hit_rate**(SC-6, F3):
- Same T-1 logic as Max Pain hit rate. Settlement excluded if pending.

**parse_pcr**(SC-3, F4+F15):
```python
from scipy.stats import percentileofscore

def parse_pcr_history(
    rows_by_trading_day: dict[date, list[dict]],
    scope: str,                         # "per_contract" | "all_months"
    contract_date: str | None,
) -> list[tuple[date, float]]:
    """For each day, PCR = Σ Put OI / Σ Call OI. Scope filter applied per day."""

def parse_pcr_walk_forward_percentile(
    pcr_history: list[tuple[date, float]],
    high_pct: float = 70.0,
    low_pct: float = 30.0,
) -> list[tuple[date, float, float, str]]:
    """
    Returns: [(date, pcr, percentile, region), ...]
    For each t, percentile_t = percentileofscore(
        scores=[pcr_s for s, pcr_s in pcr_history if s < t],   # F4: strictly past
        score=pcr_t,
        kind="mean"                                            # F15: pin kind
    )
    Region: "high" if percentile_t >= high_pct, "low" if <= low_pct, else "neutral".
    Excludes early dates where past window has < min_samples (e.g., 30) — emit warning.
    """

def parse_pcr_next_day_stats(
    pcr_classified: list[tuple[date, float, float, str]],
    tx_returns: dict[date, float],     # 次日 TX 報酬
) -> dict:
    """
    Group by region, compute mean / std / hit_positive (% of region samples with next_day_return > 0).
    NO P&L claim, NO Sharpe (F2-testability).
    """
```

**parse_institutional**(SC-4, F3-integration, F12):
```python
NIGHT_SESSION_AVAILABLE_FROM = date(2021, 10, 13)

def parse_institutional(
    rows_day: list[dict],
    rows_night: list[dict] | None,
    target_date: date,
) -> dict:
    """
    Parse foreign/dealer/trust nets per side (call/put).
    'dealer' = 自營商 (F3: match existing chip-data.ts naming, NOT 'prop').
    If target_date < NIGHT_SESSION_AVAILABLE_FROM: after_hours = None, warning="night_session_not_available_pre_2021".
    """

def parse_institutional_correlation(
    foreign_history: list[dict],          # 過去 lookback days 的 foreign call/put net
    tx_returns: dict[date, float],
    corr_window: int = 60,                # F13: 改長
    bootstrap_n: int = 1000,
) -> dict:
    """
    For each window-end t:
      delta_call_net = foreign.call_net[t] - foreign.call_net[t-1]
      next_day_return = tx_returns[t+1]
      Spearman on window of corr_window days.
      Bootstrap p-value (resample with replacement bootstrap_n times).
    is_significant = (p_value < 0.10).
    Single input only: foreign (F10-testability scope guard).
    """
```

#### `finmind.py` — 新增 client methods + 共用 fetch

```python
async def fetch_taiwan_option_daily_window(
    self, end_date: date, trading_days: int, refresh: bool = False
) -> dict[date, list[dict]]:
    """
    共用 fetch (F2+F8-correctness 優化):
    抓 end_date 往回 `trading_days` 個交易日的 TaiwanOptionDaily。
    Cache key: 'txo_daily_window_{end_date}_td{trading_days}'.
    一次 fetch 供 max_pain / oi_walls / pcr 三 endpoint 共用 (parse 各取所需).
    Fan-out: trading_days single-day FinMind calls, token bucket serialize.
    """

async def fetch_max_pain(...):       # 從 fetch_taiwan_option_daily_window 讀;parse_max_pain + hit_rate
async def fetch_oi_walls(...):       # 同上;parse_oi_walls + hit_rate
async def fetch_pcr(...):            # 同上;parse_pcr_history + walk_forward + next_day_stats
async def fetch_institutional(...):  # 自己一條:TaiwanOptionInstitutionalInvestors + AfterHours
```

Cache keys:
- `txo_daily_window_{end_date}_td{n}` — 共用底層 OI 資料
- `max_pain_{contract}_{end_date}_lb{lookback}` — parse 結果
- `oi_walls_{contract}_{end_date}_lb{lookback}_dw{delta_window}`
- `pcr_{scope}_{contract or 'all'}_{end_date}_lb{lookback}_h{high_pct}_l{low_pct}`
- `institutional_{end_date}_lb{lookback}_cw{corr_window}`

### 2.3 Frontend(`frontend/src/`)

#### Hooks(`hooks/useOptions*.ts`)
四個新 hook,**沿用 TanStack Query**(無 `seqRef`,引用 `CLAUDE.md §7 P0` exemption):
- `useMaxPain(contract, date)` / `useOptionsOIWalls(contract, date)`
- `useOptionsPCR(date, scope, contract?, thresholds?)` / `useInstitutionalOptions(date)`

統一回傳 `{ data, loading, error, refresh, noTradingDay }`(專案慣例)。Force-refresh via `refreshRef` 帶 `?refresh=true` 一次。

#### Components(`components/`)
- `OptionsChipPanel.tsx` — 4 卡 grid(`grid-cols-1 md:grid-cols-2 xl:grid-cols-4`),各自 loading/error skeleton(failure isolation)
- `OptionsMaxPainCard.tsx` — Max Pain + 乖離 % + `OptionsHitRateChart`(直方圖)+ `latest_settlement_pending` badge
- `OptionsOIWallsCard.tsx` — 4 walls(static 實心 / dynamic 虛線 marker)+ band width + hit rate + `partial_window` badge
- `OptionsPCRCard.tsx` — 分位 bar + region chip + 次日報酬 stat 表(高/中/低 region 各 mean/std/hit_positive)
  - **Color binding**(F9-integration): `region="high"` → `bg-bull/15 text-bull`、`region="low"` → `bg-bear/15 text-bear`、`region="neutral"` → `bg-ink/5 text-ink-muted`(台股慣例,bull = 紅 = up)
  - **無方向性文案**(F5-correctness):只顯示「分位 P_xx · region=high」+ 統計表;**禁** "做多/做空/賣選" 字眼
- `OptionsInstitutionalCard.tsx` — 3 家並列(外資加粗 + `bg-accent/10`)+ correlation rolling 折線 + p-value 顯示 + `after_hours_partial_coverage` warning
  - Session toggle 用 `<div hidden={!expanded}>`(F10-integration,沿用 CLAUDE.md §3)
- `OptionsHitRateChart.tsx` — 共用純函式 SVG renderer

#### lib
- `lib/options-api.ts` — 4 個 method
- `lib/options-types.ts` — 4 組 TS interface(對應 2.1 schema)
- `lib/options-chip-svg.tsx` — 純 SVG 計算

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

**Lazy**(F8-integration):`OptionsChipPanel` 與其 4 卡片**不**個別 React.lazy split — 同頁同時顯示,split 無效益。OptionsPage 整 chunk 由 App.tsx 既有 `React.lazy` 載入。

## 3. Data flow

正常流(user 切合約 / 日期):
1. `OptionsPage` state 更新 `contractId` / `date`
2. 4 個 hook 並行 invalidate
3. 每個 endpoint cache check:hit → 直接回 / miss → 觸發 `fetch_taiwan_option_daily_window`(三 OI endpoint 共用)+ institutional 自己抓
4. 4 卡片各自獨立 render

Refresh 流:單卡 refresh 帶 `?refresh=true` 跳該 endpoint cache,但 `fetch_taiwan_option_daily_window` 也需要 invalidate 該 key — 由該 fetch_* 內部判斷:若 endpoint refresh=true,則 force re-fetch shared window cache。

## 4. 指標演算法細節(逐 SC 對應,合併修正)

### 4.1 Max Pain(SC-1)
```
candidate_K = UNION { strike: row has OI > 0 for either call or put, with strict contract_date filter }
For each K in candidate_K:
  loss_oi(K) = Σ_i call_oi_i × max(K - K_i, 0)    # K_i: call strikes
             + Σ_j put_oi_j  × max(K_j - K,  0)   # K_j: put strikes  (missing side OI = 0)
K* = argmin(loss_oi(K))
total_loss_ntd = loss_oi(K*) × 50           # TXO multiplier
```

### 4.2 OI Wall(SC-2)
- **Static**:per side, `wall_strike = strike with max OI; tie-break = closest to spot`
- **Dynamic**:
  - 抓 [today-delta_window+1, today] 共 delta_window 個交易日的 OI per strike
  - `cumulative_delta_oi(K) = Σ_{d in window} (oi_d(K) - oi_{d-1}(K))`
  - `wall = strike with max |cumulative_delta_oi|; tie-break = closest to spot`
  - 若 `days_since_listing < delta_window`:`partial_window=true`,`delta_window_used = days_since_listing`

### 4.3 PCR walk-forward(SC-3, F4 critical 修正)
```
For each historical day t in lookback range:
  past_window = [pcr_s for s in pcr_history if s < t]              # 嚴格過去
  IF len(past_window) < min_samples (預設 30):
    skip; emit data_quality_warnings += ["pcr_history_too_short_for_t={t}"]
  ELSE:
    percentile_t = percentileofscore(past_window, pcr_t, kind="mean")
    region_t = "high" if percentile_t >= high_pct       (預設 70)
            else "low" if percentile_t <= low_pct        (預設 30)
            else "neutral"
Today's percentile uses same logic.
```

### 4.4 PCR Next-Day TX Return Stats(SC-7,**降級**:F2-testability)
**這不是 backtest。** 純粹統計:
```
For each t in lookback with region label:
  next_return_t = (TX_close_{t+1} - TX_close_t) / TX_close_t
Group by region (high / neutral / low):
  region_stats = {
    mean_pct, std_pct, hit_positive (% of region samples where next_return > 0),
    samples (count)
  }
```
UI 文案:**「過去 N 天高 PCR 區次日 TX 平均 +0.X%,std Y%,正報酬比率 Z%」** — 純 stat 報導,不寫策略。

### 4.5 三大法人 Net(SC-4)
- per institution(`foreign` / `dealer` / `trust`)per side(call/put)
- `net = buy_oi - sell_oi`
- session_breakdown:日盤 + 夜盤(若 date >= 2021-10-13)
- 主面板顯示合計;`<div hidden={!expanded}>` 展開日夜拆分

### 4.6 外資 correlation(SC-8, F13)
- 抓過去 lookback 日(60)的 foreign Call Net + Put Net + TX_close
- rolling Spearman, window=60(F13: 改長)
- bootstrap p-value(1000 resamples)
- `is_significant = (p_value < 0.10)`(F13: 改 p-value 而非 |r|<0.1)
- UI 折線 + p-value 顯示;`is_significant=false` 時視覺淡化(`opacity-50`)

## 5. Error handling

**錯誤路徑統一**:沿用既有 `main.py @app.exception_handler`(httpx.HTTPError + ValueError),**新增 generic Exception handler**(F6-integration):
```python
# main.py 補
@app.exception_handler(Exception)
async def _generic_handler(request, exc):
    logger.exception("unhandled %s on %s", type(exc).__name__, request.url.path)
    return JSONResponse(status_code=500, content={"detail": {"error": "internal_error"}})
```

**Error code 表**(統一 frontend 鍵):
| Code | HTTP | 觸發 |
|---|---|---|
| `missing_contract` | 400 | scope=per_contract 缺 contract |
| `missing_contract_for_per_contract_scope` | 400 | PCR 專用 |
| `invalid_contract` | 400 | contract 不在 `list_active_contracts` |
| `contract_not_applicable_for_scope` | 400 | scope=all_months 還傳 contract |
| `upstream_unavailable` | 502 | FinMind httpx.HTTPError / Timeout / ConnectError |
| `internal_error` | 500 | 純未預期(parser bug 等)|

**Failure isolation**:4 個 hook 各自獨立 catch error → 卡片顯示「載入失敗 + 重試」,**不阻擋其他卡片**(SC-10b E2E 驗證)。

## 6. Testing strategy

### 6.0 Fixture spec(F4-testability **新增**)
- 路徑:`backend/tests/fixtures/options_chip/{max_pain,oi_walls,pcr,inst,settlement,tx_close}/`
- Provenance:由 `backend/tests/fixtures/options_chip/probe.py` 一次性執行(讀 `.env FINMIND_TOKEN`)、commit 到 git。Probe script 本身也 commit
- 每個 SC 對應 fixture:
  - SC-0:probe 報告(各 dataset 1 個 sample row JSON)
  - SC-1:1 個合約全履約價 OI(含 union 邊界:只有 call OI、只有 put OI 的深 OTM 履約價)
  - SC-2:同 SC-1 + 5 天 OI 序列(testing cumulative ΔOI + partial_window)
  - SC-3:90 個 trading days 的 TXO 所有合約 OI 摘要(每天一個 PCR 數值即可,降低 fixture 體積)
  - SC-4:1 天日盤 + 夜盤法人 row;1 天夜盤=None(< 2021-10-13)
  - SC-5/6:20 個結算日的 contract_date + settlement_price + 結算前一交易日 OI
  - SC-7:同 SC-3 的 PCR 序列 + 同期 TX_close
  - SC-8:60 個交易日的 foreign Call/Put net + TX_close
- 期望輸出 colocated as `<fixture>.expected.json`,test 直接 diff
- **NoOpBucket**(F7-testability):integration test 用 `monkeypatch.setattr("services.finmind._fm_limiter", NoOpBucket())` 跳過 token bucket sleep

### 6.1 Backend
- Pure parser tests(`tests/test_finmind_options.py` 擴充,**用 standalone def,不引入 class 風格**,F4-integration):
  - `test_parse_max_pain_basic` / `_union_strikes_asymmetric_otm` / `_strict_contract_filter` / `_total_loss_includes_multiplier_50`(F1+F2+F14)
  - `test_parse_max_pain_hit_rate_uses_t_minus_1` / `_excludes_pending_settlement` / `_partial_history_warning`(F3+F10)
  - `test_parse_oi_walls_static_tie_break_by_spot` / `_dynamic_cumulative_delta` / `_partial_window_for_young_weekly`(F6+F16)
  - `test_parse_oi_walls_hit_rate_t_minus_1`(F3)
  - `test_parse_pcr_history_per_contract_vs_all_months`
  - `test_parse_pcr_walk_forward_no_lookahead`(F4)+ `_percentile_tie_break_kind_mean`(F15)
  - `test_parse_pcr_next_day_stats_no_pnl_no_sharpe`(F2-testability)
  - `test_parse_institutional_uses_dealer_not_prop`(F3-integration)
  - `test_parse_institutional_after_hours_none_pre_2021_10`(F12)
  - `test_parse_institutional_correlation_60_day_rolling_with_bootstrap_p`(F13)+ `_emits_after_hours_partial_warning`(F6-testability)
- Integration tests(mock httpx + NoOpBucket):
  - `test_fetch_taiwan_option_daily_window_cache_shared` — 一次 fetch 三 endpoint 共用(F2-integration)
  - `test_fetch_*_cache_hit_vs_miss` × 4
- Route tests(`tests/test_options_routes.py` 擴充):
  - 4 個 endpoint happy / 502 propagate / no_trading_day / insufficient_data flag
  - `test_pcr_route_missing_contract_for_per_contract_scope_400`(F8-testability)
  - `test_pcr_route_contract_not_applicable_for_all_months_400`(F17)
  - `test_pcr_route_scope_per_contract_with_invalid_contract_400`

### 6.2 Frontend
- Pure SVG renderer tests(`lib/options-chip-svg.test.ts`)
- Hook tests(`hooks/use*.test.ts`,RTL + MSW)
- Component tests(`components/Options*.test.tsx`):各 happy / loading / error / insufficient_data / partial_window
  - `OptionsPCRCard.test.tsx` 顯式驗 **無「做多/做空/賣選」文字**(F10-testability scope guard)
  - `OptionsInstitutionalCard.test.tsx` 驗 session toggle 用 hidden attribute
- E2E DevTools MCP:
  - 開 `/options` 截圖版面層次
  - 切合約 → panel 跟著刷新
  - 選非交易日 → no_trading_day banner
  - **SC-10b**:MSW 模擬 1 個 endpoint 502 → 該卡片 error,其他 3 卡片正常 render

### 6.3 Verification commands
- `backend/`: `python -m pytest -q`
- `frontend/`: `npm test` + `npm run build`
- Lint: `ruff check .` + `npm run lint`
- Type:`pyright`

## 7. 反身性對沖設計(meta,v2 強化)

deep-research + Phase 1 review 共識:
1. **無方向性文案**:UI 不出現「看多 / 看空 / 滿倉做多 / 賣選收 income」等字眼;只呈現「分位 + region 標 + 次日報酬統計」
2. **hit rate 隨指標常顯**:不藏 modal
3. **PCR 採 Lo & Liu 引用,但不複製其策略文案**:thresholds 暴露為 query param 可調
4. **不過度浪漫化**:沒有 P&L 曲線、沒有 Sharpe、沒有「強烈訊號」字眼
5. **TestParse 顯式守 scope**:correlation card 顯示元素中不能出現 dealer/trust 字眼(F10-testability)
6. **MVP2 接續**:GEX 進來同樣維持「stat + hit rate」原則,不變成 alert 系統

## 8. Known Risks(寫入 Phase 1 round 2 review 議題)
- **R1**:Lo & Liu 樣本期間未明,可能已被市場吃掉。MVP1 上線後需自做 TXO 2022-2025 backtest 確認 PCR alpha 仍存。**監控對象**:SC-7 的 region next-day stats(若高 PCR region 的 mean_pct 接近 neutral region → 訊號已死)
- **R2**:Max Pain SPX 100-expiration 顯示 high-vol 期命中率僅 29% — 本實作的 SC-5 hit rate 即用來監控此衰減
- **R3**:夜盤法人資料起始日 = **2021-10-13**(F12 固定 constant);lookback ≤ 60 trading days 不會碰邊界;若 user 改大 lookback 越界 → SC-11 data_quality_warnings 預警
- **R4**:Spearman 60-day window + bootstrap p-value;若 p-value > 0.10 持續 → UI 視覺淡化
- **R5**(新):shared `_fm_limiter` token bucket 在 4 endpoint 並行時是瓶頸;Phase 2 須 verify 真實 FinMind sponsor 限制
- **R6**(新):`TaiwanOptionFinalSettlementPrice` 欄位名未驗證 — SC-0 schema probe 一定要先做
- **R7**(新,deferred):Refresh stampede 360 calls/click — MVP1 user = single dev,token bucket 已有 5 req/s floor,風險可接受。MVP2 評估 per-IP debounce

## 9. 跨檔契約
- API error JSON shape:`{ "detail": { "error": "<code>" } }`(既有,不變)
- `no_trading_day` flag:沿用既有
- Refresh:`?refresh=true` query 跳 cache(既有);本 spec 增加共用 window cache 也要 invalidate
- Cache versions:**既有 `_CACHE_VERSION_OPTIONS = 1` 不動**;**新增 `_CACHE_VERSION_OPTIONS_CHIP = 1`**(隔離)
- Contract ID:沿用 flat ID `TXO202607` / `TXO202607W2` / `TXO202607F1`
- **新增 trading days helper**:`utils/trading_calendar.get_trading_days(end_date, n) -> list[date]`(從 `TaiwanFuturesDaily` 有資料的日子推算)
- **新增 NIGHT_SESSION_AVAILABLE_FROM constant**:`date(2021, 10, 13)`
- **新增 data_quality_warnings**:所有 hit rate / correlation payload 都帶 `data_quality_warnings: string[]`

### 9.1 Contract Type Matrix(F7-correctness 新增)

| SC | Monthly (TXO202607) | Wed-Weekly (TXO202607W2) | Fri-Weekly (TXO202607F1) |
|---|---|---|---|
| SC-1 Max Pain | ✅ | ✅ | ✅ |
| SC-2 OI Walls (static) | ✅ | ✅ | ✅ |
| SC-2 OI Walls (dynamic) | ✅ | ⚠ partial_window first 5 days | ⚠ partial_window |
| SC-3 PCR per_contract | ✅ | ⚠ history limited to listing date | ⚠ same |
| SC-3 PCR all_months | ✅(N/A contract param)| ✅ | ✅ |
| SC-4 Institutional | ✅ market-wide; not per-contract | ✅ same | ✅ same |
| SC-5 Max Pain hit_rate | ✅ | ✅ | ✅ |
| SC-6 OI Walls hit_rate | ✅ | ⚠ shorter history | ⚠ same |
| SC-7 PCR next-day stats | ✅(scope=all_months always)| same | same |
| SC-8 Foreign correlation | ✅ market-wide | same | same |

**Frontend rule**:per_contract PCR 對剛上市的週合約(< 30 days history)直接顯示 "insufficient_data";建議改 scope=all_months。

## 10. 開發順序(Phase 2 切片預告)
1. SC-0 schema probe(必須最先 — 確認 FinMind dataset 欄位名)
2. `utils/trading_calendar.py` + `services/finmind.py::fetch_taiwan_option_daily_window`(共用基礎)
3. Parsers(可並行):parse_max_pain → parse_oi_walls → parse_pcr → parse_institutional
4. Hit-rate parsers + correlation
5. Routes(4 個 endpoint)
6. Frontend types + api client + 4 hook
7. 4 卡片 + OptionsChipPanel + OptionsPage 整合
8. SC-10b E2E + 真實環境 DevTools MCP

每 SC 對應 commit:🟢 test [red] → 🟢 feat [green] → 🔵 refactor 三類分離。
