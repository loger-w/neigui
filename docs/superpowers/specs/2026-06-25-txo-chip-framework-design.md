# txo-chip-framework — Design Spec (v3)

> /feat slug: `txo-chip-framework` | Phase 0/1 artifact | v1 2026-06-25 → v2 2026-06-26 → v3 2026-06-26

## Changelog
- **v1** (2026-06-25):初版
- **v2** (2026-06-26):Phase 1 round 1 後修 41 findings(12 P0 + 16 P1 + 13 P2)詳見 `design-review-round-1.json`
- **v3** (2026-06-26):Phase 1 round 2 後修 26 findings(1 P0 + 12 P1 + 13 P2)詳見 `design-review-round-2.json`。Round 2 確認 round 1 所有 P0/P1 已修正,但 v2 修改本身又引入新問題。重點 v3 變更:
  - 修 1 條 P0:NoOpBucket monkeypatch 邏輯錯誤(FinMindClient `__init__` 綁定 limiter,patch 後 client 已 instantiated)→ 改 patch `get_finmind_rate_limiter` + reset `_client = None`,並 inline NoOpBucket class
  - 修多條 P1:共用 fetch 真的共用(單一 canonical max window + `_run_once` inflight dedup);correlation p-value 改 **permutation test**(非 bootstrap);refresh 流會 invalidate 下游 parse cache;trading_calendar 移到 `services/`(utils 維持純函式);MSW 換 `vi.spyOn`;PCR walk-forward warmup 改單一 consolidated warning
  - 修多條 P2:OI Wall 改用 Σ|ΔOI|(活躍度)而非 2-point delta;`OptionsHitRateChart` 拆兩個元件;PCR cache 分 series / classified 兩層

## 0. 背景與來源(沿用 v2)

**Why**:把 options 系統升級為日級籌碼觀察清單(Max Pain / OI Wall / PCR / 三大法人),每指標附歷史 hit rate 監控對沖反身性。

**Sources**:研究檔 + 2026-06-25 `/deep-research` 校準(`wqm7dpah3`)+ 2026-06-26 Phase 1 round 1 review(`design-review-round-1.json`)+ round 2 review(`design-review-round-2.json`)。

**專案慣例承襲**:CLAUDE.md §7 P0 用 TanStack Query 取代 seqRef;§3 hidden attribute > 條件 render;§3 紅=up / 綠=down(台股慣例)。

**Out of scope**:GEX / IV / Skew / VIX / Tick / 多指標共振 / refresh debounce(MVP2/3)。

## 1. 架構

**設計原則**:沿用既有 layered,**不重構**。新功能 additive,既有 `OptionsLargeTradersStrip` + `OptionsStrikeLadder` 不動。

```
┌─────────────────────────────────────────────────────────────┐
│ OptionsPage.tsx                                              │
│   - OptionsHeader (既有)                                     │
│   - ⬇️ OptionsChipPanel (NEW)                               │
│       ├─ OptionsMaxPainCard      (SC-1, SC-5)              │
│       ├─ OptionsOIWallsCard      (SC-2, SC-6)              │
│       ├─ OptionsPCRCard          (SC-3, SC-7)              │
│       └─ OptionsInstitutionalCard (SC-4, SC-8)             │
│   - OptionsLargeTradersStrip (既有, 不動)                    │
│   - OptionsStrikeLadder      (既有, 不動)                    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  (4 hooks parallel, failure isolation)
┌──────────────────────────────────────────────────────────────┐
│ FastAPI Backend                                              │
│   routes/options.py                                          │
│     - /api/options/{max_pain,oi_walls,pcr,institutional}    │
│   services/finmind.py                                        │
│     - fetch_taiwan_option_daily_window (共用基礎,N=250)     │
│       wrapped in _run_once for inflight dedup               │
│     - fetch_max_pain / fetch_oi_walls / fetch_pcr            │
│       (從共用 window 切自己需要的 sub-range)                 │
│     - fetch_institutional                                    │
│   services/trading_calendar.py (NEW; 含 I/O + cache)         │
│     - get_trading_days(end_date, n) → list[date]            │
│       使用 TaiwanFuturesDaily 推算,7-day calendar cache     │
│   utils/trading_calendar_helpers.py (NEW; 純函式)            │
│     - count_back_trading_days(date_list, end, n) → list     │
│   utils/cache.py (既有,不動)                                │
│   services/finmind_options.py                                │
│     - 4 組 parser + 4 組 hit_rate/correlation/stats parser  │
└──────────────────────────────────────────────────────────────┘
        │
        ▼  (FinMind sponsor tier)
TaiwanOptionDaily / OptionInstitutional[AfterHours] /
TaiwanFuturesDaily / TaiwanOptionFinalSettlementPrice
→ SC-0 probe 先驗 5 dataset schema
```

