/** @vitest-environment jsdom */
// 外部淨額時序區塊(SC-4/5/7):雙線中性配色、null 斷點、累積提示 + 補建 CTA。
// 真 useContainerSize + polyfill(MarketColdLoad 樣板)讓 chart 路徑可測。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantFlowHistoryPayload } from "../lib/warrant-flow-data";
import { WarrantFlowNetHistory } from "./WarrantFlowNetHistory";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

function mk(over?: Partial<WarrantFlowHistoryPayload>): WarrantFlowHistoryPayload {
  const days: WarrantFlowHistoryPayload["days"] = [
    ["2026-06-22", 120, 10],
    ["2026-06-23", 90, -5],
    ["2026-06-24", null, 8], // call 斷點日
    ["2026-06-25", -60, 12],
    ["2026-06-26", -100, null],
  ].map(([d, c, p]) => ({
    date: d as string,
    status: "built" as const,
    call: { trade_value: 1e8, external_net: c as number | null },
    put: { trade_value: 1e7, external_net: p as number | null },
  }));
  return {
    window: 20,
    built: 5,
    missing_count: 15,
    backfilled: 0,
    empty_reason: null,
    days,
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 200,
    top: 0,
    left: 0,
    right: 800,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => cleanup());

function renderPanel() {
  return render(<WarrantFlowNetHistory symbol="2330" active={true} />, {
    wrapper: makeQueryWrapper(),
  });
}

describe("WarrantFlowNetHistory", () => {
  it("built ≥ 2:畫雙線 + null 斷點(call 4 點斷成 2 段)+ 中性配色(SC-4/SC-7)", async () => {
    vi.spyOn(api, "warrantFlowHistory").mockResolvedValue(mk());
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("flow-net-history-chart")).toBeTruthy());
    const callSegs = screen
      .getAllByTestId("net-history-call-seg")
      .filter((el) => el.tagName === "polyline");
    expect(callSegs.length).toBe(2);
    // SC-7 正向鎖:線用 ink 色階,不套 bull/bear(series ≠ 方向)
    for (const el of [
      ...screen.getAllByTestId("net-history-call-seg"),
      ...screen.getAllByTestId("net-history-put-seg"),
    ]) {
      const cls = el.getAttribute("class") ?? "";
      expect(/text-ink/.test(cls)).toBe(true);
      expect(/bull|bear/.test(cls)).toBe(false);
    }
    // 累積提示 + CTA 同時在(missing_count > 0)
    expect(screen.getByText(/已累積 5\/20 日/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /補建缺日/ })).toBeTruthy();
  });

  it("補建缺日 CTA → 再次呼叫 api 帶 backfill=true(SC-5)", async () => {
    const spy = vi.spyOn(api, "warrantFlowHistory").mockResolvedValue(mk());
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("flow-net-history-chart")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /補建缺日/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[1]).toBe(true);
  });

  it("built < 2:不畫圖、顯示累積中文案(SC-5)", async () => {
    vi.spyOn(api, "warrantFlowHistory").mockResolvedValue(
      mk({ built: 1, missing_count: 19, days: mk().days.slice(0, 1) }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText(/資料累積中/)).toBeTruthy());
    expect(screen.queryByTestId("flow-net-history-chart")).toBeNull();
    expect(screen.getByRole("button", { name: /補建缺日/ })).toBeTruthy();
  });

  it("no_warrants → 整區塊不 render", async () => {
    vi.spyOn(api, "warrantFlowHistory").mockResolvedValue(
      mk({ empty_reason: "no_warrants", built: 0, missing_count: 0, days: [] }),
    );
    const { container } = renderPanel();
    await waitFor(() =>
      expect(screen.queryByTestId("flow-net-history")).toBeNull(),
    );
    expect(container.textContent).toBe("");
  });

  it("error → 區塊內一行錯誤文案,不吞掉區塊", async () => {
    vi.spyOn(api, "warrantFlowHistory").mockRejectedValue(new Error("伺服器暫時無法回應"));
    renderPanel();
    await waitFor(
      () => expect(screen.getByText(/伺服器暫時無法回應/)).toBeTruthy(),
      { timeout: 5000 },
    );
  });
});
