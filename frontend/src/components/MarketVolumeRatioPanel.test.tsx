/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketVolumeRatioPanel } from "./MarketVolumeRatioPanel";
import type { BreadthRow } from "../lib/market-types";

afterEach(() => cleanup());

const row = (over: Partial<BreadthRow>): BreadthRow => ({
  stock_id: "2330",
  name: "台積電",
  market: "twse",
  change_rate: 1.0,
  volume_ratio: 2.0,
  total_amount: 1e9,
  limit_up: false,
  limit_down: false,
  ...over,
});

const rows: BreadthRow[] = [
  row({ stock_id: "2330", name: "台積電", volume_ratio: 2.0, change_rate: 1.0, total_amount: 5e9 }),
  row({ stock_id: "2603", name: "長榮", volume_ratio: 5.0, change_rate: 3.0, total_amount: 2e9 }),
  row({ stock_id: "2317", name: "鴻海", volume_ratio: 1.2, change_rate: 9.0, total_amount: 1e9 }),
  row({ stock_id: "6001", name: "櫃股", market: "tpex", volume_ratio: null, change_rate: 2.0 }),
];

describe("MarketVolumeRatioPanel — MK-6 量比排行", () => {
  // 痛點:MK-6 — 經典檢視只留量比:門檻(預設 1.5)過濾 + 全列(非 top30)。
  it("預設門檻 1.5:只列 volume_ratio ≥ 1.5 的股,量比 desc 排序", () => {
    render(<MarketVolumeRatioPanel rows={rows} loading={false} onSymbolPick={() => {}} />);
    const listed = screen.getAllByTestId(/^vr-row-/).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(listed).toEqual(["vr-row-2603", "vr-row-2330"]); // 5.0 → 2.0;1.2 與 null 濾除
  });

  it("調整門檻 → 重新過濾", () => {
    render(<MarketVolumeRatioPanel rows={rows} loading={false} onSymbolPick={() => {}} />);
    fireEvent.change(screen.getByLabelText("量比門檻"), { target: { value: "1" } });
    expect(screen.getAllByTestId(/^vr-row-/)).toHaveLength(3); // null 仍排除
  });

  // 痛點:SC-6(mod/batch-ui-polish)— toggle 鈕退役,點欄位標題(漲跌/量比/
  // 成交額)排序,active 欄 th 帶 aria-sort=descending。
  it("點「漲跌」欄標題 → 依 change_rate desc,th 帶 aria-sort", () => {
    render(<MarketVolumeRatioPanel rows={rows} loading={false} onSymbolPick={() => {}} />);
    expect(screen.queryByRole("button", { name: "依漲跌幅排序" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "依漲跌排序" }));
    const listed = screen.getAllByTestId(/^vr-row-/).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(listed).toEqual(["vr-row-2603", "vr-row-2330"]); // 3.0 → 1.0(門檻仍 1.5)
    const th = screen.getByRole("button", { name: "依漲跌排序" }).closest("th")!;
    expect(th.getAttribute("aria-sort")).toBe("descending");
    fireEvent.change(screen.getByLabelText("量比門檻"), { target: { value: "1" } });
    const relisted = screen.getAllByTestId(/^vr-row-/).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(relisted).toEqual(["vr-row-2317", "vr-row-2603", "vr-row-2330"]); // 9 → 3 → 1
  });

  it("點「成交額」欄標題 → 依 total_amount desc;預設量比欄 aria-sort", () => {
    render(<MarketVolumeRatioPanel rows={rows} loading={false} onSymbolPick={() => {}} />);
    const vrTh = screen.getByRole("button", { name: "依量比排序" }).closest("th")!;
    expect(vrTh.getAttribute("aria-sort")).toBe("descending");
    fireEvent.change(screen.getByLabelText("量比門檻"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "依成交額排序" }));
    const listed = screen.getAllByTestId(/^vr-row-/).map((el) =>
      el.getAttribute("data-testid"),
    );
    // total_amount desc:2330(5e9) → 2603(2e9) → 2317(1e9)
    expect(listed).toEqual(["vr-row-2330", "vr-row-2603", "vr-row-2317"]);
  });

  it("點列觸發 onSymbolPick;市場欄顯示上市/上櫃", () => {
    const pick = vi.fn();
    render(<MarketVolumeRatioPanel rows={rows} loading={false} onSymbolPick={pick} />);
    fireEvent.click(screen.getByTestId("vr-row-2330"));
    expect(pick).toHaveBeenCalledWith("2330");
    expect(screen.getByTestId("vr-row-2330").textContent).toContain("上市");
  });

  it("rows=null → 資料暫缺;無符合 → 繁中空狀態", () => {
    const { unmount } = render(
      <MarketVolumeRatioPanel rows={null} loading={false} onSymbolPick={() => {}} />,
    );
    expect(screen.getByTestId("market-volume-ratio").textContent).toContain("資料暫缺");
    unmount();
    render(<MarketVolumeRatioPanel rows={rows} loading={false} onSymbolPick={() => {}} />);
    fireEvent.change(screen.getByLabelText("量比門檻"), { target: { value: "99" } });
    expect(screen.getByTestId("market-volume-ratio").textContent).toContain("無符合門檻的個股");
  });
});
