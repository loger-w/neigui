/**
 * @vitest-environment jsdom
 *
 * WarrantSelector — 權證選擇器 tab(SC-2/4/5/6/7)。
 * Mock 走 vi.spyOn(api),不 mock hooks(frontend-testing 慣例)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../lib/api";
import type {
  WarrantQuote, WarrantQuotesPayload, WarrantTerm, WarrantsPayload,
} from "../lib/warrant-data";
import { WarrantSelector } from "./WarrantSelector";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

function term(over: Partial<WarrantTerm> = {}): WarrantTerm {
  return {
    warrant_id: "030012",
    name: "台積凱基57購01",
    kind: "call",
    market: "twse",
    underlying_id: "2330",
    underlying_name: "台積電",
    strike: 950,
    exercise_ratio: 0.1,
    last_trading_date: "2026-07-28",
    maturity_date: "2026-07-30",
    is_reset: false,
    eod_close: 1.0,
    eod_bid: 0.99,
    eod_ask: 1.01,
    underlying_eod_close: 1000,
    iv_prev: 0.3,
    ...over,
  };
}

function quote(over: Partial<WarrantQuote> = {}): WarrantQuote {
  return {
    price: 1.3,
    best_bid: 1.29,
    best_ask: 1.31,
    best_bid_vol: 50,
    best_ask_vol: 124,
    moneyness: 0.05,
    days_left: 18,
    iv: 0.31,
    delta: 0.6,
    leverage: 4.6,
    spread_ratio: 0.0155,
    spread_lev_ratio: 0.0034,
    theo_price: 1.25,
    mispricing_pct: 0.04,
    mispricing_label: "fair",
    iv_percentile: 40,
    quote_time: "13:30",
    ...over,
  };
}

function mockApis(
  terms: WarrantTerm[],
  quotes: Record<string, WarrantQuote>,
): void {
  const wp: WarrantsPayload = { as_of_date: "2026-07-09", warrants: terms };
  const qp: WarrantQuotesPayload = {
    stock_id: "2330",
    underlying_price: 1000,
    quote_date: "2026-07-10",
    quote_time: "13:30",
    quotes,
  };
  vi.spyOn(api, "warrants").mockResolvedValue(wp);
  vi.spyOn(api, "warrantQuotes").mockResolvedValue(qp);
  vi.spyOn(api, "warrantBrokers").mockResolvedValue({
    data_date: "2026-07-09",
    rows: [{ broker_name: "凱基-台北", buy: 900, sell: 100, net: 800 }],
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

const THREE = [
  term(),
  term({ warrant_id: "030013", name: "台積元大58購02" }),
  term({ warrant_id: "03001P", name: "台積富邦57售01", kind: "put" }),
];
const THREE_QUOTES: Record<string, WarrantQuote> = {
  "030012": quote({ spread_lev_ratio: 0.005 }),
  "030013": quote({ spread_lev_ratio: 0.001 }),
  "03001P": quote({ spread_lev_ratio: null, mispricing_label: "expensive" }),
};

describe("WarrantSelector", () => {
  it("表格欄 header 齊全(SC-2)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    // 排序中欄位 header 帶 ↑/↓ 尾綴 → 比對前剝掉;/IV/ 寬 regex 會撞 IV百分位
    // (frontend-testing:selector 過鬆就收斂,不用 portal hack)
    const headerTexts = screen
      .getAllByRole("columnheader")
      .map((th) => (th.textContent ?? "").replace(/ [↑↓]$/, ""));
    for (const h of [
      "代號", "名稱", "類型", "市場", "履約價", "價內外", "剩餘天數", "行使比例",
      "現價", "買價/量", "賣價/量", "IV", "理論價", "估價差", "IV百分位",
      "實質槓桿", "價差比", "差槓比",
    ]) {
      expect(headerTexts).toContain(h);
    }
  });

  it("預設差槓比升序,null 沉底(SC-2)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const ids = screen
      .getAllByTestId("warrant-row")
      .map((r) => r.getAttribute("data-warrant-id"));
    expect(ids).toEqual(["030013", "030012", "03001P"]);
  });

  it("認售 toggle 篩選(SC-4)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "認售" }));
    const rows = screen.getAllByTestId("warrant-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-warrant-id")).toBe("03001P");
  });

  it("kind badge 用 data-testid 正向鎖(SC-5)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    const badges = screen.getAllByTestId("warrant-kind-badge");
    expect(badges).toHaveLength(3);
    expect(badges.map((b) => b.textContent)).toEqual(["認購", "認購", "認售"]);
    const labels = screen.getAllByTestId("mispricing-label");
    expect(labels.map((l) => l.textContent)).toContain("合理");
    expect(labels.map((l) => l.textContent)).toContain("偏貴");
  });

  it("嚴禁方向性文案(SC-5)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    expect(screen.queryByText(/做多|做空|買進|賣出|建議|滿倉|賣選/)).toBeNull();
  });

  it("row 展開 lazy 抓分點 + 資料日標註(SC-6)", async () => {
    mockApis(THREE, THREE_QUOTES);
    const brokerSpy = vi.spyOn(api, "warrantBrokers");
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    expect(brokerSpy).not.toHaveBeenCalled(); // 未展開不抓
    const expanders = screen.getAllByRole("button", { name: /展開分點/ });
    fireEvent.click(expanders[0]!);
    await waitFor(() => expect(screen.getByText("凱基-台北")).toBeTruthy());
    expect(brokerSpy).toHaveBeenCalledTimes(1);
    expect(brokerSpy.mock.calls[0]?.[0]).toBe("030013"); // 排序後首列
    expect(screen.getByText(/資料日 = 2026-07-09/)).toBeTruthy();
  });

  it("無權證空狀態(SC-7)", async () => {
    mockApis([], {});
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() =>
      expect(screen.getByText("此標的無掛牌權證")).toBeTruthy(),
    );
  });

  it("未選標的顯示提示,不打 API", () => {
    const spy = vi.spyOn(api, "warrants").mockResolvedValue({
      as_of_date: null,
      warrants: [],
    });
    render(<WarrantSelector symbol="" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    expect(screen.getByText(/先搜尋標的/)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it("快照基準日與最後更新顯示(SC-3 顯示面)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText(/最後更新 13:30/)).toBeTruthy());
    expect(screen.getByText(/快照基準日 2026-07-09/)).toBeTruthy();
  });

  it("重整鈕只刷 quotes 層(design R11)", async () => {
    mockApis(THREE, THREE_QUOTES);
    const wSpy = vi.spyOn(api, "warrants");
    const qSpy = vi.spyOn(api, "warrantQuotes");
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    // 等 data settle(isFetching 中重整鈕 disabled,click 會 no-op)
    await waitFor(() => expect(screen.getByText(/最後更新 13:30/)).toBeTruthy());
    expect(qSpy).toHaveBeenCalledTimes(1);
    const wCalls = wSpy.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重新整理權證報價" }));
    await waitFor(() => expect(qSpy).toHaveBeenCalledTimes(2));
    expect(qSpy.mock.calls[1]?.[1]).toBe(true); // refresh=true 跳 cooldown
    expect(wSpy.mock.calls.length).toBe(wCalls); // 快照層不重抓
  });

  it("展開列的分點表滾動內容在 row 下方(within 收斂 scope)", async () => {
    mockApis(THREE, THREE_QUOTES);
    render(<WarrantSelector symbol="2330" active={true} />, {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(screen.getByText("台積凱基57購01")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /展開分點/ })[0]!);
    await waitFor(() => {
      const detail = screen.getByTestId("warrant-brokers-detail");
      expect(within(detail).getByText("凱基-台北")).toBeTruthy();
      expect(within(detail).getByText("800")).toBeTruthy();
    });
  });
});
