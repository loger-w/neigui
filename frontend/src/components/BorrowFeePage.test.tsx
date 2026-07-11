/**
 * @vitest-environment jsdom
 *
 * 券差頁:資料日 badge / NTD 態 / partial 註記 / 空狀態 / 方向性文案禁令
 * (SC-2/3/4;impl-spec R1-4 — 文案禁令掛 page 層全文)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BorrowFeeData } from "../lib/borrow-fee";

const hookState = {
  data: null as BorrowFeeData | null,
  loading: false,
  error: null as string | null,
  noTradingDay: false,
  refresh: vi.fn(),
};

vi.mock("../hooks/useDaytradeFee", () => ({
  useDaytradeFee: () => hookState,
}));

import { BorrowFeePage } from "./BorrowFeePage";

const DATA: BorrowFeeData = {
  as_of_date: "2026-06-26",
  rows: [
    {
      market: "twse", stock_id: "8046", name: "南電",
      lending_shares: 3000, fee_rate: 3.5, date: "2026-06-26",
    },
  ],
  month_counts: { "8046": 2 },
};

beforeEach(() => {
  hookState.data = DATA;
  hookState.loading = false;
  hookState.error = null;
  hookState.noTradingDay = false;
  hookState.refresh = vi.fn();
});
afterEach(() => cleanup());

describe("BorrowFeePage", () => {
  it("顯示標題、資料日 badge 與表格", () => {
    render(<BorrowFeePage />);
    expect(screen.getByText("券差查詢")).toBeTruthy();
    expect(screen.getByText(/資料日 2026-06-26/)).toBeTruthy();
    expect(screen.getAllByTestId("fee-row").length).toBe(1);
    expect(screen.queryByText(/非交易日/)).toBeNull();
  });

  it("no_trading_day 顯示非交易日註記", () => {
    hookState.noTradingDay = true;
    hookState.data = { ...DATA, no_trading_day: true };
    render(<BorrowFeePage />);
    expect(screen.getByText(/非交易日/)).toBeTruthy();
  });

  it("partial 帶 tpex 顯示上櫃資料缺註記", () => {
    hookState.data = { ...DATA, partial: ["tpex"] };
    render(<BorrowFeePage />);
    expect(screen.getByText(/上櫃資料缺/)).toBeTruthy();
  });

  it("rows 空顯示空狀態", () => {
    hookState.data = { ...DATA, rows: [], month_counts: {} };
    render(<BorrowFeePage />);
    expect(screen.getByText("本月無券差資料")).toBeTruthy();
  });

  it("error 顯示錯誤列", () => {
    hookState.data = null;
    hookState.error = "borrow_fee_upstream";
    render(<BorrowFeePage />);
    expect(screen.getByText(/borrow_fee_upstream/)).toBeTruthy();
  });

  it("重新整理按鈕觸發 refresh", () => {
    render(<BorrowFeePage />);
    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));
    expect(hookState.refresh).toHaveBeenCalledTimes(1);
  });

  it("整頁(header + 副行 + 表格)無方向性文案", () => {
    hookState.data = { ...DATA, partial: ["tpex"], no_trading_day: true };
    hookState.noTradingDay = true;
    render(<BorrowFeePage />);
    expect(screen.queryByText(/軋空|回補|做多|做空|賣壓|買點/)).toBeNull();
  });
});

// 單檔篩選(change-spec SC-2/3/5):mock 含同股 2 筆(R1 — 防「只回首筆」
// 的錯誤 filter 假綠),assert 選定後 row 數 = 該股筆數且他股為 0。
const MULTI: BorrowFeeData = {
  as_of_date: "2026-06-26",
  rows: [
    {
      market: "twse", stock_id: "8046", name: "南電",
      lending_shares: 3000, fee_rate: 3.5, date: "2026-06-26",
    },
    {
      market: "twse", stock_id: "8046", name: "南電",
      lending_shares: 5000, fee_rate: 2.0, date: "2026-06-26",
    },
    {
      market: "twse", stock_id: "2434", name: "統懋",
      lending_shares: 21000, fee_rate: 2.619, date: "2026-06-26",
    },
  ],
  month_counts: { "8046": 2, "2434": 1 },
};

const pickStock = (query: string) => {
  const input = screen.getByTestId("borrow-fee-stock-filter");
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(screen.getByRole("option"));
  return input;
};

describe("BorrowFeePage 單檔篩選", () => {
  it("選定標的後只顯示該檔當日全部筆數(同股多筆全列)", () => {
    hookState.data = MULTI;
    render(<BorrowFeePage />);
    expect(screen.getAllByTestId("fee-row").length).toBe(3);
    pickStock("8046");
    const rows = screen.getAllByTestId("fee-row");
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.getAttribute("data-stock-id") === "8046")).toBe(true);
  });

  it("清除鈕回全表", () => {
    hookState.data = MULTI;
    render(<BorrowFeePage />);
    pickStock("8046");
    fireEvent.click(screen.getByTestId("stock-filter-clear"));
    expect(screen.getAllByTestId("fee-row").length).toBe(3);
  });

  it("選定態下編輯輸入即回全表(R3)", () => {
    hookState.data = MULTI;
    render(<BorrowFeePage />);
    const input = pickStock("8046");
    fireEvent.change(input, { target: { value: "24" } });
    expect(screen.getAllByTestId("fee-row").length).toBe(3);
  });

  it("filter 態 0 rows 顯示「該檔今日無券差資料」(SC-5:refresh 後標的消失)", () => {
    hookState.data = MULTI;
    const { rerender } = render(<BorrowFeePage />);
    pickStock("8046");
    hookState.data = {
      ...MULTI,
      rows: MULTI.rows.filter((r) => r.stock_id !== "8046"),
    };
    rerender(<BorrowFeePage />);
    expect(screen.getByText("該檔今日無券差資料")).toBeTruthy();
    expect(screen.getByTestId("stock-filter-clear")).toBeTruthy();
  });

  it("data null 時不渲染篩選器(R2)", () => {
    hookState.data = null;
    render(<BorrowFeePage />);
    expect(screen.queryByTestId("borrow-fee-stock-filter")).toBeNull();
  });
});
