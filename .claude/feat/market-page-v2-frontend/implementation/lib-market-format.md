# implementation: frontend/src/lib/market-format.ts(🟢)+ market-format.test.ts(🟢)

對應:SC-10(b)、SC-6/SC-7 換算。design v3 §12。純函式,無 React import。

## Signatures

```ts
/** eod 日期標籤:null → 「最近交易日」(SC-10b:不寫「今日」) */
export function eodLabel(eodAsOf: string | null): string;
// eodLabel("2026-07-02") → "資料至 2026-07-02"
// eodLabel(null)         → "最近交易日"

/** 張 → 萬張,一位小數(SC-7) */
export function lotsToWan(lots: number): string;
// lotsToWan(409858) → "41.0"
// lotsToWan(0)      → "0.0"

/** 0-1 小數 → 百分比字串(SC-5 cell / SC-6 today_share) */
export function pctText(v: number, digits: number): string;
// pctText(0.8, 0)      → "80%"
// pctText(0.40561, 1)  → "40.6%"

/** 有號小數 → 百分點字串,>0 前綴 +,null → "—"(SC-6 Δ;R1-2/R2-2) */
export function signedPctPoints(v: number | null): string;
// signedPctPoints(0.0015567)  → "+0.16"
// signedPctPoints(-0.0059)    → "-0.59"
// signedPctPoints(0)          → "0.00"
// signedPctPoints(null)       → "—"
```

## 失敗測試清單(market-format.test.ts,先紅)

1. `eodLabel 非 null / null 兩態`(SC-10b)
2. `lotsToWan 換算 + 邊界 0`(SC-7)
3. `pctText 0/1 位小數`(SC-5/SC-6)
4. `signedPctPoints 正/負/零/null 四態`(SC-6;0 無 + 前綴)
