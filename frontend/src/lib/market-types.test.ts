import { describe, expect, it } from "vitest";
import fix from "../../../docs/specs/market-monitor-v2/evidence/snapshot_full_2026-07-02_post-fixes.json";
import type { Breadth, MarketSnapshot } from "./market-types";

describe("MarketSnapshot v2 contract lock", () => {
  it("contract: 14 top-level keys 存在", () => {
    const keys = [
      "as_of",
      "last_tick",
      "is_trading_session",
      "stale",
      "lag_seconds",
      "sectors",
      "leaderboards",
      "universe_size",
      "excluded_count",
      "eod_as_of",
      "breadth",
      "sector_breadth",
      "sector_volume_ratio",
      "sector_amount_share",
    ];
    for (const k of keys) {
      expect(k in fix).toBe(true);
    }
  });

  it("contract: breadth shape + enum 值域", () => {
    const snap = fix as unknown as MarketSnapshot;
    const b: Breadth | null = snap.breadth;
    expect(b).not.toBeNull();
    if (!b) throw new Error("breadth is null");
    expect(Array.isArray(b.known_gaps)).toBe(true);
    for (const g of b.known_gaps) {
      expect(typeof g).toBe("string");
    }
    expect([null, "above_plus_100", "below_minus_100"]).toContain(b.thrust_dot);
    expect([null, "above", "below"]).toContain(b.centerline_cross);
    expect([null, "bearish", "bullish"]).toContain(b.divergence_dot);
    expect(b.mcclellan_series.length).toBeGreaterThan(60);
    for (const point of b.mcclellan_series) {
      expect(typeof point.date).toBe("string");
      expect(point.value === null || typeof point.value === "number").toBe(true);
    }
    for (const point of b.ad_line_series) {
      expect(typeof point.date).toBe("string");
      expect(point.value === null || typeof point.value === "number").toBe(true);
    }
  });

  it("contract: 三個 sector list row shape + 值域", () => {
    const snap = fix as unknown as MarketSnapshot;
    expect(snap.sector_breadth).not.toBeNull();
    for (const row of snap.sector_breadth ?? []) {
      expect(typeof row.sector).toBe("string");
      expect(typeof row.members).toBe("number");
      expect(typeof row.above_ma20).toBe("number");
      expect(row.pct).toBeGreaterThanOrEqual(0);
      expect(row.pct).toBeLessThanOrEqual(1);
    }

    expect(snap.sector_volume_ratio).not.toBeNull();
    for (const row of snap.sector_volume_ratio ?? []) {
      expect([null, "hot", "cold"]).toContain(row.flag);
      expect(row.vol_ratio === null || typeof row.vol_ratio === "number").toBe(true);
    }

    expect(snap.sector_amount_share).not.toBeNull();
    for (const row of snap.sector_amount_share ?? []) {
      expect(row.today_share).toBeGreaterThanOrEqual(0);
      expect(row.today_share).toBeLessThanOrEqual(1);
      expect(
        row.share_delta_20ma === null || typeof row.share_delta_20ma === "number",
      ).toBe(true);
    }
  });

  it("contract: eod_as_of / universe_size / excluded_count", () => {
    const snap = fix as unknown as MarketSnapshot;
    if (snap.eod_as_of !== null) {
      expect(typeof snap.eod_as_of).toBe("string");
      expect(/^\d{4}-\d{2}-\d{2}$/.test(snap.eod_as_of)).toBe(true);
    }
    expect(typeof snap.universe_size).toBe("number");
    expect(snap.universe_size).toBeGreaterThan(0);
    expect(typeof snap.excluded_count.etf).toBe("number");
    expect(snap.excluded_count.etf).toBeGreaterThanOrEqual(0);
    expect(typeof snap.excluded_count.warrant).toBe("number");
    expect(snap.excluded_count.warrant).toBeGreaterThanOrEqual(0);
    expect(typeof snap.excluded_count.watch_list).toBe("number");
    expect(snap.excluded_count.watch_list).toBeGreaterThanOrEqual(0);
  });
});
