/**
 * @vitest-environment jsdom
 *
 * 本日借券統計表(mod/borrow-fee-layout SC-1/2)— 免搜尋常駐右表:
 * per-stock 加總、張數換算、固定 desc 排序、testid 契約。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// mod/borrow-fee-polish SC-3:統計列點擊 → onPickStock(等同 combobox 選定)。
describe("BorrowDayStatsTable 列點擊", () => {
  it("click 呼叫 onPickStock(stock_id)", () => {
    const pick = vi.fn();
    render(<BorrowDayStatsTable rows={ROWS} onPickStock={pick} />);
    const rows = screen.getAllByTestId("day-stat-row");
    fireEvent.click(rows[1] as HTMLElement);
    expect(pick).toHaveBeenCalledWith("2434");
  });

  it("Enter / Space 鍵同效,Space 需 preventDefault(R2 — 防 overflow 欄跳捲)", () => {
    const pick = vi.fn();
    render(<BorrowDayStatsTable rows={ROWS} onPickStock={pick} />);
    const row = screen.getAllByTestId("day-stat-row")[0] as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(pick).toHaveBeenCalledWith("8069");
    // fireEvent 回傳 false = 事件被 preventDefault
    const notPrevented = fireEvent.keyDown(row, { key: " " });
    expect(notPrevented).toBe(false);
    expect(pick).toHaveBeenCalledTimes(2);
  });

  it("無 onPickStock 時點擊不炸", () => {
    render(<BorrowDayStatsTable rows={ROWS} />);
    fireEvent.click(screen.getAllByTestId("day-stat-row")[0] as HTMLElement);
  });
});

// review TC-4:affordance class 正向鎖(與色彩負向鎖對稱)— 重構誤刪可抓。
describe("BorrowDayStatsTable 列 affordance", () => {
  it("row className 含 cursor-pointer 與 hover/focus 背景階", () => {
    render(<BorrowDayStatsTable rows={ROWS} onPickStock={() => {}} />);
    const cls = (screen.getAllByTestId("day-stat-row")[0] as HTMLElement).className;
    expect(cls).toContain("cursor-pointer");
    expect(cls).toContain("hover:bg-line-strong/30");
    expect(cls).toContain("focus-visible:bg-line-strong/30");
  });
});
