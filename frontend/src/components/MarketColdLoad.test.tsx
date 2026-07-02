/** @vitest-environment jsdom */
// CR1-10 / CR1-11 regression: containerRef 曾只掛在「資料態」分支的元素上,
// 首次 mount 是 loading skeleton(無 ref),useContainerSize 的 effect 在
// ref.current === null 時提早 return 且 deps [ref, measure] 都穩定,資料到位後
// 也不會重跑 → 圖表/熱力圖永遠量到 0×0。
//
// 這份測試刻意「不」mock useContainerSize(其他 component test 檔的
// vi.mock("../hooks/useContainerSize", ...) 會蓋掉這個 bug),改用真實 hook +
// polyfill ResizeObserver + 灌 getBoundingClientRect,才能重現 cold-load 路徑。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MarketBreadthPanel } from "./MarketBreadthPanel";
import { MarketSectorBreadthHeatmap } from "./MarketSectorBreadthHeatmap";
import type { Breadth, SectorBreadthRow } from "../lib/market-types";

let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
  rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  rectSpy.mockRestore();
});

const breadth: Breadth = {
  ad_line_value: 12,
  mcclellan_oscillator: 34.5,
  mcclellan_series: [
    { date: "d0", value: null },
    { date: "d1", value: 30 },
    { date: "d2", value: 34.5 },
  ],
  ad_line_series: [
    { date: "d0", value: null },
    { date: "d1", value: 10 },
    { date: "d2", value: 12 },
  ],
  thrust_dot: null,
  centerline_cross: null,
  divergence_dot: null,
  known_gaps: [],
};

describe("cold-load 量測 regression (CR1-10 / CR1-11)", () => {
  it("MarketBreadthPanel:loading → data 後 svg 量到真實寬度,不再卡 0 (SC-4)", () => {
    const { container, rerender } = render(
      <MarketBreadthPanel breadth={null} eodAsOf={null} loaded={false} />,
    );
    rerender(<MarketBreadthPanel breadth={breadth} eodAsOf="2026-06-29" loaded={true} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("800");
  });

  it("MarketSectorBreadthHeatmap:loading → data 後 cell 依真實寬度排版,不再卡空清單 (SC-5)", () => {
    const rows: SectorBreadthRow[] = [
      { sector: "半導體業", members: 100, above_ma20: 60, pct: 0.6 },
      { sector: "金融保險業", members: 50, above_ma20: 20, pct: 0.4 },
    ];
    const { container, rerender } = render(
      <MarketSectorBreadthHeatmap
        rows={null}
        eodAsOf={null}
        loaded={false}
        onSectorClick={() => {}}
      />,
    );
    rerender(
      <MarketSectorBreadthHeatmap
        rows={rows}
        eodAsOf="2026-06-29"
        loaded={true}
        onSectorClick={() => {}}
      />,
    );
    const cells = container.querySelectorAll('[data-testid^="sb-cell-"]');
    expect(cells.length).toBe(2);
  });
});
