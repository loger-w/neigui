/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketBreadthPanel } from "./MarketBreadthPanel";
import type { Breadth } from "../lib/market-types";

// v3 C2 — jsdom 沒 ResizeObserver,useContainerSize 內部 new ResizeObserver 會
// ReferenceError;同時 getBoundingClientRect 回 0×0 → chart 算式回空。同
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

const baseBreadth: Breadth = {
  ad_line_value: 42,
  mcclellan_oscillator: 12.3,
  mcclellan_series: [
    { date: "2026-06-25", value: 5 },
    { date: "2026-06-26", value: 8 },
    { date: "2026-06-29", value: 12.3 },
  ],
  ad_line_series: [
    { date: "2026-06-25", value: 20 },
    { date: "2026-06-26", value: 35 },
    { date: "2026-06-29", value: 42 },
  ],
  thrust_dot: null,
  centerline_cross: null,
  divergence_dot: null,
  known_gaps: [],
};

describe("MarketBreadthPanel", () => {
  it("資料態:標題 + 資料至日期 + McClellan 值 + polyline 存在 (SC-4)", () => {
    render(<MarketBreadthPanel breadth={baseBreadth} eodAsOf="2026-06-29" loaded={true} />);
    const root = screen.getByTestId("market-breadth-panel");
    expect(root.textContent).toContain("市場廣度");
    expect(root.textContent).toContain("資料至 2026-06-29");
    expect(root.textContent).toContain("McClellan 12.3");
    expect(root.querySelector("polyline")).toBeTruthy();
  });

  it("null 態:「資料暫缺」+ data-state=unavailable (edge 1)", () => {
    render(<MarketBreadthPanel breadth={null} eodAsOf="2026-06-29" loaded={true} />);
    const root = screen.getByTestId("market-breadth-panel");
    expect(root.querySelector('[data-state="unavailable"]')).toBeTruthy();
    expect(root.textContent).toContain("資料暫缺");
  });

  it("taiex_unavailable:槽 3 顯示「TAIEX 資料缺」且無 breadth-divergence-dot (edge 4)", () => {
    const breadth: Breadth = {
      ...baseBreadth,
      divergence_dot: "bearish",
      known_gaps: ["taiex_unavailable"],
    };
    render(<MarketBreadthPanel breadth={breadth} eodAsOf="2026-06-29" loaded={true} />);
    const root = screen.getByTestId("market-breadth-panel");
    expect(root.textContent).toContain("TAIEX 資料缺");
    expect(screen.queryByTestId("breadth-divergence-dot")).toBeNull();
  });

  it("三 signal 全 active:三 dot testid 各自存在 + data-value 正確 (edge 9)", () => {
    const breadth: Breadth = {
      ...baseBreadth,
      thrust_dot: "above_plus_100",
      centerline_cross: "above",
      divergence_dot: "bearish",
    };
    render(<MarketBreadthPanel breadth={breadth} eodAsOf="2026-06-29" loaded={true} />);
    const thrust = screen.getByTestId("breadth-thrust-dot");
    const centerline = screen.getByTestId("breadth-centerline-dot");
    const divergence = screen.getByTestId("breadth-divergence-dot");
    expect(thrust.getAttribute("data-value")).toBe("above_plus_100");
    expect(centerline.getAttribute("data-value")).toBe("above");
    expect(divergence.getAttribute("data-value")).toBe("bearish");
  });

  it("三 signal 全 null:三 testid 皆 queryByTestId null(inactive 槽無 testid)", () => {
    render(<MarketBreadthPanel breadth={baseBreadth} eodAsOf="2026-06-29" loaded={true} />);
    expect(screen.queryByTestId("breadth-thrust-dot")).toBeNull();
    expect(screen.queryByTestId("breadth-centerline-dot")).toBeNull();
    expect(screen.queryByTestId("breadth-divergence-dot")).toBeNull();
  });

  it("方向性文案 lock (SC-10a)", () => {
    render(<MarketBreadthPanel breadth={baseBreadth} eodAsOf="2026-06-29" loaded={true} />);
    expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull();
  });

  it("eodAsOf null → 「最近交易日」(edge 5)", () => {
    render(<MarketBreadthPanel breadth={baseBreadth} eodAsOf={null} loaded={true} />);
    const root = screen.getByTestId("market-breadth-panel");
    expect(root.textContent).toContain("最近交易日");
  });

  it("!loaded → data-state=loading,無「資料暫缺」(SC-10c)", () => {
    render(<MarketBreadthPanel breadth={null} eodAsOf={null} loaded={false} />);
    const root = screen.getByTestId("market-breadth-panel");
    expect(root.querySelector('[data-state="loading"]')).toBeTruthy();
    expect(root.textContent).not.toContain("資料暫缺");
  });
});
