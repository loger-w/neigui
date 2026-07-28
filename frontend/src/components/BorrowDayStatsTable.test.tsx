/**
 * @vitest-environment jsdom
 *
 * 本日借券統計表(mod/borrow-fee-layout SC-1/2)— 免搜尋常駐右表:
 * per-stock 加總、張數換算、固定 desc 排序、testid 契約。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { BorrowFeeRow } from "../lib/borrow-fee";
import { BorrowDayStatsTable } from "./BorrowDayStatsTable";

afterEach(() => cleanup());

const row = (
  sid: string,
  name: string,
  shares: number,
  market: BorrowFeeRow["market"] = "twse",
): BorrowFeeRow => ({
  market,
  stock_id: sid,
  name,
  lending_shares: shares,
  fee_rate: 1.0,
  date: "2026-06-26",
});

const ROWS: BorrowFeeRow[] = [
  row("8046", "南電", 3000),
  row("2434", "統懋", 21000),
  row("8046", "南電", 5000),
  row("8069", "元太", 25000, "tpex"),
];

describe("BorrowDayStatsTable", () => {
  it("root testid + 標題 + 單位註記可指認(SC-1)", () => {
    render(<BorrowDayStatsTable rows={ROWS} />);
    expect(screen.getByTestId("borrow-day-stats")).toBeTruthy();
    expect(screen.getByText("本日借券統計")).toBeTruthy();
    expect(screen.getByText(/單位:張/)).toBeTruthy();
  });

  it("列數 = distinct stocks、同股多筆加總、張數 desc 排序(SC-1/2)", () => {
    render(<BorrowDayStatsTable rows={ROWS} />);
    const rows = screen.getAllByTestId("day-stat-row");
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.getAttribute("data-stock-id"))).toEqual([
      "8069",
      "2434",
      "8046",
    ]);
    // 張數換算:8069 = 25,000 股 → 25 張;8046 = 3,000+5,000 → 8 張
    expect(rows[0]?.textContent).toContain("25");
    expect(rows[2]?.textContent).toContain("8");
  });

  it("數值標色不用 accent/bull/bear(色彩語意鐵則 — 非互動態)", () => {
    render(<BorrowDayStatsTable rows={ROWS} />);
    const root = screen.getByTestId("borrow-day-stats");
    expect(root.innerHTML).not.toMatch(/accent|bull|bear/);
  });
});
