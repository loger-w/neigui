// 權證 IV 時序圖純計算 — 無 React 依賴(SC-7;chip-svg 慣例)。
// 缺值日斷線:null 之後的下一個有效點以 M 重起,不插值(design R24 渲染語意)。

import type { WarrantIvPoint } from "./warrant-data";

export interface ChartTick {
  x?: number;
  y?: number;
  label: string;
}

export interface IvChartGeom {
  bidPath: string;
  askPath: string;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  pad: { top: number; right: number; bottom: number; left: number };
}

const PAD = { top: 8, right: 8, bottom: 18, left: 38 };

function buildPath(
  series: WarrantIvPoint[],
  pick: (p: WarrantIvPoint) => number | null,
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let path = "";
  let pen = false; // 前一點是否有效(false → 下一有效點 M 重起)
  series.forEach((p, i) => {
    const v = pick(p);
    if (v == null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return path;
}

export function computeIvChart(
  series: WarrantIvPoint[],
  width: number,
  height: number,
): IvChartGeom | null {
  const values = series
    .flatMap((p) => [p.iv_bid, p.iv_ask])
    .filter((v): v is number => v != null);
  if (series.length === 0 || values.length === 0) return null;

  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = Math.max(1, height - PAD.top - PAD.bottom);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) {
    // 平坦序列:給最小視覺跨度,線落在中央
    lo -= 0.01;
    hi += 0.01;
  }
  const span = hi - lo;
  const x = (i: number) => PAD.left + (series.length === 1 ? 0.5 : i / (series.length - 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / span) * innerH;

  const yTicks = [hi, (hi + lo) / 2, lo].map((v) => ({
    y: y(v),
    label: `${(v * 100).toFixed(0)}%`,
  }));
  const tickIdx =
    series.length <= 2
      ? [0, series.length - 1].filter((i, k, a) => a.indexOf(i) === k)
      : [0, Math.floor((series.length - 1) / 2), series.length - 1];
  const xTicks = tickIdx.map((i) => ({
    x: x(i),
    label: series[i]!.date.slice(5), // MM-DD
  }));

  return {
    bidPath: buildPath(series, (p) => p.iv_bid, x, y),
    askPath: buildPath(series, (p) => p.iv_ask, x, y),
    xTicks,
    yTicks,
    pad: PAD,
  };
}
