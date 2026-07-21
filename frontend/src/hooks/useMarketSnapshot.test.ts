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
  universe_size: 1917,
  excluded_count: { etf: 347, warrant: 67, watch_list: 57 },
  index_strength: {
    twse: null,
    tpex: null,
    tsmc: { change_rate: null, contrib_points: null },
    contrib: { twse: null, tpex: null },
  },
  cap_tiers: null,
  sector_rotation: null,
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
    expect(spy).toHaveBeenCalledWith(false, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true, expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });

  it("exposes error.message when fetch rejects", async () => {
    vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockRejectedValue(new Error("finmind_unreachable"));
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    // hook 的 retry:1 + default exponential backoff(初始 1s,第 1 次重試後 2s)→
    // 最差 case 約 3 秒 settle;waitFor default 1s 不足。
    await waitFor(
      () => expect(result.current.error).toBe("finmind_unreachable"),
      { timeout: 5000 },
    );
    expect(result.current.data).toBeNull();
  });

  it("pauses polling after first fetch when is_trading_session=false (Audit X8 / SC-5)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockResolvedValue({ ...mockSnapshot, is_trading_session: false });
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    await vi.waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    // 收盤後 polling 應停。等遠超 2500ms (refetchInterval) 仍不該再次呼叫
    await vi.advanceTimersByTimeAsync(8000);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("polls every ~2.5s when is_trading_session=true (Audit X8 / SC-5)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockResolvedValue({ ...mockSnapshot, is_trading_session: true });
    renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    await vi.waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
    // 推 3 秒 → 已過一個 2500ms tick,refetch 至少觸發 1 次
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => {
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    vi.useRealTimers();
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
