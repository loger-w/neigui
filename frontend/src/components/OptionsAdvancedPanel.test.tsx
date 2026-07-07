/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { optionsApi } from "../lib/options-api";
import { useOptionsChip } from "../hooks/useOptionsChip";
import { useOptionsLargeTraders } from "../hooks/useOptionsLargeTraders";
import { useOptionsSpot } from "../hooks/useOptionsSpot";
import { OptionsAdvancedPanel } from "./OptionsAdvancedPanel";
import type {
  OptionsMaxPain, OptionsOIWalls, OptionsPCR, OptionsInstitutional,
  OptionsLargeTraders, OptionsRetailMtx, OptionsForeignFutures, OptionsSpot,
} from "../lib/options-types";

// 痛點:SC-9 進階統計收合層 — 現四卡統計全數保留於此、預設收合
// (`hidden` attribute,CLAUDE.md §3)、SC-10b failure isolation 自
// OptionsChipPanel.test.tsx 遷入(該檔隨元件刪除)。

const TODAY = "2026-06-26";

const mockMaxPain: OptionsMaxPain = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    max_pain: 21111, total_loss_ntd: 10_000_000, strike_count: 5,
    strikes_with_call_oi_only: 1, strikes_with_put_oi_only: 1,
  },
  hit_rate: null, latest_settlement_pending: false,
  data_quality_warnings: [],
  insufficient_data: { reason: "no_settlements_fetched_in_mvp", required_days: 0 },
};

const mockOIWalls: OptionsOIWalls = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    static_call_wall: { strike: 23232, oi: 800 },
    static_put_wall: { strike: 19191, oi: 700 },
    dynamic_call_wall: { strike: 23500, window_net_increase_oi: 600, partial_window: false },
    dynamic_put_wall: { strike: 18900, window_net_increase_oi: 500, partial_window: false },
    band_width_pct: 9.5,
    data_quality_warnings: [],
  },
  hit_rate: null, latest_settlement_pending: false,
  data_quality_warnings: [], insufficient_data: null,
};

const mockPcr: OptionsPCR = {
  date: TODAY, scope: "all_months", contract: null, fetched_at: "x", as_of_date: TODAY,
  current: { pcr: 0.92, percentile: 75, region: "high", thresholds: { high_pct: 70, low_pct: 30 } },
  series: [{ date: TODAY, pcr: 0.92 }],
  next_day_stats: null, data_quality_warnings: [], insufficient_data: null,
};

const mockInst: OptionsInstitutional = {
  date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    foreign: { call_net: 1500, put_net: -800, total_net: 700, day_change: 0 },
    dealer: { call_net: 100, put_net: 50, total_net: 150, day_change: 0 },
    trust: { call_net: 30, put_net: -10, total_net: 20, day_change: 0 },
    session_breakdown: { day_session: {}, after_hours: null },
  },
  series: [{ date: TODAY, foreign_total_net: 700 }],
  correlation: null, data_quality_warnings: [], insufficient_data: null,
};

const mockLt: OptionsLargeTraders = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    top5_prop: { long: 100, short: 50, net: 50 },
    top10_prop: { long: 200, short: 120, net: 80 },
    top5_all: { long: 900, short: 400, net: 500 },
    top10_all: { long: 5000, short: 1786, net: 3214 },
  },
  series: [],
};

const mockRetail: OptionsRetailMtx = {
  date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: { retail_long: 1, retail_short: 1, ratio: 0 },
  series: [], dropped_days: 0, data_quality_warnings: [],
};

const mockFf: OptionsForeignFutures = {
  date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: { long_oi: 1, short_oi: 1, net_oi: 0 },
  series: [], data_quality_warnings: [],
};

const mockSpot: OptionsSpot = {
  date: TODAY, fetched_at: "x", as_of_date: TODAY, as_of_session: "position",
  spot: 21500, prev_close: 21400, change: 100, change_pct: 0.47,
};

function Harness(): ReactElement {
  const chip = useOptionsChip("TXO202607", TODAY);
  const lt = useOptionsLargeTraders("TXO202607", TODAY);
  const spot = useOptionsSpot(TODAY);
  return <OptionsAdvancedPanel chip={chip} lt={lt} spot={spot.data} />;
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
}

function mockHappyApis() {
  vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
  vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
  vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockPcr);
  vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);
  vi.spyOn(optionsApi, "largeTraders").mockResolvedValue(mockLt);
  vi.spyOn(optionsApi, "retailMtx").mockResolvedValue(mockRetail);
  vi.spyOn(optionsApi, "foreignFutures").mockResolvedValue(mockFf);
  vi.spyOn(optionsApi, "spot").mockResolvedValue(mockSpot);
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("OptionsAdvancedPanel", () => {
  it("collapsed by default via hidden attribute; expand reveals four cards + net table", async () => {
    mockHappyApis();
    renderPanel();
    const content = screen.getByTestId("advanced-content");
    expect(content.hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByTestId("advanced-toggle"));
    expect(content.hasAttribute("hidden")).toBe(false);

    await waitFor(() => {
      expect(screen.getByTestId("options-max-pain-card")).toBeTruthy();
      expect(screen.getByTestId("options-oi-walls-card")).toBeTruthy();
      expect(screen.getByTestId("options-pcr-card")).toBeTruthy();
      expect(screen.getByTestId("options-institutional-card")).toBeTruthy();
      expect(screen.getByTestId("options-net-table")).toBeTruthy();
    });
  });

  it("SC-10b failure isolation:PCR 502 leaves other cards rendering(遷自 OptionsChipPanel.test)", async () => {
    mockHappyApis();
    vi.spyOn(optionsApi, "pcr").mockRejectedValue(new Error("upstream_unavailable"));
    renderPanel();
    fireEvent.click(screen.getByTestId("advanced-toggle"));

    await waitFor(() => {
      expect(screen.getByText("21,111")).toBeTruthy();  // Max Pain unique value
    }, { timeout: 5000 });
    await waitFor(() => {
      expect(screen.getByText(/upstream_unavailable/)).toBeTruthy();
    }, { timeout: 5000 });
  });
});
