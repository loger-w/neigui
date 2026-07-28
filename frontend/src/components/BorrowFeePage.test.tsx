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
  month_shares: { "8046": 17000 },
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
  month_shares: { "8046": 17000, "2434": 21000 },
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

// 選股加總 summary(feat/borrow-fee-totals SC-2/3/5)— testid textContent 層級
// 比對(summary 由多個 span 組成,整句 getByText 會 fragmentation 失敗)。
describe("BorrowFeePage 選股加總 summary", () => {
  const WITH_SHARES: BorrowFeeData = MULTI;

  it("選股 → summary 出現:本日合計 = 同日兩筆相加、本月累計 + 次數(千分位)", () => {
    hookState.data = WITH_SHARES;
    render(<BorrowFeePage />);
    expect(screen.queryByTestId("borrow-fee-stock-summary")).toBeNull();
    pickStock("8046");
    const t = screen.getByTestId("borrow-fee-stock-summary").textContent ?? "";
    expect(t).toContain("本日標借合計 8,000 股"); // 3,000 + 5,000(同日兩筆)
    expect(t).toContain("本月累計 17,000 股");
    expect(t).toContain("(2 次)");
  });

  it("清除選股 → summary 消失", () => {
    hookState.data = WITH_SHARES;
    render(<BorrowFeePage />);
    pickStock("8046");
    expect(screen.getByTestId("borrow-fee-stock-summary")).toBeTruthy();
    fireEvent.click(screen.getByTestId("stock-filter-clear"));
    expect(screen.queryByTestId("borrow-fee-stock-summary")).toBeNull();
  });

  it("該檔今日無列(refresh 後消失)→ 本日 0 股、本月累計照顯", () => {
    hookState.data = WITH_SHARES;
    const { rerender } = render(<BorrowFeePage />);
    pickStock("8046");
    hookState.data = {
      ...WITH_SHARES,
      rows: WITH_SHARES.rows.filter((r) => r.stock_id !== "8046"),
    };
    rerender(<BorrowFeePage />);
    const t = screen.getByTestId("borrow-fee-stock-summary").textContent ?? "";
    expect(t).toContain("本日標借合計 0 股");
    expect(t).toContain("本月累計 17,000 股");
  });

  it("month_shares 缺該股 key → 累計顯「—」且無「(N 次)」段(design R1 鎖)", () => {
    hookState.data = {
      ...WITH_SHARES,
      month_shares: { "2434": 21000 },
      month_counts: { "2434": 1 },
    };
    render(<BorrowFeePage />);
    pickStock("8046");
    const t = screen.getByTestId("borrow-fee-stock-summary").textContent ?? "";
    expect(t).toContain("本月累計 —");
    expect(t).not.toContain("— 股"); // 缺值不接「股」字
    expect(t).not.toContain("("); // 次數段整段不 render(?? 1 會捏造次數)
  });

  it("month_shares map 整個缺(版本 skew)→ 不 crash、顯「—」", () => {
    const skew = { ...MULTI };
    delete (skew as Partial<BorrowFeeData>).month_shares; // 模擬舊 backend payload
    hookState.data = skew;
    render(<BorrowFeePage />);
    pickStock("8046");
    const t = screen.getByTestId("borrow-fee-stock-summary").textContent ?? "";
    expect(t).toContain("本日標借合計 8,000 股");
    expect(t).toContain("本月累計 —");
    // Phase 4 review F1:map 整缺但 month_counts(舊欄位)仍在 →「—(2 次)」
    // 是數字與次數矛盾的畫面;累計缺值時次數段必須一併不 render。
    expect(t).not.toContain("(");
  });
});

// 本日借券統計常駐右表(mod/borrow-fee-layout SC-1/3/5)— 免搜尋即見全集
// 統計;單檔篩選只動左明細;空態兩分(全集空 vs 篩選 0 列)。
describe("BorrowFeePage 本日借券統計", () => {
  it("未選股即渲染統計表,列數 = distinct stocks、張數 desc(SC-1)", () => {
    hookState.data = MULTI;
    render(<BorrowFeePage />);
    expect(screen.getByTestId("borrow-day-stats")).toBeTruthy();
    const statRows = screen.getAllByTestId("day-stat-row");
    // 2434 = 21,000 股 > 8046 = 3,000+5,000 = 8,000 股
    expect(statRows.map((r) => r.getAttribute("data-stock-id"))).toEqual([
      "2434",
      "8046",
    ]);
  });

  it("選股後統計表仍為全集列數(SC-3:篩選只動左明細)", () => {
    hookState.data = MULTI;
    render(<BorrowFeePage />);
    pickStock("8046");
    expect(screen.getAllByTestId("fee-row").length).toBe(2);
    expect(screen.getAllByTestId("day-stat-row").length).toBe(2);
  });

  it("data.rows 全集空 → 統計表不 render + 本月無券差資料(SC-5)", () => {
    hookState.data = { ...MULTI, rows: [], month_counts: {}, month_shares: {} };
    render(<BorrowFeePage />);
    expect(screen.queryByTestId("borrow-day-stats")).toBeNull();
    expect(screen.getByText("本月無券差資料")).toBeTruthy();
  });

  it("篩選 0 列但全集非空 → 統計表仍在 + 該檔今日無券差資料(SC-5)", () => {
    hookState.data = MULTI;
    const { rerender } = render(<BorrowFeePage />);
    pickStock("8046");
    hookState.data = {
      ...MULTI,
      rows: MULTI.rows.filter((r) => r.stock_id !== "8046"),
    };
    rerender(<BorrowFeePage />);
    expect(screen.getByText("該檔今日無券差資料")).toBeTruthy();
    expect(screen.getByTestId("borrow-day-stats")).toBeTruthy();
    expect(screen.getAllByTestId("day-stat-row").length).toBe(1);
  });
});
