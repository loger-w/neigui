import { describe, it, expect } from "vitest";
import {
  prevTradingDay,
  nextTradingDay,
  snapToTradingDay,
} from "./trading-days";

describe("snapToTradingDay", () => {
  it("returns the latest date <= target when target is not a trading day", () => {
    const dates = ["2026-06-24", "2026-06-25", "2026-06-26"];
    // 2026-06-27 is Saturday → snap to 2026-06-26 (Friday)
    expect(snapToTradingDay("2026-06-27", dates)).toBe("2026-06-26");
  });

  it("returns target unchanged when it is in the trading-day list", () => {
    const dates = ["2026-06-24", "2026-06-25", "2026-06-26"];
    expect(snapToTradingDay("2026-06-25", dates)).toBe("2026-06-25");
  });

  it("returns target unchanged when target is earlier than every trading day", () => {
    const dates = ["2026-06-24", "2026-06-25"];
    expect(snapToTradingDay("2026-01-01", dates)).toBe("2026-01-01");
  });

  it("returns target unchanged when dates list is empty", () => {
    expect(snapToTradingDay("2026-06-27", [])).toBe("2026-06-27");
  });

  it("handles unsorted / duplicate input deterministically", () => {
    const dates = ["2026-06-26", "2026-06-24", "2026-06-26", "2026-06-25"];
    expect(snapToTradingDay("2026-06-27", dates)).toBe("2026-06-26");
  });
});

describe("prevTradingDay", () => {
  it("returns the trading day strictly before current", () => {
    const dates = ["2026-06-24", "2026-06-25", "2026-06-26"];
    expect(prevTradingDay("2026-06-26", dates)).toBe("2026-06-25");
  });

  it("returns null when current is at or before the earliest trading day", () => {
    const dates = ["2026-06-24", "2026-06-25"];
    expect(prevTradingDay("2026-06-24", dates)).toBeNull();
    expect(prevTradingDay("2026-01-01", dates)).toBeNull();
  });

  it("returns the latest trading day < current when current is a non-trading day", () => {
    const dates = ["2026-06-24", "2026-06-25", "2026-06-26"];
    // 2026-06-27 Saturday → prev = 2026-06-26 (Friday)
    expect(prevTradingDay("2026-06-27", dates)).toBe("2026-06-26");
  });
});

describe("nextTradingDay", () => {
  it("returns the trading day strictly after current", () => {
    const dates = ["2026-06-24", "2026-06-25", "2026-06-26"];
    expect(nextTradingDay("2026-06-24", dates)).toBe("2026-06-25");
  });

  it("returns null when current is at or after the latest trading day", () => {
    const dates = ["2026-06-24", "2026-06-25"];
    expect(nextTradingDay("2026-06-25", dates)).toBeNull();
    expect(nextTradingDay("2026-12-01", dates)).toBeNull();
  });

  it("clamps result to maxDate when provided", () => {
    const dates = ["2026-06-24", "2026-06-25", "2026-06-26", "2026-06-29"];
    // current=2026-06-25 → naive next=2026-06-26;maxDate=2026-06-26 → 2026-06-26 OK
    expect(nextTradingDay("2026-06-25", dates, "2026-06-26")).toBe("2026-06-26");
    // current=2026-06-26 → naive next=2026-06-29 > maxDate → null
    expect(nextTradingDay("2026-06-26", dates, "2026-06-26")).toBeNull();
  });
});
