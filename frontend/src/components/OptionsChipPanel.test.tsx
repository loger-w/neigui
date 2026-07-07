/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { OptionsChipPanel } from "./OptionsChipPanel";
import { optionsApi } from "../lib/options-api";
import { useOptionsChip } from "../hooks/useOptionsChip";
import { makeQueryWrapper } from "../test-utils/query-wrapper";
import type {
  OptionsMaxPain, OptionsOIWalls, OptionsPCR, OptionsInstitutional,
} from "../lib/options-types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function PanelHarness({ contractId, date }: { contractId: string; date: string }) {
  // useOptionsChip lives in the parent (OptionsPage) per F9 fix; the test
  // mirrors that ownership.
  const chip = useOptionsChip(contractId, date);
  return <OptionsChipPanel chip={chip} />;
}

function renderPanel(contractId = "TXO202607", date = "2026-06-25") {
  const Wrapper = makeQueryWrapper();
  return render(
    <Wrapper>
      <PanelHarness contractId={contractId} date={date} />
    </Wrapper>,
  );
}

const TODAY = "2026-06-25";

// F10 修: distinct strike values across cards so cross-card text matches
// cannot satisfy the wrong assertion. Each fixture carries an "ID" value
// that only that card renders (e.g. Max Pain → 21111, OI Walls call → 23232).
const mockMaxPain: OptionsMaxPain = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    max_pain: 21111, total_loss_ntd: 10_000_000, strike_count: 5,
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
    static_call_wall: { strike: 23232, oi: 800 },  // unique-to-OI Walls call
    static_put_wall: { strike: 19191, oi: 700 },   // unique-to-OI Walls put
    dynamic_call_wall: { strike: 23500, window_net_increase_oi: 600, partial_window: false },
    dynamic_put_wall: { strike: 18900, window_net_increase_oi: 500, partial_window: false },
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
  series: [{ date: TODAY, pcr: 0.92 }],
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
  series: [{ date: TODAY, foreign_total_net: 700 }],
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

    // Max Pain renders its unique value (only appears in Max Pain card)
    await waitFor(() => {
      expect(screen.getByText("21111")).toBeTruthy();
    });
    // OI Walls renders its unique call-wall value
    expect(screen.getByText("23232")).toBeTruthy();
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
      // OI Walls unique call wall (NOT shared with Max Pain mock)
      expect(screen.getByText("23232")).toBeTruthy();
    });
    expect(screen.getByText("0.92")).toBeTruthy();
    expect(screen.getByText(/指標載入失敗/)).toBeTruthy();
  });
});

describe("OptionsOIWallsCard — design v4 F2 color direction (post-impl review)", () => {
  it("renders 支撐 (put wall) in bull color, 壓力 (call wall) in bear color", async () => {
    vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
    vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
    vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockPcr);
    vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("call-wall")).toBeTruthy();
    });
    const callWall = screen.getByTestId("call-wall");
    const putWall = screen.getByTestId("put-wall");
    // 壓力 (call wall) — bear (green)
    expect(callWall.className).toContain("text-bear");
    expect(callWall.className).not.toContain("text-bull");
    // 支撐 (put wall) — bull (red)
    expect(putWall.className).toContain("text-bull");
    expect(putWall.className).not.toContain("text-bear");
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
