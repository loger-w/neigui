import { describe, expect, it } from "vitest";
import { colorForChange, layoutHeatmap } from "./heatmap-svg";
import type { Sector } from "./market-types";

describe("colorForChange", () => {
  function rgb(hex: string): [number, number, number] {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)!;
    return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  }

  it("uses bull RED for positive change (台股慣例) — R channel > G channel", () => {
    const color = colorForChange(5);
    const [r, g] = rgb(color);
    expect(r).toBeGreaterThan(g);
  });

  it("uses bear GREEN for negative change (台股慣例) — G channel > R channel", () => {
    const color = colorForChange(-5);
    const [r, g] = rgb(color);
    expect(g).toBeGreaterThan(r);
  });

  it("cross-check: positive and negative bins never coincide", () => {
    expect(colorForChange(5)).not.toBe(colorForChange(-5));
    expect(colorForChange(2)).not.toBe(colorForChange(-2));
    expect(colorForChange(8)).not.toBe(colorForChange(-8));
  });

  it("locks specific bin hex values", () => {
    expect(colorForChange(8)).toBe("#d32f2f");
    expect(colorForChange(5)).toBe("#ef5350");
    expect(colorForChange(2)).toBe("#ff8a80");
    expect(colorForChange(0.5)).toBe("#ffcdd2");
    expect(colorForChange(0)).toBe("#cfd8dc");
    expect(colorForChange(-0.5)).toBe("#c8e6c9");
    expect(colorForChange(-2)).toBe("#81c784");
    expect(colorForChange(-5)).toBe("#4caf50");
    expect(colorForChange(-8)).toBe("#2e7d32");
  });

  it("bins ≥ 7% all map to darkest red", () => {
    expect(colorForChange(7)).toBe("#d32f2f");
    expect(colorForChange(15)).toBe("#d32f2f");
    expect(colorForChange(100)).toBe("#d32f2f");
  });

  it("bins ≤ -7% all map to darkest green", () => {
    expect(colorForChange(-7)).toBe("#2e7d32");
    expect(colorForChange(-15)).toBe("#2e7d32");
    expect(colorForChange(-100)).toBe("#2e7d32");
  });
});

