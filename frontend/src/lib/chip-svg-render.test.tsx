/**
 * @vitest-environment jsdom
 *
 * Render-level tests for new selectedIndex prop on existing SVG components
 * and the new BrokerAggBarSvg.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import { BrokerAggBarSvg } from "./chip-broker-agg-svg";
import { KlineChartSvg } from "./chip-kline-svg";
import { InstBarSvg, MarginLineSvg } from "./chip-inst-bar-svg";
import type { DailyCandle } from "./chip-data";

describe("BrokerAggBarSvg", () => {
  it("renders bars matching InstBarSvg shape", () => {
    const { container } = render(
      <BrokerAggBarSvg
        data={[10, -20, 30]}
        width={300} height={50} label="分點 (1)"
      />,
    );
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBeGreaterThan(0);
  });

  it("renders selected-day cursor at correct X", () => {
    const { container } = render(
      <BrokerAggBarSvg
        data={[10, 20, 30, 40]}
        width={400} height={50} label="" selectedIndex={2}
      />,
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeTruthy();
  });

  it("does not render cursor when selectedIndex is null", () => {
    const { container } = render(
      <BrokerAggBarSvg
        data={[10, 20, 30]}
        width={300} height={50} label="" selectedIndex={null}
      />,
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeFalsy();
  });
});

describe("InstBarSvg selectedIndex", () => {
  it("renders selected-day cursor at correct X", () => {
    const { container } = render(
      <InstBarSvg
        data={[10, 20, 30, 40]}
        width={400} height={50} selectedIndex={2}
      />,
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeTruthy();
  });

  it("does not render cursor when selectedIndex is null", () => {
    const { container } = render(
      <InstBarSvg
        data={[10, 20, 30]}
        width={400} height={50} selectedIndex={null}
      />,
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeFalsy();
  });
});

describe("MarginLineSvg selectedIndex", () => {
  it("renders selected-day cursor at correct X", () => {
    const { container } = render(
      <MarginLineSvg
        marginData={[10, 20, 30]}
        shortData={[5, 15, 25]}
        width={400} height={50} selectedIndex={1}
      />,
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeTruthy();
  });
});

describe("KlineChartSvg click + selectedIndex", () => {
  const candles: DailyCandle[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, "0")}`,
    open: 100, high: 105, low: 95, close: 100, volume: 0,
  }));

  it("renders selected-day cursor with date tag", () => {
    const { container, getByText } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300} selectedIndex={3}
      />,
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeTruthy();
    expect(getByText("2026-06-13")).toBeTruthy();
  });

  it("does not render cursor when selectedIndex is null", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300} selectedIndex={null}
      />,
    );
    expect(container.querySelector("[data-testid=sel-cursor]")).toBeFalsy();
  });

  it("fires onClickIndex with correct index", () => {
    const onClick = vi.fn();
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        onClickIndex={onClick}
      />,
    );
    const overlay = container.querySelector(
      "rect[data-testid=overlay]",
    ) as SVGRectElement;
    expect(overlay).toBeTruthy();
    // jsdom getBoundingClientRect returns zeros; fire click anyway — the
    // handler computes (clientX - rect.left) which equals clientX. Pick
    // clientX in the middle of the chart to land on a valid index.
    fireEvent.click(overlay, { clientX: 250, clientY: 100 });
    expect(onClick).toHaveBeenCalled();
    const i = onClick.mock.calls[0]![0];
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(candles.length);
  });
});

// Cluster D 🟢 F6 — K-line hover shows horizontal price crosshair + right-axis
// price label chip so the user can read price at cursor Y.
describe("KlineChartSvg hoverY horizontal crosshair (F6)", () => {
  const candles: DailyCandle[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, "0")}`,
    open: 100, high: 110, low: 90, close: 100, volume: 1000,
  }));

  it("renders hover-hline + hover-price-label when hoverY is in chart area", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        hoverY={120}
      />,
    );
    expect(container.querySelector("[data-testid=hover-hline]")).toBeTruthy();
    expect(container.querySelector("[data-testid=hover-price-label]")).toBeTruthy();
  });

  it("does NOT render hover-hline when hoverY is null", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        hoverY={null}
      />,
    );
    expect(container.querySelector("[data-testid=hover-hline]")).toBeFalsy();
    expect(container.querySelector("[data-testid=hover-price-label]")).toBeFalsy();
  });

  it("does NOT render hover-hline when hoverY is in the volume sub-area", () => {
    // height=300, volTop = 0.8 * 300 = 240. Y=270 is in the volume strip.
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        hoverY={270}
      />,
    );
    expect(container.querySelector("[data-testid=hover-hline]")).toBeFalsy();
  });

  it("does NOT render hover-hline when hoverY is above the chart area (padding)", () => {
    // padT = 40; Y=20 is above chart area.
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        hoverY={20}
      />,
    );
    expect(container.querySelector("[data-testid=hover-hline]")).toBeFalsy();
  });

  it("calls onHoverY(null) on overlay mouseLeave", () => {
    const onHoverY = vi.fn();
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        onHoverY={onHoverY}
      />,
    );
    const overlay = container.querySelector(
      "rect[data-testid=overlay]",
    ) as SVGRectElement;
    fireEvent.mouseLeave(overlay);
    expect(onHoverY).toHaveBeenCalledWith(null);
  });

  it("calls onHoverY(number) on overlay mouseMove inside chart area", () => {
    const onHoverY = vi.fn();
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        onHoverY={onHoverY}
      />,
    );
    const overlay = container.querySelector(
      "rect[data-testid=overlay]",
    ) as SVGRectElement;
    fireEvent.mouseMove(overlay, { clientX: 250, clientY: 120 });
    // jsdom getBoundingClientRect returns zeros, so mouseY === clientY = 120.
    expect(onHoverY).toHaveBeenCalled();
    const lastArg = onHoverY.mock.calls[onHoverY.mock.calls.length - 1]![0];
    expect(typeof lastArg).toBe("number");
  });
});

// Bug #3 — info-row / value label must honor selectedIndex when hoverIndex is
// null. Previously fell back to `n - 1`, so mouseleave snapped display to the
// LATEST candle even when the user had picked an older date. Fix is a 3-tier
// fallback hover → selected → last in all four SVG components.
describe("Bug #3 — info text honors selectedIndex when hoverIndex is null", () => {
  const candles: DailyCandle[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, "0")}`,
    open: 100, high: 105, low: 95, close: 100, volume: 0,
  }));

  it("KlineChartSvg OHLCV header uses selectedIndex when hoverIndex is null", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={3} hoverIndex={null}
      />,
    );
    // OHLCV header renders date with slashes; unique to that row.
    expect(container.textContent).toContain("2026/06/13");
    expect(container.textContent).not.toContain("2026/06/19");
  });

  it("KlineChartSvg OHLCV header prefers hoverIndex over selectedIndex", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={3} hoverIndex={5}
      />,
    );
    expect(container.textContent).toContain("2026/06/15");
    expect(container.textContent).not.toContain("2026/06/13");
  });

  it("KlineChartSvg OHLCV header falls back to last candle when both null", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={null} hoverIndex={null}
      />,
    );
    expect(container.textContent).toContain("2026/06/19");
  });

  it("InstBarSvg label uses selectedIndex when hoverIndex is null", () => {
    const { container } = render(
      <InstBarSvg
        data={[10, 20, 30, 40]} width={400} height={50} label="外資"
        selectedIndex={2} hoverIndex={null}
      />,
    );
    expect(container.textContent).toContain("+30 張");
    expect(container.textContent).not.toContain("+40 張");
  });

  it("MarginLineSvg label uses selectedIndex when hoverIndex is null", () => {
    const { container } = render(
      <MarginLineSvg
        marginData={[10, 20, 30]} shortData={[5, 15, 25]}
        width={400} height={50} label="融資融券"
        selectedIndex={1} hoverIndex={null}
      />,
    );
    expect(container.textContent).toContain("融資 +20 張");
    expect(container.textContent).toContain("融券 +15 張");
    expect(container.textContent).not.toContain("融資 +30 張");
  });

  it("BrokerAggBarSvg label uses selectedIndex when hoverIndex is null", () => {
    const { container } = render(
      <BrokerAggBarSvg
        data={[10, 20, 30]} width={400} height={50} label="分點 (1)"
        selectedIndex={1} hoverIndex={null}
      />,
    );
    expect(container.textContent).toContain("+20 張");
    expect(container.textContent).not.toContain("+30 張");
  });
});
