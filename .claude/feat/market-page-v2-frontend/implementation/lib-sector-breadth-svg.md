# implementation: frontend/src/lib/sector-breadth-svg.tsx(🟢)+ sector-breadth-svg.test.ts(🟢)

對應:SC-5(layout 半部)。design v3 §5。純 layout 計算,不產出 SVG(R1-6);無 React import。

## Signatures

```ts
import type { SectorBreadthRow } from "./market-types";

export type BreadthBin = "strong" | "mid" | "weak" | "cold";

export type CellRect = {
  sector: string; pct: number;
  x: number; y: number; w: number; h: number;
  bin: BreadthBin;
};

/** pct > 0.7 strong;0.5 < pct ≤ 0.7 mid;0.3 < pct ≤ 0.5 weak;≤ 0.3 cold */
export function classifyBin(pct: number): BreadthBin;
// 0.71→strong, 0.7→mid, 0.5→weak, 0.3→cold, 0→cold

/** row-major grid;cols = max(1, round(sqrt(n * (w/h))));n=0 或 w/h ≤ 0 → [] */
export function layoutCells(rows: SectorBreadthRow[], w: number, h: number, gap?: number): CellRect[];
// gap 預設 2。rowsCount = ceil(n / cols);cellW = (w - (cols-1)*gap) / cols;cellH = (h - (rowsCount-1)*gap) / rowsCount
// 44 rows, 800×600 → 44 cells,全部 x+w ≤ 800 且 y+h ≤ 600(邊界 fit,§9 squarified lesson)
```

## 失敗測試清單(sector-breadth-svg.test.ts,先紅;全對應 SC-5)

1. `classifyBin 四檔 + 邊界 exactly`(0.7→mid、0.5→weak、0.3→cold — `>` 嚴格邊界單測 lock,§9 threshold lesson)
2. `layoutCells 44 cells 全在界內`(x≥0, y≥0, x+w ≤ W+ε, y+h ≤ H+ε;ε=0.5 浮點容差)
3. `layoutCells n=0 → []`、`w=0 → []`
4. `cell 帶 bin + sector + pct 透傳`(fixture 前 3 筆實值)
