/**
 * @vitest-environment jsdom
 *
 * WarrantFlowPanel — SC-1 進度文案 / SC-2 summary / SC-3 top15+展開 /
 * SC-4 明細排序 / SC-5 色彩紀律 / SC-6 truncated 插值 / SC-7 空狀態兩文案。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  WarrantFlowBranch,
  WarrantFlowPayload,
} from "../lib/warrant-flow-data";
import WarrantFlowPanel from "./WarrantFlowPanel";

const flowState: {
  data: WarrantFlowPayload | null;
  loading: boolean;
  error: string | null;
} = { data: null, loading: false, error: null };

// jsdom 無 ResizeObserver;疊直/並排的 regression 由 e2e 視覺面把關,
// 此處 mock 固定寬度走並排分支(其他 component test 同慣例)
vi.mock("../hooks/useContainerSize", () => ({
  useContainerSize: () => ({ width: 800, height: 600 }),
}));

vi.mock("../hooks/useWarrantFlow", () => ({
  useWarrantFlow: () => ({
    data: flowState.data,
    loading: flowState.loading,
    error: flowState.error,
    noTradingDay: false,
    refresh: vi.fn(),
  }),
}));

const branch = (over?: Partial<WarrantFlowBranch>): WarrantFlowBranch => ({
  broker_id: "9200",
  broker_name: "凱基-台北",
  buy_value: 40_800_000,
  sell_value: 1_200_000,
  net_value: 39_600_000,
  warrants: [
    {
      warrant_id: "030011",
      name: "台積凱基61購01",
      kind: "call",
      buy_value: 30_000_000,
      sell_value: 0,
      net_value: 30_000_000,
    },
    {
      warrant_id: "030012",
      name: "台積元大61購02",
      kind: "call",
      buy_value: 10_800_000,
      sell_value: 1_200_000,
      net_value: 9_600_000,
    },
  ],
  ...over,
});

const mk = (over?: Partial<WarrantFlowPayload>): WarrantFlowPayload => ({
  as_of_date: "2026-07-13",
  truncated: false,
  total_traded: 3,
  analyzed: 3,
  unmapped_count: 1,
  empty_reason: null,
  summary: {
    call: { buy_value: 50_460_000, sell_value: 30_030_000 },
    put: { buy_value: 4_000_000, sell_value: 1_000_000 },
  },
  top_buy_branches: [branch()],
  top_sell_branches: [
    branch({
      broker_id: "9800",
      broker_name: "元大-總公司",
      buy_value: 1_440_000,
      sell_value: 22_680_000,
      net_value: -21_240_000,
      warrants: [
        {
          warrant_id: "030011",
          name: "台積凱基61購01",
          kind: "call",
          buy_value: 0,
          sell_value: 14_000_000,
          net_value: -14_000_000,
        },
      ],
    }),
  ],
  warrants: [
    { warrant_id: "030011", name: "台積凱基61購01", kind: "call",
      trading_money: 50_000_000, net_value: 16_950_000 },
    { warrant_id: "030012", name: "台積元大61購02", kind: "call",
      trading_money: 30_000_000, net_value: 3_480_000 },
    { warrant_id: "03001P", name: "台積國泰61售01", kind: "put",
      trading_money: 12_000_000, net_value: -3_000_000 },
  ],
  ...over,
});

beforeEach(() => {
  flowState.data = null;
  flowState.loading = false;
  flowState.error = null;
});
afterEach(() => cleanup());

const renderPanel = () => render(<WarrantFlowPanel symbol="2330" active={true} />);

describe("WarrantFlowPanel", () => {
  it("SC-1:loading 且無 data → 繁中進度文案", () => {
    flowState.loading = true;
    renderPanel();
    expect(screen.getByText(/彙整分點資料中/)).toBeTruthy();
  });

  it("SC-2:資料日 badge + 認購/認售買賣四數字", () => {
    flowState.data = mk();
    renderPanel();
    const badge = screen.getByTestId("flow-date-badge");
    expect(badge.textContent).toContain("資料日 07-13");
    const summary = screen.getByTestId("flow-summary");
    expect(summary.textContent).toContain("認購");
    expect(summary.textContent).toContain("認售");
    expect(summary.textContent).toContain("5,046 萬"); // call buy
    expect(summary.textContent).toContain("3,003 萬"); // call sell
    expect(summary.textContent).toContain("400 萬"); // put buy
    expect(summary.textContent).toContain("100 萬"); // put sell
  });

  it("SC-3:買賣超兩欄 + 點分點展開權證明細(零 API)", () => {
    flowState.data = mk();
    renderPanel();
    const buyCol = screen.getByTestId("flow-buy-col");
    expect(within(buyCol).getByText("凱基-台北")).toBeTruthy();
    expect(within(buyCol).getByText("3,960 萬")).toBeTruthy();
    const sellCol = screen.getByTestId("flow-sell-col");
    expect(within(sellCol).getByText("元大-總公司")).toBeTruthy();
    // 展開前明細不在
    expect(within(buyCol).queryByText("台積凱基61購01")).toBeNull();
    fireEvent.click(within(buyCol).getByRole("button", { name: /展開 凱基-台北/ }));
    expect(within(buyCol).getByText("台積凱基61購01")).toBeTruthy();
    expect(within(buyCol).getByText("台積元大61購02")).toBeTruthy();
    // 再點收合
    fireEvent.click(within(buyCol).getByRole("button", { name: /收合 凱基-台北/ }));
    expect(within(buyCol).queryByText("台積凱基61購01")).toBeNull();
  });

  it("SC-4:權證明細表成交金額降序 + 欄位齊全", () => {
    flowState.data = mk();
    renderPanel();
    const table = screen.getByTestId("flow-warrant-table");
    for (const h of ["代號", "名稱", "類型", "成交金額", "淨買賣超"]) {
      expect(within(table).getByText(h)).toBeTruthy();
    }
    const ids = within(table)
      .getAllByTestId("flow-warrant-row")
      .map((tr) => tr.getAttribute("data-warrant-id"));
    expect(ids).toEqual(["030011", "030012", "03001P"]);
  });

  it("SC-5:淨買超 bull / 淨賣超 bear;類型 badge 零紅綠;無方向性文案", () => {
    flowState.data = mk();
    renderPanel();
    // 正向 assertion:色彩 binding 鎖 data-testid
    const buyAmounts = screen.getAllByTestId("flow-buy-amount");
    expect(buyAmounts.length).toBeGreaterThan(0);
    for (const el of buyAmounts) expect(el.className).toMatch(/bull/);
    const sellAmounts = screen.getAllByTestId("flow-sell-amount");
    for (const el of sellAmounts) expect(el.className).toMatch(/bear/);
    // 明細表淨值色
    const nets = screen.getAllByTestId("flow-warrant-net");
    expect(nets[0]!.className).toMatch(/bull/); // +16,950,000
    expect(nets[2]!.className).toMatch(/bear/); // -3,000,000
    // 認購/認售 badge 不用紅綠(accent==bull 同色值也禁)
    for (const el of screen.getAllByTestId("flow-kind-badge")) {
      expect(el.className).not.toMatch(/accent|bull|bear/);
    }
    expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull();
  });

  it("SC-6:truncated 註記由 analyzed 插值", () => {
    flowState.data = mk({ truncated: true, total_traded: 477, analyzed: 200 });
    renderPanel();
    expect(screen.getByText(/僅統計成交金額前 200 檔權證/)).toBeTruthy();
  });

  it("SC-6:未 truncated 不顯示註記", () => {
    flowState.data = mk();
    renderPanel();
    expect(screen.queryByText(/僅統計成交金額前/)).toBeNull();
  });

  it("SC-7A:無掛牌權證文案,且不 render 資料日 badge", () => {
    flowState.data = mk({
      empty_reason: "no_warrants",
      as_of_date: null,
      top_buy_branches: [],
      top_sell_branches: [],
      warrants: [],
    });
    renderPanel();
    expect(screen.getByText("此標的目前無掛牌權證")).toBeTruthy();
    expect(screen.queryByTestId("flow-date-badge")).toBeNull();
  });

  it("SC-7B:零成交文案帶資料日", () => {
    flowState.data = mk({
      empty_reason: "no_volume",
      top_buy_branches: [],
      top_sell_branches: [],
      warrants: [],
    });
    renderPanel();
    expect(screen.getByText(/資料日 07-13 全部權證零成交/)).toBeTruthy();
  });

  it("no_data error → 專屬繁中文案(R8)", () => {
    flowState.error = "no_data";
    renderPanel();
    expect(screen.getByText("近 10 個交易日無分點資料")).toBeTruthy();
  });

  it("symbol 空 → 引導文案", () => {
    render(<WarrantFlowPanel symbol="" active={true} />);
    expect(screen.getByText(/請先搜尋標的/)).toBeTruthy();
  });
});
