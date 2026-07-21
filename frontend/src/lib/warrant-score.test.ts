/**
 * WA-2 (mod/batch-ui-update): 權證綜合評分 — 手算對照。
 *
 * 演算法(R7/R11 拍板):每因子同標的橫斷面 percentile(0-100,方向統一
 * 高=好)→ 權重 35/25/20/20 加權 → Math.round。percentile = (rank−1)/(n−1)
 * ×100,n=1 → 50,tie 取平均 rank;days_left ≤ 21 該因子直接 0(懸崖罰)。
 * 任一因子缺 / 重設型 → null。
 */
import { describe, expect, it } from "vitest";
import { computeWarrantScores, type ScoreInputRow } from "./warrant-score";

function row(over: Partial<ScoreInputRow> & { warrant_id: string }): ScoreInputRow {
  return {
    is_reset: false,
    mispricing_pct: 0,
    spread_ratio: 0.02,
    leverage: 3,
    days_left: 100,
    ...over,
  };
}

describe("computeWarrantScores — 手算對照", () => {
  it("三檔全序:因子全同向 → 100 / 50 / 0", () => {
    const scores = computeWarrantScores([
      // A 全因子最佳:最便宜、價差最窄、槓桿最高、天數最多
      row({ warrant_id: "A", mispricing_pct: -0.1, spread_ratio: 0.01, leverage: 5, days_left: 100 }),
      row({ warrant_id: "B", mispricing_pct: 0, spread_ratio: 0.02, leverage: 3, days_left: 50 }),
      row({ warrant_id: "C", mispricing_pct: 0.1, spread_ratio: 0.03, leverage: 1, days_left: 22 }),
    ]);
    expect(scores.get("A")).toBe(100);
    expect(scores.get("B")).toBe(50);
    expect(scores.get("C")).toBe(0);
  });

  it("n=1 → 每因子 50 → 總分 50(非懸崖)", () => {
    const scores = computeWarrantScores([row({ warrant_id: "X", days_left: 60 })]);
    expect(scores.get("X")).toBe(50);
  });

  it("tie 取平均 rank:三檔某因子全同值 → 該因子各 50", () => {
    // 全部因子同值,天數 > 21:每因子 tie → avg rank 2 → (2−1)/2×100 = 50
    const scores = computeWarrantScores([
      row({ warrant_id: "A" }),
      row({ warrant_id: "B" }),
      row({ warrant_id: "C" }),
    ]);
    expect(scores.get("A")).toBe(50);
    expect(scores.get("B")).toBe(50);
    expect(scores.get("C")).toBe(50);
  });

  it("days_left ≤ 21 懸崖罰:該因子強制 0,即使 rank 不是最低", () => {
    // days: B(10) < A(21) < C(100) → A rank2 percentile 50,但 21 ≤ 21 → 0。
    // 其餘因子全 tie → 各 50。
    // A = 0.35×50 + 0.25×50 + 0.2×50 + 0.2×0 = 40(未罰會是 50)
    // B 同樣懸崖 → 40;C = 40 + 0.2×100 − 0.2×50 = 60
    const scores = computeWarrantScores([
      row({ warrant_id: "A", days_left: 21 }),
      row({ warrant_id: "B", days_left: 10 }),
      row({ warrant_id: "C", days_left: 100 }),
    ]);
    expect(scores.get("A")).toBe(40);
    expect(scores.get("B")).toBe(40);
    expect(scores.get("C")).toBe(60);
  });

  it("任一因子缺 → null;重設型 → null;其餘檔照常計分", () => {
    const scores = computeWarrantScores([
      row({ warrant_id: "A", mispricing_pct: -0.1, spread_ratio: 0.01, leverage: 5, days_left: 100 }),
      row({ warrant_id: "B", mispricing_pct: 0.04, spread_ratio: 0.02, leverage: 3, days_left: 50 }),
      row({ warrant_id: "NOLEV", leverage: null, days_left: 30 }),
      row({ warrant_id: "RESET", is_reset: true }),
      row({ warrant_id: "NODAYS", days_left: null }),
    ]);
    expect(scores.get("NOLEV")).toBeNull();
    expect(scores.get("RESET")).toBeNull();
    expect(scores.get("NODAYS")).toBeNull();
    // null 因子檔不進該因子排名,但其有值因子照常參與他檔的橫斷面
    expect(scores.get("A")).not.toBeNull();
    expect(scores.get("B")).not.toBeNull();
  });

  it("四捨五入到整數", () => {
    // 兩檔:各因子 0/100 對半 → A = 100, B = 0;三檔不整除的組合驗 round
    const scores = computeWarrantScores([
      row({ warrant_id: "A", mispricing_pct: -0.1, spread_ratio: 0.02, leverage: 3, days_left: 100 }),
      row({ warrant_id: "B", mispricing_pct: 0.1, spread_ratio: 0.02, leverage: 3, days_left: 100 }),
      row({ warrant_id: "C", mispricing_pct: 0, spread_ratio: 0.02, leverage: 3, days_left: 100 }),
    ]);
    // mis:A 100 / C 50 / B 0;spread/lev/days 全 tie 50
    // A = 35 + 12.5 + 10 + 10 = 67.5 → 68;B = 0 + 32.5 = 32.5 → 33
    expect(scores.get("A")).toBe(68);
    expect(scores.get("B")).toBe(33);
    expect(scores.get("C")).toBe(50);
  });
});
