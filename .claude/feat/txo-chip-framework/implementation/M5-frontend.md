# M5-frontend — Implementation Spec

> Phase 2 per-file impl spec | module: **M5-frontend** | /feat `txo-chip-framework`
> Design ref: `docs/superpowers/specs/2026-06-25-txo-chip-framework-design.md` v4
> Brainstorm ref: `.claude/feat/txo-chip-framework/brainstorm.md` v3
> Project conventions: CLAUDE.md §3 (frontend style) + §7 P0 (TanStack Query, no seqRef)

## 0. Module Goal

Wire the four backend chip endpoints (`/max_pain`, `/oi_walls`, `/pcr`, `/institutional`) into the existing `OptionsPage` as an additive `OptionsChipPanel` (4-card grid) above the legacy `OptionsLargeTradersStrip` + `OptionsStrikeLadder`. All new hooks use **TanStack Query** — no `seqRef` (CLAUDE.md §7 P0). Bull = red / Bear = green (台股慣例,design §1). PCR card **must not** show directional copy (design §7 + brainstorm SC-3).

## 1. Files in Scope

### NEW
- `frontend/src/lib/options-chip-svg.tsx` — axis/scale pure helpers (design §2.3 lib note)
- `frontend/src/components/OptionsDeviationHistogram.tsx` — design §2.3 N7
- `frontend/src/components/OptionsBandHitChart.tsx` — design §2.3 N7
- `frontend/src/hooks/useMaxPain.ts`
- `frontend/src/hooks/useOptionsOIWalls.ts`
- `frontend/src/hooks/useOptionsPCR.ts`
- `frontend/src/hooks/useInstitutionalOptions.ts`
- `frontend/src/components/OptionsMaxPainCard.tsx`
- `frontend/src/components/OptionsOIWallsCard.tsx`
- `frontend/src/components/OptionsPCRCard.tsx`
- `frontend/src/components/OptionsInstitutionalCard.tsx`
- `frontend/src/components/OptionsChipPanel.tsx`

### EXTEND
- `frontend/src/lib/options-types.ts` — append 4 interfaces matching design §2.1 schemas
- `frontend/src/lib/options-api.ts` — append 4 methods

### MODIFY
- `frontend/src/components/OptionsPage.tsx` — mount `<OptionsChipPanel>` above `<OptionsLargeTradersStrip>` (design §2.4)

### TEST (colocated, vitest + RTL, `/** @vitest-environment jsdom */` pragma)
- `frontend/src/lib/options-chip-svg.test.ts`
- `frontend/src/components/OptionsDeviationHistogram.test.tsx`
- `frontend/src/components/OptionsBandHitChart.test.tsx`
- `frontend/src/hooks/useMaxPain.test.ts`
- `frontend/src/hooks/useOptionsOIWalls.test.ts`
- `frontend/src/hooks/useOptionsPCR.test.ts`
- `frontend/src/hooks/useInstitutionalOptions.test.ts`
- `frontend/src/components/OptionsMaxPainCard.test.tsx`
- `frontend/src/components/OptionsOIWallsCard.test.tsx`
- `frontend/src/components/OptionsPCRCard.test.tsx`
- `frontend/src/components/OptionsInstitutionalCard.test.tsx`
- `frontend/src/components/OptionsChipPanel.test.tsx` — **SC-10b lives here** (design §6.2 F12)

---

## 2. Cross-cutting Conventions

- **Hook return shape** (CLAUDE.md §3):
  `{ data: T | null, loading: boolean, error: string | null, refresh: () => void, noTradingDay: boolean, insufficientData: { reason: string; required_days: number } | null, warnings: string[] }`
- **No `seqRef`** — TanStack Query owns staleness (CLAUDE.md §7 P0). Pattern follows `useOptionsLargeTraders.ts`: `forceRefreshRef` boolean flips for one-shot `refresh=true` query.
- **Query keys** (design §3 T2):
  - `["options-max-pain", contract, date]`
  - `["options-oi-walls", contract, date]`
  - `["options-pcr", scope, contract|null, date]`
  - `["options-institutional", date]`
- **Cross-card refresh cascade** (design §3 T2): `OptionsChipPanel` exposes `handleAnyRefresh` that calls `queryClient.invalidateQueries({ queryKey: [...] })` for max-pain / oi-walls / pcr. Institutional is **NOT** in cascade (independent dataset).
- **Tailwind tokens only** (CLAUDE.md §3): `text-ink` / `text-ink-muted` / `text-ink-dim` / `bg-bg` / `bg-bg-deep` / `border-line` / `border-line-strong` / `text-accent` / `bg-accent/10` / `text-up` / `text-down` (台股紅up/綠down, design §1).
- **UI 文字繁中** (CLAUDE.md §3): all labels, error messages, aria-labels.
- **PCR card 禁用方向性文案** (brainstorm SC-3 + design §7): NEVER write `做多 / 做空 / 賣選 / 滿倉`. Component test asserts `expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull()`.
- **`hidden` attribute > 條件 render** (CLAUDE.md §3): session toggle in `OptionsInstitutionalCard` uses `<div hidden={!expanded}>`.
- **Function components + hooks only**.
- **Pure SVG functions** in `lib/options-chip-svg.tsx`, component-free, independently unit-tested.

---

## 3. File Specs