**Cache versions**(v2 沿用 + v3 補):
- `_CACHE_VERSION_OPTIONS = 1` **不動**(舊 oi_lt / strike_vol / spot)
- `_CACHE_VERSION_OPTIONS_CHIP = 1` 新增(本 spec 5 個新 cache key 全用此版本)
- 兩 version 隔離

**Canonical window size**(N1+F14 修):
- 共用 `fetch_taiwan_option_daily_window` **單一 window = `CHIP_WINDOW_TD = 250` trading days(約 1 calendar year)**
- 各 parser 自行從共用 window slice 需要的 sub-range:
  - Max Pain hit_rate: 最近 20 個結算合約對應的 settlement_date 加 t_minus_1(週 + 月混算約 60-100 td)
  - OI Walls hit_rate: 同上
  - PCR walk-forward: 提升至 **250 trading days**(原 90,N8 修),提供每 region ≥ 70 樣本
  - 三 endpoint 全部從同一 `CHIP_WINDOW_TD=250` 共用 cache 讀
- Institutional 自己 60 td 一條獨立 fetch(資料源不同)

**Cold-load math 校正**(F14+F17):
- `fetch_taiwan_option_daily_window(end_date, 250)` 用 `_run_once(f"txo_daily_window_{end_date}_td250", ...)` 包起來
- 3 endpoint 並行 cold start → 共用 1 個 fan-out(250 single-day FinMind calls)+ 1 個 institutional fan-out(60 calls)= 310 calls
- 假設 5 req/s shared bucket: **62 秒** cold load(較 v2 的 30 秒慢但誠實)
- **Phase 2 前 verify** 真實 FinMind sponsor 限制;若 ≥ 10 req/s 則 ~31 秒
- 4 個卡片獨立 skeleton,institutional 先解鎖(只 60 td)

**Lazy 載入**:4 卡同頁,不個別 lazy split。`OptionsPage` chunk 由 App.tsx 既有 `React.lazy` 載。

## 2. Components

### 2.1 Backend Routes

#### `GET /api/options/max_pain`
- Query:`contract` (req), `date`, `refresh`, `lookback`(default 20 settled contracts)
- Returns(欄位沿用 v2):
  ```ts
  { contract, date, fetched_at, as_of_date, no_trading_day?,
    current: { max_pain: number, total_loss_ntd: number, strike_count: number,
               strikes_with_call_oi_only: number, strikes_with_put_oi_only: number },
    hit_rate: { samples, median_abs_deviation_pct, hit_within_1pct, hit_within_2pct,
                history: [{ settlement_date, max_pain_at_t_minus_1, settlement_price, deviation_pct }] } | null,
    latest_settlement_pending: boolean,
    data_quality_warnings: string[],
    insufficient_data?: { reason, required_days } }
  ```

#### `GET /api/options/oi_walls`
- Query:`contract` (req), `date`, `refresh`, `lookback`(default 20), `delta_window`(default 5 trading days)
- Returns:
  ```ts
  { contract, date, fetched_at, as_of_date, no_trading_day?,
    current: {
      static_call_wall: { strike, oi },
      static_put_wall: { strike, oi },
      dynamic_call_wall: {                           // N4 修: 用 activity 而非 telescoping delta
        strike,
        window_activity_oi: number,                  // Σ_{d in window} |oi_d - oi_{d-1}|
        partial_window: boolean
      },
      dynamic_put_wall: { ... },
      band_width_pct: number
    },
    hit_rate: { samples, pct_settled_inside_band, avg_band_width_pct,
                history: [{ settlement_date, put_wall_at_t_minus_1, call_wall_at_t_minus_1, settlement_price, inside_band }] } | null,
    latest_settlement_pending, data_quality_warnings, insufficient_data? }
  ```

