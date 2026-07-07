/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsOIWallsCard } from "./OptionsOIWallsCard";
import type { OptionsOIWalls } from "../lib/options-types";

afterEach(() => cleanup());

// 痛點:design R13 / code-review CR3 — hit rate 樣本被剔除(T-1 close 缺)
// 時 UI 必須顯示剔除數,否則使用者只看到變小的 N,無從知道統計基於過濾子集。

function makeData(dropped: number): OptionsOIWalls {
  return {
    contract: "TXO202607", date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
    current: {
      static_call_wall: { strike: 22500, oi: 800 },
      static_put_wall: { strike: 21500, oi: 700 },
      dynamic_call_wall: null, dynamic_put_wall: null,
      band_width_pct: 4.5, data_quality_warnings: [],
    },
    hit_rate: {
      samples: 8, pct_settled_inside_band: 0.75, avg_band_width_pct: 5.2,
      history: [], dropped_no_close: dropped, latest_settlement_pending: false,
    },
    latest_settlement_pending: false,
    data_quality_warnings: [], insufficient_data: null,
  };
}

describe("OptionsOIWallsCard hit rate 剔除數(CR3)", () => {
  it("dropped_no_close > 0 → 顯示剔除數", () => {
    render(
      <OptionsOIWallsCard data={makeData(3)} loading={false} error={null} onRefresh={() => {}} />,
    );
    expect(screen.getByText(/剔除 3/)).toBeTruthy();
  });

  it("dropped_no_close = 0 → 不顯示", () => {
    render(
      <OptionsOIWallsCard data={makeData(0)} loading={false} error={null} onRefresh={() => {}} />,
    );
    expect(screen.queryByText(/剔除/)).toBeNull();
  });
});
