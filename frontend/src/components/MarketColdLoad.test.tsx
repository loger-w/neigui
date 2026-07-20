/** @vitest-environment jsdom */
// CR1-10 / CR1-11 originally locked a `useContainerSize` cold-load regression
// in MarketBreadthPanel / MarketSectorBreadthHeatmap: containerRef only
// mounted in the "data" render branch, so the hook's ref.current===null
// early-return meant loading→data transitions never re-measured and SVGs
// stayed stuck at 0×0. Both components were deleted wholesale in
// market-today-only change-spec.md §4 (EOD 四格退役) — the class of bug no
// longer has a host.
//
// Commit 2(🟢 今日三卡)R11 紅線(P0,spec 明文不准空殼收尾):
// MarketIndexStrength / MarketCapTiers / MarketSectorRotation 是純 DOM 元件
// (無 SVG,無 useContainerSize — 已逐檔確認,理由：三卡內容全是文字/表格/長條
// bar,靠 CSS width% 而非量測像素定位,不需要容器實際尺寸)。既然沒有
// useContainerSize,CR1-10 那個 ref-only-in-data-branch 陷阱不適用。等價
// regression 改測「loading → data 切換不 crash,且資料態確實 render 出真實
// 內容」(對齊原案的精神:loading 態的 DOM 結構不能污染/卡住資料到位後的
// render)。
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MarketIndexStrength } from "./MarketIndexStrength";
import { MarketCapTiers } from "./MarketCapTiers";
import { MarketSectorRotation } from "./MarketSectorRotation";
import type { CapTier, IndexStrength, SectorRotation } from "../lib/market-types";

afterEach(() => cleanup());

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const indexStrength: IndexStrength = {
  twse: { close: 42650.6, change_rate: -0.04, median_change_rate: -1.8, spread: 1.76 },
  tpex: { close: 370.4, change_rate: -2.11, median_change_rate: -2.4, spread: 0.29 },
  tsmc: { change_rate: 1.2, contrib_points: 210.5 },
  contrib: {
    twse: { up: [{ stock_id: "2330", name: "台積電", change_rate: 1.2, contrib_points: 210.5 }], down: [] },
    tpex: { up: [], down: [] },
  },
};

const capTiers: CapTier[] = [
  { tier: "top50", members: 50, avg_change_rate: -0.3, up_ratio: 0.32 },
];

const sectorRotation: SectorRotation = {
  as_of: "2026-07-20 13:07:05",
  industries: [
    { name: "半導體", members: 120, avg_change_rate: 0.4, vol_ratio: 1.31, subs: [] },
  ],
};

describe("cold-load 等價 regression (Commit 2 移植,原 CR1-10/CR1-11 host 已刪除)", () => {
  it("MarketIndexStrength:loading → data 後渲染出真實加權/櫃買數值,不卡在骨架 (SC-1)", () => {
    const { container, rerender } = render(<MarketIndexStrength data={null} loading={true} />);
    expect(container.querySelector('[data-state="loading"]')).toBeTruthy();
    rerender(<MarketIndexStrength data={indexStrength} loading={false} />);
    expect(container.querySelector('[data-state="loading"]')).toBeNull();
    expect(screen.getByTestId("idx-side-twse").textContent).toContain("-0.04%");
  });

  it("MarketCapTiers:loading → data 後渲染出三桶真實數字,不卡在骨架 (SC-2)", () => {
    const { container, rerender } = render(<MarketCapTiers data={null} loading={true} />);
    expect(container.querySelector('[data-state="loading"]')).toBeTruthy();
    rerender(<MarketCapTiers data={capTiers} loading={false} />);
    expect(container.querySelector('[data-state="loading"]')).toBeNull();
    expect(screen.getByTestId("cap-tier-top50").textContent).toContain("-0.30%");
  });

  it("MarketSectorRotation:loading → data 後渲染出族群列表,不卡在骨架 (SC-3)", () => {
    const { container, rerender } = render(
      wrap(<MarketSectorRotation data={null} loading={true} />),
    );
    expect(container.querySelector('[data-state="loading"]')).toBeTruthy();
    rerender(wrap(<MarketSectorRotation data={sectorRotation} loading={false} />));
    expect(container.querySelector('[data-state="loading"]')).toBeNull();
    expect(screen.getByTestId("sector-row-半導體").textContent).toContain("半導體");
  });
});