#### `GET /api/options/pcr`
- Query:`date`, `refresh`, `scope`(`per_contract` | `all_months`, default `all_months`), `contract`(僅 per_contract 必填), `lookback`(default **250** trading days, N8 修), `high_pct`(default 70), `low_pct`(default 30)
- Validation(沿用 v2)+ **N5 修**:若 `scope=per_contract` 且 contract 是週合約(W/F 後綴)→ 200 回 + payload `data_quality_warnings = ["per_contract_pcr_unsupported_for_weekly_consider_all_months"]` + `region=null` + UI 顯示「週合約資料不足,建議改全月份模式」按鈕
- Returns(F17/N9 修):
  ```ts
  { date, fetched_at, as_of_date, scope, contract?, no_trading_day?,
    current: {
      pcr: number,
      percentile: number,                          // walk-forward, strictly past window
      region: "high" | "neutral" | "low" | null,   // null 若 insufficient_data
      thresholds: { high_pct, low_pct }
    },
    next_day_stats: {                              // F17 修:samples 移到 region 內,top-level samples_X 移除
      high_region:    { mean_pct, std_pct, hit_positive, samples },
      neutral_region: { ... },
      low_region:     { ... }
    } | null,
    data_quality_warnings: string[],
    insufficient_data?: { reason, required_days } }
  ```
- **UI 文案準則 重申**:**禁用** 方向性字眼;只顯示 stat 表

#### `GET /api/options/institutional`
- Query:`date`, `refresh`, `lookback`(default 60 trading days), `corr_window`(default 60)
- Returns(N2/N3 修):
  ```ts
  { date, fetched_at, as_of_date, no_trading_day?,
    current: {
      foreign: { call_net, put_net, total_net, day_change },
      dealer:  { ... },                            // 自營商 (F3-int 沿用 v2)
      trust:   { ... },
      session_breakdown: {
        day_session: { foreign, dealer, trust },
        after_hours: { ... } | null                // null 若 date < 2021-10-13
      }
    },
    correlation: {                                 // 僅 foreign (F10-test scope guard)
      samples: number,
      latest_corr: number,
      latest_p_value: number,                      // PERMUTATION test (N2 修)
      history: Array<{ date, corr, p_value }>,
      is_significant: boolean,                     // p_value < 0.10
      feature_transformation: "raw_flow" | "first_difference"  // N3: 由 SC-0 probe 決定後固定
    } | null,
    data_quality_warnings: string[],
    insufficient_data? }
  ```

### 2.2 Backend Services

#### `services/trading_calendar.py`(F16 新增)
```python
# I/O + cache layer
from utils.trading_calendar_helpers import count_back_trading_days

_TRADING_CAL_TTL_SEC = 7 * 24 * 3600
_TRADING_CAL_CACHE_KEY = "tx_trading_days_cache"

async def get_trading_days(end_date: date, n: int) -> list[date]:
    """
    回傳從 end_date 往回 n 個 AVAILABLE trading days (N6 修:資料可用而非 calendar 推算)
    n 第 1 個元素是最近的 trading day, 第 n 個是最舊。
    若 TaiwanFuturesDaily 對 end_date 尚未發布 → 用最近已發布日 (publication lag 容忍)
    Cached 7 days at services layer (calendar 變動極慢).
    """
    cached_dates: list[date] = await _read_or_fetch_tx_trading_dates()
    return count_back_trading_days(cached_dates, end_date, n)
```

#### `utils/trading_calendar_helpers.py`(F16 新增,純函式)
```python
def count_back_trading_days(
    available_dates: list[date],     # 已 fetched 的 TX trading days (sorted asc)
    end_date: date,
    n: int,
) -> list[date]:
    """純函式:在 available_dates 找 ≤ end_date 最近的 trading day,往回取 n 個."""
```

#### `services/finmind_options.py` — 新增 parser

**parse_max_pain** / **parse_max_pain_hit_rate**:沿用 v2(union strikes + strict contract_date + T-1 hit rate + total_loss × 50)

**parse_oi_walls**(N4 修):
```python
def parse_oi_walls(
    rows_today: list[dict],
    rows_history: list[list[dict]],   # past delta_window trading days
    contract_date: str,
    delta_window: int,
    spot: float,
) -> dict:
    """
    Static walls: max OI strike per side, tie-break closest to spot
    Dynamic walls (N4 修: window_activity_oi = Σ_{d} |oi_d - oi_{d-1}|, 不是 telescoping delta):
      For each strike K:
        activity(K) = sum over (delta_window-1) day-pairs of |oi_{d+1}(K) - oi_d(K)|
      wall = strike with max activity per side, tie-break closest to spot
    若 days_since_listing < delta_window: partial_window=true; warning="dynamic_wall_partial_window"
    """
```

**parse_oi_walls_hit_rate**:沿用 v2 T-1 邏輯

**parse_pcr_history**(沿用 v2):每日 PCR per scope。一次 FinMind call/day(data_id='TXO' 一次回所有合約),parser 內 aggregate。

