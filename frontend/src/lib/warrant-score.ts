// WA-2 (mod/batch-ui-update): 權證綜合評分(0-100)— 純前端計算。
//
// 演算法定序(change-spec R7/R11):
//   1. 每因子在「同標的權證集」做橫斷面 percentile(0-100),方向統一高=好:
//      估價差(便宜=好,取負)、價差比(窄=好,取負)、實質槓桿(高=好)、
//      剩餘天數(多=好);percentile = (rank−1)/(n−1)×100,n=1 → 定值 50,
//      tie 取平均 rank。days_left ≤ EXIT_CLIFF_DAYS 者該因子直接 0(懸崖罰,
//      不論其 rank)。
//   2. 權重加權合成:估價差 35% + 價差比 25% + 實質槓桿 20% + 剩餘天數 20%。
//   3. Math.round 到整數。
//
// null 規則:任一因子缺 → 該檔評分 null;重設型(IV/估價不適用)→ null 且
// 整檔排除於橫斷面之外。因子缺的檔不進「該因子」的排名,但其有值因子照常
// 參與其他檔的橫斷面(n 按因子各自計)。

import { EXIT_CLIFF_DAYS } from "./warrant-utils";

export interface ScoreInputRow {
  warrant_id: string;
  is_reset: boolean;
  mispricing_pct: number | null | undefined;
  spread_ratio: number | null | undefined;
  leverage: number | null | undefined;
  days_left: number | null | undefined;
}

const WEIGHTS = {
  mispricing: 0.35,
  spread: 0.25,
  leverage: 0.2,
  days: 0.2,
} as const;

/** 單因子橫斷面 percentile:values 為「高=好」方向的數值(index 對齊 ids)。
 *  回傳 id → percentile。n=1 → 50;tie 平均 rank。 */
function factorPercentiles(entries: { id: string; value: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = entries.length;
  if (n === 0) return out;
  if (n === 1) {
    out.set(entries[0]!.id, 50);
    return out;
  }
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  // tie → 平均 rank(1-based):同值區段的 rank 取區段內 rank 平均
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1]!.value === sorted[i]!.value) j++;
    const avgRank = (i + 1 + (j + 1)) / 2;
    const pct = ((avgRank - 1) / (n - 1)) * 100;
    for (let k = i; k <= j; k++) out.set(sorted[k]!.id, pct);
    i = j + 1;
  }
  return out;
}

/** 回傳 warrant_id → 評分(null = 因子缺 / 重設型)。 */
export function computeWarrantScores(rows: readonly ScoreInputRow[]): Map<string, number | null> {
  const scores = new Map<string, number | null>();
  // 重設型整檔排除於橫斷面(其估價/IV 系欄位語意不適用)
  const eligible = rows.filter((r) => !r.is_reset);

  const mis = factorPercentiles(
    eligible
      .filter((r) => r.mispricing_pct != null)
      .map((r) => ({ id: r.warrant_id, value: -r.mispricing_pct! })),
  );
  const spread = factorPercentiles(
    eligible
      .filter((r) => r.spread_ratio != null)
      .map((r) => ({ id: r.warrant_id, value: -r.spread_ratio! })),
  );
  const lev = factorPercentiles(
    eligible
      .filter((r) => r.leverage != null)
      .map((r) => ({ id: r.warrant_id, value: r.leverage! })),
  );
  const days = factorPercentiles(
    eligible
      .filter((r) => r.days_left != null)
      .map((r) => ({ id: r.warrant_id, value: r.days_left! })),
  );

  for (const r of rows) {
    const pMis = mis.get(r.warrant_id);
    const pSpread = spread.get(r.warrant_id);
    const pLev = lev.get(r.warrant_id);
    let pDays = days.get(r.warrant_id);
    if (r.days_left != null && r.days_left <= EXIT_CLIFF_DAYS) pDays = 0;
    if (
      r.is_reset ||
      pMis === undefined ||
      pSpread === undefined ||
      pLev === undefined ||
      pDays === undefined
    ) {
      scores.set(r.warrant_id, null);
      continue;
    }
    scores.set(
      r.warrant_id,
      Math.round(
        pMis * WEIGHTS.mispricing +
          pSpread * WEIGHTS.spread +
          pLev * WEIGHTS.leverage +
          pDays * WEIGHTS.days,
      ),
    );
  }
  return scores;
}
