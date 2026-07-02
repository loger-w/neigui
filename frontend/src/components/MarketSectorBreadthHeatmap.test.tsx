/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketSectorBreadthHeatmap } from "./MarketSectorBreadthHeatmap";
import type { SectorBreadthRow } from "../lib/market-types";

// v3 C2 — jsdom 沒 ResizeObserver,useContainerSize 內部 new ResizeObserver 會
// ReferenceError;同時 getBoundingClientRect 回 0×0 → layoutCells 回空。同
// MarketHeatmap.test.tsx 樣板。
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

// 3 筆實值 + 湊到 44 筆(SC-5 彈性 cells;不 hardcode 數字進斷言)
const rows44: SectorBreadthRow[] = [
  { sector: "半導體業", members: 120, above_ma20: 96, pct: 0.8 },
  { sector: "電子零組件業", members: 80, above_ma20: 32, pct: 0.4 },
  { sector: "金融保險業", members: 30, above_ma20: 6, pct: 0.2 },
  ...Array.from({ length: 41 }, (_, i) => ({
    sector: `族群${i}`,
    members: 10,
    above_ma20: 5,
    pct: 0.5,
  })),
];

describe("MarketSectorBreadthHeatmap", () => {
  it("N rows → N 個 sb-cell-* 全 render (SC-5)", () => {
    render(
      <MarketSectorBreadthHeatmap
        rows={rows44}
        eodAsOf="2026-06-29"
        loaded={true}
        onSectorClick={() => {}}
      />,
    );
    const cells = document.querySelectorAll('[data-testid^="sb-cell-"]');
    expect(cells).toHaveLength(rows44.length);
  });

  it("click cell → onSectorClick(該 sector 中文名字串) (SC-5)", () => {
    const spy = vi.fn();
    render(
      <MarketSectorBreadthHeatmap
        rows={rows44}
        eodAsOf="2026-06-29"
        loaded={true}
        onSectorClick={spy}
      />,
    );
    fireEvent.click(screen.getByTestId("sb-cell-半導體業"));
    expect(spy).toHaveBeenCalledWith("半導體業");
  });

  it("data-fill-bin 正確(pct 0.8 → strong;0.4 → weak)", () => {
    render(
      <MarketSectorBreadthHeatmap
        rows={rows44}
        eodAsOf="2026-06-29"
        loaded={true}
        onSectorClick={() => {}}
      />,
    );
    expect(screen.getByTestId("sb-cell-半導體業").getAttribute("data-fill-bin")).toBe("strong");
    expect(screen.getByTestId("sb-cell-電子零組件業").getAttribute("data-fill-bin")).toBe("weak");
  });

  it("null 態 / 空態 / loading 態三分 (edge 2)", () => {
    const { rerender } = render(
      <MarketSectorBreadthHeatmap rows={null} eodAsOf="2026-06-29" loaded={true} onSectorClick={() => {}} />,
    );
    const root = screen.getByTestId("market-sector-breadth-heatmap");
    expect(root.querySelector('[data-state="unavailable"]')).toBeTruthy();
    expect(root.textContent).toContain("資料暫缺");

    rerender(
      <MarketSectorBreadthHeatmap rows={[]} eodAsOf="2026-06-29" loaded={true} onSectorClick={() => {}} />,
    );
    expect(root.querySelector('[data-state="empty"]')).toBeTruthy();
    expect(root.textContent).toContain("無符合資料");

    rerender(
      <MarketSectorBreadthHeatmap rows={null} eodAsOf="2026-06-29" loaded={false} onSectorClick={() => {}} />,
    );
    expect(root.querySelector('[data-state="loading"]')).toBeTruthy();
  });

  it("近似重複名兩 rows(「運動休閒」「運動休閒類」)→ 兩 cell 並存 (edge 10)", () => {
    const rows: SectorBreadthRow[] = [
      { sector: "運動休閒", members: 5, above_ma20: 4, pct: 0.8 },
      { sector: "運動休閒類", members: 5, above_ma20: 1, pct: 0.2 },
    ];
    render(
      <MarketSectorBreadthHeatmap rows={rows} eodAsOf="2026-06-29" loaded={true} onSectorClick={() => {}} />,
    );
    expect(screen.getByTestId("sb-cell-運動休閒")).toBeTruthy();
    expect(screen.getByTestId("sb-cell-運動休閒類")).toBeTruthy();
  });

  it("方向性文案 lock (SC-10a)", () => {
    render(
      <MarketSectorBreadthHeatmap rows={rows44} eodAsOf="2026-06-29" loaded={true} onSectorClick={() => {}} />,
    );
    expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull();
  });

  it("loading 骨架 role=status + aria-label 載入中 (SC-10 / CR1-3)", () => {
    render(
      <MarketSectorBreadthHeatmap rows={null} eodAsOf={null} loaded={false} onSectorClick={() => {}} />,
    );
    const root = screen.getByTestId("market-sector-breadth-heatmap");
    const loadingEl = root.querySelector('[data-state="loading"]')!;
    expect(loadingEl.getAttribute("role")).toBe("status");
    expect(loadingEl.getAttribute("aria-label")).toBe("載入中");
  });
});