**parse_pcr_walk_forward_percentile**(沿用 v2,F14 修 warning):
```python
def parse_pcr_walk_forward_percentile(
    pcr_history: list[tuple[date, float]],
    high_pct: float = 70.0,
    low_pct: float = 30.0,
    min_samples: int = 30,
) -> tuple[list[tuple[date, float, float, str | None]], list[str]]:
    """
    返回 (classified_history, warnings).
    對每個 t:
      past_window = [pcr_s for s in history if s < t]   # strictly past
      若 len(past_window) < min_samples: region = None, count_skip += 1
      else: percentile = percentileofscore(past_window, pcr_t, kind="mean")
            region = "high" if percentile >= high_pct else "low" if <= low_pct else "neutral"
    若 count_skip > 0: warnings.append(f"pcr_walk_forward_warmup_skipped_first_{count_skip}_days")  # F14: 單一 consolidated
    """
```

**parse_pcr_next_day_stats**(F17/N9 修):
```python
def parse_pcr_next_day_stats(
    classified: list[tuple[date, float, float, str | None]],
    tx_returns: dict[date, float],
) -> tuple[dict, list[str]]:
    """
    Group by region (skip region=None). 每 region:
      samples_in_region = [t for t, _, _, r in classified if r == region_name]
      with_next_return  = [t for t in samples_in_region if t+1 in tx_returns]  # N9 修
      若 len(with_next_return) / max(1, len(samples_in_region)) < 0.95:
        warnings.append("next_day_stats_dropped_samples_5pct")
      returns = [tx_returns[t+1] for t in with_next_return]
      stat = {
        mean_pct: mean(returns),
        std_pct: std(returns),
        hit_positive: count(r > 0) / len(returns),
        samples: len(with_next_return),    # F17: samples 移到 region 內
      }
      若 samples < 30: warnings.append(f"pcr_stats_low_power_{region_name}")  # N8 修
    NO P&L, NO Sharpe.
    """
```

**parse_institutional**(沿用 v2:dealer/foreign/trust + NIGHT_SESSION_AVAILABLE_FROM = 2021-10-13)

**parse_institutional_correlation**(N2 + N3 修):
```python
def parse_institutional_correlation(
    foreign_history: list[dict],
    tx_returns: dict[date, float],
    corr_window: int = 60,
    permutation_n: int = 1000,             # N2: 改 permutation
    feature_transformation: str = "raw_flow",  # N3: SC-0 probe 後決定
) -> tuple[dict, list[str]]:
    """
    feature_transformation:
      'raw_flow' (default): correlate foreign.call_net[t] directly vs tx_returns[t+1]
                            理由:TaiwanOptionInstitutionalInvestors 已是 daily net flow,不應再 diff
      'first_difference': call_net[t] - call_net[t-1] vs tx_returns[t+1]
                          (備援;若 SC-0 確認資料是 cumulative position 而非 flow → 切換此模式)
    Spearman over corr_window days,rolling.
    Permutation p-value (N2):
      shuffle tx_returns within window (without replacement);
      recompute Spearman; p = (#perms with |r_perm| >= |r_obs| + 1) / (permutation_n + 1)
    is_significant = (p < 0.10).
    Single input only: foreign (F10-test scope guard;dealer / trust 完全不進 correlation 計算)
    若 samples < 30: warnings.append("correlation_sample_small")
    若 lookback 跨 NIGHT_SESSION_AVAILABLE_FROM 邊界: warnings.append("after_hours_partial_coverage")
    """
```

#### `services/finmind.py` — 新增 client methods

```python
CHIP_WINDOW_TD = 250  # canonical window for shared fetch

async def fetch_taiwan_option_daily_window(
    self, end_date: date, refresh: bool = False
) -> dict[date, list[dict]]:
    """
    F17 修: _run_once wrap for inflight dedup
    F14 修: 固定 N=CHIP_WINDOW_TD trading days, 各 parser 自己 slice
    """
    cache_key = f"txo_daily_window_{end_date}_td{CHIP_WINDOW_TD}"
    if refresh:
        # F18 修: refresh 同時 invalidate 下游 max_pain/oi_walls/pcr 該 contract+date 的 parse cache
        invalidate_dependent_parse_caches(end_date, scope="all")
    return await self._run_once(f"window_{cache_key}", lambda: _fetch_inner(cache_key, end_date))

async def fetch_max_pain(...):  # 從 window 切 ~100 td (settlement_lookback) + parse
async def fetch_oi_walls(...):  # 同上 + delta_window
async def fetch_pcr(...):       # 從 window 切 250 td + parse_history + walk_forward + stats
async def fetch_institutional(...):  # 獨立 60-td fetch + AfterHours
```

