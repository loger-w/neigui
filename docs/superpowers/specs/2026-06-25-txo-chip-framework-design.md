# txo-chip-framework — Design Spec (v4)

> /feat slug: `txo-chip-framework` | Phase 0/1 artifact | v1→v2→v3→v4 全於 2026-06-25/26 內完成

## Changelog
- **v1** (2026-06-25):初版
- **v2** (2026-06-26):Phase 1 round 1 後修 41 findings(12 P0 + 16 P1 + 13 P2)詳見 `design-review-round-1.json`
- **v3** (2026-06-26):Phase 1 round 2 後修 26 findings(1 P0 + 12 P1 + 13 P2)詳見 `design-review-round-2.json`
- **v4** (2026-06-26):Phase 1 round 3 後修 12 findings(**0 P0** + 5 P1 + 7 P2)詳見 `design-review-round-3.json`。Round 3 確認 round 2 全 P0/P1 修好,僅剩 implementation-tactical clarifications。重點 v4 變更:
  - **N11**:加 §1 invariant + 路由層 lookback 驗證(reject 400 if lookback × period > CHIP_WINDOW_TD)
  - **N12**:`utils/cache.py.delete_by_prefix` 契約(pattern-based invalidation across all lookback/threshold variants)
  - **N13**:`parse_oi_walls` 釘 K universe + `dynamic_wall_no_activity` / `_partial_listing` warnings
  - **I1**:invalidation 搬進 `_run_once` coroutine(after dedup, before fetch);只在 cache 真 miss/refresh 時 invalidate
  - **I2**:route 層 orchestrate `get_trading_days` 先抓,把 `list[date]` 傳給 `fetch_taiwan_option_daily_window` → **無循環 import**
  - 7 P2:cold-load math 校正、`conftest.py` 統一管理 singleton reset + FINMIND_TOKEN + NoOpBucket、frontend `queryClient.invalidateQueries` 跨 hook 同步、`latest_settlement_pending` 釐清為 boolean 不是 warning string、SC-6 schema 補 `avg_band_width_pct`、`partial_history_first_week` 撤出 catalog

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

**Canonical window size**(N1+F14 + v4 N11 修):
- 共用 `fetch_taiwan_option_daily_window` **單一 window = `CHIP_WINDOW_TD = 250` trading days**
- **INVARIANT(N11)**:`max(all_downstream_lookback_td_demands) ≤ CHIP_WINDOW_TD`
  - 路由層驗證 user-passed lookback:
    - `max_pain` lookback(合約數):反推 td 上限 = `lookback × 21`(月選最壞情況),若 > 250 → **400** `{error: "lookback_exceeds_canonical_window"}`
    - `oi_walls` 同上
    - `pcr` lookback td 直接驗 ≤ 250,否則 400
  - 預設值都在 invariant 內:max_pain/oi_walls 20 合約 × 21 ≤ 420 → 預設 20 合約 ✓(因為週/月混算實際更小);pcr 預設 250 ✓
- 各 parser slice 子 range:
  - Max Pain / OI Walls hit_rate:取相關結算日 t_minus_1 切片
  - PCR walk-forward:取整 250 td
- Institutional 60 td 獨立 fetch(資料源不同)

**Trading_calendar 編排路徑(I2 解 circular import)**:
- **Route 層先 orchestrate**:`routes/options.py` 中 4 個 handler 入口先呼叫 `services.trading_calendar.get_trading_days(end_date, CHIP_WINDOW_TD)` → 拿 `list[date]`
- 把 `list[date]` 傳給 `fetch_taiwan_option_daily_window(dates: list[date], ...)`
- `fetch_taiwan_option_daily_window` 不主動算 trading days,僅 fan-out 收到的日期清單
- `services/trading_calendar.py` 自帶 httpx call TaiwanFuturesDaily(reuse `get_finmind_rate_limiter()`)— **不**透過 `FinMindClient`,避免 `services/finmind ↔ trading_calendar` 循環

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

