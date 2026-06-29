# Implementation: Frontend Components

Covers:`MarketPage` / `MarketHeader` / `MarketHeatmap` / `MarketLeaderboard` + 對應 tests。

Design source:`../design.md` v3 §6.3-6.6、§10。

---

## File 1:`frontend/src/components/MarketHeader.tsx`(新增)

```tsx
import { type ReactElement } from "react";
import { cn } from "../lib/utils";

type Props = {
  lastUpdated: string | null;
  isStale: boolean;
  isTradingSession: boolean;
  lagSeconds: number | null;
  onRefresh: () => void;
};

export function MarketHeader({
  lastUpdated, isStale, isTradingSession, lagSeconds, onRefresh,
}: Props): ReactElement {
  const sessionLabel = !lastUpdated
    ? "尚未載入"
    : isTradingSession
      ? "盤中"
      : "已收盤";
  const lagLabel = lagSeconds == null
    ? "—"
    : lagSeconds < 30
      ? "即時"
      : lagSeconds < 60
        ? `${lagSeconds}s`
        : `${Math.floor(lagSeconds / 60)} 分鐘`;
  const lagPillColor = lagSeconds == null
    ? "bg-bg-deep text-ink-dim"
    : lagSeconds < 30
      ? "bg-accent/20 text-accent"
      : lagSeconds < 60
        ? "bg-yellow-500/20 text-yellow-600"
        : "bg-red-500/20 text-red-600";

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-line">
      <div className="flex items-center gap-3">
        <h2 className="text-ink font-medium">大盤掃描</h2>
        <span className="text-ink-muted text-xs">
          {sessionLabel}{lastUpdated && ` · ${formatTime(lastUpdated)}`}
        </span>
        <span className={cn("text-xs px-2 py-0.5 rounded", lagPillColor)}>
          {lagLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {isStale && (
          <span className="text-yellow-600 text-xs">資料停滯</span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="text-ink-muted hover:text-ink text-xs px-2 py-1 rounded
                     border border-line hover:border-line-strong cursor-pointer"
          aria-label="重新整理"
        >
          重新整理
        </button>
      </div>
    </header>
  );
}

function formatTime(iso: string): string {
  // "2026-06-29T10:29:50" → "10:29:50"
  const t = iso.split("T")[1] ?? iso;
  return t.split(".")[0] ?? t;
}
```

**SC mapping**:SC-5(last_tick / stale banner / 收盤狀態 / refresh button)。

**測試**:含在 `MarketPage.test.tsx` 整測層(避免拆 6 個小元件單測)。

---

## File 2:`frontend/src/components/MarketHeatmap.tsx`(新增)

