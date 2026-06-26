/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { OptionsChipPanel } from "./OptionsChipPanel";
import { optionsApi } from "../lib/options-api";
import { makeQueryWrapper } from "../test-utils/query-wrapper";
import type {
  OptionsMaxPain, OptionsOIWalls, OptionsPCR, OptionsInstitutional,
} from "../lib/options-types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(contractId = "TXO202607", date = "2026-06-25") {
  const Wrapper = makeQueryWrapper();
  return render(
    <Wrapper>
      <OptionsChipPanel contractId={contractId} date={date} />
    </Wrapper>,
  );
}

const TODAY = "2026-06-25";

const mockMaxPain: OptionsMaxPain = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    max_pain: 21000, total_loss_ntd: 10_000_000, strike_count: 5,
    strikes_with_call_oi_only: 1, strikes_with_put_oi_only: 1,
  },
  hit_rate: null,
  latest_settlement_pending: false,
  data_quality_warnings: [],
  insufficient_data: { reason: "no_settlements_fetched_in_mvp", required_days: 0 },
};

const mockOIWalls: OptionsOIWalls = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    static_call_wall: { strike: 22000, oi: 800 },
    static_put_wall: { strike: 20000, oi: 700 },
    dynamic_call_wall: { strike: 22500, window_activity_oi: 600, partial_window: false },
    dynamic_put_wall: { strike: 19500, window_activity_oi: 500, partial_window: false },
    band_width_pct: 9.5,
    data_quality_warnings: [],
  },
  hit_rate: null,
  latest_settlement_pending: false,
  data_quality_warnings: [],
  insufficient_data: null,
};

const mockPcr: OptionsPCR = {
  date: TODAY, scope: "all_months", contract: null,
  fetched_at: "x", as_of_date: TODAY,
  current: {
    pcr: 0.92, percentile: 75,
    region: "high",
    thresholds: { high_pct: 70, low_pct: 30 },
  },
  next_day_stats: null,
  data_quality_warnings: [],
  insufficient_data: null,
};

const mockInst: OptionsInstitutional = {
  date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    foreign: { call_net: 1500, put_net: -800, total_net: 700, day_change: 0 },
    dealer:  { call_net: 100, put_net: 50, total_net: 150, day_change: 0 },
    trust:   { call_net: 30, put_net: -10, total_net: 20, day_change: 0 },
    session_breakdown: { day_session: {}, after_hours: null },
  },
  correlation: null,
  data_quality_warnings: [],
  insufficient_data: null,
};

describe("OptionsChipPanel — SC-10b failure isolation (design v4 F12)", () => {
  it("PCR endpoint 502 leaves Max Pain / OI Walls / Institutional cards rendering", async () => {
    vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
    vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
    vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);
    vi.spyOn(optionsApi, "pcr").mockRejectedValue(new Error("upstream_unavailable"));

    renderPanel();

    // Max Pain renders its value
    await waitFor(() => {
      expect(screen.getByText("21000")).toBeTruthy();
    });
    // OI Walls static call wall strike
    expect(screen.getByText("22000")).toBeTruthy();
    // Institutional 外資 label
    expect(screen.getByText("外資")).toBeTruthy();
    // PCR card shows error
    expect(screen.getByText(/指標載入失敗/)).toBeTruthy();
  });

  it("Max Pain endpoint failure leaves the other three cards rendering", async () => {
    vi.spyOn(optionsApi, "maxPain").mockRejectedValue(new Error("finmind_error"));
    vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
    vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockPcr);
    vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);

    renderPanel();

    await waitFor(() => {
      // OI Walls static call wall
      expect(screen.getByText("22000")).toBeTruthy();
    });
    expect(screen.getByText("0.92")).toBeTruthy();
    expect(screen.getByText(/指標載入失敗/)).toBeTruthy();
  });
});

describe("OptionsPCRCard — design v4 F5 reflexivity hedge (no directional copy)", () => {
  it("renders region label but NEVER prints 做多/做空/賣選/滿倉", async () => {
    vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
    vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
    vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockPcr);
    vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("0.92")).toBeTruthy();
    });
    expect(screen.queryByText(/做多/)).toBeNull();
    expect(screen.queryByText(/做空/)).toBeNull();
    expect(screen.queryByText(/賣選/)).toBeNull();
    expect(screen.queryByText(/滿倉/)).toBeNull();
  });
});

describe("OptionsInstitutionalCard — design v4 F3-int dealer (NOT prop) naming", () => {
  it("renders the three Chinese institution labels (外資 / 自營 / 投信), no English 'prop' copy", async () => {
    vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
    vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
    vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockPcr);
    vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("外資")).toBeTruthy();
    });
    expect(screen.getByText("自營")).toBeTruthy();
    expect(screen.getByText("投信")).toBeTruthy();
    expect(screen.queryByText(/\bprop\b/i)).toBeNull();
    expect(screen.queryByText(/proprietary/i)).toBeNull();
  });
});
