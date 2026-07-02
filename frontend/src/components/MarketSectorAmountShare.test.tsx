/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketSectorAmountShare } from "./MarketSectorAmountShare";
import type { SectorAmountShareRow } from "../lib/market-types";

afterEach(() => cleanup());

describe("MarketSectorAmountShare", () => {
  it("照 props 序渲染不重排 (SC-6)", () => {
    const rows: SectorAmountShareRow[] = [
      { sector: "B族群", today_share: 0.1, share_delta_20ma: null },
      { sector: "A族群", today_share: 0.4, share_delta_20ma: null },
    ];
    render(<MarketSectorAmountShare rows={rows} eodAsOf="2026-06-29" loaded={true} />);
    const root = screen.getByTestId("market-sector-amount-share");
    const sectorCells = Array.from(root.querySelectorAll('[data-testid^="sas-row-"]')).map(
      (tr) => tr.getAttribute("data-testid"),
    );
    expect(sectorCells).toEqual(["sas-row-B族群", "sas-row-A族群"]);
  });

  it("Δ 正 → text-accent 且文字 \"+0.16\";負 → text-ink-muted \"-0.59\";null → \"—\" text-ink-dim;0 → \"0.00\" text-ink-muted (SC-6 + edge 8)", () => {
    const rows: SectorAmountShareRow[] = [
      { sector: "正值", today_share: 0.2, share_delta_20ma: 0.0016 },
      { sector: "負值", today_share: 0.2, share_delta_20ma: -0.0059 },
      { sector: "空值", today_share: 0.2, share_delta_20ma: null },
      { sector: "零值", today_share: 0.2, share_delta_20ma: 0 },
    ];
    render(<MarketSectorAmountShare rows={rows} eodAsOf="2026-06-29" loaded={true} />);

    const positive = screen.getByTestId("sas-row-正值").querySelector("td:last-child")!;
    expect(positive.textContent).toBe("+0.16");
    expect(positive.className.includes("text-accent")).toBe(true);

    const negative = screen.getByTestId("sas-row-負值").querySelector("td:last-child")!;
    expect(negative.textContent).toBe("-0.59");
    expect(negative.className.includes("text-ink-muted")).toBe(true);

    const nullish = screen.getByTestId("sas-row-空值").querySelector("td:last-child")!;
    expect(nullish.textContent).toBe("—");
    expect(nullish.className.includes("text-ink-dim")).toBe(true);

    const zero = screen.getByTestId("sas-row-零值").querySelector("td:last-child")!;
    expect(zero.textContent).toBe("0.00");
    expect(zero.className.includes("text-ink-muted")).toBe(true);
  });

  it("Δ 顯示與顏色同源 rounding 邊界 — ±0.00003 顯示 \"0.00\" 且皆 text-ink-muted (SC-6 / CR1-13)", () => {
    const rows: SectorAmountShareRow[] = [
      { sector: "微負", today_share: 0.2, share_delta_20ma: -0.00003 },
      { sector: "微正", today_share: 0.2, share_delta_20ma: 0.00003 },
    ];
    render(<MarketSectorAmountShare rows={rows} eodAsOf="2026-06-29" loaded={true} />);

    const tinyNeg = screen.getByTestId("sas-row-微負").querySelector("td:last-child")!;
    expect(tinyNeg.textContent).toBe("0.00");
    expect(tinyNeg.className.includes("text-accent")).toBe(false);
    expect(tinyNeg.className.includes("text-ink-muted")).toBe(true);

    const tinyPos = screen.getByTestId("sas-row-微正").querySelector("td:last-child")!;
    expect(tinyPos.textContent).toBe("0.00");
    expect(tinyPos.className.includes("text-accent")).toBe(false);
    expect(tinyPos.className.includes("text-ink-muted")).toBe(true);
  });

  it("today_share 0.40561 → \"40.6%\" (R1-2 換算)", () => {
    const rows: SectorAmountShareRow[] = [
      { sector: "換算", today_share: 0.40561, share_delta_20ma: null },
    ];
    render(<MarketSectorAmountShare rows={rows} eodAsOf="2026-06-29" loaded={true} />);
    const cell = screen.getByTestId("sas-row-換算").querySelector("td:nth-child(2)")!;
    expect(cell.textContent).toBe("40.6%");
  });

  it("三態 (unavailable / empty / loading)", () => {
    const { rerender } = render(
      <MarketSectorAmountShare rows={null} eodAsOf="2026-06-29" loaded={true} />,
    );
    const root = screen.getByTestId("market-sector-amount-share");
    expect(root.querySelector('[data-state="unavailable"]')).toBeTruthy();
    expect(root.textContent).toContain("資料暫缺");

    rerender(<MarketSectorAmountShare rows={[]} eodAsOf="2026-06-29" loaded={true} />);
    expect(root.querySelector('[data-state="empty"]')).toBeTruthy();
    expect(root.textContent).toContain("無符合資料");

    rerender(<MarketSectorAmountShare rows={null} eodAsOf="2026-06-29" loaded={false} />);
    expect(root.querySelector('[data-state="loading"]')).toBeTruthy();
  });

  it("方向性文案 lock (SC-10a)", () => {
    const rows: SectorAmountShareRow[] = [
      { sector: "族群", today_share: 0.2, share_delta_20ma: 0.01 },
    ];
    render(<MarketSectorAmountShare rows={rows} eodAsOf="2026-06-29" loaded={true} />);
    expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull();
  });
});
