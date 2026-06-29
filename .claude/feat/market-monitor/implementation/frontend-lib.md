# Implementation: Frontend lib

Covers: `lib/market-types.ts`、`lib/market-api.ts`、`lib/heatmap-svg.tsx` + 對應 `*.test.ts`。

Design source:`../design.md` v3 §6.3、§6.7、§10。

---

## File 1:`frontend/src/lib/market-types.ts`(新增)

```ts
/** API contract types for /api/market/snapshot — design.md §10 v3 */

export type MarketSnapshot = {
  as_of: string;                     // ISO datetime
  last_tick: string | null;          // ISO datetime
  is_trading_session: boolean;
  stale: boolean;
  lag_seconds: number | null;
  sectors: Sector[];
  leaderboards: Leaderboards;
};

export type Sector = {
  id: string;
  name: string;
  member_count: number;
  avg_change_rate: number;           // -100 ~ +100 (%)
  total_amount: number;              // 累計成交額 NT$
  stocks: StockTile[];
};

export type StockTile = {
  stock_id: string;
  name: string;
  change_rate: number;               // -100 ~ +100 (%)
  total_amount: number;              // 累計成交額 NT$
  market_value: number | null;       // T-1 市值;null = 未提供(E2 fallback 顯示)
};

export type Leaderboards = {
  gainers: LeaderboardRow[];
  losers: LeaderboardRow[];
  amount: LeaderboardRow[];
  volume_ratio: LeaderboardRow[];
};

export type LeaderboardRow = {
  stock_id: string;
  name: string;
  change_rate: number;
  total_amount: number;
  volume_ratio: number | null;       // v3 F5 — null when FinMind 不回此欄
  sector: string;
};
```

**SC mapping**:SC-1 / SC-2 / SC-3 / SC-5 都依賴此 type。

**測試**:無單測(純 type 宣告);後續 component / hook test 引用,TS 編譯本身是 gate。

---

## File 2:`frontend/src/lib/market-api.ts`(新增)— v3 F11

```ts
import type { MarketSnapshot } from "./market-types";

const BASE = "/api/market";

/**
 * 直接 fetch,**不** 經 lib/api.ts 的 __apiGet 5-min cache。
 *
 * 設計理由(design.md §6.7):polling 2.5s 跟 __apiGet 內建 5-min _cache
 * 會撞,前端 UI 凍結;TanStack Query 自身已 dedup 同 queryKey 並發,不需
 * 第二層 client cache。
 */
export async function fetchMarketSnapshot(
  refresh: boolean,
): Promise<MarketSnapshot> {
  const url = new URL(`${BASE}/snapshot`, window.location.origin);
  if (refresh) url.searchParams.set("refresh", "true");

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.json().catch(() => null) as
      | { detail?: { error?: string } }
      | null;
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<MarketSnapshot>;
}
```

### Test file:`frontend/src/lib/market-api.test.ts`(新增)

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMarketSnapshot } from "./market-api";

afterEach(() => vi.restoreAllMocks());