**Cache keys + versions**(F21 修補):
| Key pattern | Version |
|---|---|
| `txo_daily_window_{end}_td250` | CHIP |
| `max_pain_{contract}_{end}_lb{lookback}` | CHIP |
| `oi_walls_{contract}_{end}_lb{lookback}_dw{delta_window}` | CHIP |
| `pcr_series_{scope}_{contract or 'all'}_{end}_lb{lookback}` | CHIP, threshold-independent (N10) |
| `pcr_classified_{scope}_{contract or 'all'}_{end}_lb{lookback}_h{h}_l{l}` | CHIP, threshold-dependent (N10) |
| `institutional_{end}_lb{lookback}_cw{corr_window}` | CHIP |
| `tx_trading_days_cache` | CHIP, 7-day TTL |

**所有上述新 keys 均使用 `_CACHE_VERSION_OPTIONS_CHIP`,既有 keys 不動**(F21)。

**fetch_strike_volume 不合併**(F20):既有 endpoint 抓 7-day window,本 spec 抓 250-day。MVP1 維持兩條 fetch,標記為 MVP2 評估 merge 候選。

### 2.3 Frontend(沿用 v2 + N7 修)

#### Hooks:`useMaxPain` / `useOptionsOIWalls` / `useOptionsPCR` / `useInstitutionalOptions`,TanStack Query(CLAUDE.md §7 P0 exemption,無 seqRef)

#### Components:
- `OptionsChipPanel.tsx` — 4 卡 grid,failure isolation
- `OptionsMaxPainCard.tsx` — Max Pain + 乖離 + `OptionsDeviationHistogram`(N7 修:獨立元件)
- `OptionsOIWallsCard.tsx` — 4 walls(static 實心 / dynamic 虛線)+ band width + `OptionsBandHitChart`(N7 修)+ partial_window badge
- `OptionsPCRCard.tsx` — region chip(bg-bull/15 high, bg-bear/15 low, bg-ink/5 neutral)+ next-day stat 表;**禁方向性文案**
- `OptionsInstitutionalCard.tsx` — 3 家並列(外資 bg-accent/10)+ correlation rolling 折線 + p-value;session toggle 用 `<div hidden={!expanded}>`
- `OptionsDeviationHistogram.tsx`(N7 新)— Max Pain 用
- `OptionsBandHitChart.tsx`(N7 新)— OI Walls 用

#### lib:`options-api.ts` / `options-types.ts` / `options-chip-svg.tsx`(只放 axis helper)

### 2.4 OptionsPage 整合(沿用 v2)
```tsx
<OptionsPage>
  <OptionsHeader />
  <NoTradingDayBanner />
  <OptionsChipPanel contract={contractId} date={date} />  {/* NEW */}
  <OptionsLargeTradersStrip /> {/* 既有 */}
  <OptionsStrikeLadder />      {/* 既有 */}
</OptionsPage>
```

## 3. Data flow(F18 修)

正常流(沿用 v2)。

**Refresh 流**(F18 修):
- 單卡 refresh `?refresh=true` → 該 endpoint 內部:
  - 若是 max_pain / oi_walls / pcr 之一:**同時** invalidate 共用 `txo_daily_window_{end}_td250` cache + 該 endpoint 的 parse cache + 同 contract+date 的 max_pain/oi_walls/pcr 三 parse cache(避免 stale parse on fresh window)
  - 若是 institutional:只 invalidate institutional cache
- 實作:`_invalidate_dependent_parse_caches(end_date, scope=...)` 在 `services/finmind.py`,共用 fetch 開始前呼叫

## 4. 演算法細節(只列 v3 變更)

### 4.1 Max Pain(沿用 v2)
### 4.2 OI Wall(N4 修):**dynamic_wall** 改用 `Σ_{d in window} |oi_{d+1}(K) - oi_d(K)|`(activity 強度),tie-break 仍 closest-to-spot
### 4.3 PCR walk-forward(沿用 v2 + F14 warning consolidate + N8 lookback 250)
### 4.4 PCR next-day TX 報酬統計(沿用 v2 + F17 schema unify + N8 low_power warning + N9 dropped sample handling)
### 4.5 三大法人(沿用 v2)
### 4.6 外資 correlation(N2 + N3 修):
```
feature = foreign.call_net (raw daily flow; N3 default, pending SC-0 verify)
For each rolling 60-day window ending at t:
  r_observed = Spearman(feature, tx_returns_shifted_by_1)
  Permutation:                              # N2 修
    For i in 1..1000:
      shuffled_returns = random.permutation(tx_returns_shifted)
      r_perm_i = Spearman(feature, shuffled_returns)
    p_value = (count(|r_perm| >= |r_observed|) + 1) / 1001
  is_significant = (p_value < 0.10)
```