```tsx
import { useRef, useState, type ReactElement } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { layoutHeatmap, type TileLayout } from "../lib/heatmap-svg";
import type { Sector } from "../lib/market-types";

type Props = {
  sectors: Sector[];
  onSymbolPick: (stockId: string) => void;
};

export function MarketHeatmap({ sectors, onSymbolPick }: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(containerRef);
  const [hoveredTile, setHoveredTile] = useState<TileLayout | null>(null);

  const groups = layoutHeatmap(sectors, width, height);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-bg-deep">
      <svg width={width} height={height} role="img" aria-label="大盤族群熱力圖">
        {groups.map((g) => (
          <g key={g.id}>
            <rect
              x={g.x} y={g.y} width={g.w} height={g.h}
              fill="none" stroke="var(--color-line)" strokeWidth={1}
            />
            <text
              x={g.x + 4} y={g.y + 12}
              className="fill-ink-muted text-[10px] pointer-events-none"
            >
              {g.name}
            </text>
            {g.tiles.map((t) => (
              <g
                key={t.stockId}
                onMouseEnter={() => setHoveredTile(t)}
                onMouseLeave={() => setHoveredTile(null)}
                onClick={() => onSymbolPick(t.stockId)}
                className="cursor-pointer"
                data-testid={`tile-${t.stockId}`}
              >
                <rect
                  x={t.x} y={t.y} width={t.w} height={t.h}
                  fill={t.fillColor}
                  data-fill-bin={t.changeRate > 0 ? "bull" : t.changeRate < 0 ? "bear" : "neutral"}
                />
                {t.w > 30 && t.h > 18 && (
                  <text
                    x={t.x + t.w / 2} y={t.y + t.h / 2}
                    textAnchor="middle"
                    className="fill-ink text-[10px] pointer-events-none"
                  >
                    {t.stockId}
                  </text>
                )}
              </g>
            ))}
          </g>
        ))}
      </svg>
      {hoveredTile && (
        <div
          className="absolute pointer-events-none bg-bg border border-line
                     rounded px-2 py-1 text-xs text-ink shadow-lg"
          style={{ left: hoveredTile.x + hoveredTile.w + 4, top: hoveredTile.y }}
          role="tooltip"
        >
          <div className="font-medium">
            {hoveredTile.stockId} {hoveredTile.name}
          </div>
          <div className={hoveredTile.changeRate > 0 ? "text-red-500" : "text-green-500"}>
            {hoveredTile.changeRate >= 0 ? "+" : ""}{hoveredTile.changeRate.toFixed(2)}%
          </div>
          <div className="text-ink-dim">
            成交額 {(hoveredTile.totalAmount / 1e6).toFixed(1)}M
            {hoveredTile.marketValueIsFallback && (
              <span className="text-yellow-600 ml-1">(市值估)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

### Test file:`MarketHeatmap.test.tsx`(新增)

```tsx
/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketHeatmap } from "./MarketHeatmap";
import type { Sector } from "../lib/market-types";

// v3 C2 fix — jsdom 沒 ResizeObserver,useContainerSize 內部 new ResizeObserver
// 會 ReferenceError;同時 getBoundingClientRect 回 0×0 → layoutHeatmap 回空
// → 所有 tile assertion 落空。對齊既有 ChipKlineChart.test.tsx 樣板。
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
});

// Mock useContainerSize 給固定 size,避免 jsdom 0×0
vi.mock("../hooks/useContainerSize", () => ({
  useContainerSize: () => ({ width: 800, height: 600 }),
}));

afterEach(() => cleanup());

const sectors: Sector[] = [
  {
    id: "半導體業", name: "半導體業", member_count: 1,
    avg_change_rate: 1.0, total_amount: 1e9,
    stocks: [{
      stock_id: "2330", name: "台積電", change_rate: 1.92,
      total_amount: 36e9, market_value: 6e13,
    }],
  },
];

