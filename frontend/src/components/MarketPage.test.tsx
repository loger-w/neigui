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

const emptyIndexStrength: MarketSnapshot["index_strength"] = {
  twse: null,
  tpex: null,
  tsmc: { change_rate: null, contrib_points: null },
  contrib: { twse: null, tpex: null },
};

const baseSnapshot: MarketSnapshot = {
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
        { stock_id: "2330", name: "台積電", change_rate: 1.5, total_amount: 1e8, market_value: 6e13 },
      ],
    },
  ],
  leaderboards: { gainers: [], losers: [], amount: [], volume_ratio: [] },
  universe_size: 1917,
  excluded_count: { etf: 347, warrant: 67, watch_list: 57 },
  index_strength: emptyIndexStrength,
  cap_tiers: null,
  sector_rotation: null,
};

describe("MarketPage", () => {
  it("renders header + heatmap + leaderboard after mount", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue(baseSnapshot);
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByText("大盤掃描")).toBeTruthy();
      expect(screen.getByRole("img", { name: "大盤族群熱力圖" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    });
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

  // market-today-only §3 — trimmed fixture:三新鍵各帶最小合法值,足夠讓
  // 三新卡都進 data 分支。
  const richSnapshot: MarketSnapshot = {
    ...baseSnapshot,
    sectors: [],
    index_strength: {
      twse: { close: 42650.6, change_rate: -0.04, median_change_rate: -1.8, spread: 1.76 },
      tpex: { close: 370.4, change_rate: -2.11, median_change_rate: -2.4, spread: 0.29 },
      tsmc: { change_rate: 1.2, contrib_points: 210.5 },
      contrib: {
        twse: {
          up: [{ stock_id: "2330", name: "台積電", change_rate: 1.2, contrib_points: 210.5 }],
          down: [],
        },
        tpex: { up: [], down: [] },
      },
    },
    cap_tiers: [
      { tier: "top50", members: 50, avg_change_rate: -0.3, up_ratio: 0.32 },
      { tier: "mid100", members: 100, avg_change_rate: -1.9, up_ratio: 0.18 },
      { tier: "rest", members: 1600, avg_change_rate: -2.2, up_ratio: 0.15 },
    ],
    sector_rotation: {
      as_of: "2026-07-20 13:07:05",
      industries: [
        {
          name: "半導體",
          members: 120,
          avg_change_rate: 0.4,
          vol_ratio: 1.31,
          subs: [{ name: "記憶體IC", members: 6, avg_change_rate: 3.1, vol_ratio: 2.4 }],
        },
      ],
    },
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
    expect(
      grid.compareDocumentPosition(classicToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("今日三卡 root testid 全 render(data 到位後)", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockResolvedValue(richSnapshot);
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    await waitFor(() => {
      expect(screen.getByTestId("market-universe-banner")).toBeTruthy();
      expect(screen.getByTestId("market-index-strength")).toBeTruthy();
      expect(screen.getByTestId("market-cap-tiers")).toBeTruthy();
      expect(screen.getByTestId("market-sector-rotation")).toBeTruthy();
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

  it("data=null(fetch 未 resolve)→ 三新卡 data-state=loading", () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot").mockReturnValue(new Promise(() => {}));
    render(wrap(<MarketPage isActive={true} onSymbolPick={() => {}} />));
    expect(
      document.querySelector('[data-testid="market-index-strength"] [data-state="loading"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="market-cap-tiers"] [data-state="loading"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="market-sector-rotation"] [data-state="loading"]'),
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
    expect(screen.queryByTestId("market-index-strength")).toBeNull();
    expect(screen.queryByTestId("market-universe-banner")).toBeNull();
    expect(screen.queryByTestId("market-v2-grid")).toBeNull();
  });
});
