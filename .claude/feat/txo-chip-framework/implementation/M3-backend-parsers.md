# M3 — Backend Parsers Implementation Spec

> Module of `/feat txo-chip-framework`. Phase 2 per-file implementation spec.
> Source: design v4 (`docs/superpowers/specs/2026-06-25-txo-chip-framework-design.md`) + brainstorm (`.claude/feat/txo-chip-framework/brainstorm.md`).
> Scope: pure parser functions in `backend/services/finmind_options.py` + their unit tests in `backend/tests/test_finmind_options.py`.

## 0. Scope & rules

- **In scope (this module)**: 4 base parsers + 4 hit_rate/stats/correlation parsers, **as standalone module-level functions** (brainstorm §6.1: "standalone def, 不引入 class")。每個 parser 是純函式 — 不做 I/O、不讀 cache、不 await。
- **Out of scope (here)**: route handlers (M5), `services/finmind.py` client methods (M4), `services/trading_calendar.py` + helpers (M2), cache/version constants (M1), frontend (M6+).
- **Type hints 強制**:`from __future__ import annotations` 已在檔頭(沿用既有)。新函式全部 kwargs-only(`*,`)+ 完整 type hints。
- **Warning strings 必須完全等於 catalog**(brainstorm §SC-11 表 + design v4 §2.2 docstring)。測試用 `assert "exact_string" in warnings`(不可 substring)。
- **常數來源(M1 提供)**:
  - `NIGHT_SESSION_AVAILABLE_FROM: date = date(2021, 10, 13)`
  - `_CACHE_VERSION_OPTIONS_CHIP = 1`(本模組不直接用,但同檔)
  - `MAX_PAIN_MULTIPLIER_NTD = 50`(新增,SC-1 F14)
  - `MIN_PCR_WALKFORWARD_SAMPLES = 30`(SC-3)
  - `PCR_STATS_LOW_POWER_THRESHOLD = 30`(SC-7 N8)
  - `PCR_STATS_DROPPED_SAMPLES_THRESHOLD = 0.05`(SC-7 N9)
  - `CORRELATION_SAMPLE_SMALL_THRESHOLD = 30`(SC-8)
  - `CORRELATION_PERMUTATION_N = 1000`(SC-8 N2)
  - `CORRELATION_SIGNIFICANCE_P = 0.10`(SC-8)

---

## 1. File: `backend/services/finmind_options.py` (EXTEND)

### 1.1 Top-of-file additions (constants block)

在既有 import / constants 區塊新增:

```python
from __future__ import annotations

from datetime import date
from statistics import mean, pstdev
from typing import Literal

# 新增常數(對應 design v4 §9 跨檔契約 + brainstorm catalog)
MAX_PAIN_MULTIPLIER_NTD: int = 50
NIGHT_SESSION_AVAILABLE_FROM: date = date(2021, 10, 13)
MIN_PCR_WALKFORWARD_SAMPLES: int = 30
PCR_STATS_LOW_POWER_THRESHOLD: int = 30
PCR_STATS_DROPPED_SAMPLES_THRESHOLD: float = 0.05
CORRELATION_SAMPLE_SMALL_THRESHOLD: int = 30
CORRELATION_PERMUTATION_N: int = 1000
CORRELATION_SIGNIFICANCE_P: float = 0.10
```

> 若 M1 / M4 已宣告同名常數,匯入再 re-export,避免重複定義。

### 1.2 `parse_max_pain` (SC-1)

**位置**:檔尾 standalone def。

```python
def parse_max_pain(
    *,
    rows: list[dict],
    contract_date: str,
) -> tuple[dict, list[str]]:
    """
    Compute Max Pain for a single contract on a single trading day.

    Algorithm (design v4 §4.1 + brainstorm SC-1):
      1. STRICT contract filter: keep only rows where row["contract_date"] == contract_date
         (F2 — 不靠 row["data_id"] 字串 startswith,因為週/月混)
      2. Candidate strike universe = union(strikes with call_oi > 0, strikes with put_oi > 0)
         (F1 — asymmetric OTM 也要被納入)
      3. For each candidate K:
           total_loss(K) = Σ_i call_oi_i × max(0, K_i - K) + Σ_j put_oi_j × max(0, K - K_j)
         (loss expressed in option-OI points; multiplier applied at the very end)
      4. max_pain = arg min K total_loss(K). Tie-break: smaller K wins
         (deterministic; brainstorm 未指定 tie-break,選 smaller-K for stability)
      5. total_loss_ntd = min_loss_points × MAX_PAIN_MULTIPLIER_NTD  (F14)

    Returns:
      (current, warnings)
        current = {
          "max_pain": int,                          # integer strike
          "total_loss_ntd": float,                  # min_loss × 50, NTD
          "strike_count": int,                      # |candidate K|
          "strikes_with_call_oi_only": int,
          "strikes_with_put_oi_only": int,
        }
        warnings: list[str]   # empty here; warnings only emitted by hit-rate parser

    Raises:
      ValueError if rows is empty after strict filter → route maps to insufficient_data
    """
```

