/**
 * @vitest-environment jsdom
 *
 * 券差表:排序互動 / 高費率標色 / 方向性文案禁令(SC-2/3/5)。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BorrowFeeRow } from "../lib/borrow-fee";
import { DaytradeFeeTable } from "./DaytradeFeeTable";

afterEach(() => cleanup());

const row = (
  sid: string, shares: number, fee: number, market: "twse" | "tpex" = "twse",
): BorrowFeeRow => ({
  market,
  stock_id: sid,
  name: `名${sid}`,
  lending_shares: shares,
  fee_rate: fee,
  date: "2026-06-26",
});

const ROWS = [
  row("8046", 3000, 3.5),
  row("2434", 21000, 2.619),
  row("8069", 25000, 1.0, "tpex"),
];
const COUNTS = { "8046": 2, "2434": 1, "8069": 3 };

function rowIds(): string[] {
  return screen.getAllByTestId("fee-row").map((tr) => tr.getAttribute("data-stock-id") ?? "");
}

describe("DaytradeFeeTable", () => {
  it("預設費率降序 + 格式化(千分位/兩位小數%)", () => {
    render(<DaytradeFeeTable rows={ROWS} monthCounts={COUNTS} />);
    expect(rowIds()).toEqual(["8046", "2434", "8069"]);
    expect(screen.getByText("25,000")).toBeTruthy();
    expect(screen.getByText("3.50%")).toBeTruthy();
    expect(screen.getByText("2.62%")).toBeTruthy();
  });

  it("點欄位標題切排序:首點 desc、再點 asc,aria-sort 跟著動", () => {
    render(<DaytradeFeeTable rows={ROWS} monthCounts={COUNTS} />);
    const sharesBtn = screen.getByRole("button", { name: "借券股數" });
    fireEvent.click(sharesBtn);
    expect(rowIds()).toEqual(["8069", "2434", "8046"]);
    fireEvent.click(sharesBtn);
    expect(rowIds()).toEqual(["8046", "2434", "8069"]);
    const th = sharesBtn.closest("th");
    expect(th?.getAttribute("aria-sort")).toBe("ascending");
  });

  it("本月次數欄用 monthCounts 合成並可排序", () => {
    render(<DaytradeFeeTable rows={ROWS} monthCounts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: "本月次數" }));
    expect(rowIds()).toEqual(["8069", "8046", "2434"]);
  });

  it("費率 ≥ 3.5% 的費率 cell 帶 fee-high testid,其餘沒有", () => {
    render(<DaytradeFeeTable rows={ROWS} monthCounts={COUNTS} />);
    const high = screen.getAllByTestId("fee-high");
    expect(high.length).toBe(1);
    expect(high[0]!.closest("tr")?.getAttribute("data-stock-id")).toBe("8046");
  });

  it("市場欄顯示上市/上櫃 badge", () => {
    render(<DaytradeFeeTable rows={ROWS} monthCounts={COUNTS} />);
    expect(screen.getAllByText("上市").length).toBe(2);
    expect(screen.getAllByText("上櫃").length).toBe(1);
  });

  it("無任何方向性文案(SC-3 契約)", () => {
    render(<DaytradeFeeTable rows={ROWS} monthCounts={COUNTS} />);
    expect(screen.queryByText(/軋空|回補|做多|做空|賣壓|買點/)).toBeNull();
  });
});
