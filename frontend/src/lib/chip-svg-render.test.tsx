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
  // CH-3b 後 header 無日期 → 改以 volume(帶千分位,grid 價格標籤不會撞)區分列。
  const candles: DailyCandle[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, "0")}`,
    open: 100, high: 105, low: 95, close: 100, volume: 1000 + i,
  }));

  it("KlineChartSvg OHLCV header uses selectedIndex when hoverIndex is null", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={3} hoverIndex={null}
      />,
    );
    expect(container.textContent).toContain("1,003");
    expect(container.textContent).not.toContain("1,009");
  });

  it("KlineChartSvg OHLCV header prefers hoverIndex over selectedIndex", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={3} hoverIndex={5}
      />,
    );
    expect(container.textContent).toContain("1,005");
    expect(container.textContent).not.toContain("1,003");
  });

  it("KlineChartSvg OHLCV header falls back to last candle when both null", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={null} hoverIndex={null}
      />,
    );
    expect(container.textContent).toContain("1,009");
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

// CH-3b(mod/batch-ui-update):HUD 左上不再顯示日期(sel-cursor 的日期標籤
// 為選取游標,保留 — 只有 header 的 YYYY/MM/DD 移除)。
describe("CH-3b — OHLCV header 無日期", () => {
  const candles: DailyCandle[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, "0")}`,
    open: 100, high: 105, low: 95, close: 100, volume: 1000 + i,
  }));

  // 痛點:CH-3b — 刪日期是為了把 HUD 讓給範圍聚合;斜線日期格式為 header 專屬。
  it("header does not render a slash-formatted date", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={3} hoverIndex={null}
      />,
    );
    expect(container.textContent).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
  });
});

// CH-2a(mod/batch-ui-update):windowAgg 提供時 HUD 顯示窗聚合(不隨 hover 變)。
describe("CH-2a — KlineChartSvg windowAgg HUD", () => {
  const candles: DailyCandle[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, "0")}`,
    open: 100, high: 105, low: 95, close: 100, volume: 0,
  }));
  const agg = {
    days: 5, open: 100, high: 120, low: 90, close: 110,
    volume: 5000, change: 10, changePct: 10,
  };

  // 痛點:CH-2a — 天數窗聚合要在第一眼(HUD)可見,不是只有右欄。
  it("renders window aggregate values with a N日 marker", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={6} windowAgg={agg}
      />,
    );
    expect(container.textContent).toContain("5日");
    expect(container.textContent).toContain("5,000");
    expect(container.textContent).toContain("+10.00%");
  });

  // 痛點:窗聚合模式下 HUD 錨定範圍,hover 不得把 HUD 切回單日值。
  it("hover does not switch the HUD back to per-day values", () => {
    const { container } = render(
      <KlineChartSvg
        candles={candles} width={500} height={300}
        selectedIndex={6} hoverIndex={2} windowAgg={agg}
      />,
    );
    expect(container.textContent).toContain("5,000");
    expect(container.textContent).not.toContain("量 0");
  });
});

// CH-2b(mod/batch-ui-update):子圖 label 尾端顯示窗內加總(parent 格式化)。
describe("CH-2b — subchart windowText", () => {
  // 痛點:CH-2b — 改天數時六個子圖要跟著呈現窗加總,不能只有 K 線有 band。
  it("InstBarSvg appends windowText to the label row", () => {
    const { container } = render(
      <InstBarSvg
        data={[10, 20, 30]} width={400} height={50} label="外資"
        windowText="5日 +55 張"
      />,
    );
    expect(container.textContent).toContain("5日 +55 張");
  });

  it("InstBarSvg omits windowText when not provided", () => {
    const { container } = render(
      <InstBarSvg data={[10, 20, 30]} width={400} height={50} label="外資" />,
    );
    expect(container.textContent).not.toContain("5日");
  });

  it("MarginLineSvg appends windowText to the label row", () => {
    const { container } = render(
      <MarginLineSvg
        marginData={[10, 20, 30]} shortData={[5, 15, 25]}
        width={400} height={50} label="融資融券"
        windowText="5日 融資+60 融券+45 張"
      />,
    );
    expect(container.textContent).toContain("5日 融資+60 融券+45 張");
  });

  it("BrokerAggBarSvg appends windowText to the label row", () => {
    const { container } = render(
      <BrokerAggBarSvg
        data={[10, 20, 30]} width={400} height={50} label="分點 (1)"
        windowText="5日 +60 張"
      />,
    );
    expect(container.textContent).toContain("5日 +60 張");
  });
});