**Implementation notes**:
- 用 `int(row["strike_price"])`(probe 已驗欄位名;若 SC-0 顯示 float,改 `float` 但 `max_pain` 仍 cast 回 int)。
- `call_oi` / `put_oi` 欄位名:依 SC-0 probe 結果。若 probe 顯示是 `open_interest` 含 `call_put` 區分,在 parser 內聚合:`call_oi = sum(r["open_interest"] for r in rows if r["call_put"] == "call" and r["strike_price"] == K)`。
- `strikes_with_call_oi_only` = `|{K : call_oi(K) > 0, put_oi(K) == 0}|`
- 不 catch exception;讓 ValueError 穿透到 route 的 global handler。

### 1.3 `parse_max_pain_hit_rate` (SC-5)

```python
def parse_max_pain_hit_rate(
    *,
    settled_contracts: list[dict],
    oi_by_trading_day: dict[date, list[dict]],
    settlement_prices: dict[str, float],
    trading_days_sorted: list[date],
) -> tuple[dict | None, bool, list[str]]:
    """
    Compute historical hit rate over past settled contracts.

    Args:
      settled_contracts: each item =
        {"contract_date": str, "settlement_date": date}
      oi_by_trading_day: {trading_day: rows_of_that_day} (already sliced from shared window)
      settlement_prices: {contract_date: settlement_price} from TaiwanOptionFinalSettlementPrice
      trading_days_sorted: ascending trading-day list, used to find t_minus_1

    Algorithm (design v4 §4 SC-5 + brainstorm):
      For each (contract_date, settlement_date) c:
        t = settlement_date
        t_minus_1 = trading_days_sorted[idx(t) - 1]      # F3 — strict T-1
        if t_minus_1 not in oi_by_trading_day:           # data gap
          skip sample
        if contract_date not in settlement_prices:       # F10 — latest pending
          latest_settlement_pending = True; skip
        max_pain_t1 = parse_max_pain(rows=oi_by_trading_day[t_minus_1],
                                     contract_date=contract_date)[0]["max_pain"]
        settlement = settlement_prices[contract_date]
        deviation_pct = (settlement - max_pain_t1) / settlement

      hit_rate = {
        "samples": int,
        "median_abs_deviation_pct": float,
        "hit_within_1pct": float,                     # ratio in [0, 1]
        "hit_within_2pct": float,
        "history": [                                  # newest-first, ≤ 20 entries
          {"settlement_date": "YYYY-MM-DD",
           "max_pain_at_t_minus_1": int,
           "settlement_price": float,
           "deviation_pct": float}, ...
        ],
      }

    Returns:
      (hit_rate or None, latest_settlement_pending, warnings)
      hit_rate is None when samples == 0 → route emits insufficient_data
    """
```

**Notes**:
- `median_abs_deviation_pct = median([abs(d) for d in deviation_pcts])`(用 `statistics.median`)。
- `hit_within_Xpct = sum(1 for d in deviation_pcts if abs(d) <= X/100) / samples`。
- 不 emit warmup warning;hit rate 本身不會 walk-forward warmup。
- `latest_settlement_pending` 為 boolean,**不**塞進 warnings(v4 F24)。

### 1.4 `parse_oi_walls` (SC-2)

```python
def parse_oi_walls(
    *,
    rows_today: list[dict],
    rows_history_by_day: dict[date, list[dict]],
    contract_date: str,
    delta_window: int,
    spot: float,
    end_date: date,
    trading_days_sorted: list[date],
) -> tuple[dict, list[str]]:
    """
    Compute static + dynamic OI walls per side (call / put).

    Args:
      rows_today: rows on end_date for contract_date (already strict-filtered upstream OK,
        but parser still applies strict filter defensively)
      rows_history_by_day: {trading_day: rows_of_that_day} covering at least
        [end_date - delta_window trading days, end_date]
      delta_window: N trading days for dynamic activity calc
      spot: TX spot on end_date (used for tie-break)
      end_date: anchor date
      trading_days_sorted: ascending list of available trading days

    Algorithm (design v4 §4.2 + N4 + N13):
      STATIC walls (per side):
        per_side_strikes = {K: oi for rows on end_date with that side, oi > 0}
        wall = argmax oi
        tie-break: among ties, pick K minimizing |K - spot|;
                   if still tied (rare), pick smaller K
        (call_universe and put_universe are disjoint per side; static + dynamic share
         the same per-side universe — N13)

      DYNAMIC walls (per side, N4 + N13):
        window_start_idx = max(0, idx(end_date) - delta_window)
        window_days = trading_days_sorted[window_start_idx : idx(end_date) + 1]
        partial_window = len(window_days) - 1 < delta_window     # contract-level

        candidates_K = per-side strikes with oi > 0 on end_date (N13: K universe = today's
          per-side strikes; do NOT include strikes that have disappeared today)

        For each K in candidates_K:
          oi_series = [oi_on_day(d, K, side) for d in window_days]   # missing day → 0
          activity(K) = sum(abs(oi_series[i+1] - oi_series[i])
                            for i in range(len(oi_series)-1))
          strike_first_seen_in_window = first d where oi_on_day(d, K, side) > 0
          if window_days[0] < strike_first_seen_in_window:
            strike_level_partial_listing = True   # else False

        dynamic_wall = argmax activity over candidates_K
        tie-break: same as static (closest to spot, then smaller K)

      Band:
        if static_call_wall.strike > static_put_wall.strike:
            band_width_pct = (call - put) / spot * 100
        else: band_width_pct = 0.0   # degenerate / inverted

    Warnings (brainstorm catalog + N13):
      - "dynamic_wall_partial_window"    if partial_window is True (contract-level)
      - "dynamic_wall_partial_listing"   if any candidate's strike_level_partial_listing
      - "dynamic_wall_no_activity"       if max activity across candidates == 0

    Returns:
      (current, warnings)
        current = {
          "static_call_wall": {"strike": int, "oi": int},
          "static_put_wall":  {"strike": int, "oi": int},
          "dynamic_call_wall": {
            "strike": int,
            "window_activity_oi": int,
            "partial_window": bool,
          },
          "dynamic_put_wall": {...},
          "band_width_pct": float,
        }
    """
```

