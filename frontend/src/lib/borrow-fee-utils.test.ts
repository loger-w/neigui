import { describe, expect, it } from "vitest";
import { FEE_HIGHLIGHT_THRESHOLD, type BorrowFeeRow } from "./borrow-fee";
import {
  aggregateDayStats,
  distinctStocks,
  formatFee,
  formatLots,
  formatShares,
  matchStockOptions,
  sortRows,
  type StockOption,
} from "./borrow-fee-utils";

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

describe("distinctStocks", () => {
  it("同股多筆去重取首見 name/market,代號升冪", () => {
    const rows = [
      row("8046", 3000, 3.5),
      row("2434", 21000, 2.619),
      row("8046", 5000, 2.0),
    ];
    expect(distinctStocks(rows)).toEqual([
      { stock_id: "2434", name: "n2434", market: "twse" },
      { stock_id: "8046", name: "n8046", market: "twse" },
    ]);
  });

  it("空 rows 回空陣列", () => {
    expect(distinctStocks([])).toEqual([]);
  });
});

describe("matchStockOptions", () => {
  const options: StockOption[] = [
    { stock_id: "2434", name: "統懋", market: "twse" },
    { stock_id: "5483", name: "中美晶", market: "tpex" },
    { stock_id: "8046", name: "南電", market: "twse" },
  ];

  it("空 query 回全部候選(不沿用 SymbolSearch 20 筆 cap;change-spec R4)", () => {
    expect(matchStockOptions(options, "")).toEqual(options);
    expect(matchStockOptions(options, "  ")).toEqual(options);
  });

  it("代號 prefix 匹配", () => {
    expect(matchStockOptions(options, "80").map((o) => o.stock_id)).toEqual(["8046"]);
    expect(matchStockOptions(options, "046")).toEqual([]);
  });

  it("名稱 substring 匹配", () => {
    expect(matchStockOptions(options, "中美").map((o) => o.stock_id)).toEqual(["5483"]);
  });

  it("無匹配回空陣列", () => {
    expect(matchStockOptions(options, "9999")).toEqual([]);
  });
});

describe("FEE_HIGHLIGHT_THRESHOLD", () => {
  it("與 backend services/daytrade_fee.py 同名常數鎖同值(test_fee_highlight_threshold_value)", () => {
    expect(FEE_HIGHLIGHT_THRESHOLD).toBe(3.5);
  });
});

// mod/borrow-fee-layout SC-1/2:當日 per-stock 統計(免搜尋常駐右表的資料層)。
describe("aggregateDayStats", () => {
  it("同股多筆加總、name 取首見、total desc 排序", () => {
    // 第二筆刻意用不同 name — 鎖「取首見」而非「最後一筆覆蓋」(review TC-1)
    const rows = [
      row("8046", 3000, 3.5),
      row("2434", 21000, 2.619),
      { ...row("8046", 5000, 2.0), name: "南電(舊)" },
    ];
    expect(aggregateDayStats(rows)).toEqual([
      { stock_id: "2434", name: "n2434", total_shares: 21000 },
      { stock_id: "8046", name: "n8046", total_shares: 8000 },
    ]);
  });

  it("同 total tie-break 代號升冪(SC-2)", () => {
    const rows = [row("8046", 3000, 3.5), row("5483", 3000, 3.5), row("8069", 25000, 1.0)];
    expect(aggregateDayStats(rows).map((s) => s.stock_id)).toEqual([
      "8069",
      "5483",
      "8046",
    ]);
  });

  it("空陣列回空", () => {
    expect(aggregateDayStats([])).toEqual([]);
  });
});

describe("formatLots", () => {
  it("整千顯整數、非整千四捨五入 1 位小數、千分位(change-spec R5 測試對)", () => {
    expect(formatLots(3000)).toBe("3");
    expect(formatLots(25000)).toBe("25");
    expect(formatLots(1234)).toBe("1.2");
    expect(formatLots(1900)).toBe("1.9");
    expect(formatLots(2500000)).toBe("2,500");
  });

  it("邊界組合:千分位+小數並存、不足一張、捨入 tie(review TC-2)", () => {
    expect(formatLots(1234567)).toBe("1,234.6");
    expect(formatLots(500)).toBe("0.5");
    expect(formatLots(1250)).toBe("1.3"); // halfExpand:1.25 → 1.3
  });
});
