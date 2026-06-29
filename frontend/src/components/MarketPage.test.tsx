/** @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as marketApi from "../lib/market-api";
import { MarketPage } from "./MarketPage";
import type { ReactNode } from "react";

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
    });
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
});