describe("MarketHeatmap", () => {
  it("renders SVG container with role img", () => {
    render(<MarketHeatmap sectors={sectors} onSymbolPick={() => {}} />);
    expect(screen.getByRole("img", { name: "大盤族群熱力圖" })).toBeTruthy();
  });

  it("renders tile for each stock with data-testid", () => {
    render(<MarketHeatmap sectors={sectors} onSymbolPick={() => {}} />);
    expect(document.querySelector('[data-testid="tile-2330"]')).toBeTruthy();
  });

  it("rect has data-fill-bin=bull for positive change (台股慣例 bull=紅 SC-2)", () => {
    render(<MarketHeatmap sectors={sectors} onSymbolPick={() => {}} />);
    const rect = document.querySelector('[data-testid="tile-2330"] rect[data-fill-bin]');
    expect(rect?.getAttribute("data-fill-bin")).toBe("bull");
  });

  it("rect has data-fill-bin=bear for negative change", () => {
    const bearSectors: Sector[] = [{
      ...sectors[0]!,
      stocks: [{ ...sectors[0]!.stocks[0]!, change_rate: -2.5 }],
    }];
    render(<MarketHeatmap sectors={bearSectors} onSymbolPick={() => {}} />);
    const rect = document.querySelector('[data-testid="tile-2330"] rect[data-fill-bin]');
    expect(rect?.getAttribute("data-fill-bin")).toBe("bear");
  });

  it("calls onSymbolPick with stock_id on tile click", () => {
    const spy = vi.fn();
    render(<MarketHeatmap sectors={sectors} onSymbolPick={spy} />);
    fireEvent.click(document.querySelector('[data-testid="tile-2330"]')!);
    expect(spy).toHaveBeenCalledWith("2330");
  });

  it("shows tooltip on mouseEnter with stock_id + name", () => {
    render(<MarketHeatmap sectors={sectors} onSymbolPick={() => {}} />);
    const tile = document.querySelector('[data-testid="tile-2330"]')!;
    fireEvent.mouseEnter(tile);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("2330");
    expect(tip.textContent).toContain("台積電");
    expect(tip.textContent).toContain("+1.92%");
  });

  it("tooltip shows fallback marker when market_value is null (E2)", () => {
    const fallbackSectors: Sector[] = [{
      ...sectors[0]!,
      stocks: [{ ...sectors[0]!.stocks[0]!, market_value: null }],
    }];
    render(<MarketHeatmap sectors={fallbackSectors} onSymbolPick={() => {}} />);
    fireEvent.mouseEnter(document.querySelector('[data-testid="tile-2330"]')!);
    expect(screen.getByRole("tooltip").textContent).toContain("市值估");
  });

  it("renders nothing meaningful for empty sectors[]", () => {
    render(<MarketHeatmap sectors={[]} onSymbolPick={() => {}} />);
    expect(document.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(0);
  });
});
```

**SC mapping**:SC-2(treemap render / bull=紅 bear=綠 / hover tooltip / click→pivot)+ E2(fallback flag)。

---

## File 3:`frontend/src/components/MarketLeaderboard.tsx`(新增)

```tsx
import { useState, type ReactElement } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";
import type { Leaderboards, LeaderboardRow } from "../lib/market-types";

type Tab = "gainers" | "amount" | "volume_ratio";

type Props = {
  leaderboards: Leaderboards | null;
  onSymbolPick: (stockId: string) => void;
};

export function MarketLeaderboard({
  leaderboards, onSymbolPick,
}: Props): ReactElement {
  const [tab, setTab] = useState<Tab>("gainers");

  return (
    <div className="border-l border-line flex flex-col h-full bg-bg">
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="h-full flex flex-col">
        <TabsList className="border-b border-line">
          <TabsTrigger value="gainers">漲跌幅</TabsTrigger>
          <TabsTrigger value="amount">大量單</TabsTrigger>
          <TabsTrigger value="volume_ratio">量比</TabsTrigger>
        </TabsList>

        <TabsContent value="gainers" className="flex-1 overflow-y-auto">
          <DualRankList
            up={leaderboards?.gainers ?? []}
            down={leaderboards?.losers ?? []}
            onPick={onSymbolPick}
          />
        </TabsContent>
        <TabsContent value="amount" className="flex-1 overflow-y-auto">
          <RankList
            rows={leaderboards?.amount ?? []}
            valueLabel={(r) => `${(r.total_amount / 1e6).toFixed(1)}M`}
            onPick={onSymbolPick}
          />
        </TabsContent>
        <TabsContent value="volume_ratio" className="flex-1 overflow-y-auto">
          <RankList
            rows={leaderboards?.volume_ratio ?? []}
            valueLabel={(r) => r.volume_ratio != null ? `${r.volume_ratio.toFixed(2)}x` : "—"}
            onPick={onSymbolPick}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DualRankList({ up, down, onPick }: {
  up: LeaderboardRow[]; down: LeaderboardRow[];
  onPick: (sid: string) => void;
}) {
  return (
    <>
      <SectionTitle>漲幅 Top 15</SectionTitle>
      {up.slice(0, 15).map((r) => <Row key={r.stock_id} row={r} onPick={onPick} />)}
      <SectionTitle>跌幅 Top 15</SectionTitle>
      {down.slice(0, 15).map((r) => <Row key={r.stock_id} row={r} onPick={onPick} />)}
    </>
  );
}

function RankList({ rows, valueLabel, onPick }: {
  rows: LeaderboardRow[]; valueLabel: (r: LeaderboardRow) => string;
  onPick: (sid: string) => void;
}) {
  return (
    <>
      {rows.map((r) => (
        <Row
          key={r.stock_id} row={r} onPick={onPick}
          extraValue={valueLabel(r)}
        />
      ))}
    </>
  );
}

function Row({ row, onPick, extraValue }: {
  row: LeaderboardRow; onPick: (sid: string) => void;
  extraValue?: string;
}) {
  const positive = row.change_rate > 0;
  return (
    <button
      type="button"
      onClick={() => onPick(row.stock_id)}
      data-testid={`lb-row-${row.stock_id}`}
      className="flex justify-between items-center w-full px-3 py-1
                 hover:bg-bg-deep cursor-pointer text-xs"
    >
      <span className="text-ink">
        {row.stock_id} <span className="text-ink-muted">{row.name}</span>
      </span>
      <span className="flex gap-2 items-baseline">
        <span className={cn(positive ? "text-red-500" : "text-green-500")}>
          {positive ? "+" : ""}{row.change_rate.toFixed(2)}%
        </span>
        {extraValue && <span className="text-ink-dim">{extraValue}</span>}
      </span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] text-ink-dim border-b border-line">
      {children}
    </div>
  );
}
```

### Test file:`MarketLeaderboard.test.tsx`(新增)

```tsx
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketLeaderboard } from "./MarketLeaderboard";
import type { Leaderboards } from "../lib/market-types";

afterEach(() => cleanup());

const mockLb: Leaderboards = {
  gainers: [
    mkRow("2330", "台積電", 5.0, 100e6, 2.5),
    mkRow("2317", "鴻海", 3.0, 80e6, 1.8),
  ],
  losers: [
    mkRow("2412", "中華電", -2.5, 50e6, 0.8),
  ],
  amount: [
    mkRow("2330", "台積電", 5.0, 100e6, 2.5),
  ],
  volume_ratio: [
    mkRow("9999", "X", 2.0, 1e6, 8.5),
  ],
};

describe("MarketLeaderboard", () => {
  it("renders three tabs", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "大量單" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "量比" })).toBeTruthy();
  });

  it("defaults to 漲跌幅 tab and shows gainers + losers dual list", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    expect(screen.getByText("漲幅 Top 15")).toBeTruthy();
    expect(screen.getByText("跌幅 Top 15")).toBeTruthy();
    expect(document.querySelector('[data-testid="lb-row-2330"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="lb-row-2412"]')).toBeTruthy();
  });

  it("switches to 大量單 tab on click + shows total_amount", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "大量單" }));
    expect(screen.getByText(/100\.0M/)).toBeTruthy();
  });

  it("switches to 量比 tab + shows volume_ratio with x suffix (F5)", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "量比" }));
    expect(screen.getByText(/8\.50x/)).toBeTruthy();
  });

  it("量比 tab shows — when volume_ratio is null", () => {
    const lb: Leaderboards = {
      ...mockLb,
      volume_ratio: [mkRow("9999", "X", 1.0, 1e6, null)],
    };
    render(<MarketLeaderboard leaderboards={lb} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "量比" }));
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("calls onSymbolPick on row click", () => {
    const spy = vi.fn();
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={spy} />);
    fireEvent.click(document.querySelector('[data-testid="lb-row-2330"]')!);
    expect(spy).toHaveBeenCalledWith("2330");
  });

  it("uses bull-red for positive change (台股慣例,正反向 assertion 鎖 v3 C5)", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    const row = document.querySelector('[data-testid="lb-row-2330"]')!;
    expect(row.querySelector(".text-red-500")).toBeTruthy();   // 紅必須在
    expect(row.querySelector(".text-green-500")).toBeNull();   // 綠絕不在 — 鎖 SC-2 方向
  });

  it("uses bear-green for negative change (台股慣例,正反向 assertion 鎖 v3 C5)", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    const row = document.querySelector('[data-testid="lb-row-2412"]')!;
    expect(row.querySelector(".text-green-500")).toBeTruthy(); // 綠必須在
    expect(row.querySelector(".text-red-500")).toBeNull();     // 紅絕不在
  });

  it("renders gracefully when leaderboards is null", () => {
    render(<MarketLeaderboard leaderboards={null} onSymbolPick={() => {}} />);
    expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="lb-row-"]')).toHaveLength(0);
  });
});

