// CH-2(mod/batch-ui-update):windowDays 窗範圍聚合 — 純函式,無 React 依賴。
import type { DailyCandle } from "./chip-data";

export interface WindowAgg {
  days: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
}

/** [startIdx..endIdx] 窗聚合:開=窗首開、高/低=窗內極值、收=窗末收、量=加總;
 *  漲跌 = 窗末收 vs 窗前一日收(startIdx=0 時退回窗首開盤為基準)。 */
export function computeWindowAgg(
  candles: DailyCandle[],
  startIdx: number,
  endIdx: number,
): WindowAgg | null {
  if (startIdx < 0 || endIdx < startIdx || endIdx >= candles.length) return null;
  const first = candles[startIdx]!;
  const last = candles[endIdx]!;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i]!;
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volume += c.volume;
  }
  const prevClose = startIdx > 0 ? candles[startIdx - 1]!.close : first.open;
  const change = last.close - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  return {
    days: endIdx - startIdx + 1,
    open: first.open,
    high,
    low,
    close: last.close,
    volume,
    change,
    changePct,
  };
}

/** [startIdx..endIdx] 區間加總(越界自動 clamp;空陣列回 0)。 */
export function sumRange(values: number[], startIdx: number, endIdx: number): number {
  const s = Math.max(0, startIdx);
  const e = Math.min(values.length - 1, endIdx);
  let sum = 0;
  for (let i = s; i <= e; i++) sum += values[i]!;
  return sum;
}
