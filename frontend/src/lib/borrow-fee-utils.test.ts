import { describe, expect, it } from "vitest";
import { FEE_HIGHLIGHT_THRESHOLD, type BorrowFeeRow } from "./borrow-fee";
import { formatFee, formatShares, sortRows } from "./borrow-fee-utils";

const row = (sid: string, shares: number, fee: number): BorrowFeeRow => ({
  market: "twse",
  stock_id: sid,
  name: `n${sid}`,
  lending_shares: shares,
  fee_rate: fee,
  date: "2026-06-26",
});

const counts = { "8046": 2, "2434": 1, "8069": 3 };

describe("sortRows", () => {
  const rows = [row("2434", 21000, 2.619), row("8046", 3000, 3.5), row("8069", 25000, 1.0)];

  it("fee_rate desc / asc", () => {
    expect(sortRows(rows, "fee_rate", "desc", counts).map((r) => r.stock_id))
      .toEqual(["8046", "2434", "8069"]);
    expect(sortRows(rows, "fee_rate", "asc", counts).map((r) => r.stock_id))
      .toEqual(["8069", "2434", "8046"]);
  });

  it("lending_shares desc", () => {
    expect(sortRows(rows, "lending_shares", "desc", counts).map((r) => r.stock_id))
      .toEqual(["8069", "2434", "8046"]);
  });

  it("month_count 用外部 map 排序", () => {
    expect(sortRows(rows, "month_count", "desc", counts).map((r) => r.stock_id))
      .toEqual(["8069", "8046", "2434"]);
  });

  it("stock_id asc 為字串序;tie-break 用 stock_id asc", () => {
    const tied = [row("8069", 1000, 1.0), row("2434", 1000, 1.0)];
    expect(sortRows(tied, "fee_rate", "desc", counts).map((r) => r.stock_id))
      .toEqual(["2434", "8069"]);
    expect(sortRows(rows, "stock_id", "asc", counts).map((r) => r.stock_id))
      .toEqual(["2434", "8046", "8069"]);
  });

  it("不改動原陣列", () => {
    const before = rows.map((r) => r.stock_id);
    sortRows(rows, "fee_rate", "asc", counts);
    expect(rows.map((r) => r.stock_id)).toEqual(before);
  });
});

describe("format", () => {
  it("formatShares 千分位", () => {
    expect(formatShares(25000)).toBe("25,000");
    expect(formatShares(1000)).toBe("1,000");
  });

  it("formatFee 兩位小數 + %", () => {
    expect(formatFee(3.5)).toBe("3.50%");
    expect(formatFee(0.717)).toBe("0.72%");
    expect(formatFee(7)).toBe("7.00%");
  });
});

describe("FEE_HIGHLIGHT_THRESHOLD", () => {
  it("與 backend services/daytrade_fee.py 同名常數鎖同值(test_fee_highlight_threshold_value)", () => {
    expect(FEE_HIGHLIGHT_THRESHOLD).toBe(3.5);
  });
});