**Notes**:
- `oi_on_day(d, K, side)`:helper inline 或 module-private `_oi_lookup`。Missing day or missing K → 0.
- 嚴格 contract filter:parser 入口先 `rows_today_filtered = [r for r in rows_today if r["contract_date"] == contract_date]`,history 同理(每日 filter)。
- `delta_window` 預設值在 route 層帶入(5),parser 不設 default。
- `partial_window` 出現在 dict 內(per-side)**也**會 emit warning。dict 內 boolean 給 frontend badge 用;warning 給 catalog 顯示用。

### 1.5 `parse_oi_walls_hit_rate` (SC-6)

```python
def parse_oi_walls_hit_rate(
    *,
    settled_contracts: list[dict],
    oi_by_trading_day: dict[date, list[dict]],
    settlement_prices: dict[str, float],
    trading_days_sorted: list[date],
    delta_window: int,
    spot_by_trading_day: dict[date, float],
) -> tuple[dict | None, bool, list[str]]:
    """
    Historical hit rate: for each settled contract, was settlement inside the
    [Put Wall, Call Wall] band derived from T-1 OI?

    Algorithm (brainstorm SC-6 + v4 F23 schema):
      For each (contract_date, settlement_date):
        t_minus_1 = trading_days_sorted[idx(settlement_date) - 1]
        walls = parse_oi_walls(rows_today=oi_by_trading_day[t_minus_1], ...,
                               end_date=t_minus_1, spot=spot_by_trading_day[t_minus_1])[0]
        put_wall = walls["static_put_wall"]["strike"]
        call_wall = walls["static_call_wall"]["strike"]
        lo, hi = min(put_wall, call_wall), max(...)
        inside_band = lo <= settlement_prices[contract_date] <= hi
        band_width_pct = (hi - lo) / spot * 100      # for avg

    Returns:
      (hit_rate or None, latest_settlement_pending, warnings)
        hit_rate = {
          "samples": int,
          "pct_settled_inside_band": float,         # in [0, 1]
          "avg_band_width_pct": float,              # v4 F23 補
          "history": [
            {"settlement_date": "YYYY-MM-DD",
             "put_wall_at_t_minus_1": int,
             "call_wall_at_t_minus_1": int,
             "settlement_price": float,
             "inside_band": bool}, ...
          ],
        }
    """
```

**Notes**:
- 不 re-emit `dynamic_wall_*` warning(那些 belong to current,不是 hit rate)。
- Sample 結構 ≤ 20(最近的 20 個結算)。

### 1.6 `parse_pcr_history` (SC-3 base)

```python
def parse_pcr_history(
    *,
    rows_by_trading_day: dict[date, list[dict]],
    scope: Literal["per_contract", "all_months"],
    contract_date: str | None,
) -> list[tuple[date, float]]:
    """
    Build daily PCR series.

    Algorithm (design v4 §2.2 parse_pcr_history + brainstorm SC-3):
      For each d in sorted(rows_by_trading_day.keys()):
        rows_d = rows_by_trading_day[d]
        if scope == "per_contract":
          if contract_date is None: raise ValueError("contract_date_required_for_per_contract")
          rows_d = [r for r in rows_d if r["contract_date"] == contract_date]
        # scope == "all_months": keep all rows (TXO sponsor returns all contracts in 1 call)
        sum_put_oi = Σ rows_d where side == put
        sum_call_oi = Σ rows_d where side == call
        if sum_call_oi == 0: skip day  (division-undefined; warning emitted by caller if needed)
        pcr_d = sum_put_oi / sum_call_oi
      return [(d, pcr_d), ...]   ascending by d
    """
```

