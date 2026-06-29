/** Squarified treemap layout + colour mapping for MarketHeatmap.
 *
 * 純算式(無 React state / DOM 讀取)。上層元件 layout → map 成 <rect>/<text>。
 * Bruls et al. 1999 squarified algorithm。
 *
 * design.md §6.3 v3 (v3 L4 — TileLayout has fillColor + marketValueIsFallback
 * derived fields,backward-compatible expansion of design §6.3 TileLayout)。
 */

import type { Sector, StockTile } from "./market-types";

export type TileLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  stockId: string;
  name: string;
  changeRate: number;
  marketValue: number | null;
  totalAmount: number;
  fillColor: string;
  marketValueIsFallback: boolean;
};

export type SectorGroupLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  name: string;
  avgChangeRate: number;
  tiles: TileLayout[];
};

// ---------------------------------------------------------------------------
// colorForChange — 9 bins, bull=紅 / bear=綠(台股慣例 CLAUDE.md §3 / SC-2)
// ---------------------------------------------------------------------------

const BULL_DARKEST = "#d32f2f";
const BULL_DARK = "#ef5350";
const BULL_MID = "#ff8a80";
const BULL_LIGHT = "#ffcdd2";
const NEUTRAL = "#cfd8dc";
const BEAR_LIGHT = "#c8e6c9";
const BEAR_MID = "#81c784";
const BEAR_DARK = "#4caf50";
const BEAR_DARKEST = "#2e7d32";

export function colorForChange(changeRate: number): string {
  if (changeRate >= 7) return BULL_DARKEST;
  if (changeRate >= 3) return BULL_DARK;
  if (changeRate >= 1) return BULL_MID;
  if (changeRate > 0) return BULL_LIGHT;
  if (changeRate === 0) return NEUTRAL;
  if (changeRate > -1) return BEAR_LIGHT;
  if (changeRate > -3) return BEAR_MID;
  if (changeRate > -7) return BEAR_DARK;
  return BEAR_DARKEST;
}

// ---------------------------------------------------------------------------
// Squarified treemap — pure algorithm
// ---------------------------------------------------------------------------

type Item = {
  /** opaque payload (Sector for outer, StockTile-derived for inner) */
  ref: unknown;
  weight: number;
};

type Rect = { x: number; y: number; w: number; h: number };

/** Layout `items` (sorted desc by weight) within `rect`. Returns one box per
 * item in the same order. Implements squarified treemap. */
function squarify(items: Item[], rect: Rect): Array<Rect & { ref: unknown }> {
  if (items.length === 0) return [];
  const result: Array<Rect & { ref: unknown }> = [];
  const queue = [...items];
  let r = { ...rect };
  while (queue.length > 0) {
    const row: Item[] = [queue.shift()!];
    const short = Math.min(r.w, r.h);
    let bestRatio = worstAspect(row, short);
    while (queue.length > 0) {
      const next = queue[0]!;
      const tryRow = [...row, next];
      const tryRatio = worstAspect(tryRow, short);
      if (tryRatio <= bestRatio) {
        row.push(queue.shift()!);
        bestRatio = tryRatio;
      } else {
        break;
      }
    }
    // place row in r
    const placed = placeRow(row, r);
    for (const p of placed) result.push(p);
    r = remainingRect(r, row);
    if (r.w <= 0 || r.h <= 0) break;
  }
  return result;
}

function worstAspect(row: Item[], short: number): number {
  if (row.length === 0) return Infinity;
  const sum = row.reduce((acc, it) => acc + it.weight, 0);
  if (sum <= 0 || short <= 0) return Infinity;
  const max = row.reduce((acc, it) => Math.max(acc, it.weight), 0);
  const min = row.reduce((acc, it) => Math.min(acc, it.weight), Infinity);
  const short2 = short * short;
  const sum2 = sum * sum;
  return Math.max((short2 * max) / sum2, sum2 / (short2 * min));
}

function placeRow(row: Item[], rect: Rect): Array<Rect & { ref: unknown }> {
  const sum = row.reduce((acc, it) => acc + it.weight, 0);
  if (sum <= 0) {
    const equalW = rect.w / row.length;
    return row.map((it, idx) => ({
      x: rect.x + idx * equalW, y: rect.y, w: equalW, h: rect.h, ref: it.ref,
    }));
  }
  if (rect.w >= rect.h) {
    // Layout as vertical column on left edge.
    // Column width = sum / rect.h (so col area = colW * rect.h == sum)。
    const colW = Math.min(sum / rect.h, rect.w);  // clamp to remaining w
    const result: Array<Rect & { ref: unknown }> = [];
    let yCursor = rect.y;
    for (const it of row) {
      const h = (it.weight / sum) * rect.h;
      result.push({ x: rect.x, y: yCursor, w: colW, h, ref: it.ref });
      yCursor += h;
    }
    return result;
  } else {
    // Layout as horizontal row on top edge。row height = sum / rect.w。
    const rowH = Math.min(sum / rect.w, rect.h);
    const result: Array<Rect & { ref: unknown }> = [];
    let xCursor = rect.x;
    for (const it of row) {
      const w = (it.weight / sum) * rect.w;
      result.push({ x: xCursor, y: rect.y, w, h: rowH, ref: it.ref });
      xCursor += w;
    }
    return result;
  }
}

