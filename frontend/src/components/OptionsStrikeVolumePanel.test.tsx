/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsStrikeVolumePanel } from "./OptionsStrikeVolumePanel";

afterEach(() => cleanup());

const data = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [
    { strike: 22000, volume: 18500, oi: 35200, oi_change: 2100 },
    { strike: 22100, volume: 12100, oi: 30000, oi_change: -1400 },
  ],
  put: [
    { strike: 21500, volume: 14200, oi: 28100, oi_change: 1800 },
  ],
};

describe("OptionsStrikeVolumePanel", () => {
  it("renders the call/put columns with correct row counts", () => {
    render(<OptionsStrikeVolumePanel data={data} loading={false} error={null} />);
    expect(screen.getAllByTestId("call-row").length).toBe(2);
    expect(screen.getAllByTestId("put-row").length).toBe(1);
  });

  it("renders strike, volume, oi_change values", () => {
    render(<OptionsStrikeVolumePanel data={data} loading={false} error={null} />);
    expect(screen.getByText("22,000")).toBeTruthy();
    expect(screen.getByText("18,500")).toBeTruthy();
    expect(screen.getByText("+2,100")).toBeTruthy();
    expect(screen.getByText("−1,400")).toBeTruthy();
  });

  it("shows empty state when no data", () => {
    render(<OptionsStrikeVolumePanel data={null} loading={false} error={null} />);
    expect(screen.getByText("尚無資料")).toBeTruthy();
  });
});
