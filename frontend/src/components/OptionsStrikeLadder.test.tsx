/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsStrikeLadder } from "./OptionsStrikeLadder";
import type { OptionsStrikeVolume, OptionsSpot } from "../lib/options-types";

afterEach(() => cleanup());

const data: OptionsStrikeVolume = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [
    { strike: 53000, volume: 520, oi: 4100, oi_change: 310 },
    { strike: 53500, volume: 1200, oi: 8410, oi_change: 680 },
  ],
  put: [
    { strike: 52500, volume: 145, oi: 3520, oi_change: -88 },
    { strike: 53000, volume:  96, oi: 2410, oi_change: -22 },
  ],
};

const spot: OptionsSpot = {
  date: "2026-06-23", fetched_at: "x", as_of_date: "2026-06-23",
  spot: 53420, prev_close: 53300, change: 120, change_pct: 0.225,
};

describe("OptionsStrikeLadder", () => {
  it("renders the ladder when data + spot present", () => {
    render(<OptionsStrikeLadder data={data} spot={spot} loading={false} error={null} />);
    expect(screen.getByTestId("ladder-spot")).toBeTruthy();
  });

  it("renders error banner when error", () => {
    render(<OptionsStrikeLadder data={null} spot={null} loading={false} error="boom" />);
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("renders loading state when loading and no data", () => {
    render(<OptionsStrikeLadder data={null} spot={null} loading error={null} />);
    expect(screen.getByTestId("ladder-loading")).toBeTruthy();
  });

  it("works without spot (renders ladder, omits anchor row)", () => {
    render(<OptionsStrikeLadder data={data} spot={null} loading={false} error={null} />);
    expect(screen.queryByTestId("ladder-spot")).toBeNull();
    expect(screen.getAllByTestId("ladder-row").length).toBeGreaterThan(0);
  });
});
