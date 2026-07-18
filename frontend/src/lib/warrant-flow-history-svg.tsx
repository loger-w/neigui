// 外部淨額時序圖純函式(無 React 依賴,獨立單測 — chip-svg 慣例)。
// null 日斷點:連續非 null built 日成段,null / missing 切段不補 0(SC-4);
// x = built 槽等距 index(missing 不佔位,佔位會產生假 gap 誤導為斷點,design §3.4)。
import type { WarrantFlowHistoryDay } from "./warrant-flow-data";

export interface NetHistoryPoint {
  x: number;
  y: number;
}

export interface NetHistoryChartGeom {
  /** 認購線段(每段 ≥1 點;單點段由元件畫圓點) */
  callSegments: NetHistoryPoint[][];
  putSegments: NetHistoryPoint[][];
  zeroY: number;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
}

const PAD = { left: 44, right: 8, top: 8, bottom: 18 };

function segments(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): NetHistoryPoint[][] {
  const out: NetHistoryPoint[][] = [];
  let cur: NetHistoryPoint[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) out.push(cur);
      cur = [];
      return;
    }
    cur.push({ x: x(i), y: y(v) });
  });
  if (cur.length) out.push(cur);
  return out;
}

export function computeNetHistoryChart(
  days: WarrantFlowHistoryDay[],
  width: number,
  height: number,
): NetHistoryChartGeom | null {
  const built = days.filter((d) => d.status === "built");
  if (built.length < 2 || width <= PAD.left + PAD.right) return null;

  const callVals = built.map((d) => d.call?.external_net ?? null);
  const putVals = built.map((d) => d.put?.external_net ?? null);
  const finite = [...callVals, ...putVals].filter((v): v is number => v != null);

  // y domain 恆含 0(零軸 = 方向分界;全 null 時退化為 ±1 對稱域)
  const lo = Math.min(0, ...(finite.length ? finite : [-1]));
  const hi = Math.max(0, ...(finite.length ? finite : [1]));
  const span = hi - lo || 1;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (built.length === 1 ? plotW / 2 : (i / (built.length - 1)) * plotW);
  const y = (v: number) => PAD.top + ((hi - v) / span) * plotH;

  // x ticks:首/中/尾(built 槽日期,MM-DD)
  const tickIdx =
    built.length <= 2 ? built.map((_, i) => i) : [0, Math.floor((built.length - 1) / 2), built.length - 1];
  return {
    callSegments: segments(callVals, x, y),
    putSegments: segments(putVals, x, y),
    zeroY: y(0),
    xTicks: [...new Set(tickIdx)].map((i) => ({ x: x(i), label: built[i]!.date.slice(5) })),
    yTicks: [hi, 0, lo]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((v) => ({ y: y(v), label: fmtTick(v) })),
  };
}

/** y 軸 tick 標籤:億/萬 縮寫(帶號) */
function fmtTick(v: number): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(1)}億`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(0)}萬`;
  return `${sign}${a.toFixed(0)}`;
}
