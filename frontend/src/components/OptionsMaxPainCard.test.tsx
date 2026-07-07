/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsMaxPainCard } from "./OptionsMaxPainCard";
import type { OptionsMaxPain } from "../lib/options-types";

afterEach(() => cleanup());

// 痛點:SC-10 — Max Pain 主數字要有「距現價 ±x.x%」對照才可判讀;
// 「賣方總賠付 / 履約價數 / call-only」是內部診斷,移入 InfoHint popover,
// 首屏不出現(design v3 §1.4)。

const data: OptionsMaxPain = {
  contract: "TXO202607", date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: {
    max_pain: 21500, total_loss_ntd: 12_345_678, strike_count: 173,
    strikes_with_call_oi_only: 12, strikes_with_put_oi_only: 3,
  },
  hit_rate: null, latest_settlement_pending: false,
  data_quality_warnings: [], insufficient_data: null,
};

describe("OptionsMaxPainCard(SC-10)", () => {
  it("shows 距現價 % next to the main number", () => {
    render(
      <OptionsMaxPainCard
        data={data} loading={false} error={null} onRefresh={() => {}}
        spot={22000}
      />,
    );
    // (21500 - 22000) / 22000 = -2.27% → 下方 2.3%
    expect(screen.getByTestId("max-pain-distance").textContent).toContain("下方 2.3%");
    expect(screen.getByText("21,500")).toBeTruthy();
  });

  it("omits distance when spot missing", () => {
    render(
      <OptionsMaxPainCard
        data={data} loading={false} error={null} onRefresh={() => {}}
        spot={null}
      />,
    );
    expect(screen.queryByTestId("max-pain-distance")).toBeNull();
  });

  it("diagnostics (賣方總賠付/履約價數) not visible on first paint", () => {
    render(
      <OptionsMaxPainCard
        data={data} loading={false} error={null} onRefresh={() => {}}
        spot={22000}
      />,
    );
    expect(screen.queryByText(/賣方總賠付/)).toBeNull();
    expect(screen.queryByText(/履約價數/)).toBeNull();
    // InfoHint trigger exists instead
    expect(screen.getByTestId("options-info-hint")).toBeTruthy();
  });
});
