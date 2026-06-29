/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketHeatmap } from "./MarketHeatmap";
import type { Sector } from "../lib/market-types";

// v3 C2 — jsdom 沒 ResizeObserver,useContainerSize 內部 new ResizeObserver
// 會 ReferenceError;同時 getBoundingClientRect 回 0×0 → layoutHeatmap 回空。
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

afterEach(() => cleanup());

const sectors: Sector[] = [
  {
    id: "半導體業",
    name: "半導體業",
    member_count: 1,
    avg_change_rate: 1.0,
    total_amount: 1e9,
    stocks: [
      {
        stock_id: "2330",
        name: "台積電",
        change_rate: 1.92,
        total_amount: 36e9,
        market_value: 6e13,
      },
    ],
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

  it("rect has data-fill-bin=bull for positive change (台股慣例 bull=紅)", () => {
    render(<MarketHeatmap sectors={sectors} onSymbolPick={() => {}} />);
    const rect = document.querySelector('[data-testid="tile-2330"] rect[data-fill-bin]');
    expect(rect?.getAttribute("data-fill-bin")).toBe("bull");
  });

  it("rect has data-fill-bin=bear for negative change", () => {
    const bearSectors: Sector[] = [
      { ...sectors[0]!,
        stocks: [{ ...sectors[0]!.stocks[0]!, change_rate: -2.5 }] },
    ];
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
    const fallbackSectors: Sector[] = [
      { ...sectors[0]!,
        stocks: [{ ...sectors[0]!.stocks[0]!, market_value: null }] },
    ];
    render(<MarketHeatmap sectors={fallbackSectors} onSymbolPick={() => {}} />);
    fireEvent.mouseEnter(document.querySelector('[data-testid="tile-2330"]')!);
    expect(screen.getByRole("tooltip").textContent).toContain("市值估");
  });

  it("renders nothing meaningful for empty sectors[]", () => {
    render(<MarketHeatmap sectors={[]} onSymbolPick={() => {}} />);
    expect(document.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(0);
  });
});
