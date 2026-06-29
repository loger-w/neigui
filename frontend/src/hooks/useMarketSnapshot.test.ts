/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as marketApi from "../lib/market-api";
import { useMarketSnapshot } from "./useMarketSnapshot";
import { makeQueryWrapper } from "../test-utils/query-wrapper";
import type { MarketSnapshot } from "../lib/market-types";

const mockSnapshot: MarketSnapshot = {
  as_of: "2026-06-29T10:30:00+08:00",
  last_tick: "2026-06-29T10:29:50",
  is_trading_session: true,
  stale: false,
  lag_seconds: 10,
  sectors: [],
  leaderboards: { gainers: [], losers: [], amount: [], volume_ratio: [] },
};

beforeEach(() => vi.restoreAllMocks());

describe("useMarketSnapshot", () => {
  it("fetches on mount when enabled=true", async () => {
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockResolvedValue(mockSnapshot);
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockSnapshot));
    expect(spy).toHaveBeenCalledWith(false);
  });

  it("does NOT fetch when enabled=false (F4 — mode 切走)", async () => {
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockResolvedValue(mockSnapshot);
    renderHook(() => useMarketSnapshot(false), {
      wrapper: makeQueryWrapper(),
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("exposes lastUpdated / isStale / isTradingSession from payload", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockResolvedValue({ ...mockSnapshot, stale: true });
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.isStale).toBe(true));
    expect(result.current.lastUpdated).toBe(mockSnapshot.last_tick);
    expect(result.current.isTradingSession).toBe(true);
  });

  it("refresh() invokes fetchMarketSnapshot with refresh=true (F1 — CLAUDE.md §4)", async () => {
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockResolvedValue(mockSnapshot);
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    spy.mockClear();
    result.current.refresh();
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
  });

  it("exposes error.message when fetch rejects", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockRejectedValue(new Error("finmind_unreachable"));
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("finmind_unreachable"));
    expect(result.current.data).toBeNull();
  });

  it("loading flips false after fetch resolves (對齊 useOptionsLargeTraders.ts 樣板)", async () => {
    let resolveFetch: (v: MarketSnapshot) => void = () => {};
    vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    resolveFetch(mockSnapshot);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockSnapshot);
  });
});
