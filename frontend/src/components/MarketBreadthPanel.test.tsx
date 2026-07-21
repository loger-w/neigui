/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketBreadthPanel } from "./MarketBreadthPanel";
import type { Breadth, BreadthRow } from "../lib/market-types";

afterEach(() => cleanup());

const row = (over: Partial<BreadthRow>): BreadthRow => ({
  stock_id: "2330",
  name: "台積電",
  market: "twse",
  change_rate: 1.0,
  volume_ratio: 1.2,
  total_amount: 1e9,
  limit_up: false,
  limit_down: false,
  ...over,
});

const breadth: Breadth = {
  twse: { limit_up: 1, up: 2, flat: 1, down: 1, limit_down: 0 },
  tpex: { limit_up: 0, up: 0, flat: 0, down: 1, limit_down: 1 },
  rows: [
    row({ stock_id: "2603", name: "長榮", change_rate: 10.0, limit_up: true }),
    row({}),
    row({ stock_id: "6001", name: "櫃股", market: "tpex", change_rate: -10.0, limit_down: true }),
  ],
};

describe("MarketBreadthPanel — MK-5 漲跌家數", () => {
  // 痛點:MK-5 — 上市/上櫃分欄家數;visibility-only 會被空殼蓋住,鎖數字。
  it("上市/上櫃分欄顯示 漲停/上漲/平盤/下跌/跌停 家數", () => {
    render(<MarketBreadthPanel data={breadth} loading={false} onSymbolPick={() => {}} />);
    const twse = screen.getByTestId("breadth-twse");
    expect(twse.textContent).toContain("上市");
    expect(twse.textContent).toContain("漲停 1");
    expect(twse.textContent).toContain("上漲 2");
    expect(twse.textContent).toContain("平盤 1");
    expect(twse.textContent).toContain("下跌 1");
    expect(twse.textContent).toContain("跌停 0");
    const tpex = screen.getByTestId("breadth-tpex");
    expect(tpex.textContent).toContain("上櫃");
    expect(tpex.textContent).toContain("跌停 1");
  });

  // 痛點:MK-5 — 點漲停 bucket 展開該市場清單,點個股跳 equity。
  it("點漲停 bucket → 展開該市場漲停清單,點個股觸發 onSymbolPick", () => {
    const pick = vi.fn();
    render(<MarketBreadthPanel data={breadth} loading={false} onSymbolPick={pick} />);
    expect(screen.queryByTestId("breadth-list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "上市漲停清單" }));
    const list = screen.getByTestId("breadth-list");
    expect(list.textContent).toContain("長榮");
    expect(list.textContent).toContain("+10.00%");
    expect(list.textContent).not.toContain("櫃股"); // tpex 跌停不混入
    fireEvent.click(screen.getByTestId("breadth-stock-2603"));
    expect(pick).toHaveBeenCalledWith("2603");
    // 再點 bucket 收合
    fireEvent.click(screen.getByRole("button", { name: "上市漲停清單" }));
    expect(screen.queryByTestId("breadth-list")).toBeNull();
  });

  it("上櫃跌停清單獨立展開", () => {
    render(<MarketBreadthPanel data={breadth} loading={false} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "上櫃跌停清單" }));
    expect(screen.getByTestId("breadth-list").textContent).toContain("櫃股");
  });

  it("data=null → 資料暫缺;loading → skeleton", () => {
    const { unmount } = render(
      <MarketBreadthPanel data={null} loading={false} onSymbolPick={() => {}} />,
    );
    expect(screen.getByTestId("market-breadth").textContent).toContain("資料暫缺");
    unmount();
    render(<MarketBreadthPanel data={null} loading={true} onSymbolPick={() => {}} />);
    expect(
      screen.getByTestId("market-breadth").querySelector('[data-state="loading"]'),
    ).toBeTruthy();
  });
});
