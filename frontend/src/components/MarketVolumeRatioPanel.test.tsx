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
  row({ stock_id: "2330", name: "台積電", volume_ratio: 2.0, change_rate: 1.0 }),
  row({ stock_id: "2603", name: "長榮", volume_ratio: 5.0, change_rate: 3.0 }),
  row({ stock_id: "2317", name: "鴻海", volume_ratio: 1.2, change_rate: 9.0 }),
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

  // 痛點:MK-6 — 可切量比/漲跌幅排序。
  it("切換漲跌幅排序 → 依 change_rate desc", () => {
    render(<MarketVolumeRatioPanel rows={rows} loading={false} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "依漲跌幅排序" }));
    const listed = screen.getAllByTestId(/^vr-row-/).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(listed).toEqual(["vr-row-2603", "vr-row-2330"]); // 3.0 → 1.0(門檻仍 1.5)
    fireEvent.change(screen.getByLabelText("量比門檻"), { target: { value: "1" } });
    const relisted = screen.getAllByTestId(/^vr-row-/).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(relisted).toEqual(["vr-row-2317", "vr-row-2603", "vr-row-2330"]); // 9 → 3 → 1
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
