// Pure layout helpers for sector breadth heatmap-style grid. 不產出 SVG(R1-6);
// no React import。design v3 §5。

import type { SectorBreadthRow } from "./market-types";

export type BreadthBin = "strong" | "mid" | "weak" | "cold";

export type CellRect = {
  sector: string;
  pct: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bin: BreadthBin;
};

/** pct > 0.7 strong;0.5 < pct ≤ 0.7 mid;0.3 < pct ≤ 0.5 weak;≤ 0.3 cold */
export function classifyBin(pct: number): BreadthBin {
  if (pct > 0.7) return "strong";
  if (pct > 0.5) return "mid";
  if (pct > 0.3) return "weak";
  return "cold";
}

/** row-major grid;cols = max(1, round(sqrt(n * (w/h))));n=0 或 w/h ≤ 0 → [] */
export function layoutCells(
  rows: SectorBreadthRow[],
  w: number,
  h: number,
  gap = 2,
): CellRect[] {
  const n = rows.length;
  if (n === 0 || w <= 0 || h <= 0) return [];

  const cols = Math.max(1, Math.round(Math.sqrt(n * (w / h))));
  const rowsCount = Math.ceil(n / cols);
  const cellW = (w - (cols - 1) * gap) / cols;
  const cellH = (h - (rowsCount - 1) * gap) / rowsCount;

  const cells: CellRect[] = [];
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const col = i % cols;
    const r = Math.floor(i / cols);
    cells.push({
      sector: row.sector,
      pct: row.pct,
      x: col * (cellW + gap),
      y: r * (cellH + gap),
      w: cellW,
      h: cellH,
      bin: classifyBin(row.pct),
    });
  }
  return cells;
}
