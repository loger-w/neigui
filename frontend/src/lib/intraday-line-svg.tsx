// Background intraday close-price polyline overlay for the bubble chart.
// 與蝴蝶泡泡共用同一個 SVG canvas;Y 軸 reuse bubble 的 price scale(由父
// 傳 yLow/yHigh),X 軸獨立(時間 09:00 → 13:30 線性 270 min)。
// 純背景紋理,pointer-events="none" 不參與 hit test。

import { memo } from "react";
import type { IntradayPoint } from "./chip-data";
import { CHIP } from "./chip-theme";

// 09:00 = 540 min from midnight; 13:30 = 810 min; range = 270 min.
// 1 分 K 第一根實際標 09:00(probe verified 2026-06-26 2330);最後一根
// 13:30。實測首末對齊整點,不需動態 first/last fallback。
export const SESSION_START_MIN = 9 * 60;
export const SESSION_RANGE_MIN = (13 * 60 + 30) - 9 * 60;

const STROKE_WIDTH = 1;

export function parseMinute(t: string): number {
  // "HH:MM" → minutes from midnight. Robust to "HH:MM:SS" by taking first 5.
  const s = t.slice(0, 5);
  if (s.length < 5 || s[2] !== ":") return NaN;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(3, 5));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

export function pointsToPolyline(
  points: IntradayPoint[],
  yLow: number,
  yHigh: number,
  paddingLeft: number,
  paddingTop: number,
  chartWidth: number,
  chartHeight: number,
): string {
  if (points.length === 0 || yHigh === yLow) return "";
  const yRange = yHigh - yLow;
  const coords: string[] = [];
  for (const p of points) {
    const minutes = parseMinute(p.t);
    if (Number.isNaN(minutes)) continue;
    if (p.price < yLow || p.price > yHigh) continue;
    const x = paddingLeft + ((minutes - SESSION_START_MIN) / SESSION_RANGE_MIN) * chartWidth;
    const y = paddingTop + ((yHigh - p.price) / yRange) * chartHeight;
    coords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return coords.join(" ");
}

interface Props {
  points: IntradayPoint[];
  yLow: number;
  yHigh: number;
  paddingLeft: number;
  paddingTop: number;
  chartWidth: number;
  chartHeight: number;
}

export const IntradayLineLayer = memo(function IntradayLineLayer({
  points, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight,
}: Props) {
  if (points.length === 0) return null;
  const d = pointsToPolyline(
    points, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight,
  );
  if (d === "") return null;
  return (
    <polyline
      points={d}
      stroke={CHIP.intradayLine}
      strokeWidth={STROKE_WIDTH}
      fill="none"
      pointerEvents="none"
      data-testid="intraday-line"
    />
  );
});