describe("layoutHeatmap — squarified treemap algorithm", () => {
  function mkStock(
    stockId: string,
    marketValue: number | null,
    changeRate = 0,
  ) {
    return {
      stock_id: stockId,
      name: stockId,
      change_rate: changeRate,
      total_amount: 1_000_000,
      market_value: marketValue,
    };
  }
  function mkSector(id: string, stocks: ReturnType<typeof mkStock>[]) {
    const avg = stocks.length
      ? stocks.reduce((s, t) => s + t.change_rate, 0) / stocks.length
      : 0;
    return {
      id,
      name: id,
      member_count: stocks.length,
      avg_change_rate: avg,
      total_amount: stocks.reduce((s, t) => s + t.total_amount, 0),
      stocks,
    };
  }

  it("returns empty array for empty sectors", () => {
    expect(layoutHeatmap([], 800, 600)).toEqual([]);
  });

  it("each sector group fits within the canvas", () => {
    const sectors: Sector[] = [
      mkSector("半導體業", [mkStock("2330", 1e13)]),
      mkSector("電子工業", [mkStock("2382", 5e12)]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    expect(layout.length).toBeGreaterThan(0);
    for (const s of layout) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(800.01);
      expect(s.y + s.h).toBeLessThanOrEqual(600.01);
    }
  });

  it("tiles within a sector fit within the sector rect", () => {
    const sectors: Sector[] = [
      mkSector("半導體業", [
        mkStock("2330", 6e13),
        mkStock("2454", 6e12),
      ]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    const sector = layout[0]!;
    expect(sector.tiles.length).toBeGreaterThan(0);
    for (const tile of sector.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(sector.x);
      expect(tile.y).toBeGreaterThanOrEqual(sector.y);
      expect(tile.x + tile.w).toBeLessThanOrEqual(sector.x + sector.w + 0.01);
      expect(tile.y + tile.h).toBeLessThanOrEqual(sector.y + sector.h + 0.01);
    }
  });

  it("stocks with null market_value fall back to sector median size (E2)", () => {
    const sectors: Sector[] = [
      mkSector("半導體業", [
        mkStock("2330", 6e13),
        mkStock("2454", 6e12),
        mkStock("XYZ", null),
      ]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    const tile = layout[0]!.tiles.find((t) => t.stockId === "XYZ");
    expect(tile?.marketValueIsFallback).toBe(true);
    expect(tile?.w).toBeGreaterThan(0);
    expect(tile?.h).toBeGreaterThan(0);
  });

  it("falls back to whole-market median when sector market_value all null", () => {
    const sectors: Sector[] = [
      mkSector("A", [mkStock("a1", null), mkStock("a2", null)]),
      mkSector("B", [mkStock("b1", null)]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    expect(layout.length).toBe(2);
    for (const s of layout) {
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
      for (const t of s.tiles) {
        expect(t.marketValueIsFallback).toBe(true);
        expect(t.w).toBeGreaterThan(0);
        expect(t.h).toBeGreaterThan(0);
      }
    }
  });

  it("handles extreme aspect ratio without NaN / negative size", () => {
    const sectors: Sector[] = [
      mkSector("A", [mkStock("a1", 1e13), mkStock("a2", 5e12)]),
      mkSector("B", [mkStock("b1", 3e12)]),
    ];
    const wide = layoutHeatmap(sectors, 2000, 10);
    for (const s of wide) {
      expect(Number.isFinite(s.w) && s.w >= 0).toBe(true);
      expect(Number.isFinite(s.h) && s.h >= 0).toBe(true);
    }
    const tall = layoutHeatmap(sectors, 10, 2000);
    for (const s of tall) {
      expect(Number.isFinite(s.w) && s.w >= 0).toBe(true);
      expect(Number.isFinite(s.h) && s.h >= 0).toBe(true);
    }
  });

  it("handles many tiles without crash (28×30 = 840 tiles)", () => {
    const sectors: Sector[] = Array.from({ length: 28 }, (_, i) =>
      mkSector(`sector_${i}`,
        Array.from({ length: 30 }, (_, j) => mkStock(`s${i}_${j}`, 1e10 + j)),
      ),
    );
    const layout = layoutHeatmap(sectors, 1000, 800);
    expect(layout.length).toBe(28);
    let totalTiles = 0;
    for (const s of layout) {
      expect(s.tiles.length).toBe(30);
      totalTiles += s.tiles.length;
    }
    expect(totalTiles).toBe(840);
  });

  it("never produces NaN or negative width / height", () => {
    const sectors: Sector[] = [
      { id: "S", name: "S", member_count: 1, avg_change_rate: 0, total_amount: 0,
        stocks: [{ stock_id: "0050", name: "0050", change_rate: 0,
                    total_amount: 1e6, market_value: 1e13 }] },
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    expect(layout.length).toBeGreaterThan(0);
    for (const s of layout) {
      expect(Number.isFinite(s.w)).toBe(true);
      expect(s.w).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.h)).toBe(true);
      expect(s.h).toBeGreaterThanOrEqual(0);
    }
  });

  it("color is set on each tile via colorForChange", () => {
    const sectors: Sector[] = [
      { id: "X", name: "X", member_count: 1, avg_change_rate: 5, total_amount: 1e6,
        stocks: [{ stock_id: "9999", name: "9999", change_rate: 5.0,
                    total_amount: 1e6, market_value: 1e12 }] },
    ];
    const layout = layoutHeatmap(sectors, 400, 300);
    expect(layout[0]!.tiles[0]!.fillColor).toBe(colorForChange(5));
  });
});
