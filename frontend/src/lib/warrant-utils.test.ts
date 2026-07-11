/**
 * warrant-utils 純函式測試(warrant-selector SC-3/SC-4)。
 */
import { describe, expect, it } from "vitest";
import type { WarrantRow } from "./warrant-data";
import {
  DEFAULT_FILTERS,
  QUOTES_REFETCH_MS,
  filterWarrants,
  isMarketOpen,
  mergeWarrantRows,
  quotesRefetchInterval,
  sortWarrants,
} from "./warrant-utils";

function row(over: Partial<WarrantRow> = {}): WarrantRow {
  return {
    warrant_id: "030012",
    name: "測試",
    kind: "call",
    market: "twse",
    underlying_id: "2330",
    underlying_name: "台積電",
    strike: 95,
    exercise_ratio: 0.1,
    last_trading_date: "2026-07-28",
    maturity_date: "2026-07-30",
    is_reset: false,
    eod_close: 1,
    eod_bid: 0.99,
    eod_ask: 1.01,
    underlying_eod_close: 100,
    iv_prev: 0.3,
    iv_drift: null,
    price: 1.3,
    days_left: 18,
    best_bid_vol: 50,
    moneyness: 0.05,
    mispricing_pct: 0.02,
    iv_percentile: 40,
    spread_lev_ratio: 0.005,
    ...over,
  };
}

describe("filterWarrants", () => {
  it("預設 filters 不剔除任何列(含 null 欄位列)", () => {
    const rows = [row(), row({ warrant_id: "030013", mispricing_pct: null })];
    expect(filterWarrants(rows, DEFAULT_FILTERS)).toHaveLength(2);
  });

  it("kind toggle 只留認售", () => {
    const rows = [row(), row({ warrant_id: "03001P", kind: "put" })];
    const out = filterWarrants(rows, { ...DEFAULT_FILTERS, kind: "put" });
    expect(out.map((r) => r.warrant_id)).toEqual(["03001P"]);
  });

  it("剩餘天數下限(啟用時 undefined 剔除)", () => {
    const rows = [
      row({ days_left: 5 }),
      row({ warrant_id: "030013", days_left: 60 }),
      row({ warrant_id: "030014", days_left: undefined }),
    ];
    const out = filterWarrants(rows, { ...DEFAULT_FILTERS, minDaysLeft: 30 });
    expect(out.map((r) => r.warrant_id)).toEqual(["030013"]);
  });

  it("價內外範圍", () => {
    const rows = [
      row({ moneyness: -0.3 }),
      row({ warrant_id: "030013", moneyness: 0.02 }),
    ];
    const out = filterWarrants(rows, {
      ...DEFAULT_FILTERS,
      moneynessMin: -0.1,
      moneynessMax: 0.1,
    });
    expect(out.map((r) => r.warrant_id)).toEqual(["030013"]);
  });

  it("委買量 > 0 開關", () => {
    const rows = [
      row({ best_bid_vol: 0 }),
      row({ warrant_id: "030013", best_bid_vol: 5 }),
      row({ warrant_id: "030014", best_bid_vol: null }),
    ];
    const out = filterWarrants(rows, { ...DEFAULT_FILTERS, requireBidVol: true });
    expect(out.map((r) => r.warrant_id)).toEqual(["030013"]);
  });

  it("估價差範圍(null 在啟用時剔除)", () => {
    const rows = [
      row({ mispricing_pct: 0.5 }),
      row({ warrant_id: "030013", mispricing_pct: -0.02 }),
      row({ warrant_id: "030014", mispricing_pct: null }),
    ];
    const out = filterWarrants(rows, {
      ...DEFAULT_FILTERS,
      mispricingMin: -0.1,
      mispricingMax: 0.1,
    });
    expect(out.map((r) => r.warrant_id)).toEqual(["030013"]);
  });

  it("IV 百分位上限", () => {
    const rows = [
      row({ iv_percentile: 90 }),
      row({ warrant_id: "030013", iv_percentile: 20 }),
    ];
    const out = filterWarrants(rows, { ...DEFAULT_FILTERS, ivPctlMax: 50 });
    expect(out.map((r) => r.warrant_id)).toEqual(["030013"]);
  });
});

describe("sortWarrants", () => {
  it("預設鍵差槓比 asc,null 沉底", () => {
    const rows = [
      row({ warrant_id: "A", spread_lev_ratio: 0.02 }),
      row({ warrant_id: "B", spread_lev_ratio: null }),
      row({ warrant_id: "C", spread_lev_ratio: 0.001 }),
    ];
    const asc = sortWarrants(rows, "spread_lev_ratio", "asc");
    expect(asc.map((r) => r.warrant_id)).toEqual(["C", "A", "B"]);
    const desc = sortWarrants(rows, "spread_lev_ratio", "desc");
    expect(desc.map((r) => r.warrant_id)).toEqual(["A", "C", "B"]); // null 仍沉底
  });
});

describe("isMarketOpen(Asia/Taipei;13:35 inclusive — impl-R6)", () => {
  // 2026-07-06 = Monday;台北 = UTC+8
  it.each([
    ["2026-07-06T00:59:00Z", false], // 08:59
    ["2026-07-06T01:00:00Z", true], // 09:00
    ["2026-07-06T05:35:00Z", true], // 13:35 inclusive
    ["2026-07-06T05:36:00Z", false], // 13:36
    ["2026-07-11T03:00:00Z", false], // 週六 11:00
  ])("%s → %s", (iso, expected) => {
    expect(isMarketOpen(new Date(iso))).toBe(expected);
  });
});

describe("quotesRefetchInterval(= useWarrantQuotes 的 refetchInterval 函式)", () => {
  it("盤中 → 15_000;盤外 → false(impl-R8 兩分支)", () => {
    expect(QUOTES_REFETCH_MS).toBe(15_000);
    expect(quotesRefetchInterval(new Date("2026-07-06T02:00:00Z"))).toBe(15_000);
    expect(quotesRefetchInterval(new Date("2026-07-06T06:00:00Z"))).toBe(false);
  });
});

describe("mergeWarrantRows", () => {
  it("by warrant_id 合併,quotes 缺的檔保留 term 欄位", () => {
    const terms = [
      row({ price: undefined, days_left: undefined }),
      { ...row({ price: undefined, days_left: undefined }), warrant_id: "030013" },
    ];
    const merged = mergeWarrantRows(terms, {
      "030012": {
        price: 1.5,
        best_bid: 1.49,
        best_ask: 1.51,
        best_bid_vol: 10,
        best_ask_vol: 20,
        moneyness: 0.05,
        days_left: 18,
        iv: 0.31,
        delta: 0.6,
        leverage: 4.6,
        spread_ratio: 0.013,
        spread_lev_ratio: 0.003,
        theo_price: 1.45,
        mispricing_pct: 0.034,
        mispricing_label: "fair",
        iv_percentile: null,
        quote_time: "13:30",
      },
    });
    expect(merged[0]?.price).toBe(1.5);
    expect(merged[0]?.quote_time).toBe("13:30");
    expect(merged[1]?.price).toBeUndefined();
    expect(merged[1]?.name).toBe("測試");
  });
});
