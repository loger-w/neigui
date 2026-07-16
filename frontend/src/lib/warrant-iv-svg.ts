// 權證 IV 歷史圖純計算 — 無 React 依賴(chip-svg 慣例;warrant-iv-redesign)。
// 上下雙 panel 共 x 軸(dataviz 單軸鐵則,不做雙軸疊圖):上 IV %(bid/ask/HV20/
// 趨勢線),下標的收盤。缺值日斷線:null 之後的下一個有效點以 M 重起,不插值。

import type { WarrantIvPoint } from "./warrant-data";

export interface IvHistoryChartGeom {
  width: number;
  height: number;
  pad: { left: number; right: number };
  ivPanel: {
    top: number;
    height: number;
    bidPath: string;
    askPath: string;
    hvPath: string;
    trendPath: string;
    yTicks: { y: number; label: string }[];
  };
  pricePanel: {
    top: number;
    height: number;
    pricePath: string;
    yTicks: { y: number; label: string }[];
  };
  xTicks: { x: number; label: string }[];
}

const PAD = { left: 44, right: 8 };
const IV_TOP = 8;
const IV_H = 150;
const PANEL_GAP = 16;
const PRICE_H = 56;
const X_LABEL_H = 18;

const HV_WINDOW = 20; // 20 個 log return = 21 個連續有效收盤(change-spec R3)
const ANNUALIZE = Math.sqrt(252);

/** 標的收盤 20 日年化歷史波動率;與 series index 對齊,null 收盤打斷 run 重積。 */
export function computeHv20(series: WarrantIvPoint[]): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  let returns: number[] = []; // 當前 run 的 log returns
  let prevClose: number | null = null;
  series.forEach((p, i) => {
    const c = p.underlying_close;
    if (c == null || c <= 0) {
      returns = [];
      prevClose = null;
      return;
    }
    if (prevClose != null) {
      returns.push(Math.log(c / prevClose));
      if (returns.length > HV_WINDOW) returns.shift();
      if (returns.length === HV_WINDOW) {
        const mean = returns.reduce((s, r) => s + r, 0) / HV_WINDOW;
        const varSum = returns.reduce((s, r) => s + (r - mean) ** 2, 0);
        out[i] = Math.sqrt(varSum / (HV_WINDOW - 1)) * ANNUALIZE;
      }
    }
    prevClose = c;
  });
  return out;
}

/** 最新非 null iv_bid 在全窗非 null iv_bid 的分位(0-100,<= 口徑對齊 backend)。 */
export function computeIvPercentile(series: WarrantIvPoint[]): number | null {
  const values = series.map((p) => p.iv_bid).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const latest = values[values.length - 1]!;
  return (100 * values.filter((v) => v <= latest).length) / values.length;
}

/** 趨勢線:斜率 = backend Theil-Sen slope_bid,截距 = median(y − slope·x)。
 *  x = series index(含洞不壓縮,對齊 backend);bid 有效點 <2 → null。 */
export function trendLine(
  series: WarrantIvPoint[],
  slope: number,
): { intercept: number; i0: number; i1: number } | null {
  const points = series
    .map((p, i) => [i, p.iv_bid] as const)
    .filter((pair): pair is readonly [number, number] => pair[1] != null);
  if (points.length < 2) return null;
  const residuals = points.map(([x, y]) => y - slope * x).sort((a, b) => a - b);
  const mid = Math.floor(residuals.length / 2);
  const intercept =
    residuals.length % 2 === 1
      ? residuals[mid]!
      : (residuals[mid - 1]! + residuals[mid]!) / 2;
  return { intercept, i0: points[0]![0], i1: points[points.length - 1]![0] };
}

function buildPath(
  series: WarrantIvPoint[],
  pick: (p: WarrantIvPoint, i: number) => number | null,
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let path = "";
  let pen = false; // 前一點是否有效(false → 下一有效點 M 重起)
  series.forEach((p, i) => {
    const v = pick(p, i);
    if (v == null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return path;
}

function span(values: number[]): { lo: number; hi: number } {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) {
    // 平坦序列:給最小視覺跨度,線落在中央
    lo -= 0.01;
    hi += 0.01;
  }
  return { lo, hi };
}

export function computeIvHistoryChart(
  series: WarrantIvPoint[],
  width: number,
  trendSlope: number | null,
): IvHistoryChartGeom | null {
  const ivValues = series
    .flatMap((p) => [p.iv_bid, p.iv_ask])
    .filter((v): v is number => v != null);
  if (series.length === 0 || ivValues.length === 0) return null;

  const hv = computeHv20(series);
  const trend = trendSlope != null ? trendLine(series, trendSlope) : null;

  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const x = (i: number) =>
    PAD.left + (series.length === 1 ? 0.5 : i / (series.length - 1)) * innerW;

  // IV panel 值域涵蓋 HV 與趨勢線端點,低 HV 不被裁掉
  const scaleValues = [
    ...ivValues,
    ...hv.filter((v): v is number => v != null),
    ...(trend
      ? [trend.intercept + trendSlope! * trend.i0, trend.intercept + trendSlope! * trend.i1]
      : []),
  ];
  const iv = span(scaleValues);
  const ivY = (v: number) => IV_TOP + (1 - (v - iv.lo) / (iv.hi - iv.lo)) * IV_H;

  const priceTop = IV_TOP + IV_H + PANEL_GAP;
  const priceValues = series
    .map((p) => p.underlying_close)
    .filter((v): v is number => v != null);
  let pricePath = "";
  let priceTicks: { y: number; label: string }[] = [];
  if (priceValues.length > 0) {
    const pr = span(priceValues);
    const priceY = (v: number) => priceTop + (1 - (v - pr.lo) / (pr.hi - pr.lo)) * PRICE_H;
    pricePath = buildPath(series, (p) => p.underlying_close, x, priceY);
    priceTicks = [pr.hi, pr.lo].map((v) => ({
      y: priceY(v),
      label: v >= 1000 ? v.toFixed(0) : v.toFixed(1),
    }));
  }

  const tickIdx =
    series.length <= 2
      ? [0, series.length - 1].filter((i, k, a) => a.indexOf(i) === k)
      : [0, Math.floor((series.length - 1) / 2), series.length - 1];

  return {
    width,
    height: IV_TOP + IV_H + PANEL_GAP + PRICE_H + X_LABEL_H,
    pad: PAD,
    ivPanel: {
      top: IV_TOP,
      height: IV_H,
      bidPath: buildPath(series, (p) => p.iv_bid, x, ivY),
      askPath: buildPath(series, (p) => p.iv_ask, x, ivY),
      hvPath: buildPath(series, (_p, i) => hv[i] ?? null, x, ivY),
      trendPath: trend
        ? `M${x(trend.i0).toFixed(1)},${ivY(trend.intercept + trendSlope! * trend.i0).toFixed(1)}` +
          `L${x(trend.i1).toFixed(1)},${ivY(trend.intercept + trendSlope! * trend.i1).toFixed(1)}`
        : "",
      yTicks: [iv.hi, (iv.hi + iv.lo) / 2, iv.lo].map((v) => ({
        y: ivY(v),
        label: `${(v * 100).toFixed(0)}%`,
      })),
    },
    pricePanel: {
      top: priceTop,
      height: PRICE_H,
      pricePath,
      yTicks: priceTicks,
    },
    xTicks: tickIdx.map((i) => ({
      x: x(i),
      label: series[i]!.date.slice(5), // MM-DD
    })),
  };
}