#### `services/trading_calendar.py`(F16 + v4 I2 修)
```python
# I/O + cache layer, **不**依賴 services/finmind.FinMindClient (避免循環 import)
import httpx
from services.rate_limiter import get_finmind_rate_limiter
from utils.trading_calendar_helpers import count_back_trading_days
from utils.cache import _read_cache_v, _write_cache_v

_TRADING_CAL_TTL_SEC = 7 * 24 * 3600
_TRADING_CAL_CACHE_KEY = "tx_trading_days_cache"

async def get_trading_days(end_date: date, n: int) -> list[date]:
    """
    回傳從 end_date 往回 n 個 AVAILABLE trading days.
    若 TaiwanFuturesDaily 對 end_date 未發布 → 用最近已發布日 (publication lag 容忍).
    Cached 7 days (calendar 變動極慢).
    自帶 httpx call (不透過 FinMindClient),reuse rate limiter.
    """
    cached_dates: list[date] = await _read_or_fetch_tx_trading_dates()
    return count_back_trading_days(cached_dates, end_date, n)

async def _read_or_fetch_tx_trading_dates() -> list[date]:
    """Read cache or fetch TaiwanFuturesDaily directly via httpx + shared rate limiter."""
    cached = _read_cache_v(_TRADING_CAL_CACHE_KEY, version=_CACHE_VERSION_OPTIONS_CHIP)
    if cached and (now - cached["fetched_at"] < _TRADING_CAL_TTL_SEC):
        return [date.fromisoformat(d) for d in cached["dates"]]
    limiter = get_finmind_rate_limiter()
    await limiter.acquire_async()
    async with httpx.AsyncClient(timeout=30.0) as cli:
        r = await cli.get("https://api.finmindtrade.com/api/v4/data", params={
            "dataset": "TaiwanFuturesDaily", "data_id": "TX",
            "start_date": (today - timedelta(days=400)).isoformat(),
            "token": settings.FINMIND_TOKEN,
        })
        r.raise_for_status()
    dates = sorted({date.fromisoformat(row["date"]) for row in r.json()["data"]})
    _write_cache_v(_TRADING_CAL_CACHE_KEY, {"fetched_at": now, "dates": [d.isoformat() for d in dates]}, version=_CACHE_VERSION_OPTIONS_CHIP)
    return dates
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

**parse_oi_walls**(N4 + v4 N13 修):
```python
def parse_oi_walls(
    rows_today: list[dict],
    rows_history: list[list[dict]],   # past delta_window trading days
    contract_date: str,
    delta_window: int,
    spot: float,
) -> tuple[dict, list[str]]:
    """
    Static walls: max OI strike per side, tie-break closest to spot
    
    Dynamic walls (N4 + N13 修):
      K universe per side (N13):
        - Call wall candidates = strikes with call_oi > 0 on end_date
        - Put  wall candidates = strikes with put_oi > 0 on end_date
        - (per side OI, 不混 call/put;static/dynamic 共享同一 universe)
      For each candidate K:
        activity(K) = Σ_{d in window} |oi_{d+1}(K) - oi_d(K)|
        Strike newly-listed at day d_first > window_start:
          - 把 d < d_first 的 oi 視為 0 → 第一筆會貢獻 large |ΔOI|
          - 設定 strike-level `partial_listing=true`
          - **預設保留**該 strike 進候選池(但每側產生 partial_listing warning)
      wall = strike with max activity per side, tie-break closest to spot
    
    Warnings (N13 補):
      - "dynamic_wall_partial_window": days_since_listing < delta_window (contract-level)
      - "dynamic_wall_partial_listing": 有任一候選 strike partial_listing=true
      - "dynamic_wall_no_activity": max activity == 0 (totally inactive market)
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
    self, trading_dates: list[date], end_date: date, refresh: bool = False
) -> dict[date, list[dict]]:
    """
    I2 修: trading_dates 由 route 層注入 (避免 circular import)
    I1 修: invalidation 搬進 _run_once 內,after dedup before fetch
    F17 修: _run_once wrap for inflight dedup
    F14 修: 固定 N=CHIP_WINDOW_TD trading days, 各 parser 自己 slice
    """
    cache_key = f"txo_daily_window_{end_date}_td{CHIP_WINDOW_TD}"
    return await self._run_once(
        f"window_{cache_key}",
        lambda: _do_fetch_window(cache_key, trading_dates, end_date, refresh),
    )

async def _do_fetch_window(cache_key: str, dates: list[date], end_date: date, refresh: bool):
    """I1 修: invalidate 在 dedup 後執行,並只在 cache miss 或 refresh 時做"""
    cached = _read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
    if cached and not refresh:
        return cached["data"]
    # 真要 refetch 才動下游 cache (避免 thrash on no-op refresh)
    await _invalidate_dependent_parse_caches(end_date, scope="all")
    # ... fan-out fetch dates ...
    _write_cache_v(cache_key, ...)

async def fetch_max_pain(self, contract, end_date, lookback, refresh):
    """
    Route 已先 get_trading_days(end_date, CHIP_WINDOW_TD) 並注入 dates.
    Lookback 已在 route 驗證 ≤ CHIP_WINDOW_TD (N11).
    """
async def fetch_oi_walls(...):
async def fetch_pcr(...):
async def fetch_institutional(...):  # 獨立路徑,不需 shared window
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

**`utils/cache.py` 契約擴充(N12 修)**:
- 新增 `delete_by_prefix(prefix: str) -> int`(回傳刪除筆數)
- `_invalidate_dependent_parse_caches(end_date, scope)` 用以下 prefix:
  - `max_pain_{contract}_{end_date}_` → 涵蓋所有 lookback 變體
  - `oi_walls_{contract}_{end_date}_` → 涵蓋所有 lookback × delta_window
  - `pcr_series_{scope}_{contract or 'all'}_{end_date}_` → 跨 lookback
  - `pcr_classified_{scope}_{contract or 'all'}_{end_date}_` → 跨 lookback × high × low
- contract 為 `None`(institutional 不分 contract)時 prefix 不含 contract 段

**fetch_strike_volume 不合併**(F20):既有 endpoint 抓 7-day window,本 spec 抓 250-day。MVP1 維持兩條 fetch,標記為 MVP2 評估 merge 候選。

**Cold-load math 重算(v4 C1 修)**:
- TaiwanOptionDaily: 250 calls(共用 window)
- TaiwanOptionInstitutionalInvestors(日盤)+ AfterHours(夜盤): 60 × 2 = 120 calls
- TaiwanFuturesDaily(TX returns, range query): 1 call
- trading_calendar: 1 call(7-day cache,絕大多數 hit)
- 合計 cold-start = **372 calls** / 5 req/s = **~74 秒**(不是 v3 寫的 62 秒)
- **SC-0 probe 同時驗 institutional dataset 是否支援 range query**;若支援 → 兩條合計 2 calls → 252 + 2 + 1 = **255 calls / 5 req/s = ~51 秒**

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

## 3. Data flow(F18 + v4 I1 + T2 修)

正常流:路由先 `get_trading_days(end_date, CHIP_WINDOW_TD)` → 傳 dates 給 fetch_taiwan_option_daily_window;4 卡片並行;失敗隔離。

**Refresh 流(I1 修 — invalidation 在 `_run_once` 內,after dedup)**:
- 單卡 refresh `?refresh=true`(後端):
  - 進 `fetch_taiwan_option_daily_window` `_run_once` dedup
  - 在 dedup 取得 lock 後 inside coroutine:read cache + 若 miss/refresh → 才 `_invalidate_dependent_parse_caches(end_date, scope="all")`(prefix-based, N12)+ 真正 fan-out
  - 並發 refresh 共享同一個 invalidate-then-fetch task,**不** thrash
  - cache hit 時(refresh=False)完全不動下游 parse cache
- Frontend coordination(T2 修):`OptionsChipPanel` 提供 `handleAnyRefresh` callback:當任一卡按 refresh,呼叫:
  ```typescript
  queryClient.invalidateQueries({ queryKey: ["options-max-pain", contract, date] });
  queryClient.invalidateQueries({ queryKey: ["options-oi-walls", contract, date] });
  queryClient.invalidateQueries({ queryKey: ["options-pcr", contract, date] });
  // institutional 不在 cascade(資料源獨立)
  ```
- Institutional refresh 只 invalidate 自己 cache(無 cascade)

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
  | SC-6 | samples, pct_settled_inside_band, avg_band_width_pct, history (≤ 20 entries) |  <!-- v4 F23 補 -->

  | SC-7 | high_region, neutral_region, low_region 各 dict(mean_pct, std_pct, hit_positive, samples) |
  | SC-8 | samples, latest_corr, latest_p_value, history, is_significant, feature_transformation |
  | SC-10 | error responses 對應 status + detail.error code |
  | SC-10b | failure isolation 4 卡狀態 |
  | SC-11 | warning strings 集合 |

- **Fixture size budget**:每 fixture file ≤ 50 KB;SC-3 PCR 序列只存 `{date, pcr}` 而非 full OI rows;SC-5/6 settlement 紀錄壓縮到必要欄位

- **`backend/tests/conftest.py` 統一管理**(v4 T1 + F22 + F15 修;**新增專案級 conftest**,既有 test 檔的 module-local `_reset_singleton` 必須刪除):
  ```python
  # backend/tests/conftest.py  (NEW — 整 backend test suite 共用)
  import pytest
  
  class NoOpBucket:
      """Test-only no-op token bucket; duck-types services.rate_limiter.TokenBucket."""
      rate: float = float("inf")
      async def acquire_async(self, tokens: int = 1, timeout: float | None = None) -> bool:
          return True
      async def acquire(self, tokens: int = 1, timeout: float | None = None) -> bool:
          return True
  
  @pytest.fixture(autouse=True)
  def _reset_finmind_singleton_and_env(monkeypatch, tmp_path):
      """T1 修:統一管理。**取代** test_finmind.py / test_finmind_options.py 的 module-local _reset_singleton。
      
      F22 修:也 set FINMIND_TOKEN env (FinMindClient.__init__ raises ValueError if empty).
      F15 修:reset _client = None forces rebuild on next get_finmind()."""
      monkeypatch.setenv("FINMIND_TOKEN", "test-token")
      monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
      import services.finmind as fm
      monkeypatch.setattr(fm, "_client", None)
      monkeypatch.setattr(fm, "_fm_limiter", None)
  
  @pytest.fixture
  def bypass_finmind_rate_limiter(monkeypatch):
      """Opt-in:在 _reset_finmind_singleton_and_env 之上,把 limiter 換成 NoOp。"""
      import services.finmind as fm
      monkeypatch.setattr(fm, "get_finmind_rate_limiter", lambda: NoOpBucket())
      monkeypatch.setattr(fm, "_client", None)
  ```
  **遷移步驟**:在實作前先刪除既有 `test_finmind.py` / `test_finmind_options.py` 內的 module-local `_reset_singleton` autouse fixture(避免和 conftest 衝突)

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
    - `test_refresh_invalidates_dependent_pcr_keys_across_threshold_variants`(v4 N12)
    - `test_refresh_invalidation_is_inside_run_once_not_before`(v4 I1: 並發 refresh 不 thrash)

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
- **R11** (v4 新):User-supplied lookback 必須在 route 層驗證 ≤ CHIP_WINDOW_TD,否則 400(N11)
- **R12** (v4 新):`utils/cache.py` 必須加 `delete_by_prefix`;invalidation cascade 必須是 pattern-based(N12)
- **R13** (v4 新):`services/trading_calendar.py` 自帶 httpx,**不**透過 `FinMindClient`(I2,避免循環 import);如未來想統一,需先解耦兩者

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
