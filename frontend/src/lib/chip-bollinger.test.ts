import { describe, it, expect } from "vitest";
import { calcBollinger, rollingMean, rollingStd } from "./chip-kline-svg";

describe("calcBollinger", () => {
  it("empty input → 三組空陣列", () => {
    const r = calcBollinger([], 20, 2);
    expect(r.middle).toEqual([]);
    expect(r.upper).toEqual([]);
    expect(r.lower).toEqual([]);
  });

  it("series 短於 period → 全為 null", () => {
    const r = calcBollinger([1, 2, 3, 4, 5], 20, 2);
    expect(r.middle).toHaveLength(5);
    expect(r.middle.every((v) => v === null)).toBe(true);
    expect(r.upper.every((v) => v === null)).toBe(true);
    expect(r.lower.every((v) => v === null)).toBe(true);
  });

  it("period=20 / k=2 對已知序列計算正確", () => {
    // 取 20 個遞增整數 1..20:
    //   mean = 10.5
    //   pop std = sqrt( sum((i - 10.5)^2 for i in 1..20) / 20 )
    //           = sqrt(33.25 / 1) — 實際值我們用 rollingStd 算
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const r = calcBollinger(values, 20, 2);
    // 前 19 筆 null
    for (let i = 0; i < 19; i++) {
      expect(r.middle[i]).toBeNull();
      expect(r.upper[i]).toBeNull();
      expect(r.lower[i]).toBeNull();
    }
    // 第 20 筆中軌 = mean = 10.5
    expect(r.middle[19]).toBeCloseTo(10.5, 6);
    const std = rollingStd(values, 20)[19]!;
    expect(r.upper[19]).toBeCloseTo(10.5 + 2 * std, 6);
    expect(r.lower[19]).toBeCloseTo(10.5 - 2 * std, 6);
  });

  it("period 內無變異(std=0) → upper === lower === middle", () => {
    // 20 個相同的值
    const flat = Array(20).fill(7);
    const r = calcBollinger(flat, 20, 2);
    expect(r.middle[19]).toBe(7);
    expect(r.upper[19]).toBe(7);
    expect(r.lower[19]).toBe(7);
  });

  it("中軌 === rollingMean(closes, period)(BB 中軌就是 SMA)", () => {
    const values = [
      10, 12, 11, 13, 14, 15, 13, 12, 11, 10,
      11, 12, 13, 14, 15, 16, 17, 16, 15, 14, 13, 12,
    ];
    const period = 5;
    const r = calcBollinger(values, period, 2);
    const sma = rollingMean(values, period);
    expect(r.middle).toEqual(sma);
  });
});