function mkRow(
  sid: string, name: string, chg: number,
  amount: number, vr: number | null,
) {
  return {
    stock_id: sid, name, change_rate: chg,
    total_amount: amount, volume_ratio: vr,
    sector: "半導體業",
  };
}
```

**SC mapping**:SC-3(3 tab / top 30 / row click pivot)+ F5 regression(volume_ratio 顯示數值)+ bull=紅 bear=綠。

---

## File 4:`frontend/src/components/MarketPage.tsx`(新增 lazy shell)

```tsx
import { type ReactElement } from "react";
import { useMarketSnapshot } from "../hooks/useMarketSnapshot";
import { MarketHeader } from "./MarketHeader";
import { MarketHeatmap } from "./MarketHeatmap";
import { MarketLeaderboard } from "./MarketLeaderboard";

type Props = {
  isActive: boolean;
  onSymbolPick: (stockId: string) => void;
};

export function MarketPage({ isActive, onSymbolPick }: Props): ReactElement {
  const { data, refresh, lastUpdated, isStale, isTradingSession, error } =
    useMarketSnapshot(isActive);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ink-muted">
        <p>資料源無法連線:{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-2 px-3 py-1 border border-line rounded text-xs"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <MarketHeader
        lastUpdated={lastUpdated}
        isStale={isStale}
        isTradingSession={isTradingSession}
        lagSeconds={data?.lag_seconds ?? null}
        onRefresh={refresh}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] flex-1 overflow-hidden">
        <MarketHeatmap
          sectors={data?.sectors ?? []}
          onSymbolPick={onSymbolPick}
        />
        <MarketLeaderboard
          leaderboards={data?.leaderboards ?? null}
          onSymbolPick={onSymbolPick}
        />
      </div>
    </div>
  );
}
```

### Test file:`MarketPage.test.tsx`(新增 — integration)

```tsx
/** @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as marketApi from "../lib/market-api";
import { MarketPage } from "./MarketPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// v3 C2 fix — 同 MarketHeatmap.test.tsx
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
});

vi.mock("../hooks/useContainerSize", () => ({
  useContainerSize: () => ({ width: 800, height: 600 }),
}));

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("MarketPage", () => {
  it("renders header + heatmap + leaderboard after mount", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue({
      as_of: "x", last_tick: "2026-06-29T10:30:00",
      is_trading_session: true, stale: false, lag_seconds: 5,
      sectors: [{ id: "半導體業", name: "半導體業", member_count: 1,
                  avg_change_rate: 1.5, total_amount: 1e9,
                  stocks: [{ stock_id: "2330", name: "台積電",
                             change_rate: 1.5, total_amount: 1e8,
                             market_value: 6e13 }] }],
      leaderboards: { gainers: [], losers: [], amount: [], volume_ratio: [] },
    });
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText("大盤掃描")).toBeTruthy();
      expect(screen.getByRole("img", { name: "大盤族群熱力圖" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    });
  });

  it("shows error banner when fetch fails (E7)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockRejectedValue(new Error("finmind_unreachable"));
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText(/資料源無法連線/)).toBeTruthy();
    });
  });

  it("does not call api when isActive=false (F4)", async () => {
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot");
    render(wrap(<MarketPage isActive={false} onSymbolPick={() => {}} />));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

**SC mapping**:SC-1 + SC-2 + SC-3 + SC-5(integration);F4 regression。
