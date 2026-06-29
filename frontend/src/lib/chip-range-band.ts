export interface RangeBand {
  startIdx: number;
  endIdx: number;
}

export function computeRangeBand(
  selectedIndex: number | null,
  windowDays: number,
  candleCount: number,
): RangeBand | null {
  if (selectedIndex === null) return null;
  if (windowDays <= 1) return null;
  if (candleCount <= 0) return null;
  if (selectedIndex < 0 || selectedIndex >= candleCount) return null;
  const startIdx = Math.max(0, selectedIndex - windowDays + 1);
  return { startIdx, endIdx: selectedIndex };
}

export function rangeBandX(
  band: RangeBand,
  width: number,
  candleCount: number,
  padL: number,
  padR: number,
): { x: number; width: number } {
  const xRange = width - padL - padR;
  const slotW = xRange / candleCount;
  return {
    x: padL + slotW * band.startIdx,
    width: slotW * (band.endIdx - band.startIdx + 1),
  };
}
