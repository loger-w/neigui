# implementation: frontend/src/lib/breadth-svg.tsx(🟢)+ breadth-svg.test.ts(🟢)

對應:SC-3。design v3 §4。純函式,**無 React import**(chip-svg 樣板);檔名 .tsx 對齊上游 prompt 命名。

## Signatures

```ts
import type { BreadthPoint } from "./market-types";

export type Segment = { pts: { x: number; y: number }[] };

export type BuildOpts = { pad?: number; includeZero?: boolean };  // pad 預設 4;includeZero 預設 false

/** 取序列尾端 n 筆(n 預設 60;series 只含交易日,尾端 60 筆 = 最後 60 個交易日) */
export function sliceWindow<T>(series: T[], n?: number): T[];
// sliceWindow([1..128 筆], 60) → 最後 60 筆;len < n → 原樣

/** slice 後非 null 值域;includeZero=true 強制 0 入域(McClellan 0 線);全 null → null */
export function valueDomain(series: BreadthPoint[], includeZero: boolean): { min: number; max: number } | null;
// [{v:5},{v:-3}] includeZero=false → {min:-3, max:5}
// [{v:5},{v:8}]  includeZero=true  → {min:0, max:8}
// 全 null → null

/** null 斷線:連續非 null 段各成一 Segment;x = index 線性映射(null 佔 x 位);y 依 domain 反轉映射 */
export function buildSegments(series: BreadthPoint[], w: number, h: number, opts?: BuildOpts): Segment[];
// [null,null,5,7,null,3] w=100 h=50 → 2 segments:pts.length 2([5,7])與 1([3] 單點)
// 全 null → [];domain 退化(max===min)→ y = h/2
// x_i = pad + i * (w - 2*pad) / (len - 1);len===1 → x = w/2
// y = pad + (max - v) / (max - min) * (h - 2*pad)

/** 0 線 y 座標(用同一 domain includeZero=true);全 null → null;pad 預設 4(與 BuildOpts.pad 同值 — 0 線與 polyline 同座標系,I1-2) */
export function zeroLineY(series: BreadthPoint[], h: number, pad?: number): number | null;

/** Segment → SVG polyline points 字串 */
export function polylinePoints(seg: Segment): string;
// {pts:[{x:1,y:2},{x:3,y:4}]} → "1,2 3,4"
```

元件端用法(見 components-market-breadth-panel.md):`seg.pts.length === 1` → `<circle>`;≥ 2 → `<polyline points={polylinePoints(seg)}>`。

## 失敗測試清單(breadth-svg.test.ts,先紅;全對應 SC-3)

1. `null 斷線分 2 段`(edge 3)— `[null,5,7,null,3]` → 2 segments,長度 [2,1]
2. `全 null → []` + `valueDomain 全 null → null`(edge 3 極端)
3. `暖機序列:前 38 null 的 128 筆 slice(60) 後全非 null,1 段`(edge 3,fixture 形狀)
4. `sliceWindow 尾端 60 / len<60 原樣`
5. `valueDomain includeZero 強制 0 入域;false 不強制`
6. `y 座標反轉映射:max 值 y=pad、min 值 y=h-pad;退化 domain → h/2`
7. `zeroLineY 與 buildSegments(includeZero:true) 同 domain 一致` — pinned 數值:series=[{v:10}], h=50, 預設 pad=4 → domain {0,10} → zeroLineY = 4 + (10-0)/10*(50-8) = **46**(I1-2)
8. `polylinePoints 格式`
