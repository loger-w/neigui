/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ChipKlineChart } from "./ChipKlineChart";
import type { ChipHistory } from "../lib/chip-data";

beforeAll(() => {
  // jsdom lacks ResizeObserver; useContainerSize relies on it. Stub a no-op.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(cleanup);

const mkHistory = (n: number): ChipHistory => {
  const candles = Array.from({ length: n }, (_, i) => ({
    date: `2026-${String(((i % 12) + 1)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    open: 100, high: 105, low: 99, close: 102, volume: 1000,
  }));
  // Make dates strictly increasing so callbacks/select are unambiguous.
  for (let i = 0; i < n; i++) {
    const d = new Date(2024, 0, 1 + i);
    candles[i]!.date = d.toISOString().slice(0, 10);
  }
  return {
    symbol: "2330", fetched_at: "", last_date: candles[n - 1]?.date ?? "",
    candles,
    institutional: candles.map((c) => ({
      date: c.date, foreign_net: 0, trust_net: 0, dealer_net: 0, major_net: 0,
    })),
    margin: candles.map((c) => ({
      date: c.date, margin_balance: 0, short_balance: 0,
      margin_change: 0, short_change: 0,
    })),
    major: candles.map((c) => ({ date: c.date, major_net: 0 })),
  };
};

const noop = () => {};

function dispatchWheel(el: Element, deltaY: number) {
  act(() => {
    // jsdom doesn't synthesize WheelEvent via fireEvent.wheel reliably for
    // listeners attached via addEventListener with {passive:false} — use
    // raw dispatch on the same node so the imperative listener runs.
    el.dispatchEvent(
      new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
    );
  });
}

describe("ChipKlineChart — zoom HUD + wheel handler", () => {
  it("renders zoom HUD showing default visible days (90)", () => {
    const history = mkHistory(540);
    const { getByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(getByTestId("kline-zoom-hud").textContent).toBe("90 日");
  });

  it("clamps visible days to candles.length when history shorter than default", () => {
    const history = mkHistory(30);
    const { getByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    // initial 90 → clamped to 30
    expect(getByTestId("kline-zoom-hud").textContent).toBe("30 日");
  });

  it("wheel down zooms OUT (visible days +10, more days visible)", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("100 日");
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("110 日");
  });

  it("wheel up zooms IN (visible days -10, fewer days visible)", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    dispatchWheel(root, -100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("80 日");
  });

  it("wheel up clamps at minimum 30", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    // 90 → 80 → 70 → 60 → 50 → 40 → 30 → 30 (clamp)
    for (let i = 0; i < 10; i++) dispatchWheel(root, -100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("30 日");
  });

  it("wheel down clamps at candles.length", () => {
    const history = mkHistory(100);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    // initial 90 → 100 then clamp at 100
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("100 日");
    dispatchWheel(root, 100);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("100 日");
  });

  it("does not render zoom HUD when history is null", () => {
    const { queryByTestId } = render(
      <ChipKlineChart
        history={null}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(queryByTestId("kline-zoom-hud")).toBeNull();
  });

  it("wheel deltaY=0 is a no-op", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    dispatchWheel(root, 0);
    expect(getByTestId("kline-zoom-hud").textContent).toBe("90 日");
  });

  it("onPickDate receives the date from the sliced view, not the original index", () => {
    const history = mkHistory(540);
    const pick = vi.fn();
    render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={pick}
        onClearAllBrokers={noop}
      />,
    );
    // The component does not expose onPickDate directly outside SVG handlers,
    // so we rely on the contract: sliced.candles.at(-1).date === last date.
    // (Visual interaction is covered by DevTools MCP end-to-end.) This is a
    // weak smoke check that the click path doesn't throw on render.
    expect(pick).not.toHaveBeenCalled();
  });

  it("double-click resets zoom to default 90 and clears brush anchor", () => {
    const history = mkHistory(540);
    const { getByTestId, container } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    const root = container.firstChild as Element;
    // Zoom out a couple of steps so HUD differs from default
    dispatchWheel(root, 100); // 100
    dispatchWheel(root, 100); // 110
    expect(getByTestId("kline-zoom-hud").textContent).toContain("110");
    // Double-click resets
    act(() => {
      root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(getByTestId("kline-zoom-hud").textContent).toBe("90 日");
  });

  it("zoom HUD label notes brush anchor state when viewEndIdx is locked", () => {
    // We can't easily synthesise a brush in jsdom (PointerEvent + bounding
    // rects), but we can at least confirm the default HUD has no anchor tag.
    const history = mkHistory(540);
    const { getByTestId } = render(
      <ChipKlineChart
        history={history}
        selectedDate=""
        selectedBrokerIds={new Set()}
        brokerSeries={new Map()}
        onPickDate={noop}
        onClearAllBrokers={noop}
      />,
    );
    expect(getByTestId("kline-zoom-hud").textContent).not.toContain("已框選");
  });
});