### 3.1 `frontend/src/lib/options-types.ts` (EXTEND)

Append the following interfaces (preserving existing `OILTGroup`, `OptionsLargeTraders`, `StrikeRow`, `OptionsStrikeVolume`, `OptionsSpot`). Field names mirror design §2.1 verbatim.

```ts
// ---------- common ----------
export interface InsufficientData {
  reason: string;
  required_days: number;
}

// ---------- Max Pain (SC-1, SC-5) ----------
export interface MaxPainHistoryEntry {
  settlement_date: string;
  max_pain_at_t_minus_1: number;
  settlement_price: number;
  deviation_pct: number;
}

export interface MaxPainHitRate {
  samples: number;
  median_abs_deviation_pct: number;
  hit_within_1pct: number;
  hit_within_2pct: number;
  history: MaxPainHistoryEntry[];
}

export interface OptionsMaxPain {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date: string | null;
  no_trading_day?: boolean;
  current: {
    max_pain: number;
    total_loss_ntd: number;
    strike_count: number;
    strikes_with_call_oi_only: number;
    strikes_with_put_oi_only: number;
  };
  hit_rate: MaxPainHitRate | null;
  latest_settlement_pending: boolean;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData;
}

// ---------- OI Walls (SC-2, SC-6) ----------
export interface StaticWall { strike: number; oi: number; }
export interface DynamicWall {
  strike: number;
  window_activity_oi: number;
  partial_window: boolean;
}

export interface OIWallHistoryEntry {
  settlement_date: string;
  put_wall_at_t_minus_1: number;
  call_wall_at_t_minus_1: number;
  settlement_price: number;
  inside_band: boolean;
}

export interface OIWallsHitRate {
  samples: number;
  pct_settled_inside_band: number;
  avg_band_width_pct: number;            // v4 F23
  history: OIWallHistoryEntry[];
}

export interface OptionsOIWalls {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date: string | null;
  no_trading_day?: boolean;
  current: {
    static_call_wall: StaticWall;
    static_put_wall: StaticWall;
    dynamic_call_wall: DynamicWall;
    dynamic_put_wall: DynamicWall;
    band_width_pct: number;
  };
  hit_rate: OIWallsHitRate | null;
  latest_settlement_pending: boolean;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData;
}

// ---------- PCR (SC-3, SC-7) ----------
export type PCRRegion = "high" | "neutral" | "low";

export interface PCRRegionStats {
  mean_pct: number;
  std_pct: number;
  hit_positive: number;
  samples: number;                       // v4 F17: samples 移到 region 內
}

export interface OptionsPCR {
  date: string;
  fetched_at: string;
  as_of_date: string | null;
  scope: "per_contract" | "all_months";
  contract?: string;
  no_trading_day?: boolean;
  current: {
    pcr: number;
    percentile: number;
    region: PCRRegion | null;            // null if insufficient_data
    thresholds: { high_pct: number; low_pct: number };
  };
  next_day_stats: {
    high_region:    PCRRegionStats;
    neutral_region: PCRRegionStats;
    low_region:     PCRRegionStats;
  } | null;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData;
}

// ---------- Institutional (SC-4, SC-8) ----------
export interface InstitutionalParty {
  call_net: number;
  put_net: number;
  total_net: number;
  day_change: number;
}

export interface SessionTriple {
  foreign: InstitutionalParty;
  dealer:  InstitutionalParty;           // 自營 — F3-integration, NOT prop
  trust:   InstitutionalParty;
}

export interface InstCorrelationEntry {
  date: string;
  corr: number;
  p_value: number;
}

export interface InstitutionalCorrelation {
  samples: number;
  latest_corr: number;
  latest_p_value: number;                // permutation test (N2)
  history: InstCorrelationEntry[];
  is_significant: boolean;
  feature_transformation: "raw_flow" | "first_difference";  // N3
}

export interface OptionsInstitutional {
  date: string;
  fetched_at: string;
  as_of_date: string | null;
  no_trading_day?: boolean;
  current: {
    foreign: InstitutionalParty;
    dealer:  InstitutionalParty;
    trust:   InstitutionalParty;
    session_breakdown: {
      day_session: SessionTriple;
      after_hours: SessionTriple | null;   // null pre-2021-10-13
    };
  };
  correlation: InstitutionalCorrelation | null;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData;
}
```

**SC coverage**: SC-1, SC-2, SC-3, SC-4, SC-5, SC-6, SC-7, SC-8 (type carrier for all).

### 3.2 `frontend/src/lib/options-api.ts` (EXTEND)

Append to `optionsApi` object. Pattern mirrors existing `largeTraders` / `strikeVolume` / `spot`.

