import { describe, it, expect } from "vitest";
import { classifyBin, layoutCells } from "./sector-breadth-svg";
import type { SectorBreadthRow } from "./market-types";

function row(sector: string, pct: number): SectorBreadthRow {
  return { sector, members: 20, above_ma20: Math.round(pct * 20), pct };
}

describe("classifyBin", () => {
  it("0.71 → strong (> 0.7)", () => {
    expect(classifyBin(0.71)).toBe("strong");
  });

  it("0.7 → mid (嚴格 > 邊界,不是 strong)", () => {
    expect(classifyBin(0.7)).toBe("mid");
  });

  it("0.5 → weak (嚴格 > 邊界,不是 mid)", () => {
    expect(classifyBin(0.5)).toBe("weak");
  });

  it("0.3 → cold (嚴格 > 邊界,不是 weak)", () => {
    expect(classifyBin(0.3)).toBe("cold");
  });

  it("0 → cold", () => {
    expect(classifyBin(0)).toBe("cold");
  });
});

describe("layoutCells", () => {
  it("44 rows in 800×600 → 44 cells 全在界內(ε=0.5)", () => {
    const rows: SectorBreadthRow[] = Array.from({ length: 44 }, (_, i) =>
      row(`sector-${i}`, (i % 10) / 10),
    );
    const cells = layoutCells(rows, 800, 600);
    expect(cells.length).toBe(44);
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.x + cell.w).toBeLessThanOrEqual(800 + 0.5);
      expect(cell.y + cell.h).toBeLessThanOrEqual(600 + 0.5);
    }
  });

  it("n=0 → []", () => {
    expect(layoutCells([], 800, 600)).toEqual([]);
  });

  it("w=0 → []", () => {
    const rows: SectorBreadthRow[] = [row("sector-0", 0.5)];
    expect(layoutCells(rows, 0, 600)).toEqual([]);
  });

  it("cell 帶 bin + sector + pct 透傳(前 3 筆實值)", () => {
    const rows: SectorBreadthRow[] = [
      { sector: "半導體", members: 30, above_ma20: 24, pct: 0.8 },
      { sector: "金融", members: 20, above_ma20: 10, pct: 0.5 },
      { sector: "航運", members: 10, above_ma20: 2, pct: 0.2 },
    ];
    const cells = layoutCells(rows, 800, 600);
    expect(cells[0]).toMatchObject({ sector: "半導體", pct: 0.8, bin: "strong" });
    expect(cells[1]).toMatchObject({ sector: "金融", pct: 0.5, bin: "weak" });
    expect(cells[2]).toMatchObject({ sector: "航運", pct: 0.2, bin: "cold" });
  });
});
