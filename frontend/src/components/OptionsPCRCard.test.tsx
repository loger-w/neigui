/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsPCRCard } from "./OptionsPCRCard";
import type { OptionsPCR } from "../lib/options-types";

afterEach(() => cleanup());

// 痛點(characterization,refactor/options-p2-reuse):stats 表兩種格式化變體 —
// mean/std 已是百分比值(直接 toFixed),hit_positive 是小數(×100 再 toFixed)。
// 換錯變體會差 100 倍,此檔鎖住每個欄位用哪一種。

const data: OptionsPCR = {
  date: "2026-06-26", scope: "per_contract", contract: "TXO202607",
  fetched_at: "x", as_of_date: "2026-06-26",
  current: {
    pcr: 1.18, percentile: 72,
    region: "neutral", thresholds: { high_pct: 80, low_pct: 20 },
  },
  series: [],
  next_day_stats: {
    high_region: { mean_pct: 0.35, std_pct: 1.2, hit_positive: 0.61, samples: 18 },
    neutral_region: { mean_pct: -0.04, std_pct: 0.9, hit_positive: 0.52, samples: 120 },
    low_region: { mean_pct: 0.1, std_pct: 1.5, hit_positive: 0.48, samples: 22 },
  },
  data_quality_warnings: [],
  insufficient_data: null,
};

describe("OptionsPCRCard stats 表格式化(characterization)", () => {
  it("mean/std 已是 % 值直接格式化(digits 2),hit_positive 小數 ×100(digits 1)", () => {
    render(
      <OptionsPCRCard data={data} loading={false} error={null} onRefresh={() => {}} />,
    );
    // high_region:mean 0.35 → "0.35%"、std 1.2 → "1.20%"(不 ×100)
    expect(screen.getByText("0.35%")).toBeTruthy();
    expect(screen.getByText("1.20%")).toBeTruthy();
    // hit_positive 0.61 → "61.0%"(×100)
    expect(screen.getByText("61.0%")).toBeTruthy();
  });

  it("主數字 + 分位照 payload 呈現", () => {
    render(
      <OptionsPCRCard data={data} loading={false} error={null} onRefresh={() => {}} />,
    );
    expect(screen.getByText("1.18")).toBeTruthy();
    expect(screen.getByText("72")).toBeTruthy();
  });
});