```ts
maxPain(
  contract: string,
  date?: string,
  refresh?: boolean,
  lookback?: number,            // default 20 settled contracts (design §2.1)
): Promise<OptionsMaxPain> {
  const params: Record<string, string> = { contract };
  if (date) params.date = date;
  if (refresh) params.refresh = "true";
  if (lookback != null) params.lookback = String(lookback);
  return __apiGet(`${BASE}/max_pain`, params);
},

oiWalls(
  contract: string,
  date?: string,
  refresh?: boolean,
  lookback?: number,            // default 20
  delta_window?: number,        // default 5
): Promise<OptionsOIWalls> {
  const params: Record<string, string> = { contract };
  if (date) params.date = date;
  if (refresh) params.refresh = "true";
  if (lookback != null) params.lookback = String(lookback);
  if (delta_window != null) params.delta_window = String(delta_window);
  return __apiGet(`${BASE}/oi_walls`, params);
},

pcr(args: {
  scope?: "per_contract" | "all_months";   // default all_months (design §2.1)
  contract?: string;                       // required only when scope=per_contract
  date?: string;
  refresh?: boolean;
  lookback?: number;                       // default 250 (N8)
  high_pct?: number;                       // default 70
  low_pct?: number;                        // default 30
}): Promise<OptionsPCR> {
  const params: Record<string, string> = {};
  if (args.scope) params.scope = args.scope;
  if (args.contract) params.contract = args.contract;
  if (args.date) params.date = args.date;
  if (args.refresh) params.refresh = "true";
  if (args.lookback != null) params.lookback = String(args.lookback);
  if (args.high_pct != null) params.high_pct = String(args.high_pct);
  if (args.low_pct  != null) params.low_pct  = String(args.low_pct);
  return __apiGet(`${BASE}/pcr`, params);
},

institutional(
  date?: string,
  refresh?: boolean,
  lookback?: number,            // default 60 (design §2.1)
  corr_window?: number,         // default 60
): Promise<OptionsInstitutional> {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  if (refresh) params.refresh = "true";
  if (lookback != null) params.lookback = String(lookback);
  if (corr_window != null) params.corr_window = String(corr_window);
  return __apiGet(`${BASE}/institutional`, params);
},
```

Imports to add at top:
```ts
import type {
  OptionsLargeTraders, OptionsStrikeVolume, OptionsSpot,
  OptionsMaxPain, OptionsOIWalls, OptionsPCR, OptionsInstitutional,
} from "./options-types";
```

**SC coverage**: SC-1, SC-2, SC-3, SC-4, SC-5, SC-6, SC-7, SC-8 (transport layer).

### 3.3 `frontend/src/lib/options-chip-svg.tsx` (NEW)

Pure SVG helpers — **no React effects, no async, no state**. Exposed as plain functions returning JSX or scalars, for component-free unit testing (CLAUDE.md §3 lib convention). Per design §2.3: "只放 axis helper".

```ts
// ---------- axis / scale helpers ----------

export interface LinearScale {
  (x: number): number;
  invert(y: number): number;
  domain: [number, number];
  range:  [number, number];
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale;
//  s(x) = range[0] + (x - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0])
//  s.invert(y) reverse
//  Edge: domain[0] === domain[1] → returns midpoint for any x

export function niceTicks(min: number, max: number, count: number): number[];
//  Standard 1/2/5 nice tick algorithm. Returns evenly spaced ticks within [min, max].

export function clampToRange(value: number, lo: number, hi: number): number;

export function percentileToBarRect(
  percentile: number,                // 0..100
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number };
//  Used by PCR card's percentile bar. percentile clipped to [0, 100].

export function histogramBins(
  values: number[],
  binCount: number,
): Array<{ x0: number; x1: number; count: number }>;
//  Used by OptionsDeviationHistogram. Empty `values` → [].
//  Symmetric domain around 0 if min < 0 < max, else min..max.
```

No React imports. Pure functions only.

**SC coverage**: SC-1 (deviation histogram), SC-3 (percentile bar), SC-5 (hit rate distribution), SC-6 (band hit chart x-axis).

### 3.4 `frontend/src/components/OptionsDeviationHistogram.tsx` (NEW)

Pure presentational SVG component for Max Pain hit-rate distribution (design §2.3 N7).

```tsx
import type { ReactElement } from "react";
import { histogramBins, linearScale, niceTicks } from "../lib/options-chip-svg";
import type { MaxPainHistoryEntry } from "../lib/options-types";

interface Props {
  history: MaxPainHistoryEntry[];        // each entry: deviation_pct
  width?: number;                        // default 220
  height?: number;                       // default 80
  binCount?: number;                     // default 12
}

export function OptionsDeviationHistogram(props: Props): ReactElement;
```

Behavior:
- Reads `deviation_pct` from each entry → builds histogram via `histogramBins`.
- Renders SVG `<rect>` per bin. Bull (positive deviation) = `fill="var(--color-up)"`, Bear (negative) = `fill="var(--color-down)"`.
- Vertical 0-line marker.
- ±1% / ±2% bands as light fill behind.
- `role="img"`, `aria-label="Max Pain 與結算價乖離分佈"`.
- Empty history → renders empty SVG frame with text `"無歷史樣本"` (繁中).

**SC coverage**: SC-1 (UI), SC-5.

### 3.5 `frontend/src/components/OptionsBandHitChart.tsx` (NEW)

OI Walls hit-rate chart (design §2.3 N7) — shows, for each historical settlement, whether settlement price fell inside the [put_wall, call_wall] band.

```tsx
import type { ReactElement } from "react";
import type { OIWallHistoryEntry } from "../lib/options-types";

interface Props {
  history: OIWallHistoryEntry[];
  width?: number;                        // default 240
  height?: number;                       // default 80
}

export function OptionsBandHitChart(props: Props): ReactElement;
```