**Notes**:
- 無 weekly-warning 在此 — N5 warning 是 route 層產出(用 contract_date 判斷後綴 W/F),parser 純算數。
- 0-call-OI 跳過,**不**emit 警告(罕見;若 PCR series 太短會由 walk_forward 觸發 warmup warning)。

### 1.7 `parse_pcr_walk_forward_percentile` (SC-3)

```python
def parse_pcr_walk_forward_percentile(
    *,
    pcr_history: list[tuple[date, float]],
    high_pct: float = 70.0,
    low_pct: float = 30.0,
    min_samples: int = MIN_PCR_WALKFORWARD_SAMPLES,
) -> tuple[list[tuple[date, float, float | None, str | None]], list[str]]:
    """
    Walk-forward percentile classification — STRICTLY past window.

    Algorithm (design v4 §2.2 + brainstorm SC-3 + F14):
      classified = []
      count_skip = 0
      for i, (d, pcr_d) in enumerate(pcr_history):
        past_window = [pcr for (_, pcr) in pcr_history[:i]]   # strictly past, len = i
        if len(past_window) < min_samples:
          classified.append((d, pcr_d, None, None))           # region=None
          count_skip += 1
          continue
        pct = scipy.stats.percentileofscore(past_window, pcr_d, kind="mean")
        region = "high" if pct >= high_pct else "low" if pct <= low_pct else "neutral"
        classified.append((d, pcr_d, pct, region))

      warnings = []
      if count_skip > 0:
        warnings.append(f"pcr_walk_forward_warmup_skipped_first_{count_skip}_days")
        # F14: single consolidated warning, NOT one per day

    Returns:
      (classified, warnings)
        classified entry = (date, pcr, percentile_or_None, region_or_None)
    """
```

**Notes**:
- Import `from scipy.stats import percentileofscore`(scipy 已是 deps via numpy 親緣;若缺,加進 `pyproject.toml` — M0 / M1 處理)。
- `kind="mean"` 是測試明確驗證點(brainstorm:`_percentile_tie_break_kind_mean`)。
- 為了測試 lookahead,fixture 會構造「未來日值極端」的序列,assert classified[i] 的 percentile 不受 i+k 影響。

### 1.8 `parse_pcr_next_day_stats` (SC-7)

```python
def parse_pcr_next_day_stats(
    *,
    classified: list[tuple[date, float, float | None, str | None]],
    tx_returns: dict[date, float],
) -> tuple[dict | None, list[str]]:
    """
    Next-day TX return stats by PCR region. NOT a backtest. NO P&L, NO Sharpe.

    Algorithm (design v4 §2.2 + brainstorm SC-7 + F17 + N8 + N9):
      regions = ["high", "neutral", "low"]
      result = {}
      warnings = []

      for region_name in regions:
        samples_in_region = [d for (d, _, _, r) in classified if r == region_name]
        with_next_return = [d for d in samples_in_region if (d's next trading day) in tx_returns]

        if samples_in_region:
          dropped_ratio = (len(samples_in_region) - len(with_next_return)) / len(samples_in_region)
          if dropped_ratio > PCR_STATS_DROPPED_SAMPLES_THRESHOLD:
            warnings.append("next_day_stats_dropped_samples_5pct")
            # N9: single consolidated warning across all regions (dedupe)

        if not with_next_return:
          result[f"{region_name}_region"] = {"mean_pct": 0.0, "std_pct": 0.0,
                                              "hit_positive": 0.0, "samples": 0}
          continue

        returns = [tx_returns[next_trading_day(d)] for d in with_next_return]
        result[f"{region_name}_region"] = {
          "mean_pct":     mean(returns) * 100,                      # convert to %
          "std_pct":      pstdev(returns) * 100 if len(returns) > 1 else 0.0,
          "hit_positive": sum(1 for r in returns if r > 0) / len(returns),
          "samples":      len(with_next_return),                    # F17: samples INSIDE region
        }

        if len(with_next_return) < PCR_STATS_LOW_POWER_THRESHOLD:
          warnings.append(f"pcr_stats_low_power_{region_name}")   # N8

      # dedupe warnings list (preserve order)
      seen = set(); warnings = [w for w in warnings if not (w in seen or seen.add(w))]

      if all(result[k]["samples"] == 0 for k in result):
        return None, warnings   # caller maps to insufficient_data
      return result, warnings
    """
```

**Notes**:
- "next trading day" 由 caller 提供 — parser 用 `tx_returns` 的 keys 推:`next_trading_day(d)` = `min({k for k in tx_returns.keys() if k > d})` 或 None。
  - 為避免每次 O(N),預先建 `sorted_tx_dates = sorted(tx_returns)`,再用 `bisect_right`。
