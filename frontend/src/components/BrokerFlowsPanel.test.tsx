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
afterEach(() => {
  cleanup();
  // SC-8:selected 走 sessionStorage(useSessionState),測試間必清防污染
  sessionStorage.clear();
  // SC-9:常用分點走 localStorage,同樣清
  localStorage.clear();
});

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

  it("total > hits → dropdown 尾端截斷提示(F-2 SC-2)", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue({ hits: HITS.hits, total: 173 });
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.change(screen.getByLabelText("搜尋分點"), { target: { value: "富邦" } });
    // 該變 assertion(a11y 收割):文案同時鏡射進 sr-only status,findByText
    // 全域查會撞雙元素 → 收斂到 listbox 內驗視覺提示列
    await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    expect(
      within(screen.getByRole("listbox")).getByText(
        "共 173 筆,僅列前 2,請輸入更精確關鍵字",
      ),
    ).toBeTruthy();
  });

  // a11y 收割(next-time:/mod trader-search-truncation Phase 5 review P2):
  // combobox 契約補齊 — 截斷資訊原本只有明眼使用者可感(role=presentation
  // 不朗讀),activedescendant 缺口讓 SR 使用者不知鍵盤焦點在哪個選項。
  it("combobox aria 契約:role/expanded/controls + activedescendant 跟隨 ArrowDown", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    const input = screen.getByLabelText("搜尋分點");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    fireEvent.change(input, { target: { value: "富邦" } });
    await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox");
    expect(listbox.id).toBeTruthy();
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    const first = input.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    expect(document.getElementById(first!)?.textContent).toContain("9600 富邦");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const second = input.getAttribute("aria-activedescendant");
    expect(document.getElementById(second!)?.textContent).toContain("9604 富邦陽明");
  });

  it("dropdown 關閉 → aria-expanded false 且無 activedescendant", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    const input = screen.getByLabelText("搜尋分點");
    fireEvent.change(input, { target: { value: "富邦" } });
    await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("截斷提示鏡射進 role=status(aria-live),SR 可感;無截斷時 status 空", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue({ hits: HITS.hits, total: 173 });
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.change(screen.getByLabelText("搜尋分點"), { target: { value: "富邦" } });
    await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("共 173 筆,僅列前 2,請輸入更精確關鍵字");
  });

  it("total == hits → status 區空字串(不產生噪音朗讀)", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.change(screen.getByLabelText("搜尋分點"), { target: { value: "富邦" } });
    await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("total == hits → 無截斷提示(F-2 SC-2)", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.change(screen.getByLabelText("搜尋分點"), { target: { value: "富邦" } });
    await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    expect(screen.queryByText(/僅列前/)).toBeNull();
  });

  it("鍵盤導航不入截斷提示列:ArrowDown 到底 + Enter 選最後一個 hit(review R4)", async () => {
    vi.spyOn(api, "brokerTraders").mockResolvedValue({ hits: HITS.hits, total: 173 });
    const flowsSpy = vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    const input = screen.getByLabelText("搜尋分點");
    fireEvent.change(input, { target: { value: "富邦" } });
    await screen.findByText("9600 富邦", undefined, { timeout: 3000 });
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(flowsSpy).toHaveBeenCalled());
    expect(flowsSpy.mock.calls[0]?.[0]).toBe("9604");
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

  // SC-7(mod/batch-ui-polish):directory 帶 dash 名稱在 dropdown / 選定
  // 徽章 / query 回填 / selectedEcho 全走「id 去dash名」formatter(R6:echo
  // 與 setQuery 格式一致,否則帶 dash 分點選定後 refocus 誤啟搜尋)。
  it("帶 dash 分點:顯示去 dash,選定後 refocus 不誤啟搜尋", async () => {
    const tradersSpy = vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    const input = screen.getByLabelText("搜尋分點") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "富邦" } });
    const option = await screen.findByText("9604 富邦陽明", undefined, { timeout: 3000 });
    fireEvent.mouseDown(option);
    expect(input.value).toBe("9604 富邦陽明");
    tradersSpy.mockClear();
    fireEvent.focus(input);
    await new Promise((r) => setTimeout(r, 400)); // 過 debounce 窗
    expect(tradersSpy).not.toHaveBeenCalledWith("9604 富邦陽明", expect.anything());
    expect(screen.queryByText("查無符合分點")).toBeNull();
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

  // SC-8(mod/batch-ui-polish):mode 切換 unmount(N4 契約)後 remount,
  // 已選分點自 sessionStorage 還原 — 不需重新搜尋。
  it("unmount 後 remount:已選分點與 query echo 保留", async () => {
    const { flowsSpy } = await pickFubon();
    cleanup();
    vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    // 選定徽章直接還原,無需輸入(徽章非搜尋框 → 只顯名稱不帶 id)
    expect(screen.getByText("富邦", { selector: "span" })).toBeTruthy();
    expect((screen.getByLabelText("搜尋分點") as HTMLInputElement).value).toBe(
      "9600 富邦",
    );
    await screen.findByTestId("broker-flows-buy", undefined, { timeout: 3000 });
    expect(flowsSpy).toHaveBeenCalled();
  });

  // SC-9(mod/batch-ui-polish):常用分點 — 選定後星號加入,chips 一鍵帶入,
  // localStorage 持久化(重整 / remount 仍在)。
  it("星號加入常用 → chip 顯示 → remount 後仍在 → 點 chip 一鍵帶入查詢", async () => {
    await pickFubon();
    // 加入常用
    fireEvent.click(screen.getByLabelText("加入常用分點"));
    expect(screen.getByLabelText("移除常用分點")).toBeTruthy();
    const row = screen.getByTestId("saved-brokers-row");
    expect(row.textContent).toContain("富邦");
    expect(row.textContent).not.toContain("9600");
    expect(JSON.parse(localStorage.getItem("neigui.saved-brokers.v1") ?? "[]")).toEqual([
      { id: "9600", name: "富邦" },
    ]);
    cleanup();
    sessionStorage.clear(); // 清 SC-8 selected,模擬全新 session 只剩常用清單

    const flowsSpy = vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    // 精確 accessible name(regex 會同時撈到「自常用移除 …」鈕 — selector 過鬆)
    const chip = within(screen.getByTestId("saved-brokers-row")).getByRole("button", {
      name: "富邦",
    });
    fireEvent.click(chip);
    await waitFor(() => expect(flowsSpy).toHaveBeenCalled());
    expect(flowsSpy.mock.calls[0]?.[0]).toBe("9600");
    expect((screen.getByLabelText("搜尋分點") as HTMLInputElement).value).toBe("9600 富邦");
  });

  it("常用 chip 可移除(× 鈕),清單清空後 row 消失", async () => {
    localStorage.setItem(
      "neigui.saved-brokers.v1",
      JSON.stringify([{ id: "9600", name: "富邦" }]),
    );
    vi.spyOn(api, "brokerTraders").mockResolvedValue(HITS);
    vi.spyOn(api, "brokerDailyFlows").mockResolvedValue(mk());
    render(<BrokerFlowsPanel active={true} onPickStock={vi.fn()} />, {
      wrapper: makeQueryWrapper(),
    });
    fireEvent.click(screen.getByLabelText("自常用移除 富邦"));
    expect(screen.queryByTestId("saved-brokers-row")).toBeNull();
    expect(JSON.parse(localStorage.getItem("neigui.saved-brokers.v1") ?? "[]")).toEqual([]);
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