Behavior:
- Per entry: horizontal segment from `put_wall_at_t_minus_1` to `call_wall_at_t_minus_1`, point marker at `settlement_price`.
- Segment color: `inside_band` true → `var(--color-line-strong)`, false → `var(--color-accent)`.
- X-axis = settlement_date (compressed indices), Y-axis = price.
- `role="img"`, `aria-label="OI Wall 區間命中歷史"`.
- Empty history → `"無歷史樣本"`.

**SC coverage**: SC-2 (UI), SC-6.

### 3.6 `frontend/src/hooks/useMaxPain.ts` (NEW)

```ts
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { optionsApi } from "../lib/options-api";
import type { OptionsMaxPain, InsufficientData } from "../lib/options-types";

export interface UseMaxPainResult {
  data: OptionsMaxPain | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  noTradingDay: boolean;
  insufficientData: InsufficientData | null;
  warnings: string[];
}

export function useMaxPain(contract: string, date: string): UseMaxPainResult;
```

Impl pattern (mirrors `useOptionsLargeTraders.ts`):
- `forceRefreshRef = useRef(false)`.
- `useQuery({ queryKey: ["options-max-pain", contract, date], queryFn, enabled: contract !== "" })`.
- `refresh()` flips `forceRefreshRef = true; refetch()`.
- `noTradingDay = data?.no_trading_day === true`.
- `insufficientData = data?.insufficient_data ?? null`.
- `warnings = data?.data_quality_warnings ?? []`.

**SC coverage**: SC-1, SC-5, SC-10b (failure carrier), SC-11 (warnings carrier).

### 3.7 `frontend/src/hooks/useOptionsOIWalls.ts` (NEW)

```ts
export interface UseOptionsOIWallsResult {
  data: OptionsOIWalls | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  noTradingDay: boolean;
  insufficientData: InsufficientData | null;
  warnings: string[];
}

export function useOptionsOIWalls(contract: string, date: string): UseOptionsOIWallsResult;
```

Query key `["options-oi-walls", contract, date]`. Otherwise identical to `useMaxPain`.

**SC coverage**: SC-2, SC-6, SC-10b, SC-11.

### 3.8 `frontend/src/hooks/useOptionsPCR.ts` (NEW)

```ts
export interface UseOptionsPCRArgs {
  scope: "per_contract" | "all_months";
  contract: string | null;             // required only when scope === "per_contract"
  date: string;
}

export interface UseOptionsPCRResult {
  data: OptionsPCR | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  noTradingDay: boolean;
  insufficientData: InsufficientData | null;
  warnings: string[];
}

export function useOptionsPCR(args: UseOptionsPCRArgs): UseOptionsPCRResult;
```

- Query key: `["options-pcr", args.scope, args.contract, args.date]`.
- `enabled`: when `scope === "per_contract"` requires `contract != null && contract !== ""`; `all_months` always enabled (assuming `date`).
- `queryFn` passes `optionsApi.pcr({ scope, contract: contract ?? undefined, date, refresh })`.

**SC coverage**: SC-3, SC-7, SC-10b, SC-11.

### 3.9 `frontend/src/hooks/useInstitutionalOptions.ts` (NEW)

```ts
export interface UseInstitutionalOptionsResult {
  data: OptionsInstitutional | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  noTradingDay: boolean;
  insufficientData: InsufficientData | null;
  warnings: string[];
}

export function useInstitutionalOptions(date: string): UseInstitutionalOptionsResult;
```

Query key `["options-institutional", date]`. **Always enabled** (no contract dependency). Independent of cross-card refresh cascade (design §3 T2).

**SC coverage**: SC-4, SC-8, SC-10b, SC-11.

### 3.10 `frontend/src/components/OptionsMaxPainCard.tsx` (NEW)

```tsx
import type { ReactElement } from "react";
import type { OptionsMaxPain } from "../lib/options-types";

interface Props {
  data: OptionsMaxPain | null;
  loading: boolean;
  error: string | null;
  insufficientData: { reason: string; required_days: number } | null;
  warnings: string[];
  spot: number | null;                  // for 乖離 %
  onRefresh: () => void;
}

export function OptionsMaxPainCard(props: Props): ReactElement;
```

Layout:
- Header: title `"Max Pain"` + refresh button (aria-label `"重新整理 Max Pain"`).
- Body:
  - Big number: `current.max_pain` (integer, no decimal).
  - Sub: `乖離 ${pct}%` from spot (if spot && current). Color: positive deviation = `text-up`, negative = `text-down`.
  - Tiny: `總損失 ${total_loss_ntd.toLocaleString("zh-TW")} NTD`.
  - Strikes meta: `K=${strike_count}` (`call_only=${...}, put_only=${...}` muted).
- Hit rate block (if `hit_rate !== null`):
  - Median |dev|: `${median_abs_deviation_pct.toFixed(2)}%`.
  - `±1%: ${hit_within_1pct * 100}%` / `±2%: ${hit_within_2pct * 100}%`.
  - `<OptionsDeviationHistogram history={hit_rate.history} />`.
  - `latest_settlement_pending` → tiny badge `"最新結算尚未公布"`.
- States:
  - `loading && !data` → skeleton (line / line / box).
  - `error` → `<div className="text-accent bg-accent/[0.06] ...">{error}</div>` + 重新整理 button.
  - `insufficientData` → grey `"資料不足:${reason}(需要 ${required_days} 天)"`.