- `mean_pct` / `std_pct` 是百分點(× 100);frontend 預期 number 直接顯示「%」suffix。
- F17 schema:**top-level** 只有 `high_region` / `neutral_region` / `low_region`,**不**有 top-level `samples_X` keys(這就是「schema unify」)。

### 1.9 `parse_institutional` (SC-4)

```python
def parse_institutional(
    *,
    day_session_rows: list[dict],
    after_hours_rows: list[dict] | None,
    date_anchor: date,
    prev_day_rows: list[dict] | None = None,
) -> tuple[dict, list[str]]:
    """
    Parse institutional positioning (foreign / dealer / trust) for a single day.

    Algorithm (design v4 §2.2 + brainstorm SC-4 + F3-integration):
      institutions = ["foreign", "dealer", "trust"]   # NOT "prop" — F3-integration

      For each inst:
        day = aggregate over day_session_rows where row.institution == inst
        # FinMind dataset may name as "外資" / "自營商" / "投信" — map at the
        # very entry point (probe-driven). NEVER expose 中文 keys in payload.

        after_hours = aggregate over after_hours_rows if not None
        total = day + after_hours (else just day)
        day_change = total - prev_total (if prev_day_rows given, else 0)

        result[inst] = {
          "call_net":  call_long - call_short,         # net OI
          "put_net":   put_long  - put_short,
          "total_net": call_net + put_net,             # signed
          "day_change": day_change_total_net,
        }

      session_breakdown = {
        "day_session": {inst: {...} for inst in institutions},
        "after_hours": {inst: {...}} if date_anchor >= NIGHT_SESSION_AVAILABLE_FROM
                                     and after_hours_rows is not None
                       else None,
      }

      warnings = []
      if date_anchor < NIGHT_SESSION_AVAILABLE_FROM:
        warnings.append("night_session_not_available_pre_2021")

    Returns:
      (current, warnings)
        current = {
          "foreign": {...}, "dealer": {...}, "trust": {...},
          "session_breakdown": {...},
        }
    """
```

**Notes**:
- 中文 → 英文 institution mapping table 放 module-private constant:
  ```python
  _INSTITUTION_NAME_MAP: dict[str, str] = {
      "外資": "foreign", "外資及陸資": "foreign",
      "自營商": "dealer", "自營商(避險)": "dealer",
      "投信": "trust",
  }
  ```
  Mapping 細節等 SC-0 probe 落地後 lock。
- `day_change` 計算需要 prev_day rows;route 層多抓 1 天即可。Parser 內 `prev_day_rows is None` → `day_change = 0`(明確紀錄)。

### 1.10 `parse_institutional_correlation` (SC-8)

```python
def parse_institutional_correlation(
    *,
    foreign_history: list[dict],
    tx_returns: dict[date, float],
    corr_window: int = 60,
    permutation_n: int = CORRELATION_PERMUTATION_N,
    feature_transformation: Literal["raw_flow", "first_difference"] = "raw_flow",
    rng_seed: int = 0,
) -> tuple[dict | None, list[str]]:
    """
    Rolling 60-day Spearman correlation between foreign call_net and next-day TX return,
    with permutation p-value. ONLY foreign — scope guard (F10-test).

    Args:
      foreign_history: [{"date": date, "call_net": float, "put_net": float}, ...] ascending
      tx_returns: {trading_day: pct_return}
      corr_window: rolling window size in trading days (default 60)
      permutation_n: number of permutations (default 1000, N2)
      feature_transformation: N3
        "raw_flow" (default): correlate call_net[t] directly vs tx_returns[next_day(t)]
        "first_difference": (call_net[t] - call_net[t-1]) vs tx_returns[next_day(t)]
      rng_seed: for reproducible permutation in tests

    Algorithm (design v4 §4.6 + N2 + N3):
      Build feature:
        if raw_flow:        feature = [(d, call_net) for d in foreign_history]
        if first_difference: feature = [(d, call_net[i] - call_net[i-1])
                                        for i in range(1, len(...))]

      Pair with next-day return:
        pairs = [(d, f_d, tx_returns[next_trading_day(d)]) for ...]
        skip if next_trading_day(d) not in tx_returns

      For each rolling window of size corr_window ending at t:
        sample_pairs = pairs[i-corr_window+1 : i+1]
        f = [f for (_, f, _) in sample_pairs]
        r = [r for (_, _, r) in sample_pairs]
        r_obs = scipy.stats.spearmanr(f, r).statistic     # NaN-safe; if NaN → skip

        rng = numpy.random.default_rng(rng_seed + i)        # deterministic per window
        count_extreme = 0
        for _ in range(permutation_n):
          r_shuffled = rng.permutation(r)
          r_perm = spearmanr(f, r_shuffled).statistic
          if abs(r_perm) >= abs(r_obs):
            count_extreme += 1
        p_value = (count_extreme + 1) / (permutation_n + 1)

        history.append({"date": d.isoformat(), "corr": r_obs, "p_value": p_value})

      warnings = []
      if len(pairs) < CORRELATION_SAMPLE_SMALL_THRESHOLD:
        warnings.append("correlation_sample_small")
      first_date = foreign_history[0]["date"] if foreign_history else None
      if first_date and first_date < NIGHT_SESSION_AVAILABLE_FROM:
        warnings.append("after_hours_partial_coverage")

      if not history:
        return None, warnings

    Returns:
      (current, warnings)
        current = {
          "samples":  len(history),
          "latest_corr": history[-1]["corr"],
          "latest_p_value": history[-1]["p_value"],
          "history": history,
          "is_significant": history[-1]["p_value"] < CORRELATION_SIGNIFICANCE_P,
          "feature_transformation": feature_transformation,
        }

    Scope guard (F10-test + brainstorm SC-8):
      Output dict MUST NOT contain "dealer" or "trust" keys.
      Test `_excludes_dealer_trust_from_correlation_payload` asserts this.
    """
```

