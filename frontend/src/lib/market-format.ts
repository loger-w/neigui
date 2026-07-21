/** Pure formatting helpers for market snapshot UI — design v3 §12. No React import. */

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

/**
 * 已是百分比數值的漲跌 → 帶正負號 + % 尾碼,null → "—"(market-today-only
 * change-spec.md §1 R7 單位契約:change_rate / spread 等欄位已是 -2.11 表示
 * -2.11%,不是 decimal ratio,不能沿用 `signedPctPoints` 的 ×100 邏輯)。
 */
export function signedPercent(v: number | null, digits = 2): string {
  if (v === null) return "—";
  const rounded = Number(v.toFixed(digits));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)}%`;
}

/** 量比 → `1.31x` 字串,null → "—"(SC-1 貢獻估算 / SC-3 族群輪動共用) */
export function formatRatio(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(2)}x`;
}

/** 成交額(TWD)→ 百萬元字串,null → "—"(SC-3 成員股列表) */
export function formatAmount(v: number | null): string {
  return v === null ? "—" : `${(v / 1e6).toFixed(1)}M`;
}

/**
 * bull(紅)/ bear(綠)/ 中性 三分支 tailwind class,漲跌 % 上色共用(台股慣例)。
 * null 或 0 → 中性(text-ink-dim)。
 */
export function changeColorClass(v: number | null): string {
  if (v === null || v === 0) return "text-ink-dim";
  return v > 0 ? "text-bull" : "text-bear";
}
