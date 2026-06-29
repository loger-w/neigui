import { describe, it, expect } from "vitest";
import { computeRangeBand, rangeBandX } from "./chip-range-band";

describe("computeRangeBand", () => {
  it("returns null when selectedIndex is null (no anchor)", () => {
    expect(computeRangeBand(null, 5, 100)).toBeNull();
  });

  it("returns null when windowDays <= 1 (range collapses to single day)", () => {
    expect(computeRangeBand(10, 1, 100)).toBeNull();
    expect(computeRangeBand(10, 0, 100)).toBeNull();
  });

  it("returns startIdx..endIdx covering windowDays candles ending at selectedIndex", () => {
    // windowDays=5, selectedIndex=20 → start=16, end=20 (5 candles: 16,17,18,19,20)
    expect(computeRangeBand(20, 5, 100)).toEqual({ startIdx: 16, endIdx: 20 });
  });

  it("clamps startIdx to 0 when windowDays > selectedIndex+1", () => {
    // windowDays=10 but only 6 candles available before selectedIndex=5
    expect(computeRangeBand(5, 10, 100)).toEqual({ startIdx: 0, endIdx: 5 });
  });

  it("returns null when candleCount=0 (defensive)", () => {
    expect(computeRangeBand(0, 5, 0)).toBeNull();
  });

  it("returns null when selectedIndex out of range (defensive)", () => {
    expect(computeRangeBand(100, 5, 50)).toBeNull();
    expect(computeRangeBand(-1, 5, 50)).toBeNull();
  });
});

describe("rangeBandX", () => {
  it("returns x and width aligned to candle slots", () => {
    // width=300, padL=12, padR=58 → xRange=230, candleCount=10 → slotW=23
    // start=2, end=4 → x = 12 + 23*2 = 58, width = 23 * (4-2+1) = 69
    expect(rangeBandX({ startIdx: 2, endIdx: 4 }, 300, 10, 12, 58)).toEqual({
      x: 58,
      width: 69,
    });
  });

  it("first candle start at left padding", () => {
    // start=0, end=0 → x = padL = 12, width = slotW = 23
    expect(rangeBandX({ startIdx: 0, endIdx: 0 }, 300, 10, 12, 58)).toEqual({
      x: 12,
      width: 23,
    });
  });

  it("handles fractional slotW deterministically", () => {
    // width=100, padL=10, padR=10 → xRange=80, candleCount=3 → slotW=80/3
    // start=1, end=2 → x = 10 + (80/3)*1 ≈ 36.667, width = (80/3)*2 ≈ 53.333
    const r = rangeBandX({ startIdx: 1, endIdx: 2 }, 100, 3, 10, 10);
    expect(r.x).toBeCloseTo(10 + 80 / 3, 5);
    expect(r.width).toBeCloseTo((80 / 3) * 2, 5);
  });
});
