/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LargeTradersBars, LargeTradersTrend } from "./options-chart-svg";
import type { OptionsLargeTraders } from "./options-types";

const sampleCurrent: OptionsLargeTraders["current"] = {
  top5_prop:  { long: 12500, short:  8200, net:  4300 },
  top10_prop: { long: 18000, short: 11000, net:  7000 },
  top5_all:   { long: 22000, short: 17000, net:  5000 },
  top10_all:  { long: 31000, short: 24000, net:  7000 },
};

describe("LargeTradersBars", () => {
  it("renders 8 bars (one long + one short per of 4 groups)", () => {
    const { container } = render(
      <LargeTradersBars current={sampleCurrent} width={400} height={200} />,
    );
    const bars = container.querySelectorAll("[data-testid='lt-bar']");
    expect(bars.length).toBe(8);
  });

  it("renders 4 group labels", () => {
    const { container } = render(
      <LargeTradersBars current={sampleCurrent} width={400} height={200} />,
    );
    const labels = container.querySelectorAll("[data-testid='lt-label']");
    expect(labels.length).toBe(4);
  });
});

describe("LargeTradersTrend", () => {
  it("renders two polylines when series has points", () => {
    const series = [
      { date: "2026-06-20", top10_all_net: 6800, top10_prop_net: 5400 },
      { date: "2026-06-23", top10_all_net: 7000, top10_prop_net: 5500 },
    ];
    const { container } = render(
      <LargeTradersTrend series={series} width={400} height={150} />,
    );
    const lines = container.querySelectorAll("polyline");
    expect(lines.length).toBe(2);
  });

  it("renders empty state SVG with no polylines when series empty", () => {
    const { container } = render(
      <LargeTradersTrend series={[]} width={400} height={150} />,
    );
    expect(container.querySelectorAll("polyline").length).toBe(0);
  });
});
