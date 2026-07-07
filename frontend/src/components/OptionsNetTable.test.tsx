/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsNetTable } from "./OptionsNetTable";
import type { OptionsLargeTraders } from "../lib/options-types";

afterEach(() => cleanup());

// 痛點:NET 四格降級為進階區對照表(design v3 §2)— 四組當日 net + 20 日
// 變化,附「特定法人 vs 全交易人」固定說明(受眾判讀的前置知識)。

const lt: OptionsLargeTraders = {
  contract: "TXO202607", date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: {
    top5_prop: { long: 100, short: 50, net: 50 },
    top10_prop: { long: 200, short: 120, net: 80 },
    top5_all: { long: 900, short: 400, net: 500 },
    top10_all: { long: 5000, short: 1786, net: 3214 },
  },
  series: [
    { date: "2026-06-01", top5_all_net: 100, top10_all_net: 2800, top5_prop_net: 10, top10_prop_net: 20 },
    { date: "2026-06-26", top5_all_net: 500, top10_all_net: 3214, top5_prop_net: 50, top10_prop_net: 80 },
  ],
};

describe("OptionsNetTable", () => {
  it("renders four group rows with net + 20D change", () => {
    render(<OptionsNetTable data={lt} />);
    const table = screen.getByTestId("options-net-table");
    const rows = table.querySelectorAll("tbody tr");
    expect(rows.length).toBe(4);
    expect(table.textContent).toContain("+3,214");
    // top10_all 20D 變化 = 3214 - 2800 = +414
    expect(table.textContent).toContain("+414");
  });

  it("includes the 特定法人 vs 全交易人 explanation", () => {
    render(<OptionsNetTable data={lt} />);
    expect(screen.getByText(/特定法人 = 前 N 大/).textContent).toContain("全交易人");
  });

  it("renders nothing meaningful without data", () => {
    render(<OptionsNetTable data={null} />);
    expect(screen.queryByTestId("options-net-table")).toBeNull();
  });
});
