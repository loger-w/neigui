/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BubbleChartSvg } from "./chip-bubble-svg";
import type { BrokerTrade } from "./chip-data";

afterEach(() => cleanup());

const mkTrade = (overrides: Partial<BrokerTrade> = {}): BrokerTrade => ({
  broker: "凱基台北",
  broker_id: "9201A",
  price: 100,
  buy: 50,
  sell: 0,
  ...overrides,
});

describe("BubbleChartSvg — default unfiltered render", () => {
  it("renders bubbles when trades have significant volume", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 50, sell: 0 }),
      mkTrade({ broker: "B", broker_id: "B1", price: 101, buy: 0, sell: 30 }),
    ];
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("shows 'No significant volume' when no broker selected and all volumes ≤ threshold", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "A", broker_id: "A1", price: 100, buy: 2, sell: 1 }),
    ];
    const { container } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    expect(container.textContent).toContain("No significant volume");
  });
});

describe("BubbleChartSvg F1 — no yellow highlight on selected broker", () => {
  it("selected broker's bubbles use normal stroke (not CHIP.ma5 #f0b429) and strokeWidth=1", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 100, buy: 50, sell: 0 }),
      mkTrade({ broker: "其他", broker_id: "X1", price: 100, buy: 50, sell: 0 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="凱基台北"
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    expect(circles.length).toBeGreaterThan(0);
    for (const c of circles) {
      const stroke = c.getAttribute("stroke") ?? "";
      const sw = c.getAttribute("stroke-width") ?? "";
      // Bug requirement: no circle uses the MA5 yellow stroke or the 2px width
      expect(stroke.toLowerCase()).not.toBe("#f0b429");
      expect(sw).not.toBe("2");
    }
  });
});

describe("BubbleChartSvg F2 — single-broker search bypasses global empty-state", () => {
  it("low-volume day + selectedBroker WITH (sub-threshold) trades → renders broker bubbles, NO 'No significant volume'", () => {
    // EVERY broker is sub-threshold (buy/sell ≤ 5). Pre-fix this triggered
    // the global "No significant volume" early-return regardless of the
    // selectedBroker. Post-fix: single-broker mode bypasses the threshold
    // so the broker's bubbles still render.
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 100, buy: 3, sell: 0 }),
      mkTrade({ broker: "其他甲", broker_id: "X1", price: 100, buy: 1, sell: 1 }),
      mkTrade({ broker: "其他乙", broker_id: "X2", price: 100, buy: 1, sell: 1 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="凱基台北"
      />,
    );
    expect(container.textContent).not.toContain("No significant volume");
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
  });

  it("low-volume day + selectedBroker NOT in trades → per-broker hint shown (not global empty-state)", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "其他甲", broker_id: "X1", price: 100, buy: 1, sell: 1 }),
    ];
    const { container } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="找不到的分點"
      />,
    );
    expect(container.textContent).toContain("找不到的分點 今日無顯著成交量");
    expect(container.textContent).not.toContain("No significant volume");
  });

  it("normal-volume day + selectedBroker → only selected broker's bubbles render", () => {
    const trades: BrokerTrade[] = [
      mkTrade({ broker: "其他", broker_id: "X1", price: 100, buy: 100, sell: 0 }),
      mkTrade({ broker: "凱基台北", broker_id: "9201A", price: 101, buy: 80, sell: 0 }),
    ];
    const { container: filtered } = render(
      <BubbleChartSvg
        trades={trades}
        width={400}
        height={300}
        selectedBroker="凱基台北"
      />,
    );
    const filteredCircles = filtered.querySelectorAll("circle");
    expect(filteredCircles.length).toBe(1); // only 凱基台北's buy bubble

    cleanup();

    const { container: unfiltered } = render(
      <BubbleChartSvg trades={trades} width={400} height={300} />,
    );
    expect(unfiltered.querySelectorAll("circle").length).toBe(2);
  });
});