- Warnings footer (if `warnings.length > 0`): `<div data-testid="warnings">` 灰色小字 each warning string verbatim (SC-11).

**SC coverage**: SC-1, SC-5, SC-9, SC-10b, SC-11.

### 3.11 `frontend/src/components/OptionsOIWallsCard.tsx` (NEW)

Same prop shape as MaxPain but typed `OptionsOIWalls`. Layout:
- Header: `"OI 牆"` + refresh.
- 2×2 grid:
  - 上排:`Static 上方 Call 牆 @${strike} / OI ${oi.toLocaleString()}`(實心 marker symbol)
  - 上排:`Static 下方 Put 牆 @...`(實心)
  - 下排:`Dynamic Call 牆 @${strike} / 活躍度 ${window_activity_oi.toLocaleString()}`(虛線 marker, partial badge if `partial_window === true`)
  - 下排:`Dynamic Put 牆 @...`
- Band: `區間寬度 ${band_width_pct.toFixed(2)}%`.
- Hit rate block (if `hit_rate !== null`):
  - `區間命中率: ${(pct_settled_inside_band * 100).toFixed(1)}%`
  - `平均區間寬: ${avg_band_width_pct.toFixed(2)}%` (v4 F23)
  - `<OptionsBandHitChart history={hit_rate.history} />`.
- Static vs Dynamic: dotted-border for dynamic markers per design §2.3.
- Warnings footer (SC-11): especially `dynamic_wall_partial_window` / `dynamic_wall_partial_listing` / `dynamic_wall_no_activity`.

**SC coverage**: SC-2, SC-6, SC-9, SC-10b, SC-11.

### 3.12 `frontend/src/components/OptionsPCRCard.tsx` (NEW)

```tsx
interface Props {
  data: OptionsPCR | null;
  loading: boolean;
  error: string | null;
  insufficientData: { reason: string; required_days: number } | null;
  warnings: string[];
  onRefresh: () => void;
  onSwitchToAllMonths?: () => void;     // for per_contract weekly unsupported case (N5)
}
```

Layout:
- Header: `"PCR"` + scope label (`合約` / `全月份`) + refresh.
- Big number: `current.pcr.toFixed(2)`.
- Percentile bar (using `percentileToBarRect`): horizontal bar with marker at `current.percentile`. Labels `0` / `100` ends.
- **Region chip** (color bound to bull/bear, NOT direction — design §2.3 + brainstorm SC-3):
  - `region === "high"` → `bg-up/15 text-up` chip `"高位"`
  - `region === "neutral"` → `bg-ink/5 text-ink-muted` chip `"中性"`
  - `region === "low"` → `bg-down/15 text-down` chip `"低位"`
  - `region === null` → grey chip `"資料不足"`
- Thresholds line: `閾值 ${high_pct}/${low_pct}` muted.
- **next_day_stats** table (3 rows) — if `next_day_stats !== null`:
  - Columns: `區位` / `平均次日報酬%` / `標準差%` / `正報酬比率` / `樣本數`
  - Rows: `高位 / 中性 / 低位` with `mean_pct.toFixed(2)` / `std_pct.toFixed(2)` / `(hit_positive * 100).toFixed(1)%` / `samples`.
  - **NO P&L, NO Sharpe, NO directional text.**
- Special case: `warnings.includes("per_contract_pcr_unsupported_for_weekly_consider_all_months")` (N5):
  - Replace center with `"週合約資料不足,建議改全月份模式"` + button `"切換至全月份"` (calls `onSwitchToAllMonths`).
- Warnings footer (SC-11): `pcr_walk_forward_warmup_skipped_first_{N}_days`, `pcr_stats_low_power_*`, `next_day_stats_dropped_samples_5pct`.

**Forbidden tokens** (test asserts): `做多`, `做空`, `賣選`, `滿倉`.

**SC coverage**: SC-3, SC-7, SC-9, SC-10b, SC-11.

### 3.13 `frontend/src/components/OptionsInstitutionalCard.tsx` (NEW)

```tsx
import { useState } from "react";

interface Props {
  data: OptionsInstitutional | null;
  loading: boolean;
  error: string | null;
  insufficientData: { reason: string; required_days: number } | null;
  warnings: string[];
  onRefresh: () => void;
}
```

Layout:
- Header: `"三大法人"` + refresh + 展開 toggle button (`expanded` boolean state, default `false`).
- 3 parties side by side (foreign / dealer / trust):
  - 外資 (`foreign`): `bg-accent/10` + `font-semibold` (highlight per design §2.3).
  - 自營商 (`dealer`): standard.
  - 投信 (`trust`): standard.
  - Each shows: `Call 淨 ${call_net.toLocaleString()}` / `Put 淨 ${put_net.toLocaleString()}` / `合計 ${total_net.toLocaleString()}` / `日變動 ${day_change}`.
  - Color rule: positive net = `text-up`, negative = `text-down` (台股紅up).
- **Session breakdown** (toggle):
  - Uses `<div hidden={!expanded}>` — design §2.3 + CLAUDE.md §3.
  - Shows `day_session` block and `after_hours` block.
  - If `after_hours === null` → `"夜盤 ${date} 不可用"` (warning typically present as `after_hours_partial_coverage`).