describe("fetchMarketSnapshot", () => {
  it("hits /api/market/snapshot without refresh param when refresh=false", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ stub: 1 }), { status: 200 }),
    );
    await fetchMarketSnapshot(false);
    const url = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(url).toContain("/api/market/snapshot");
    expect(url).not.toContain("refresh=true");
  });

  it("adds refresh=true to URL when refresh=true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ stub: 1 }), { status: 200 }),
    );
    await fetchMarketSnapshot(true);
    const url = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(url).toContain("refresh=true");
  });

  it("throws with detail.error message on 5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { error: "finmind_unreachable" } }),
        { status: 502 },
      ),
    );
    await expect(fetchMarketSnapshot(false)).rejects.toThrow(
      "finmind_unreachable",
    );
  });

  it("throws with generic HTTP message when body has no detail.error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("oops", { status: 500 }),
    );
    await expect(fetchMarketSnapshot(false)).rejects.toThrow(/HTTP 500/);
  });
});
```

**SC mapping**:SC-1(fetch happy)+ SC-5(refresh 旗標)+ E7(error path)。

---

## File 3:`frontend/src/lib/heatmap-svg.tsx`(新增)— 純算式

**注**(v3 L4):本檔 `TileLayout` 在 design.md §6.3 base 上 backward-compatible expansion 兩 derived field:
- `fillColor: string` — 把 `colorForChange()` 拉到 layout 階段算,component 直接吃結果不必再 map;對齊 chip-svg.tsx 純算式輸出含顏色慣例
- `marketValueIsFallback: boolean` — 支援 E2 tooltip 標「市值估」flag,符合 design §1 Q3 fallback 兌現

非 breaking change(原 fields 未動),不需 design.md v4。

### Module structure
```tsx
/** Squarified treemap layout + colour mapping for MarketHeatmap.
 *
 * 純算式(無 React state / DOM 讀取);算 layout、回 list of rect 給上層元件
 * map 成 <rect>/<text>。Bruls et al. 1999 squarified algorithm。
 *
 * design.md §6.3 v3。
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
  fillColor: string;          // 已套 colorForChange()
  marketValueIsFallback: boolean; // E2 — sector median fallback
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

export function layoutHeatmap(
  sectors: Sector[],
  width: number,
  height: number,
): SectorGroupLayout[] {
  // 1. 外層 treemap:sector 面積 = sum of stocks.market_value(若全缺則用 stocks.length 等比)
  // 2. squarified — group sectors,每組畫成 row 或 column 看 aspect ratio
  // 3. 對每個 sector group,在其矩形內再跑 squarified for stocks
  // 4. 缺 market_value 的 stock 用 sector tile median 補,標 marketValueIsFallback=true
  // ...
  // Phase 3 寫真實算式;此 spec 只給 signature
  return [];
}

export function colorForChange(changeRate: number): string {
  // Bull = 紅,Bear = 綠(台股慣例,CLAUDE.md §3 / brainstorm.md SC-2)
  // 9 階配色:
  //   ≥ +7%  : #d32f2f (深紅)
  //   ≥ +3%  : #ef5350
  //   ≥ +1%  : #ff8a80
  //   ≥ +0.01: #ffcdd2
  //   = 0    : #cfd8dc (灰)
  //   ≤ -0.01: #c8e6c9
  //   ≤ -1%  : #81c784
  //   ≤ -3%  : #4caf50
  //   ≤ -7%  : #2e7d32 (深綠)
  // ...
  return "#cfd8dc";  // Phase 3 寫實作
}
```

### Test file:`frontend/src/lib/heatmap-svg.test.ts`(新增)

```ts
import { describe, expect, it } from "vitest";
import { colorForChange, layoutHeatmap } from "./heatmap-svg";
import type { Sector } from "./market-types";

describe("colorForChange", () => {
  // v3 L1 fix — lock 具體 hex + RGB channel direction + cross-check;
  // 避免 stub trivially pass + 鎖 SC-2 hard rule(台股 bull=紅 / bear=綠)。

  // RGB channel helper
  function rgb(hex: string): [number, number, number] {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)!;
    return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  }

  it("uses bull RED for positive change (台股慣例) — R channel > G channel", () => {
    const color = colorForChange(5);
    const [r, g, _b] = rgb(color);
    expect(r).toBeGreaterThan(g);  // 紅多於綠 — 鎖 SC-2 方向
  });

  it("uses bear GREEN for negative change (台股慣例) — G channel > R channel", () => {
    const color = colorForChange(-5);
    const [r, g, _b] = rgb(color);
    expect(g).toBeGreaterThan(r);  // 綠多於紅 — 鎖 SC-2 方向
  });

  it("cross-check: positive and negative bins never coincide", () => {
    expect(colorForChange(5)).not.toBe(colorForChange(-5));
    expect(colorForChange(2)).not.toBe(colorForChange(-2));
    expect(colorForChange(8)).not.toBe(colorForChange(-8));
  });

  it("locks specific bin hex values", () => {
    // 9 bin 精確 hex,任何 regression 都會紅
    expect(colorForChange(8)).toBe("#d32f2f");     // ≥ +7
    expect(colorForChange(5)).toBe("#ef5350");     // ≥ +3
    expect(colorForChange(2)).toBe("#ff8a80");     // ≥ +1
    expect(colorForChange(0.5)).toBe("#ffcdd2");   // > 0
    expect(colorForChange(0)).toBe("#cfd8dc");     // = 0 (中性灰)
    expect(colorForChange(-0.5)).toBe("#c8e6c9");  // < 0
    expect(colorForChange(-2)).toBe("#81c784");    // ≤ -1
    expect(colorForChange(-5)).toBe("#4caf50");    // ≤ -3
    expect(colorForChange(-8)).toBe("#2e7d32");    // ≤ -7
  });

  it("bins ≥ 7% all map to darkest red", () => {
    expect(colorForChange(7)).toBe("#d32f2f");
    expect(colorForChange(15)).toBe("#d32f2f");
    expect(colorForChange(100)).toBe("#d32f2f");
  });

  it("bins ≤ -7% all map to darkest green", () => {
    expect(colorForChange(-7)).toBe("#2e7d32");
    expect(colorForChange(-15)).toBe("#2e7d32");
    expect(colorForChange(-100)).toBe("#2e7d32");
  });
});

describe("layoutHeatmap — squarified treemap algorithm", () => {
  it("returns empty array for empty sectors", () => {
    expect(layoutHeatmap([], 800, 600)).toEqual([]);
  });

  it("each sector group fits within the canvas", () => {
    const sectors: Sector[] = [
      mkSector("半導體業", [mkStock("2330", 1e13)]),
      mkSector("電子工業", [mkStock("2382", 5e12)]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    expect(layout.length).toBeGreaterThan(0);  // v3 L2 guard
    for (const s of layout) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(800.01);
      expect(s.y + s.h).toBeLessThanOrEqual(600.01);
    }
  });

  it("tiles within a sector fit within the sector rect", () => {
    const sectors: Sector[] = [
      mkSector("半導體業", [
        mkStock("2330", 6e13),
        mkStock("2454", 6e12),
      ]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    const sector = layout[0]!;
    expect(sector.tiles.length).toBeGreaterThan(0);  // v3 L2 guard
    for (const tile of sector.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(sector.x);
      expect(tile.y).toBeGreaterThanOrEqual(sector.y);
      expect(tile.x + tile.w).toBeLessThanOrEqual(sector.x + sector.w + 0.01);
      expect(tile.y + tile.h).toBeLessThanOrEqual(sector.y + sector.h + 0.01);
    }
  });

  it("stocks with null market_value fall back to sector median size (E2)", () => {
    const sectors: Sector[] = [
      mkSector("半導體業", [
        mkStock("2330", 6e13),
        mkStock("2454", 6e12),
        mkStock("XYZ", null),    // 缺市值
      ]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    const tile = layout[0]!.tiles.find((t) => t.stockId === "XYZ");
    expect(tile?.marketValueIsFallback).toBe(true);
    expect(tile?.w).toBeGreaterThan(0);
    expect(tile?.h).toBeGreaterThan(0);
  });

  it("falls back to whole-market median when sector market_value all null (v3 L2)", () => {
    // 兩個 sector 全部 null → 用整盤 median(設計 §1 Q3 fallback);
    // 兩 sector 都應該有非零面積 + 比例由 stock count 拉開
    const sectors: Sector[] = [
      mkSector("A", [mkStock("a1", null), mkStock("a2", null)]),
      mkSector("B", [mkStock("b1", null)]),
    ];
    const layout = layoutHeatmap(sectors, 800, 600);
    expect(layout.length).toBe(2);
    for (const s of layout) {
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
      for (const t of s.tiles) {
        expect(t.marketValueIsFallback).toBe(true);
        expect(t.w).toBeGreaterThan(0);
        expect(t.h).toBeGreaterThan(0);
      }
    }
  });

  it("handles extreme aspect ratio without NaN / negative size (v3 L2 / R-D3)", () => {
    const sectors: Sector[] = [
      mkSector("A", [mkStock("a1", 1e13), mkStock("a2", 5e12)]),
      mkSector("B", [mkStock("b1", 3e12)]),
    ];
    // 極寬
    const wide = layoutHeatmap(sectors, 2000, 10);
    for (const s of wide) {
      expect(Number.isFinite(s.w) && s.w >= 0).toBe(true);
      expect(Number.isFinite(s.h) && s.h >= 0).toBe(true);
    }
    // 極高
    const tall = layoutHeatmap(sectors, 10, 2000);
    for (const s of tall) {
      expect(Number.isFinite(s.w) && s.w >= 0).toBe(true);
      expect(Number.isFinite(s.h) && s.h >= 0).toBe(true);
    }
  });

  it("handles many tiles without crash (v3 L2 / R-D3 — 28×30 = 840 tiles)", () => {
    const sectors: Sector[] = Array.from({ length: 28 }, (_, i) =>
      mkSector(`sector_${i}`,
        Array.from({ length: 30 }, (_, j) => mkStock(`s${i}_${j}`, 1e10 + j)),
      ),
    );
    const layout = layoutHeatmap(sectors, 1000, 800);
    expect(layout.length).toBe(28);
    let totalTiles = 0;
    for (const s of layout) {
      expect(s.tiles.length).toBe(30);
      totalTiles += s.tiles.length;
    }
    expect(totalTiles).toBe(840);
  });

  it("never produces NaN or negative width / height", () => {
    const sectors: Sector[] = [mkSector("Singleton", [mkStock("0050", 1e13)])];
    const layout = layoutHeatmap(sectors, 800, 600);
    expect(layout.length).toBeGreaterThan(0);  // v3 L2 guard
    for (const s of layout) {
      expect(Number.isFinite(s.w)).toBe(true);
      expect(s.w).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.h)).toBe(true);
      expect(s.h).toBeGreaterThanOrEqual(0);
    }
  });

  it("color is set on each tile via colorForChange", () => {
    const sectors: Sector[] = [mkSector("X", [mkStock("9999", 1e12, 5.0)])];
    const layout = layoutHeatmap(sectors, 400, 300);
    expect(layout[0]!.tiles[0]!.fillColor).toBe(colorForChange(5));
  });
});

// --- helpers ---
function mkStock(
  stockId: string,
  marketValue: number | null,
  changeRate = 0,
) {
  return {
    stock_id: stockId,
    name: stockId,
    change_rate: changeRate,
    total_amount: 1_000_000,
    market_value: marketValue,
  };
}
function mkSector(id: string, stocks: ReturnType<typeof mkStock>[]) {
  const avg = stocks.length
    ? stocks.reduce((s, t) => s + t.change_rate, 0) / stocks.length
    : 0;
  return {
    id,
    name: id,
    member_count: stocks.length,
    avg_change_rate: avg,
    total_amount: stocks.reduce((s, t) => s + t.total_amount, 0),
    stocks,
  };
}
```

**SC mapping**:`colorForChange` tests → SC-2(bull=紅 bear=綠);`layoutHeatmap` tests → SC-2(treemap render)+ R-D3(squarified edge cases)+ E2(market_value fallback)。