## 5. Error handling(沿用 v2)
- 既有 `httpx.HTTPError` + `ValueError` global handler
- **新增 generic Exception handler**(F6-integration 沿用 v2 plan):`main.py` 加 `@app.exception_handler(Exception)` → `{detail: {error: "internal_error"}}`,500
- Error code 表沿用 v2 + 新增:`per_contract_pcr_unsupported_for_weekly_consider_all_months`(payload warning,不是 400)

## 6. Testing(主要 v3 變更)

### 6.0 Fixture spec(F15+F18+F19 補)

- 路徑:`backend/tests/fixtures/options_chip/{probe,max_pain,oi_walls,pcr,inst,settlement,tx_close,tx_trading_days}/`
- Provenance:`backend/tests/fixtures/options_chip/probe.py` 讀 `.env FINMIND_TOKEN`,一次性 probe 5 datasets:
  - `TaiwanOptionDaily` — 1 day full rows(driving fan-out shape)
  - `TaiwanOptionInstitutionalInvestors`(日盤)— 1 day
  - `TaiwanOptionInstitutionalInvestorsAfterHours`(夜盤)— 1 day
  - `TaiwanOptionFinalSettlementPrice` — 5 settlements
  - `TaiwanFuturesDaily` — 1 month(check publication latency,F16/N6)
- **probe.py 行為**(F16 修):
  - 只在新增 / 刷新 fixture 時跑(非每次 CI)
  - 自動 sanitize:drop `__user` / `__tier` 等 metadata key
  - 加 `test_probe_fixtures_match_parser_field_names`(static 比對:parser code 引用的 field name 必須在 probe JSON 出現)
  - **unit tests 不需 FINMIND_TOKEN**(讀 committed fixtures)
- **per-SC expected.json schema**(F15):

  | SC | expected.json keys |
  |---|---|
  | SC-0 | dataset_name, sample_row_keys, schema_drift_check |
  | SC-1 | max_pain (int), total_loss_ntd (float), strike_count, strikes_with_call_oi_only, strikes_with_put_oi_only |
  | SC-2 | static_call_wall {strike, oi}, static_put_wall {...}, dynamic_call_wall {strike, window_activity_oi, partial_window}, ... |
  | SC-3 | pcr (float), percentile (0-100), region ("high"|"neutral"|"low"|null), thresholds {high_pct, low_pct} |
  | SC-4 | foreign, dealer, trust 三 dict;session_breakdown |
  | SC-5 | samples, median_abs_deviation_pct, hit_within_1pct, hit_within_2pct, history (≤ 20 entries) |
  | SC-6 | samples, pct_settled_inside_band, history |
  | SC-7 | high_region, neutral_region, low_region 各 dict(mean_pct, std_pct, hit_positive, samples) |
  | SC-8 | samples, latest_corr, latest_p_value, history, is_significant, feature_transformation |
  | SC-10 | error responses 對應 status + detail.error code |
  | SC-10b | failure isolation 4 卡狀態 |
  | SC-11 | warning strings 集合 |

- **Fixture size budget**:每 fixture file ≤ 50 KB;SC-3 PCR 序列只存 `{date, pcr}` 而非 full OI rows;SC-5/6 settlement 紀錄壓縮到必要欄位

- **NoOpBucket 介面定義**(F15/F18 inline):
  ```python
  # backend/tests/conftest.py
  class NoOpBucket:
      """Test-only no-op token bucket; duck-types services.rate_limiter.TokenBucket."""
      rate: float = float("inf")
      async def acquire_async(self, tokens: int = 1, timeout: float | None = None) -> bool:
          return True
      async def acquire(self, tokens: int = 1, timeout: float | None = None) -> bool:
          return True
  
  @pytest.fixture(autouse=False)
  def bypass_finmind_rate_limiter(monkeypatch):
      """F15 修: patch BEFORE first get_finmind() + reset _client. 
         FinMindClient.__init__ binds self._limiter at construction; replacing
         module-level _fm_limiter post-construction is no-op."""
      import services.finmind as fm
      monkeypatch.setattr(fm, "get_finmind_rate_limiter", lambda: NoOpBucket())
      monkeypatch.setattr(fm, "_client", None)  # force rebuild on next get_finmind()
  ```

### 6.1 Backend tests

