/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsLargeTradersPanel } from "./OptionsLargeTradersPanel";

// jsdom doesn't ship ResizeObserver; useContainerSize references it.
beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => cleanup());

const mk = () => ({
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  current: {
    top5_prop:  { long: 100, short: 50, net: 50 },
    top10_prop: { long: 200, short: 100, net: 100 },
    top5_all:   { long: 300, short: 200, net: 100 },
    top10_all:  { long: 400, short: 300, net: 100 },
  },
  series: [
    { date: "2026-06-20", top10_all_net: 80, top10_prop_net: 60 },
    { date: "2026-06-23", top10_all_net: 100, top10_prop_net: 80 },
  ],
});

describe("OptionsLargeTradersPanel", () => {
  it("shows section heading", () => {
    render(<OptionsLargeTradersPanel data={mk()} loading={false} error={null} />);
    expect(screen.getByText("大戶部位")).toBeTruthy();
  });

  it("shows error banner when error present", () => {
    render(<OptionsLargeTradersPanel data={null} loading={false} error="boom" />);
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("shows loading state when loading and no data", () => {
    render(<OptionsLargeTradersPanel data={null} loading={true} error={null} />);
    expect(screen.getByTestId("options-lt-loading")).toBeTruthy();
  });

  it("renders weekly aggregate banner when weeklyAggregateBanner=true", () => {
    render(
      <OptionsLargeTradersPanel data={mk()} loading={false} error={null}
        weeklyAggregateBanner />,
    );
    expect(screen.getByTestId("options-lt-weekly-banner")).toBeTruthy();
  });

  it("hides weekly aggregate banner when weeklyAggregateBanner=false", () => {
    render(
      <OptionsLargeTradersPanel data={mk()} loading={false} error={null} />,
    );
    expect(screen.queryByTestId("options-lt-weekly-banner")).toBeNull();
  });
});
