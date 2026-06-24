/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsLargeTradersStrip } from "./OptionsLargeTradersStrip";
import type { OptionsLargeTraders } from "../lib/options-types";

afterEach(() => cleanup());

const mk = (): OptionsLargeTraders => ({
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  current: {
    top5_prop:  { long: 100, short: 50,  net:  50 },
    top10_prop: { long: 200, short: 100, net: 100 },
    top5_all:   { long: 300, short: 200, net: 100 },
    top10_all:  { long: 400, short: 300, net: 100 },
  },
  series: [
    { date: "2026-06-20", top5_all_net: 80, top10_all_net: 90, top5_prop_net: 60, top10_prop_net: 70 },
    { date: "2026-06-23", top5_all_net: 100, top10_all_net: 100, top5_prop_net: 50, top10_prop_net: 100 },
  ],
});

describe("OptionsLargeTradersStrip", () => {
  it("renders 4 cards with NET numbers", () => {
    render(<OptionsLargeTradersStrip data={mk()} loading={false} error={null} />);
    const cards = screen.getAllByTestId("strip-card");
    expect(cards.length).toBe(4);
  });

  it("each card contains a sparkline svg", () => {
    const { container } = render(
      <OptionsLargeTradersStrip data={mk()} loading={false} error={null} />,
    );
    const sparks = container.querySelectorAll("[data-testid='strip-spark']");
    expect(sparks.length).toBe(4);
  });

  it("shows weekly aggregate banner when prop=true", () => {
    render(
      <OptionsLargeTradersStrip data={mk()} loading={false} error={null}
        weeklyAggregateBanner />,
    );
    expect(screen.getByTestId("strip-weekly-banner")).toBeTruthy();
  });

  it("hides weekly banner when prop omitted", () => {
    render(<OptionsLargeTradersStrip data={mk()} loading={false} error={null} />);
    expect(screen.queryByTestId("strip-weekly-banner")).toBeNull();
  });

  it("shows error banner when error present", () => {
    render(<OptionsLargeTradersStrip data={null} loading={false} error="boom" />);
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("shows skeleton when loading and no data", () => {
    render(<OptionsLargeTradersStrip data={null} loading error={null} />);
    expect(screen.getByTestId("strip-skeleton")).toBeTruthy();
  });
});