function remainingRect(rect: Rect, row: Item[]): Rect {
  const sum = row.reduce((acc, it) => acc + it.weight, 0);
  if (sum <= 0) return { x: rect.x, y: rect.y, w: 0, h: 0 };
  if (rect.w >= rect.h) {
    const colW = Math.min(sum / rect.h, rect.w);
    return { x: rect.x + colW, y: rect.y, w: Math.max(0, rect.w - colW), h: rect.h };
  } else {
    const rowH = Math.min(sum / rect.w, rect.h);
    return { x: rect.x, y: rect.y + rowH, w: rect.w, h: Math.max(0, rect.h - rowH) };
  }
}

// ---------------------------------------------------------------------------
// layoutHeatmap
// ---------------------------------------------------------------------------

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function sectorWeight(sector: Sector, fallback: number): number {
  let total = 0;
  for (const s of sector.stocks) {
    total += s.market_value ?? fallback;
  }
  return total;
}

function tileWeight(
  stock: StockTile,
  sectorMedian: number,
  wholeMarketMedian: number,
): { weight: number; isFallback: boolean } {
  if (stock.market_value !== null && stock.market_value !== undefined) {
    return { weight: stock.market_value, isFallback: false };
  }
  // fallback: sector median if sector has any real values, else whole-market median
  const fallback = sectorMedian > 0 ? sectorMedian : wholeMarketMedian;
  return {
    weight: fallback > 0 ? fallback : 1,  // 確保非零 → tile 仍有 size
    isFallback: true,
  };
}

export function layoutHeatmap(
  sectors: Sector[],
  width: number,
  height: number,
): SectorGroupLayout[] {
  if (sectors.length === 0) return [];
  if (width <= 0 || height <= 0) return [];

  // Whole-market median for sector-level fallback
  const allMVs: number[] = [];
  for (const sec of sectors) {
    for (const s of sec.stocks) {
      if (s.market_value !== null && s.market_value !== undefined) {
        allMVs.push(s.market_value);
      }
    }
  }
  const wholeMarketMedian = median(allMVs);
  const wholeFallback = wholeMarketMedian > 0 ? wholeMarketMedian : 1;

  // Outer treemap of sectors
  const sectorItems: Item[] = sectors.map((sec) => ({
    ref: sec,
    weight: sectorWeight(sec, wholeFallback),
  }));

  // Sort desc for squarified
  sectorItems.sort((a, b) => b.weight - a.weight);

  // Squarify expects weights scaled so sum equals rect area
  const totalArea = width * height;
  const totalWeight = sectorItems.reduce((acc, it) => acc + it.weight, 0);
  if (totalWeight <= 0) {
    // All zero — equal split
    const wSlice = width / sectors.length;
    return sectors.map((sec, i) => ({
      x: i * wSlice, y: 0, w: wSlice, h: height,
      id: sec.id, name: sec.name, avgChangeRate: sec.avg_change_rate, tiles: [],
    }));
  }
  const scale = totalArea / totalWeight;
  const scaledItems: Item[] = sectorItems.map((it) => ({
    ref: it.ref, weight: it.weight * scale,
  }));

  const sectorBoxes = squarify(scaledItems, { x: 0, y: 0, w: width, h: height });

  const result: SectorGroupLayout[] = [];
  for (const box of sectorBoxes) {
    const sec = box.ref as Sector;
    // Inner treemap of stocks in this sector
    const sectorMVs = sec.stocks
      .map((s) => s.market_value)
      .filter((v): v is number => v !== null && v !== undefined);
    const sectorMedian = median(sectorMVs);

    const tileItems: Array<Item & { isFallback: boolean }> = sec.stocks.map((s) => {
      const w = tileWeight(s, sectorMedian, wholeMarketMedian);
      return { ref: s, weight: w.weight, isFallback: w.isFallback };
    });
    tileItems.sort((a, b) => b.weight - a.weight);

    let tiles: TileLayout[] = [];
    const innerTotalWeight = tileItems.reduce((acc, it) => acc + it.weight, 0);
    if (innerTotalWeight > 0 && box.w > 0 && box.h > 0) {
      const innerArea = box.w * box.h;
      const innerScale = innerArea / innerTotalWeight;
      const scaled: Item[] = tileItems.map((it) => ({
        ref: it.ref, weight: it.weight * innerScale,
      }));
      const tileBoxes = squarify(scaled, box);
      const fallbackSet = new Set(tileItems.filter((t) => t.isFallback).map((t) => t.ref));
      tiles = tileBoxes.map((tb) => {
        const stock = tb.ref as StockTile;
        return {
          x: tb.x, y: tb.y, w: Math.max(0, tb.w), h: Math.max(0, tb.h),
          stockId: stock.stock_id,
          name: stock.name,
          changeRate: stock.change_rate,
          marketValue: stock.market_value,
          totalAmount: stock.total_amount,
          fillColor: colorForChange(stock.change_rate),
          marketValueIsFallback: fallbackSet.has(stock),
        };
      });
    }
    result.push({
      x: box.x, y: box.y, w: box.w, h: box.h,
      id: sec.id, name: sec.name, avgChangeRate: sec.avg_change_rate,
      tiles,
    });
  }
  return result;
}
