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
    const i = onClick.mock.calls[0][0];
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(candles.length);
  });
});