- Pure parser tests(`tests/test_finmind_options.py` 擴充,**standalone def,不引入 class**):
  - Max Pain:`test_parse_max_pain_basic` / `_union_strikes_asymmetric_otm` / `_strict_contract_filter` / `_total_loss_includes_multiplier_50`
  - Max Pain hit rate:`test_parse_max_pain_hit_rate_uses_t_minus_1` / `_excludes_pending_settlement` / `_partial_history_warning`
  - OI Walls:`test_parse_oi_walls_static_tie_break_by_spot` / `_dynamic_uses_activity_not_telescoping_delta`(N4) / `_partial_window_for_young_weekly`
  - OI Walls hit rate:`test_parse_oi_walls_hit_rate_t_minus_1`
  - PCR:`test_parse_pcr_history_per_contract_vs_all_months`
  - PCR walk-forward:`test_parse_pcr_walk_forward_no_lookahead` / `_emits_single_warmup_warning_not_per_day`(F14) / `_percentile_tie_break_kind_mean`
  - PCR next-day stats:`test_parse_pcr_next_day_stats_no_pnl_no_sharpe` / `_payload_schema_exact`(F17) / `_emits_low_power_warning_when_samples_lt_30`(N8) / `_handles_missing_tx_returns_t_plus_1`(N9)
  - Institutional:`test_parse_institutional_uses_dealer_not_prop` / `_after_hours_none_pre_2021_10`
  - Institutional correlation:`test_parse_institutional_correlation_60_day_rolling_with_permutation_p`(N2 修名)/ `_excludes_dealer_trust_from_correlation_payload`(**F11 修補,brainstorm 一致**)/ `_emits_after_hours_partial_warning` / `_feature_transformation_raw_flow_default`(N3)/ `_emits_correlation_sample_small_when_lt_30`
  - Trading calendar:`tests/test_trading_calendar.py` — `test_count_back_trading_days_handles_publication_lag`(N6) / `_handles_holiday_clusters_cny`(F9-correctness)

- Integration tests(use `bypass_finmind_rate_limiter` fixture + mock httpx):
  - **F13 enumeration**:
    - `test_fetch_taiwan_option_daily_window_inflight_dedup_via_run_once`(F17)
    - `test_fetch_max_pain_cache_hit_vs_miss`
    - `test_fetch_oi_walls_cache_hit_vs_miss`
    - `test_fetch_pcr_cache_hit_vs_miss`
    - `test_fetch_institutional_cache_hit_vs_miss`
    - `test_fetch_max_pain_refresh_invalidates_shared_window_cache`(F18)
    - `test_fetch_oi_walls_refresh_invalidates_shared_window_cache`(F18)
    - `test_fetch_pcr_refresh_invalidates_shared_window_cache`(F18)

- Route tests(`tests/test_options_routes.py`):
  - 4 endpoint happy + 502 propagate + no_trading_day + insufficient_data
  - `test_pcr_route_missing_contract_for_per_contract_scope_400`
  - `test_pcr_route_contract_not_applicable_for_all_months_400`
  - `test_pcr_route_per_contract_weekly_returns_warning_not_400`(N5)

### 6.2 Frontend tests

- Pure SVG renderer(`lib/options-chip-svg.test.ts`)+ `OptionsDeviationHistogram.test.tsx` + `OptionsBandHitChart.test.tsx`(N7 拆)
- Hook tests:沿用既有 `vi.spyOn(optionsApi, ...)` pattern(**F12 修:不用 MSW**)
- Component tests:
  - 4 卡片各 happy / loading / error / insufficient_data / partial_window
  - `OptionsPCRCard.test.tsx` 顯式 `expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull()`
  - `OptionsInstitutionalCard.test.tsx` 驗 session toggle 用 hidden attribute
  - **`OptionsChipPanel.test.tsx`**:**SC-10b 在這層測,不走 DevTools MCP**(F12 修):
    ```typescript
    vi.spyOn(optionsApi, "pcr").mockRejectedValue(new ApiError(502, "upstream_unavailable"));
    vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
    vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
    vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);
    render(<OptionsChipPanel ... />);
    // assert: PCR card 顯示 error chip
    // assert: Max Pain / OI Walls / Institutional 三卡片 render 正常資料
    ```
- E2E DevTools MCP:**只**驗 SC-9 版面 + 切合約/日期 + non-trading-day banner(SC-10b 不走 E2E,避免 MSW 依賴)

### 6.3 Verification commands
- `cd backend && python -m pytest -q`
- `cd frontend && npm test && npm run build`
- Lint:`ruff check .` + `npm run lint`
- Type:`pyright`(basic)

## 7. 反身性對沖設計(沿用 v2)
1. 無方向性文案 / 2. hit rate 常顯 / 3. 引用 Lo & Liu 不複製策略 / 4. 不過度浪漫化 / 5. correlation 鎖單一輸入(foreign only,scope guard)/ 6. MVP2 GEX 同原則

