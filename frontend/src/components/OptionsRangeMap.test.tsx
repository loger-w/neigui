/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OptionsRangeMap } from "./OptionsRangeMap";
import type { OptionsStrikeVolume, OptionsOIWalls, OptionsMaxPain, OptionsSpot } from "../lib/options-types";

afterEach(() => cleanup());

// 痛點:SC-7 wrapper — OI/成交量 toggle(普通 button,Radix Tabs 在 jsdom
// 不可靠);R10 as_of 防禦:sv 與 ow 基準日不一致時隱藏牆 + 註記。

const TODAY = "2026-06-26";

const sv: OptionsStrikeVolume = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  call: [{ strike: 22000, volume: 100, oi: 500, oi_change: 10 }],
  put: [{ strike: 21000, volume: 80, oi: 400, oi_change: -5 }],
};

const ow: OptionsOIWalls = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    static_call_wall: { strike: 22000, oi: 500 },
    static_put_wall: { strike: 21000, oi: 400 },
    dynamic_call_wall: null, dynamic_put_wall: null,
    band_width_pct: 4.6, data_quality_warnings: [],
  },
  hit_rate: null, latest_settlement_pending: false,
  data_quality_warnings: [], insufficient_data: null,
};

const mp: OptionsMaxPain = {
  contract: "TXO202607", date: TODAY, fetched_at: "x", as_of_date: TODAY,
  current: {
    max_pain: 21500, total_loss_ntd: 1, strike_count: 2,
    strikes_with_call_oi_only: 0, strikes_with_put_oi_only: 0,
  },
  hit_rate: null, latest_settlement_pending: false,
  data_quality_warnings: [], insufficient_data: null,
};

const spot: OptionsSpot = {
  date: TODAY, fetched_at: "x", as_of_date: TODAY, as_of_session: "position",
  spot: 21500, prev_close: 21400, change: 100, change_pct: 0.47,
};

function renderMap(over: Record<string, unknown> = {}) {
  return render(
    <OptionsRangeMap
      sv={sv} ow={ow} mp={mp} spot={spot}
      loading={false} error={null}
      {...over}
    />,
  );
}

describe("OptionsRangeMap", () => {
  it("renders walls from backend payload by default (OI metric)", () => {
    renderMap();
    expect(document.querySelector("[data-wall='call']")).toBeTruthy();
    expect(document.querySelector("[data-wall='put']")).toBeTruthy();
  });

  it("metric toggle buttons switch OI / 成交量", () => {
    renderMap();
    const volBtn = screen.getByRole("tab", { name: "成交量" });
    expect(screen.getByRole("tab", { name: "OI" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(volBtn);
    expect(volBtn.getAttribute("aria-selected")).toBe("true");
  });

  it("R10 防禦:sv/ow 基準日不一致 → 隱藏牆 + 顯示註記", () => {
    renderMap({ ow: { ...ow, as_of_date: "2026-06-25" } });
    expect(document.querySelector("[data-wall]")).toBeNull();
    expect(screen.getByText(/牆資料基準日不同/)).toBeTruthy();
  });

  it("error state renders message", () => {
    renderMap({ sv: null, error: "boom" });
    expect(screen.getByText(/boom/)).toBeTruthy();
  });
});
