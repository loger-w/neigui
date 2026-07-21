// CH-2(mod/batch-ui-update):windowDays 窗範圍聚合純函式。
import { describe, expect, it } from "vitest";
import type { DailyCandle } from "./chip-data";
import { computeWindowAgg, sumRange } from "./chip-window-agg";

const mk = (i: number): DailyCandle => ({
  date: `2026-07-${String(i + 1).padStart(2, "0")}`,
  open: 100 + i,
  high: 110 + i,
  low: 90 + i,
  close: 105 + i,
  volume: 1000 * (i + 1),
});

const candles = Array.from({ length: 8 }, (_, i) => mk(i));

describe("computeWindowAgg", () => {
  // 痛點:CH-2a — HUD 窗聚合 開=窗首開、高=窗內最高、低=窗內最低、
  // 收=窗末收、量=加總、漲跌=窗末收 vs 窗前一日收。
  it("aggregates OHLC/volume over [startIdx..endIdx]", () => {
    const agg = computeWindowAgg(candles, 2, 4);
    expect(agg).not.toBeNull();
    expect(agg!.days).toBe(3);
    expect(agg!.open).toBe(102); // candles[2].open
    expect(agg!.high).toBe(114); // max high = candles[4].high
    expect(agg!.low).toBe(92); // min low = candles[2].low
    expect(agg!.close).toBe(109); // candles[4].close
    expect(agg!.volume).toBe(3000 + 4000 + 5000);
  });

  it("change compares window-end close vs the close of the day before the window", () => {
    const agg = computeWindowAgg(candles, 2, 4)!;
    // prevClose = candles[1].close = 106;change = 109 - 106 = 3
    expect(agg.change).toBe(3);
    expect(agg.changePct).toBeCloseTo((3 / 106) * 100, 6);
  });

  // 痛點:窗頂到資料最左時無「窗前一日」→ 以窗首開盤為基準(spec CH-2a)。
  it("falls back to window-start open when startIdx is 0", () => {
    const agg = computeWindowAgg(candles, 0, 2)!;
    // prev = candles[0].open = 100;close = 107
    expect(agg.change).toBe(7);
    expect(agg.changePct).toBeCloseTo(7, 6);
  });

  it("returns null on invalid ranges", () => {
    expect(computeWindowAgg(candles, -1, 3)).toBeNull();
    expect(computeWindowAgg(candles, 3, 2)).toBeNull();
    expect(computeWindowAgg(candles, 0, 99)).toBeNull();
    expect(computeWindowAgg([], 0, 0)).toBeNull();
  });
});

describe("sumRange", () => {
  it("sums values over [startIdx..endIdx]", () => {
    expect(sumRange([1, 2, 3, 4, 5], 1, 3)).toBe(9);
  });

  it("clamps out-of-range to 0-sum semantics", () => {
    expect(sumRange([1, 2, 3], 2, 99)).toBe(3);
    expect(sumRange([], 0, 0)).toBe(0);
  });
});