- Correlation block (if `correlation !== null`):
  - Header: `"外資 60d Spearman vs 次日 TX 報酬"`.
  - Big number: `latest_corr.toFixed(3)` (`text-ink-dim opacity-50` if `!is_significant`).
  - `p-value: ${latest_p_value.toFixed(3)}` + significance badge (`p<0.10`).
  - `feature_transformation` muted label.
  - Mini line: `correlation.history` rolling chart (simple SVG polyline, x = index, y = corr ∈ [-1, 1]).
- Warnings footer (SC-11): `correlation_sample_small`, `after_hours_partial_coverage`.

**SC coverage**: SC-4, SC-8, SC-9, SC-10b, SC-11.

### 3.14 `frontend/src/components/OptionsChipPanel.tsx` (NEW)

```tsx
import { useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { OptionsMaxPainCard } from "./OptionsMaxPainCard";
import { OptionsOIWallsCard } from "./OptionsOIWallsCard";
import { OptionsPCRCard } from "./OptionsPCRCard";
import { OptionsInstitutionalCard } from "./OptionsInstitutionalCard";
import { useMaxPain } from "../hooks/useMaxPain";
import { useOptionsOIWalls } from "../hooks/useOptionsOIWalls";
import { useOptionsPCR } from "../hooks/useOptionsPCR";
import { useInstitutionalOptions } from "../hooks/useInstitutionalOptions";

interface Props {
  contract: string;
  date: string;
  spot: number | null;
  isWeekly: boolean;                    // drives PCR default scope hint
}

export function OptionsChipPanel(props: Props): ReactElement;
```

Behavior:
- Defaults PCR scope = `"all_months"` (design §2.1 default).
- Local state `pcrScope: "per_contract" | "all_months"` (default `"all_months"`).
- Wires 4 hooks in parallel: `mp`, `walls`, `pcr`, `inst`.
- **Failure isolation** (SC-10b): each card receives its own `error` and renders independently.
- **Cross-card refresh cascade** (design §3 T2):
  ```tsx
  const qc = useQueryClient();
  const handleSharedRefresh = () => {
    qc.invalidateQueries({ queryKey: ["options-max-pain", contract, date] });
    qc.invalidateQueries({ queryKey: ["options-oi-walls", contract, date] });
    qc.invalidateQueries({ queryKey: ["options-pcr"] });   // any scope/contract for date
  };
  // institutional refresh is NOT in cascade (independent dataset)
  ```
  Each card's `onRefresh` is `() => { ownHook.refresh(); handleSharedRefresh(); }` for MaxPain / OIWalls / PCR; Institutional uses only its own `refresh`.