**Notes**:
- `from scipy.stats import spearmanr`。
- `numpy.random.default_rng(rng_seed + i)` 使每個 window 的 permutation 在固定 seed 下完全 deterministic — 測試可硬比 latest_p_value 等於某個值。
- Performance:60 sample × 1000 perm × N window — Phase 2 verify;若太慢 fallback 到 vectorized `scipy.stats.permutation_test`。MVP 先求對。

---

## 2. File: `backend/tests/test_finmind_options.py` (EXTEND)

### 2.1 Header / imports

既有測試保留。在檔尾新增 test functions(brainstorm §6.1 規定 **standalone def,不引入 class**)。

```python
from datetime import date
from services.finmind_options import (
    parse_max_pain, parse_max_pain_hit_rate,
    parse_oi_walls, parse_oi_walls_hit_rate,
    parse_pcr_history, parse_pcr_walk_forward_percentile, parse_pcr_next_day_stats,
    parse_institutional, parse_institutional_correlation,
    NIGHT_SESSION_AVAILABLE_FROM,
)
```

### 2.2 Test list (verbatim names per brainstorm §6.1)

**Max Pain (SC-1)** — fixtures: `backend/tests/fixtures/options_chip/max_pain/{basic,asymmetric_otm,mixed_contract,multiplier}/{rows.json, expected.json}`

- `test_parse_max_pain_basic`
  - Standard 11-strike symmetric chain → assert `current["max_pain"]` == expected integer。
- `test_parse_max_pain_union_strikes_asymmetric_otm`
  - Fixture 故意 call-OI 集中在 high strikes、put-OI 集中在 low strikes,union ≠ intersection。Assert candidate universe 包含兩側 OTM。
- `test_parse_max_pain_strict_contract_filter`
  - Rows 混入別張合約 (e.g. TXO202607W2 vs TXO202607)。Assert parser 只用 contract_date 匹配的 rows。
- `test_parse_max_pain_total_loss_includes_multiplier_50`
  - 簡單 fixture 手算 total_loss_points,assert `total_loss_ntd == points × 50` (相對 tol 1e-6, brainstorm SC-1)。

**Max Pain hit rate (SC-5)** — fixtures: `.../max_pain_hit/`

- `test_parse_max_pain_hit_rate_uses_t_minus_1`
  - Fixture 構造 t-day 與 t-1-day OI 差異大,assert hit-rate 使用 t-1 的 max_pain(brainstorm 對抗測試)。
- `test_parse_max_pain_hit_rate_excludes_pending_settlement`
  - settlement_prices 缺最新一筆 → latest_settlement_pending=True, sample 被剔除。
- `test_parse_max_pain_hit_rate_partial_history_warning`
  - 史料 < 20 樣本 → 仍計算但 history 長度 < 20。`insufficient_data` 由 route 層判,parser 不 emit warning。

**OI Walls (SC-2)** — fixtures: `.../oi_walls/`

- `test_parse_oi_walls_static_tie_break_by_spot`
  - 兩 strike 同 OI → assert wall = closer to spot。
- `test_parse_oi_walls_dynamic_uses_activity_not_telescoping_delta`(N4)
  - Fixture:strike A oi 漲後跌回(net Δ=0),strike B 單調漲(net Δ=10);activity(A) = 20 > activity(B) = 10 → wall = A。
  - 對抗 v2 的 telescoping delta(會錯選 B)。
- `test_parse_oi_walls_partial_window_for_young_weekly`
  - days_since_listing < delta_window → `partial_window=True` 且 warnings 含 `dynamic_wall_partial_window`。
- `test_parse_oi_walls_emits_partial_listing_warning`(N13 補)
  - Candidate strike 在 window 中段才上市 → `dynamic_wall_partial_listing` warning。
- `test_parse_oi_walls_emits_no_activity_warning`(N13 補)
  - 所有 strike activity=0 (history rows 與 today 完全相同) → `dynamic_wall_no_activity` warning。

**OI Walls hit rate (SC-6)** — fixtures: `.../oi_walls_hit/`

