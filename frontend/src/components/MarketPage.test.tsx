/** @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as marketApi from "../lib/market-api";
import { MarketPage } from "./MarketPage";
import type { ReactNode } from "react";
import type { MarketSnapshot } from "../lib/market-types";

// v3 C2 — 同 MarketHeatmap.test.tsx
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
});

vi.mock("../hooks/useContainerSize", () => ({
  useContainerSize: () => ({ width: 800, height: 600 }),
}));

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("MarketPage", () => {
  it("renders header + heatmap + leaderboard after mount", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue({
      as_of: "x",
      last_tick: "2026-06-29T10:30:00",
      is_trading_session: true,
      stale: false,
      lag_seconds: 5,
      sectors: [
        {
          id: "半導體業",
          name: "半導體業",
          member_count: 1,
          avg_change_rate: 1.5,
          total_amount: 1e9,
          stocks: [
            { stock_id: "2330", name: "台積電", change_rate: 1.5,
              total_amount: 1e8, market_value: 6e13 },
          ],
        },
      ],
      leaderboards: { gainers: [], losers: [], amount: [], volume_ratio: [] },
      universe_size: 1917,
      excluded_count: { etf: 347, warrant: 67, watch_list: 57 },
      eod_as_of: "2026-07-02",
      breadth: null,
      sector_breadth: null,
      sector_volume_ratio: null,
      sector_amount_share: null,
    });
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText("大盤掃描")).toBeTruthy();
      expect(screen.getByRole("img", { name: "大盤族群熱力圖" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    });
  });

  it("eod_pending=true → EOD 面板維持載入骨架,不顯示「資料暫缺」(prd 冷啟動)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue({
      as_of: "x",
      last_tick: "2026-07-03T10:30:00",
      is_trading_session: false,
      stale: false,
      lag_seconds: 5,
      sectors: [],
      leaderboards: { gainers: [], losers: [], amount: [], volume_ratio: [] },
      universe_size: 1917,
      excluded_count: { etf: 347, warrant: 67, watch_list: 57 },
      eod_as_of: null,
      eod_pending: true,
      breadth: null,
      sector_breadth: null,
      sector_volume_ratio: null,
      sector_amount_share: null,
    } as MarketSnapshot);
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText("大盤掃描")).toBeTruthy();
    });
    expect(document.querySelectorAll('[data-state="loading"]').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-state="unavailable"]')).toBeNull();
  });

  it("shows error banner when fetch fails (E7)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockRejectedValue(new Error("finmind_unreachable"));
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(
      () => {
        expect(screen.getByText(/資料源無法連線/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it("does not call api when isActive=false (F4)", async () => {
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot");
    render(wrap(<MarketPage isActive={false} onSymbolPick={() => {}} />));
    expect(spy).not.toHaveBeenCalled();
  });

  // v3 §11 — trimmed fixture:breadth 帶 3 筆 mcclellan/ad_line 點,
  // sector 三個 list 各 2 rows(裁切版,足夠讓 5 新元件都進 render 分支)。
  const richSnapshot: MarketSnapshot = {
    as_of: "x",
    last_tick: "2026-06-29T10:30:00",
    is_trading_session: true,
    stale: false,
    lag_seconds: 5,
    sectors: [],
    leaderboards: { gainers: [], losers: [], amount: [], volume_ratio: [] },
    universe_size: 1917,
    excluded_count: { etf: 347, warrant: 67, watch_list: 57 },
    eod_as_of: "2026-07-02",
    breadth: {
      ad_line_value: 12,
      mcclellan_oscillator: 34.5,
      ad_line_series: [
        { date: "2026-06-27", value: 10 },
        { date: "2026-06-28", value: 11 },
        { date: "2026-06-29", value: 12 },
      ],
      mcclellan_series: [
        { date: "2026-06-27", value: 30 },
        { date: "2026-06-28", value: 32 },
        { date: "2026-06-29", value: 34.5 },
      ],
      thrust_dot: null,
      centerline_cross: "above",
      divergence_dot: null,
      known_gaps: [],
    },
    sector_breadth: [
      { sector: "半導體業", members: 100, above_ma20: 60, pct: 0.6 },
      { sector: "金融保險業", members: 50, above_ma20: 20, pct: 0.4 },
    ],
    sector_volume_ratio: [
      { sector: "半導體業", today_vol_lots: 500000, vol_ratio: 1.8, flag: "hot" },
      { sector: "金融保險業", today_vol_lots: 200000, vol_ratio: 0.9, flag: null },
    ],
    sector_amount_share: [
      { sector: "半導體業", today_share: 0.35, share_delta_20ma: 0.02 },
      { sector: "金融保險業", today_share: 0.15, share_delta_20ma: -0.01 },
    ],
  };

  it("DOM 順序:universe banner 在 header 後、market-v2-grid 前、grid 在經典檢視折疊區前 (SC-9 / CR1-6)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue(richSnapshot);
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId("market-universe-banner")).toBeTruthy();
    });
    const header = screen.getByText("大盤掃描");
    const banner = screen.getByTestId("market-universe-banner");
    const grid = screen.getByTestId("market-v2-grid");
    const classicToggle = screen.getByTestId("market-classic-toggle");
    expect(
      header.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      banner.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // SC-9:新 5 panel 主視圖必須排在經典檢視折疊區之前(不能被移到後面)
    expect(
      grid.compareDocumentPosition(classicToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("新 5 root testid 全 render(data 到位後)(SC-9)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue(richSnapshot);
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId("market-universe-banner")).toBeTruthy();
      expect(screen.getByTestId("market-breadth-panel")).toBeTruthy();
      expect(screen.getByTestId("market-sector-breadth-heatmap")).toBeTruthy();
      expect(screen.getByTestId("market-sector-amount-share")).toBeTruthy();
      expect(screen.getByTestId("market-sector-vol-ratio")).toBeTruthy();
    });
  });

  it("經典檢視預設展開:market-heatmap / market-leaderboard 可見 (D-2 / SC-11e)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue(richSnapshot);
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId("market-heatmap")).toBeTruthy();
    });
    const toggle = screen.getByTestId("market-classic-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("market-heatmap").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("market-leaderboard")).toBeTruthy();
  });

  it("click market-classic-toggle → 折疊(hidden=true)但舊元件仍 mounted (SC-9)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue(richSnapshot);
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId("market-classic-toggle")).toBeTruthy();
    });
    const toggle = screen.getByTestId("market-classic-toggle");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const heatmap = document.querySelector('[data-testid="market-heatmap"]');
    const leaderboard = document.querySelector('[data-testid="market-leaderboard"]');
    expect(heatmap).toBeTruthy();
    expect(leaderboard).toBeTruthy();
    expect(heatmap?.closest("[hidden]")).toBeTruthy();
  });

  it("data=null(fetch 未 resolve)→ 4 個新 panel data-state=loading (SC-9 / 契約事實 2)", () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockReturnValue(new Promise(() => {}));
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    expect(
      document.querySelector('[data-testid="market-breadth-panel"] [data-state="loading"]'),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-testid="market-sector-breadth-heatmap"] [data-state="loading"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="market-sector-amount-share"] [data-state="loading"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="market-sector-vol-ratio"] [data-state="loading"]'),
    ).toBeTruthy();
    expect(screen.queryByTestId("market-universe-banner")).toBeNull();
  });

  it("error && !data → 既有整頁錯誤分支,新 panel 不 render (SC-9 / 契約事實 2)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockRejectedValue(
      new Error("finmind_unreachable"),
    );
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(
      () => {
        expect(screen.getByText(/資料源無法連線/)).toBeTruthy();
      },
      { timeout: 5000 },
    );
    expect(screen.queryByTestId("market-breadth-panel")).toBeNull();
    expect(screen.queryByTestId("market-universe-banner")).toBeNull();
    expect(screen.queryByTestId("market-v2-grid")).toBeNull();
  });
});