## 8. Known Risks(v3 擴充)
- **R1**:Lo & Liu 樣本期間未明 → SC-7 stats 即監控(N8 修 lookback 250 後每 region ≥ 70 樣本,statistical power 提升)
- **R2**:Max Pain SPX 100-expiration 結果 high-vol 期命中率 29% → SC-5 monitoring
- **R3**:夜盤起始 2021-10-13 → constant 固定,SC-11 warning
- **R4**:Spearman → permutation p-value(N2 修);只算 foreign(scope guard)
- **R5**:shared `_fm_limiter` token bucket;Phase 2 須 verify 真實限制
- **R6**:5 dataset schema 須 SC-0 probe 先驗(F19 擴大)
- **R7** (deferred):Refresh stampede → MVP2
- **R8** (新):NoOpBucket 必須在 `get_finmind()` 之前 patch + reset `_client`,否則無效;**conftest fixture pattern** 必須**所有** integration test 採用
- **R9** (新):TaiwanFuturesDaily publication lag → `get_trading_days` 回最近**已發布**日;若週五尾盤跑 hit rate,可能少 1 天
- **R10** (新):Correlation `feature_transformation` 預設 `raw_flow`,**SC-0 probe 後確認**是否 daily flow 或 cumulative position;確認後 lock。若是後者改 `first_difference`

## 9. 跨檔契約(v3 補)
- 既有:`detail.error` / `no_trading_day` flag / `?refresh=true` / Contract ID flat / Bull=紅 Bear=綠
- **`_CACHE_VERSION_OPTIONS_CHIP = 1`** 新增,所有 5 新 keys 使用(F21)
- **`NIGHT_SESSION_AVAILABLE_FROM = date(2021, 10, 13)`**
- **`CHIP_WINDOW_TD = 250`**(共用 TaiwanOptionDaily window)
- **`data_quality_warnings: string[]`** 全 endpoint payload 帶
- **trading_calendar layering**:`services/trading_calendar.py`(I/O + cache)+ `utils/trading_calendar_helpers.py`(pure)
- **NoOpBucket**:`backend/tests/conftest.py`(test-only)
- **fetch_strike_volume 不合併**:既有與新 fetch 並存;MVP2 評估 merge

### 9.1 Contract Type Matrix(N5 修)

| SC | Monthly | Wed-Weekly | Fri-Weekly | Note |
|---|---|---|---|---|
| SC-1 Max Pain | ✅ | ✅ | ✅ | |
| SC-2 OI Walls (static) | ✅ | ✅ | ✅ | |
| SC-2 OI Walls (dynamic, window_activity) | ✅ | ⚠ partial | ⚠ partial | warning emitted |
| SC-3 PCR per_contract (weekly) | N/A | ⚠ unsupported_for_weekly warning + null region (N5) | same | UI shows "consider all_months" button |
| SC-3 PCR all_months | ✅ | ✅ | ✅ | |
| SC-4 Institutional | ✅ market-wide | ✅ same | ✅ same | not per-contract |
| SC-5/6 hit rate | ✅ | ⚠ short history | ⚠ same | |
| SC-7 next-day stats | ✅(scope=all_months always) | same | same | |
| SC-8 Foreign correlation | ✅ market-wide | same | same | |

## 10. 開發順序(v3 修)
1. **SC-0 schema probe(5 datasets)**(F19 + R6 + R9 + R10):probe.py + sanitize + drift static check + TaiwanFuturesDaily publication latency check
2. `utils/trading_calendar_helpers.py`(pure)+ `services/trading_calendar.py`(I/O + cache)
3. `backend/tests/conftest.py`:NoOpBucket + bypass_finmind_rate_limiter fixture(R8 + F15)
4. `services/finmind.py::fetch_taiwan_option_daily_window`(_run_once + 250-day canonical window + refresh invalidation)
5. Parsers(可並行):parse_max_pain → parse_oi_walls → parse_pcr → parse_institutional
6. Hit-rate parsers + correlation(permutation)
7. Routes(4 endpoint + PCR validation matrix)
8. Frontend:types + api + 4 hook + 4 卡片 + 2 chart 元件 + OptionsChipPanel + OptionsPage 整合
9. SC-10b failure isolation 在 OptionsChipPanel.test.tsx;SC-9 + non-trading-day 在 DevTools MCP

每 SC 對應 commit:🟢 test [red] → 🟢 feat [green] → 🔵 refactor 三類分離。
