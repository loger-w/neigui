// Pure layout helpers for breadth line charts (AD Line / McClellan Oscillator).
// No React import — chip-svg 樣板;檔名 .tsx 對齊上游 prompt 命名。design v3 §4。

import type { BreadthPoint } from "./market-types";

export type Segment = { pts: { x: number; y: number }[] };

/** pad 預設 4;includeZero 預設 false */
export type BuildOpts = { pad?: number; includeZero?: boolean };

/** 取序列尾端 n 筆(n 預設 60);len < n → 原樣 */
export function sliceWindow<T>(series: T[], n = 60): T[] {
  if (n <= 0) return [];
  return series.slice(-n);
}

/** slice 後非 null 值域;includeZero=true 強制 0 入域(McClellan 0 線);全 null → null */
export function valueDomain(
  series: BreadthPoint[],
  includeZero: boolean,
): { min: number; max: number } | null {
  const values: number[] = [];
  for (const p of series) {
    if (p.value !== null) values.push(p.value);
  }
  if (values.length === 0) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max };
}

/** null 斷線:連續非 null 段各成一 Segment;x = index 線性映射(null 佔 x 位);y 依 domain 反轉映射 */
export function buildSegments(
  series: BreadthPoint[],
  w: number,
  h: number,
  opts?: BuildOpts,
): Segment[] {
  const pad = opts?.pad ?? 4;
  const includeZero = opts?.includeZero ?? false;
  const domain = valueDomain(series, includeZero);
  if (domain === null) return [];

  const len = series.length;
  const mapX = (i: number): number =>
    len === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (len - 1);
  const mapY = (v: number): number =>
    domain.max === domain.min
      ? h / 2
      : pad + ((domain.max - v) / (domain.max - domain.min)) * (h - 2 * pad);

  const segments: Segment[] = [];
  let current: { x: number; y: number }[] = [];
  for (let i = 0; i < len; i++) {
    const p = series[i];
    if (p === undefined || p.value === null) {
      if (current.length > 0) {
        segments.push({ pts: current });
        current = [];
      }
      continue;
    }
    current.push({ x: mapX(i), y: mapY(p.value) });
  }
  if (current.length > 0) segments.push({ pts: current });
  return segments;
}

/** 0 線 y 座標(用同一 domain includeZero=true);全 null → null;pad 預設 4(I1-2) */
export function zeroLineY(series: BreadthPoint[], h: number, pad = 4): number | null {
  const domain = valueDomain(series, true);
  if (domain === null) return null;
  if (domain.max === domain.min) return h / 2;
  return pad + ((domain.max - 0) / (domain.max - domain.min)) * (h - 2 * pad);
}

/** Segment → SVG polyline points 字串 */
export function polylinePoints(seg: Segment): string {
  return seg.pts.map((p) => `${p.x},${p.y}`).join(" ");
}