- `test_parse_oi_walls_hit_rate_t_minus_1`
  - history 5 個結算合約;Settlement 落在 band 內 / 外的混合,assert pct_settled_inside_band 對。
  - 同時驗 payload 含 `avg_band_width_pct`(v4 F23)。

**PCR base (SC-3)** — fixtures: `.../pcr/`

- `test_parse_pcr_history_per_contract_vs_all_months`
  - 同一 fixture 跑兩次 scope,assert `per_contract` 只用 contract_date 過濾的 rows、`all_months` 用全部。

**PCR walk-forward (SC-3)** — same dir

- `test_parse_pcr_walk_forward_no_lookahead`
  - 對抗測試:在 i+5 故意塞極端值。Assert classified[i] 的 percentile 不變(只看 strict past)。
- `test_parse_pcr_walk_forward_emits_single_warmup_warning_not_per_day`(F14)
  - Series 長 50 天,min_samples=30 → 前 30 天 skip。Assert warnings == `["pcr_walk_forward_warmup_skipped_first_30_days"]`(**單一** consolidated,**不**是 30 個 warning)。
- `test_parse_pcr_walk_forward_percentile_tie_break_kind_mean`
  - 構造同值多筆 fixture,assert percentile 使用 `kind="mean"`(`percentileofscore` mean 與 weak 不同的 case)。

**PCR next-day stats (SC-7)** — fixtures: `.../pcr_stats/`

- `test_parse_pcr_next_day_stats_no_pnl_no_sharpe`
  - Assert returned dict 不含 "pnl" / "sharpe" / "cumulative" 等 key。
- `test_parse_pcr_next_day_stats_payload_schema_exact`(F17)
  - 用 `assert set(result.keys()) == {"high_region", "neutral_region", "low_region"}`。
  - 每 region 內 keys == `{"mean_pct", "std_pct", "hit_positive", "samples"}`(F17 unify)。
- `test_parse_pcr_next_day_stats_emits_low_power_warning_when_samples_lt_30`(N8)
  - Fixture neutral region 只有 10 樣本 → warnings 含 `pcr_stats_low_power_neutral`。
- `test_parse_pcr_next_day_stats_handles_missing_tx_returns_t_plus_1`(N9)
  - 構造 region 有 100 樣本但 tx_returns 缺 10 個 t+1 → dropped_ratio = 10% > 5% → warning `next_day_stats_dropped_samples_5pct`。

**Institutional (SC-4)** — fixtures: `.../inst/`

- `test_parse_institutional_uses_dealer_not_prop`
  - 中文 fixture(`自營商`)→ assert payload key == `"dealer"`,**不**是 `"prop"`。
  - assert `"prop" not in result`。
- `test_parse_institutional_after_hours_none_pre_2021_10`
  - date_anchor = 2021-10-12 → `session_breakdown["after_hours"] is None`,warnings 含 `night_session_not_available_pre_2021`。
- `test_parse_institutional_after_hours_present_post_2021_10`(輔助 — 非 brainstorm 強制但能保 boundary 對)
  - date_anchor = 2021-10-13 + 1d 有 after_hours rows → present。

**Institutional correlation (SC-8)** — fixtures: `.../inst_corr/`

- `test_parse_institutional_correlation_60_day_rolling_with_permutation_p`(N2 — 改名 from `_bootstrap_p`)
  - 60-day window;fixture 固定 + rng_seed=0 → assert latest_p_value 等於預先算好的常數(deterministic via seed)。
- `test_parse_institutional_correlation_excludes_dealer_trust_from_correlation_payload`(F11)
  - Fixture 含 dealer / trust rows → assert returned dict keys ∩ {"dealer", "trust"} == ∅。
  - 此測試**直接驗 scope guard**。
- `test_parse_institutional_correlation_emits_after_hours_partial_warning`
  - foreign_history first date < 2021-10-13 → warnings 含 `after_hours_partial_coverage`。
- `test_parse_institutional_correlation_feature_transformation_raw_flow_default`(N3)
  - 不傳 feature_transformation → payload 顯示 `"raw_flow"`;傳 `"first_difference"` → payload 顯示對應字串。
- `test_parse_institutional_correlation_emits_correlation_sample_small_when_lt_30`
  - foreign_history 只有 20 筆 → warnings 含 `correlation_sample_small`。

### 2.3 Fixture loader helper

加在 test file 頂端(或既有共用 fixture helper)。

```python
import json
from pathlib import Path

_FIX_ROOT = Path(__file__).parent / "fixtures" / "options_chip"

def _load_fixture(sc: str, name: str) -> tuple[dict, dict]:
    """Load (rows.json, expected.json) for a given SC sub-dir."""
    base = _FIX_ROOT / sc / name
    rows = json.loads((base / "rows.json").read_text(encoding="utf-8"))
    expected = json.loads((base / "expected.json").read_text(encoding="utf-8"))
    return rows, expected
```

