/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  OptionsThermometerRow,
  buildForeignReading,
  buildTop10Reading,
  buildPcrReading,
  buildRetailReading,
} from "./OptionsThermometerRow";
import type {
  OptionsInstitutional, OptionsLargeTraders, OptionsPCR,
  OptionsRetailMtx, OptionsForeignFutures,
} from "../lib/options-types";

afterEach(() => cleanup());

// 痛點:SC-8 溫度計四格 — 每格「誰站哪邊」一句判讀;「較昨日」必須取
// series 末兩點差(day_change 恆 0 是死欄位,KR-1);PCR 資料不足顯示
// 「資料不足」、其他格 error 顯示「—」(impl-review R6);禁方向性文案。

const inst: OptionsInstitutional = {
  date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: {
    foreign: { call_net: 1500, put_net: -800, total_net: 700, day_change: 0 },
    dealer: { call_net: 0, put_net: 0, total_net: 0, day_change: 0 },
    trust: { call_net: 0, put_net: 0, total_net: 0, day_change: 0 },
    session_breakdown: { day_session: {}, after_hours: null },
  },
  series: [
    { date: "2026-06-25", foreign_total_net: 400 },
    { date: "2026-06-26", foreign_total_net: 700 },
  ],
  correlation: null, data_quality_warnings: [], insufficient_data: null,
};

const lt: OptionsLargeTraders = {
  contract: "TXO202607", date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: {
    top5_prop: { long: 0, short: 0, net: 0 },
    top10_prop: { long: 0, short: 0, net: 0 },
    top5_all: { long: 0, short: 0, net: 0 },
    top10_all: { long: 5000, short: 1786, net: 3214 },
  },
  series: [
    { date: "2026-06-25", top5_all_net: 0, top10_all_net: 2800, top5_prop_net: 0, top10_prop_net: 0 },
    { date: "2026-06-26", top5_all_net: 0, top10_all_net: 3214, top5_prop_net: 0, top10_prop_net: 0 },
  ],
};

const pcr: OptionsPCR = {
  date: "2026-06-26", scope: "all_months", contract: null,
  fetched_at: "x", as_of_date: "2026-06-26",
  current: { pcr: 1.23, percentile: 73, region: "high", thresholds: { high_pct: 70, low_pct: 30 } },
  series: [{ date: "2026-06-26", pcr: 1.23 }],
  next_day_stats: null, data_quality_warnings: [], insufficient_data: null,
};

const retail: OptionsRetailMtx = {
  date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: { retail_long: 37344, retail_short: 30282, ratio: 0.166 },
  series: [{ date: "2026-06-26", ratio: 0.166 }],
  dropped_days: 0, data_quality_warnings: [],
};

const ff: OptionsForeignFutures = {
  date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: { long_oi: 6178, short_oi: 87230, net_oi: -81052 },
  series: [{ date: "2026-06-26", net_oi: -81052 }],
  data_quality_warnings: [],
};

const ok = <T,>(data: T) => ({ data, loading: false, error: null as string | null });

function renderRow(over: Record<string, unknown> = {}) {
  return render(
    <OptionsThermometerRow
      inst={ok(inst)} lt={ok(lt)} pcr={ok(pcr)} retail={ok(retail)} ff={ok(ff)}
      {...over}
    />,
  );
}

describe("判讀句純函式", () => {
  it("外資:淨多/淨空 + 較昨日方向來自 series 末兩點差", () => {
    expect(buildForeignReading(inst.series)).toBe("外資選擇權淨多 700 口,較昨日增加");
    expect(buildForeignReading([
      { date: "a", foreign_total_net: -200 },
      { date: "b", foreign_total_net: -500 },
    ])).toBe("外資選擇權淨空 500 口,較昨日減少");
    expect(buildForeignReading([{ date: "b", foreign_total_net: 100 }]))
      .toBe("外資選擇權淨多 100 口");
  });

  it("前十大:淨向 + 20 日趨勢", () => {
    expect(buildTop10Reading(3214, [2800, 3214])).toContain("前十大交易人淨多 3,214 口");
    expect(buildTop10Reading(-100, [200, -100])).toContain("淨空 100 口");
  });

  it("PCR:分位描述,region null → 資料不足", () => {
    expect(buildPcrReading(pcr.current)).toBe("Put/Call 未平倉比 1.23,歷史第 73 百分位,偏高");
    expect(buildPcrReading({ ...pcr.current, region: null })).toBeNull();
  });

  it("散戶小台:淨向 + 佔比", () => {
    expect(buildRetailReading(retail.current!)).toBe("小台散戶淨多,佔總未平倉 16.6%");
    expect(buildRetailReading({ retail_long: 100, retail_short: 300, ratio: -0.2 }))
      .toBe("小台散戶淨空,佔總未平倉 20.0%");
  });
});

describe("OptionsThermometerRow", () => {
  it("renders four tiles with readings", () => {
    renderRow();
    const row = screen.getByTestId("options-thermometer");
    expect(row.querySelectorAll("[data-testid='thermo-tile']").length).toBe(4);
    expect(row.textContent).toContain("外資選擇權淨多 700 口");
    expect(row.textContent).toContain("前十大交易人淨多 3,214 口");
    expect(row.textContent).toContain("歷史第 73 百分位");
    expect(row.textContent).toContain("小台散戶淨多");
  });

  it("外資格第二行顯示期貨對照", () => {
    renderRow();
    expect(screen.getByTestId("thermo-foreign-futures").textContent)
      .toContain("期貨淨空 81,052 口");
  });

  it("PCR 資料不足 → 該格顯示「資料不足」不擋其他格(edge 3 / R6)", () => {
    renderRow({
      pcr: ok({ ...pcr, current: { ...pcr.current, region: null } }),
    });
    expect(screen.getByText("資料不足")).toBeTruthy();
    expect(screen.getByTestId("options-thermometer").textContent)
      .toContain("外資選擇權淨多");
  });

  it("單格 error → 該格「—」不擋其他格", () => {
    renderRow({ retail: { data: null, loading: false, error: "boom" } });
    const tiles = screen.getAllByTestId("thermo-tile");
    expect(tiles.some((t) => (t.textContent ?? "").includes("—"))).toBe(true);
    expect(screen.getByTestId("options-thermometer").textContent)
      .toContain("外資選擇權淨多");
  });

  it("never renders directional copy", () => {
    renderRow();
    expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull();
  });

  it("weeklyAggregate 時前十大格附週選 aggregate 註記(code-review CR2 回復)", () => {
    renderRow({ weeklyAggregate: true });
    expect(screen.getByText(/週三選.*週五選合計/)).toBeTruthy();
  });
});
