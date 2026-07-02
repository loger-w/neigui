# implementation: frontend/src/lib/market-types.ts(🔵)+ market-types.test.ts(🟢)

對應:SC-1。design v3 §2。

## market-types.ts 追加(既有型別一行不動)

```ts
export type ExcludedCount = { etf: number; warrant: number; watch_list: number };

export type BreadthPoint = { date: string; value: number | null };

export type Breadth = {
  ad_line_value: number | null;
  mcclellan_oscillator: number | null;
  ad_line_series: BreadthPoint[];
  mcclellan_series: BreadthPoint[];
  thrust_dot: "above_plus_100" | "below_minus_100" | null;
  centerline_cross: "above" | "below" | null;
  divergence_dot: "bearish" | "bullish" | null;
  known_gaps: string[];
};

export type SectorBreadthRow = { sector: string; members: number; above_ma20: number; pct: number };

export type SectorVolumeRatioRow = {
  sector: string;
  today_vol_lots: number;
  vol_ratio: number | null;
  flag: "hot" | "cold" | null;
};

export type SectorAmountShareRow = { sector: string; today_share: number; share_delta_20ma: number | null };
```

`MarketSnapshot` 追加欄位(既有 7 欄不動):

```ts
  universe_size: number;
  excluded_count: ExcludedCount;
  eod_as_of: string | null;
  breadth: Breadth | null;
  sector_breadth: SectorBreadthRow[] | null;
  sector_volume_ratio: SectorVolumeRatioRow[] | null;
  sector_amount_share: SectorAmountShareRow[] | null;
```

## market-types.test.ts(runtime contract lock,對齊 options-contract.test.ts pattern)

```ts
import { describe, expect, it } from "vitest";
import fix from "../../../docs/specs/market-monitor-v2/evidence/snapshot_full_2026-07-02_post-fixes.json";
import type { MarketSnapshot } from "./market-types";
```

失敗測試清單(先寫全紅 — 型別欄位補上前 `fix` 的欄位 access 在 tsc 不會紅,但 runtime assert 缺 key 會紅?**不會 — fixture 本來就有 key**。本檔的紅相位:先寫 test import `MarketSnapshot` 新欄位 access(`(fix as MarketSnapshot).breadth` 等)→ 型別未補時 `npm run build`/vitest tsc 紅(property not exist)。以 build 紅為紅相位證據):

1. `contract: 14 top-level keys 存在`(SC-1)— `["as_of","last_tick","is_trading_session","stale","lag_seconds","sectors","leaderboards","universe_size","excluded_count","eod_as_of","breadth","sector_breadth","sector_volume_ratio","sector_amount_share"].every(k => k in fix)`
2. `contract: breadth shape + enum 值域`(SC-1)— known_gaps 是 string[];thrust_dot ∈ {above_plus_100, below_minus_100, null};centerline_cross ∈ {above, below, null};divergence_dot ∈ {bearish, bullish, null};mcclellan_series 每筆 `{date: string, value: number|null}`;series 長度 > 60(暖機 pad window)
3. `contract: 三個 sector list row shape + 值域`(SC-1)— sector_breadth 每 row {sector:string, members:number, above_ma20:number, pct:0≤x≤1};sector_volume_ratio 每 row flag ∈ {hot, cold, null}、vol_ratio number|null;sector_amount_share 每 row today_share ∈ [0,1]、share_delta_20ma **只 assert typeof number | null(有號,R2-2)**
4. `contract: eod_as_of / universe_size / excluded_count`(SC-1)— eod_as_of string|null(YYYY-MM-DD regex when string);universe_size number > 0;excluded_count {etf,warrant,watch_list} 皆 number ≥ 0

輸入輸出範例:fixture 實值 → test 全綠;若未來 payload drift(如 known_gaps 改 object)→ assert 立紅。
```