- `onSwitchToAllMonths` passed to PCR card sets `setPcrScope("all_months")`.
- Grid: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 px-4 py-3 border-b border-line`.
- `data-testid="options-chip-panel"`.

**SC coverage**: SC-1, SC-2, SC-3, SC-4, SC-5, SC-6, SC-7, SC-8, SC-9, **SC-10b (primary site)**, SC-11.

### 3.15 `frontend/src/components/OptionsPage.tsx` (MODIFY)

Section to touch: lines 34–88 (component body and JSX return).

Changes:
1. Import `OptionsChipPanel`:
   ```tsx
   import { OptionsChipPanel } from "./OptionsChipPanel";
   ```
2. Inside JSX, between the `anyNoTradingDay` banner and `<OptionsLargeTradersStrip>`, mount:
   ```tsx
   <OptionsChipPanel
     contract={contractId}
     date={date}
     spot={spot.data?.spot ?? null}
     isWeekly={isWeekly}
   />
   ```
3. **Do not** modify existing `<OptionsLargeTradersStrip>` or `<OptionsStrikeLadder>` props/behavior (design §1: additive, 不重構).
4. **Do not** add chip hooks to `loading` aggregation — failure isolation (SC-10b) means panel handles its own states.

Design ref: §2.4.

**SC coverage**: SC-9 (page integration).

---

## 4. Test File Specs

All test files use `/** @vitest-environment jsdom */` pragma + `afterEach(cleanup)`. Mocking pattern: `vi.spyOn(optionsApi, X)` (CLAUDE.md §3 + design §6.2 F12 — **no MSW**).

### 4.1 `frontend/src/lib/options-chip-svg.test.ts`

Test names:
- `test_linear_scale_basic_forward_and_invert`
- `test_linear_scale_degenerate_domain_returns_midpoint`
- `test_nice_ticks_1_2_5_progression`
- `test_clamp_to_range_above_below_within`
- `test_percentile_to_bar_rect_at_0_50_100`
- `test_percentile_to_bar_rect_clips_out_of_range`
- `test_histogram_bins_empty_input_returns_empty`
- `test_histogram_bins_symmetric_domain_for_signed_values`

**SC coverage**: SC-1, SC-3, SC-5, SC-6.

### 4.2 `frontend/src/components/OptionsDeviationHistogram.test.tsx`

Test names:
- `test_renders_empty_state_when_history_is_empty`
- `test_renders_bins_with_bull_bear_colors_by_sign`
- `test_renders_zero_line_marker`
- `test_aria_label_is_traditional_chinese`

**SC coverage**: SC-1, SC-5.

### 4.3 `frontend/src/components/OptionsBandHitChart.test.tsx`

Test names:
- `test_renders_empty_state_when_history_is_empty`
- `test_inside_band_uses_neutral_color_outside_uses_accent`
- `test_segment_endpoints_match_put_and_call_walls`
- `test_settlement_marker_rendered_per_entry`

**SC coverage**: SC-2, SC-6.

### 4.4 `frontend/src/hooks/useMaxPain.test.ts`

Test names:
- `test_returns_data_loading_error_refresh_shape`
- `test_disabled_when_contract_is_empty_string`
- `test_refresh_passes_true_to_api`
- `test_no_trading_day_flag_propagated`
- `test_warnings_default_to_empty_array_when_missing`

**SC coverage**: SC-1, SC-5, SC-11.

### 4.5 `frontend/src/hooks/useOptionsOIWalls.test.ts`

Test names mirror useMaxPain:
- `test_returns_data_loading_error_refresh_shape`
- `test_disabled_when_contract_is_empty_string`
- `test_refresh_passes_true_to_api`
- `test_partial_window_warning_propagated_through_data_quality_warnings`

**SC coverage**: SC-2, SC-6, SC-11.

### 4.6 `frontend/src/hooks/useOptionsPCR.test.ts`

Test names:
- `test_query_key_includes_scope_contract_date`
- `test_per_contract_disabled_when_contract_is_null`
- `test_all_months_enabled_without_contract`
- `test_refresh_passes_true_to_api`
- `test_propagates_unsupported_for_weekly_warning`

**SC coverage**: SC-3, SC-7, SC-11.

### 4.7 `frontend/src/hooks/useInstitutionalOptions.test.ts`

Test names:
- `test_returns_data_loading_error_refresh_shape`
- `test_always_enabled_no_contract_dependency`
- `test_after_hours_null_when_payload_says_so`
- `test_correlation_optional_null_handled`

**SC coverage**: SC-4, SC-8, SC-11.

### 4.8 `frontend/src/components/OptionsMaxPainCard.test.tsx`

Test names:
- `test_renders_max_pain_value_and_deviation_pct`
- `test_renders_total_loss_with_thousands_separator`
- `test_renders_hit_rate_block_with_histogram`
- `test_renders_skeleton_when_loading_no_data`
- `test_renders_error_chip_with_refresh_button`
- `test_renders_insufficient_data_message`
- `test_renders_latest_settlement_pending_badge`
- `test_renders_warnings_block_when_warnings_non_empty`

**SC coverage**: SC-1, SC-5, SC-9, SC-11.

### 4.9 `frontend/src/components/OptionsOIWallsCard.test.tsx`

Test names:
- `test_renders_four_walls_static_solid_dynamic_dashed`
- `test_renders_partial_window_badge_when_partial_window_true`
- `test_renders_band_width_pct_value`
- `test_renders_hit_rate_with_avg_band_width_pct`
- `test_renders_skeleton_when_loading`
- `test_renders_error_chip`
- `test_renders_dynamic_wall_no_activity_warning_in_footer`
- `test_renders_dynamic_wall_partial_listing_warning_in_footer`

**SC coverage**: SC-2, SC-6, SC-9, SC-11.

### 4.10 `frontend/src/components/OptionsPCRCard.test.tsx`

Test names:
- `test_renders_pcr_value_and_percentile_bar`
- `test_renders_region_chip_high_with_bull_color`
- `test_renders_region_chip_low_with_bear_color`
- `test_renders_region_chip_neutral`
- `test_renders_region_chip_insufficient_when_region_null`
- `test_renders_next_day_stats_three_regions_table`
- `test_does_not_render_directional_text`  // assert /做多|做空|賣選|滿倉/ → null (brainstorm SC-3 + design §7)
- `test_renders_switch_to_all_months_button_on_weekly_warning` // N5
- `test_clicking_switch_calls_onSwitchToAllMonths`
- `test_renders_low_power_warning_in_footer`
- `test_renders_walk_forward_warmup_warning_in_footer`

**SC coverage**: SC-3, SC-7, SC-9, SC-11.

### 4.11 `frontend/src/components/OptionsInstitutionalCard.test.tsx`

Test names:
- `test_renders_three_parties_with_foreign_highlighted`
- `test_uses_dealer_label_not_prop`  // brainstorm SC-4 F3-integration
- `test_renders_call_put_total_day_change_per_party`
- `test_session_toggle_uses_hidden_attribute_not_conditional_render`  // brainstorm SC-4 + CLAUDE.md §3
- `test_after_hours_null_renders_dark_session_unavailable_message`
- `test_renders_correlation_block_with_p_value_and_significance_badge`
- `test_correlation_dimmed_opacity_when_not_significant`
- `test_renders_correlation_sample_small_warning_in_footer`
- `test_renders_after_hours_partial_coverage_warning_in_footer`

**SC coverage**: SC-4, SC-8, SC-9, SC-11.

### 4.12 `frontend/src/components/OptionsChipPanel.test.tsx`

**SC-10b primary site** (design §6.2 F12 + brainstorm SC-10b). Pattern from brainstorm verbatim.

Test names:
- `test_renders_four_cards_in_grid`
- `test_failure_isolation_pcr_error_does_not_break_other_cards`  // **SC-10b verbatim from brainstorm**
- `test_failure_isolation_max_pain_error_does_not_break_other_cards`
- `test_failure_isolation_oi_walls_error_does_not_break_other_cards`
- `test_failure_isolation_institutional_error_does_not_break_other_cards`
- `test_refresh_on_max_pain_cascades_invalidate_to_oi_walls_and_pcr`  // design §3 T2
- `test_refresh_on_institutional_does_not_invalidate_other_queries`   // T2: institutional NOT in cascade
- `test_switch_to_all_months_button_changes_pcr_scope`

Sample SC-10b test body (verbatim pattern from brainstorm.md + design §6.2):
```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "../lib/api";   // or whatever error class used

