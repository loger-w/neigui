/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketLeaderboard } from "./MarketLeaderboard";
import type { Leaderboards } from "../lib/market-types";

afterEach(() => cleanup());

function mkRow(
  sid: string,
  name: string,
  chg: number,
  amount: number,
  vr: number | null,
) {
  return {
    stock_id: sid,
    name,
    change_rate: chg,
    total_amount: amount,
    volume_ratio: vr,
    sector: "半導體業",
  };
}

const mockLb: Leaderboards = {
  gainers: [
    mkRow("2330", "台積電", 5.0, 100e6, 2.5),
    mkRow("2317", "鴻海", 3.0, 80e6, 1.8),
  ],
  losers: [mkRow("2412", "中華電", -2.5, 50e6, 0.8)],
  amount: [mkRow("2330", "台積電", 5.0, 100e6, 2.5)],
  volume_ratio: [mkRow("9999", "X", 2.0, 1e6, 8.5)],
};

describe("MarketLeaderboard", () => {
  it("renders three tabs", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "大量單" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "量比" })).toBeTruthy();
  });

  it("defaults to 漲跌幅 tab and shows gainers + losers dual list", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    expect(screen.getByText("漲幅 Top 15")).toBeTruthy();
    expect(screen.getByText("跌幅 Top 15")).toBeTruthy();
    expect(document.querySelector('[data-testid="lb-row-2330"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="lb-row-2412"]')).toBeTruthy();
  });

  it("switches to 大量單 tab on click + shows total_amount", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "大量單" }));
    expect(screen.getByText(/100\.0M/)).toBeTruthy();
  });

  it("switches to 量比 tab + shows volume_ratio with x suffix (F5)", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "量比" }));
    expect(screen.getByText(/8\.50x/)).toBeTruthy();
  });

  it("量比 tab shows — when volume_ratio is null", () => {
    const lb: Leaderboards = {
      ...mockLb,
      volume_ratio: [mkRow("9999", "X", 1.0, 1e6, null)],
    };
    render(<MarketLeaderboard leaderboards={lb} onSymbolPick={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "量比" }));
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("calls onSymbolPick on row click", () => {
    const spy = vi.fn();
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={spy} />);
    fireEvent.click(document.querySelector('[data-testid="lb-row-2330"]')!);
    expect(spy).toHaveBeenCalledWith("2330");
  });

  it("uses bull binding for positive change (台股慣例 bull=紅,Audit X11 contract via data-color-bin)", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    const row = document.querySelector('[data-testid="lb-row-2330"]')!;
    // X11:改 data-color-bin 正向 assertion(對齊 heatmap-svg data-fill-bin),
    // 不鎖 raw class — X5 semantic token sweep 不會撞這個 test。
    expect(row.getAttribute("data-color-bin")).toBe("bull");
  });

  it("uses bear binding for negative change (台股慣例 bear=綠,Audit X11)", () => {
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    const row = document.querySelector('[data-testid="lb-row-2412"]')!;
    expect(row.getAttribute("data-color-bin")).toBe("bear");
  });

  it("change_rate === 0 falls into neutral (Audit X6 + X11:對齊 heatmap colorForChange)", () => {
    const lb: Leaderboards = {
      ...mockLb,
      gainers: [mkRow("0000", "中性股", 0, 1e6, 1.0)],
      losers: [],
    };
    render(<MarketLeaderboard leaderboards={lb} onSymbolPick={() => {}} />);
    const row = document.querySelector('[data-testid="lb-row-0000"]')!;
    expect(row.getAttribute("data-color-bin")).toBe("neutral");
  });

  it("does NOT lock raw Tailwind class (X11:contract is on data-color-bin only)", () => {
    // 鎖 X5 sweep 之後不能再有 raw class assertion;一旦回 raw class
    // 就會把 token migration 卡住。
    render(<MarketLeaderboard leaderboards={mockLb} onSymbolPick={() => {}} />);
    const row = document.querySelector('[data-testid="lb-row-2330"]')!;
    expect(row.getAttribute("data-color-bin")).toBe("bull");
    // 不寫 .text-red-500 / .text-bull 等具體 class assertion — token 名可能
    // 還會變,但 data-color-bin 是契約名稱不會動。
  });

  it("renders gracefully when leaderboards is null", () => {
    render(<MarketLeaderboard leaderboards={null} onSymbolPick={() => {}} />);
    expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="lb-row-"]')).toHaveLength(0);
  });
});
