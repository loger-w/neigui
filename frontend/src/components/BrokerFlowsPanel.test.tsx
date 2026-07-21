/**
 * @vitest-environment jsdom
 *
 * BrokerFlowsPanel — 分點反查 tab(SC-4/5/6):搜尋選分點 → 金額買超/賣超雙表
 * → 點列跳轉回呼。Mock 走 vi.spyOn(api)(frontend-testing;不引 MSW)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "../lib/api";
import type { BrokerFlowsPayload } from "../lib/broker-flows-data";
import { BrokerFlowsPanel } from "./BrokerFlowsPanel";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const HITS = {
  hits: [
    { broker_id: "9600", broker_name: "富邦" },
    { broker_id: "9604", broker_name: "富邦-陽明" },
  ],
  total: 2,
};

const mk = (over?: Partial<BrokerFlowsPayload>): BrokerFlowsPayload => ({
  broker_id: "9600",
  broker_name: "富邦",
  requested_date: "2026-07-17",
  as_of_date: "2026-07-17",
  no_trading_day: false,
  stock_count: 3,
  fetched_at: "2026-07-17T21:30:00",
  buy_top: [
    { stock_id: "2330", stock_name: "台積電", buy_lots: 500, sell_lots: 100, net_lots: 400, net_amount: 400_500_000 },
    { stock_id: "0050", stock_name: "", buy_lots: 50, sell_lots: 0, net_lots: 50, net_amount: 10_000_000 },
  ],
  sell_top: [
    { stock_id: "2412", stock_name: "中華電", buy_lots: 0, sell_lots: 7777, net_lots: -7777, net_amount: -933_240_000 },
  ],
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

async function pickFubon(payload: BrokerFlowsPayload = mk()) {
  const tradersSpy = vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
  const flowsSpy = vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(payload);
  const onPickStock = vi.fn();
  render(<BrokerFlowsPanel active={true} onPickStock={onPickStock} />, {
    wrapper: makeQueryWrapper(),
  });
  const input = screen.getByLabelText("搜尋分點");
  fireEvent.change(input, { target: { value: "富邦" } });
  // debounce 200ms → dropdown 出現
  const option = await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
  fireEvent.mouseDown(option);
  await waitFor(() => expect(flowsSpy).toHaveBeenCalled());
  // fetch settle → 雙表渲染完才回傳(mutation resolve 是 microtask 之後)
  await screen.findByTestId("broker-flows-buy", undefined, { timeout: 3000 });
  return { onPickStock, flowsSpy, tradersSpy };
}

describe("BrokerFlowsPanel", () => {
  it("未選分點 → 引導文案,不打 flows API", () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue({ hits: [], total: 0 });
    const flowsSpy = vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    expect(screen.getByText(/搜尋分點名稱或代號/)).toBeTruthy();
    expect(flowsSpy).not.toHaveBeenCalled();
  });

  it("選定分點 → 金額買超/賣超雙表渲染(張數 + 金額縮寫)", async () => {
    await pickFubon();
    const buyTable = screen.getByTestId("broker-flows-buy");
    const sellTable = screen.getByTestId("broker-flows-sell");
    expect(within(buyTable).getByText("台積電")).toBeTruthy();
    expect(within(buyTable).getByText("4.01億")).toBeTruthy();
    expect(within(buyTable).getByText("400")).toBeTruthy(); // net_lots
    expect(within(sellTable).getByText("2412")).toBeTruthy();
    expect(within(sellTable).getByText("-9.33億")).toBeTruthy();
  });

  it("stock_name 空 → 顯示代號本身(edge 4)", async () => {
    await pickFubon();
    const buyTable = screen.getByTestId("broker-flows-buy");
    // 0050 name 空:代號 cell 存在且不出現空名破版
    expect(within(buyTable).getAllByText("0050").length).toBeGreaterThan(0);
  });

  it("點買超列 → onPickStock(stock_id, name, broker_id);空名轉 null(R9)", async () => {
    const { onPickStock } = await pickFubon();
    fireEvent.click(within(screen.getByTestId("broker-flows-buy")).getByText("台積電"));
    expect(onPickStock).toHaveBeenCalledWith("2330", "台積電", "9600");
    fireEvent.click(within(screen.getByTestId("broker-flows-buy")).getAllByText("0050")[0]!);
    expect(onPickStock).toHaveBeenCalledWith("0050", null, "9600");
  });

  it("sell_top 空 → 「無賣超」空狀態(edge 1)", async () => {
    await pickFubon(mk({ sell_top: [] }));
    expect(screen.getByText("無賣超")).toBeTruthy();
  });

  it("no_trading_day → 回退標註(SC-6)", async () => {
    await pickFubon(mk({
      no_trading_day: true, requested_date: "2026-07-19", as_of_date: "2026-07-17",
    }));
    expect(screen.getByText(/2026-07-19 尚無資料,顯示 2026-07-17/)).toBeTruthy();
  });

  it("stock_count > 60 → 截斷註記(edge 2)", async () => {
    await pickFubon(mk({ stock_count: 1136 }));
    expect(screen.getByText(/共 1136 檔/)).toBeTruthy();
  });

  it("搜尋無結果 → 「查無符合分點」(review S4)", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue({ hits: [], total: 0 });
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.change(screen.getByLabelText("搜尋分點"), { target: { value: "不存在" } });
    expect(await screen.findByText("查無符合分點", undefined, { timeout: 3000 })).toBeTruthy();
  });

  it("目錄故障 → 搜尋框下方顯示繁中錯誤,不靜默(review C1)", async () => {
    vi.spyOn(api, "brokerTraders").mockRejectedValue(new Error("broker_directory_unavailable"));
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.change(screen.getByLabelText("搜尋分點"), { target: { value: "富邦" } });
    expect(
      await screen.findByText("分點目錄暫時無法取得", undefined, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it("選定後 refocus 搜尋框:不以 echo 字串查詢、不開 dropdown(review V1)", async () => {
    const { tradersSpy } = await pickFubon();
    const input = screen.getByLabelText("搜尋分點");
    fireEvent.focus(input); // query 此時 = 選定 echo「9600 富邦」
    await new Promise((r) => setTimeout(r, 400)); // 過 debounce 窗
    expect(tradersSpy).not.toHaveBeenCalledWith("9600 富邦", expect.anything());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("查無符合分點")).toBeNull();
  });

  it("flows 錯誤碼映射繁中(review P2SUM-2)", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    vi.spyOn(api, "brokerDailyFlows").mockRejectedValue(new Error("broker_not_found"));
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.change(screen.getByLabelText("搜尋分點"), { target: { value: "富邦" } });
    const option = await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    fireEvent.mouseDown(option);
    expect(
      await screen.findByText("找不到該分點", undefined, { timeout: 5000 }),
    ).toBeTruthy();
  });
});