it("test_failure_isolation_pcr_error_does_not_break_other_cards", async () => {
  vi.spyOn(optionsApi, "pcr").mockRejectedValue(new ApiError(502, "upstream_unavailable"));
  vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
  vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
  vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OptionsChipPanel contract="TXO202607" date="2026-06-23" spot={20000} isWeekly={false} />
    </QueryClientProvider>,
  );

  // PCR card shows error chip
  expect(await screen.findByText(/upstream_unavailable/)).toBeInTheDocument();
  // Other 3 cards render mock data
  expect(await screen.findByText(/Max Pain/)).toBeInTheDocument();
  expect(await screen.findByText(/OI 牆/)).toBeInTheDocument();
  expect(await screen.findByText(/三大法人/)).toBeInTheDocument();
});
```

**SC coverage**: SC-9, **SC-10b (primary)**, SC-11.

---

## 5. SC × File Coverage Matrix

| File | SC-0 | SC-1 | SC-2 | SC-3 | SC-4 | SC-5 | SC-6 | SC-7 | SC-8 | SC-9 | SC-10 | SC-10b | SC-11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `lib/options-types.ts` | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | ✓ |
| `lib/options-api.ts` | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `lib/options-chip-svg.tsx` | – | ✓ | – | ✓ | – | ✓ | ✓ | – | – | – | – | – | – |
| `components/OptionsDeviationHistogram.tsx` | – | ✓ | – | – | – | ✓ | – | – | – | – | – | – | – |
| `components/OptionsBandHitChart.tsx` | – | – | ✓ | – | – | – | ✓ | – | – | – | – | – | – |
| `hooks/useMaxPain.ts` | – | ✓ | – | – | – | ✓ | – | – | – | – | – | ✓ | ✓ |
| `hooks/useOptionsOIWalls.ts` | – | – | ✓ | – | – | – | ✓ | – | – | – | – | ✓ | ✓ |
| `hooks/useOptionsPCR.ts` | – | – | – | ✓ | – | – | – | ✓ | – | – | – | ✓ | ✓ |
| `hooks/useInstitutionalOptions.ts` | – | – | – | – | ✓ | – | – | – | ✓ | – | – | ✓ | ✓ |
| `components/OptionsMaxPainCard.tsx` | – | ✓ | – | – | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ |
| `components/OptionsOIWallsCard.tsx` | – | – | ✓ | – | – | – | ✓ | – | – | ✓ | – | ✓ | ✓ |
| `components/OptionsPCRCard.tsx` | – | – | – | ✓ | – | – | – | ✓ | – | ✓ | – | ✓ | ✓ |
| `components/OptionsInstitutionalCard.tsx` | – | – | – | – | ✓ | – | – | – | ✓ | ✓ | – | ✓ | ✓ |
| `components/OptionsChipPanel.tsx` | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | **✓ primary** | ✓ |
| `components/OptionsPage.tsx` | – | – | – | – | – | – | – | – | – | ✓ | – | – | – |

**Note**: SC-0 is backend-only (schema probe), M5-frontend doesn't carry it. SC-10 (failure modes + non-trading-day) is largely backend route + DevTools MCP scope (design §6.2 last bullet); frontend carries it via error chip + `noTradingDay` banner which is already in `OptionsPage`.

---

## 6. Implementation Order (within M5)

1. `lib/options-types.ts` extend (no deps; unblocks everything).
2. `lib/options-api.ts` extend (depends on types).
3. `lib/options-chip-svg.tsx` + test (no deps).
4. `OptionsDeviationHistogram` + test (depends on svg helpers).
5. `OptionsBandHitChart` + test (depends on svg helpers).
6. 4 hooks + tests in parallel (depend on api + types).
7. 4 cards + tests in parallel (depend on hooks + presentation components + svg helpers).
8. `OptionsChipPanel` + test — includes **SC-10b primary tests** (depends on all 4 cards + hooks + QueryClient).
9. `OptionsPage` modify (depends on `OptionsChipPanel`).

Per CLAUDE.md TDD: each step writes **red test first**, then implementation, then refactor — three separate commits 🟢 test → 🟢 feat → 🔵 refactor (design §10).

---

## 7. Verification Gate (per CLAUDE.md §D + auto-verify)

- `cd frontend && npm test` — all new + existing tests pass.
- `cd frontend && npm run build` — `tsc -b` catches type errors across new types.
- `cd frontend && npm run lint` — ESLint clean (incl. `react-you-might-not-need-an-effect`; new hooks must not use `useEffect` for data fetching).
- Real-env (DevTools MCP, design §6.2 last bullet): SC-9 layout + 切合約 + 切日期 + non-trading-day banner. **SC-10b NOT via DevTools MCP** (in `OptionsChipPanel.test.tsx` per F12).
