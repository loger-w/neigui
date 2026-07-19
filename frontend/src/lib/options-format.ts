/**
 * Options 卡片共用 % 格式化(refactor/options-p2-reuse,自三卡 local 版收斂)。
 *
 * 兩種變體對應 payload 兩種單位,合併時不改任何 call site 的輸出:
 * - fmtPct:輸入已是百分比值(band_width_pct: 4.5 → "4.5%")
 * - fmtPctFraction:輸入是小數(hit_within_1pct: 0.45 → "45%")
 */

export function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !isFinite(p)) return "—";
  return `${p.toFixed(digits)}%`;
}

export function fmtPctFraction(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}
