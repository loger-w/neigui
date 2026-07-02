/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketSectorVolRatio } from "./MarketSectorVolRatio";
import type { SectorVolumeRatioRow } from "../lib/market-types";

afterEach(() => cleanup());

describe("MarketSectorVolRatio", () => {
  it("flag hot → data-flag=hot bg-accent;cold → bg-ink-dim;null → row 內無 [data-flag] (SC-7 + edge 7)", () => {
    const rows: SectorVolumeRatioRow[] = [
      { sector: "熱門", today_vol_lots: 100000, vol_ratio: 2, flag: "hot" },
      { sector: "冷門", today_vol_lots: 100000, vol_ratio: 0.5, flag: "cold" },
      { sector: "普通", today_vol_lots: 100000, vol_ratio: 1, flag: null },
    ];
    render(<MarketSectorVolRatio rows={rows} eodAsOf="2026-06-29" loaded={true} />);

    const hotRow = screen.getByTestId("svr-row-熱門");
    const hotDot = hotRow.querySelector("[data-flag]")!;
    expect(hotDot.getAttribute("data-flag")).toBe("hot");
    expect(hotDot.className.includes("bg-accent")).toBe(true);

    const coldRow = screen.getByTestId("svr-row-冷門");
    const coldDot = coldRow.querySelector("[data-flag]")!;
    expect(coldDot.getAttribute("data-flag")).toBe("cold");
    expect(coldDot.className.includes("bg-ink-dim")).toBe(true);

    const normalRow = screen.getByTestId("svr-row-普通");
    expect(normalRow.querySelector("[data-flag]")).toBeNull();
  });

  it("409858 lots → \"41.0\" (SC-7 萬張換算)", () => {
    const rows: SectorVolumeRatioRow[] = [
      { sector: "換算", today_vol_lots: 409858, vol_ratio: 1, flag: null },
    ];
    render(<MarketSectorVolRatio rows={rows} eodAsOf="2026-06-29" loaded={true} />);
    const cell = screen.getByTestId("svr-row-換算").querySelector("td:nth-child(2)")!;
    expect(cell.textContent).toBe("41.0");
  });

  it("vol_ratio null → \"—\";2.1127 → \"2.11\" (edge 7)", () => {
    const rows: SectorVolumeRatioRow[] = [
      { sector: "空值", today_vol_lots: 100000, vol_ratio: null, flag: null },
      { sector: "有值", today_vol_lots: 100000, vol_ratio: 2.1127, flag: null },
    ];
    render(<MarketSectorVolRatio rows={rows} eodAsOf="2026-06-29" loaded={true} />);
    expect(
      screen.getByTestId("svr-row-空值").querySelector("td:last-child")!.textContent,
    ).toBe("—");
    expect(
      screen.getByTestId("svr-row-有值").querySelector("td:last-child")!.textContent,
    ).toBe("2.11");
  });

  it("三態 (unavailable / empty / loading)", () => {
    const { rerender } = render(
      <MarketSectorVolRatio rows={null} eodAsOf="2026-06-29" loaded={true} />,
    );
    const root = screen.getByTestId("market-sector-vol-ratio");
    expect(root.querySelector('[data-state="unavailable"]')).toBeTruthy();
    expect(root.textContent).toContain("資料暫缺");

    rerender(<MarketSectorVolRatio rows={[]} eodAsOf="2026-06-29" loaded={true} />);
    expect(root.querySelector('[data-state="empty"]')).toBeTruthy();
    expect(root.textContent).toContain("無符合資料");

    rerender(<MarketSectorVolRatio rows={null} eodAsOf="2026-06-29" loaded={false} />);
    expect(root.querySelector('[data-state="loading"]')).toBeTruthy();
  });

  it("方向性文案 lock (SC-10a)", () => {
    const rows: SectorVolumeRatioRow[] = [
      { sector: "族群", today_vol_lots: 100000, vol_ratio: 1, flag: "hot" },
    ];
    render(<MarketSectorVolRatio rows={rows} eodAsOf="2026-06-29" loaded={true} />);
    expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull();
  });

  it("照 props 序渲染 (契約事實 10)", () => {
    const rows: SectorVolumeRatioRow[] = [
      { sector: "B族群", today_vol_lots: 100000, vol_ratio: 1, flag: null },
      { sector: "A族群", today_vol_lots: 100000, vol_ratio: 1, flag: null },
    ];
    render(<MarketSectorVolRatio rows={rows} eodAsOf="2026-06-29" loaded={true} />);
    const root = screen.getByTestId("market-sector-vol-ratio");
    const testIds = Array.from(root.querySelectorAll('[data-testid^="svr-row-"]')).map((tr) =>
      tr.getAttribute("data-testid"),
    );
    expect(testIds).toEqual(["svr-row-B族群", "svr-row-A族群"]);
  });
});
