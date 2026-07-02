/** Pure formatting helpers for market snapshot UI — design v3 §12. No React import. */

/** eod 日期標籤:null → 「最近交易日」(SC-10b:不寫「今日」) */
export function eodLabel(eodAsOf: string | null): string {
  return eodAsOf === null ? "最近交易日" : `資料至 ${eodAsOf}`;
}

/** 張 → 萬張,一位小數(SC-7) */
export function lotsToWan(lots: number): string {
  return (lots / 10000).toFixed(1);
}

/** 0-1 小數 → 百分比字串(SC-5 cell / SC-6 today_share) */
export function pctText(v: number, digits: number): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/** 有號小數 → 百分點字串,>0 前綴 +,null → "—"(SC-6 Δ;R1-2/R2-2) */
export function signedPctPoints(v: number | null): string {
  if (v === null) return "—";
  const points = Number((v * 100).toFixed(2));
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(2)}`;
}