### 2.4 Fixture file expectations (per design v4 §6.0)

新增 fixture 目錄(實際檔由 M0 SC-0 probe + manual curation 落):
```
backend/tests/fixtures/options_chip/
  probe/                          # SC-0 (M0)
  max_pain/{basic,asymmetric_otm,mixed_contract,multiplier}/
  max_pain_hit/{basic,pending,partial}/
  oi_walls/{basic,tie_break_spot,activity_vs_delta,partial_window,partial_listing,no_activity}/
  oi_walls_hit/{basic}/
  pcr/{per_contract,all_months,no_lookahead,warmup,tie_break}/
  pcr_stats/{schema,low_power,dropped_samples}/
  inst/{dealer_naming,pre_night_session,post_night_session}/
  inst_corr/{rolling60,scope_guard,after_hours_partial,raw_flow_default,sample_small}/
```

每 sub-dir 含:
- `rows.json` — parser 輸入(已 sanitize,不含 __user / __tier metadata)
- `expected.json` — 期望輸出(per design v4 §6.0 SC-N schema)

> Fixture 落盤由 M0(SC-0 probe + sanitize)+ M3 implementer 手刻 expected.json 完成。本 spec 只定義 schema。

---

## 3. SC coverage matrix

| File | SC-0 | SC-1 | SC-2 | SC-3 | SC-4 | SC-5 | SC-6 | SC-7 | SC-8 | SC-11 |
|---|---|---|---|---|---|---|---|---|---|---|
| `services/finmind_options.py` (parse_max_pain) | | ✓ | | | | | | | | |
| `services/finmind_options.py` (parse_max_pain_hit_rate) | | | | | | ✓ | | | | ✓ |
| `services/finmind_options.py` (parse_oi_walls) | | | ✓ | | | | | | | ✓ |
| `services/finmind_options.py` (parse_oi_walls_hit_rate) | | | | | | | ✓ | | | |
| `services/finmind_options.py` (parse_pcr_history) | | | | ✓ | | | | | | |
| `services/finmind_options.py` (parse_pcr_walk_forward_percentile) | | | | ✓ | | | | | | ✓ |
| `services/finmind_options.py` (parse_pcr_next_day_stats) | | | | | | | | ✓ | | ✓ |
| `services/finmind_options.py` (parse_institutional) | | | | | ✓ | | | | | ✓ |
| `services/finmind_options.py` (parse_institutional_correlation) | | | | | | | | | ✓ | ✓ |
| `tests/test_finmind_options.py` | (uses probe) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> SC-0 (probe / dataset schema) handled by M0; this module **consumes** probe-derived fixtures (probe JSON drives parser field names).
> SC-9 / SC-10 / SC-10b handled by routes (M5) + frontend (M6+).

---

## 4. Dependencies

- **Upstream (must land first)**:
  - M0: SC-0 probe — fixture field names lock。
  - M1: `_CACHE_VERSION_OPTIONS_CHIP` 常數宣告位置(parser 不直接用,但 module 同檔)。
  - `backend/tests/conftest.py`(設計 v4 §6.0 + T1/F22):autouse `_reset_finmind_singleton_and_env` fixture + `NoOpBucket`。Pure parser tests **不需要** `bypass_finmind_rate_limiter`(parsers 沒 I/O),但 import 路徑下 conftest 仍會跑,所以 conftest 必須在本模組測試前就位。
- **External deps**:
  - `scipy.stats.percentileofscore` / `scipy.stats.spearmanr` — 需在 backend `pyproject.toml` 確認 scipy 已列(若無,M1 加入)。
  - `numpy.random.default_rng` — 一般 numpy。
  - `statistics.median` / `mean` / `pstdev` — stdlib。
- **Downstream (consumes this module)**:
  - M4 (`services/finmind.py::fetch_*`):呼叫 parser。
  - M5 (routes):組裝 payload + 401/400 validation + warning catalog 補上 route-only 警告(如 `per_contract_pcr_unsupported_for_weekly_consider_all_months`)。

---

## 5. Open implementation questions (must resolve before coding)

1. **FinMind 中文 institution 命名**:`自營商(避險)` / `自營商(自行買賣)` 是否合併進 `dealer`?→ 等 M0 probe 結果,在 `_INSTITUTION_NAME_MAP` lock。
2. **`call_oi` / `put_oi` 欄位實際名**:probe 後若是 `open_interest` + `call_put` enum,parser 內聚合;若已分欄,直接用。
3. **`scipy` 版本**:確認 `scipy.stats.percentileofscore` 支援 `kind="mean"`(scipy ≥ 1.9 OK)。
4. **Permutation 性能**:60-sample × 1000 perm × ~190 rolling windows ≈ 11.4M Spearman 計算。若 wall-clock > 5s 為單測試 → 改 `scipy.stats.permutation_test` 向量化版,或允許 `permutation_n=200` 在測試 fixture 中。Phase 2 verify。
