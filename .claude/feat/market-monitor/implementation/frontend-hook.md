# Implementation: Frontend Hook

Covers: `hooks/useMarketSnapshot.ts` + `hooks/useMarketSnapshot.test.ts`。

Design source:`../design.md` v3 §6.2(v3 F1 + F4 修)、§10。

---

## File 1:`frontend/src/hooks/useMarketSnapshot.ts`(新增)

```ts
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketSnapshot } from "../lib/market-api";
import type { MarketSnapshot } from "../lib/market-types";

export type UseMarketSnapshot = {
  data: MarketSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: string | null;
  isStale: boolean;
  isTradingSession: boolean;
};

export function useMarketSnapshot(enabled: boolean): UseMarketSnapshot {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<MarketSnapshot, Error>({
    queryKey: ["market", "snapshot"],
    queryFn: async () => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return fetchMarketSnapshot(force);
    },
    enabled,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.is_trading_session ? 2500 : false;
    },
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 0,
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
    lastUpdated: data?.last_tick ?? null,
    isStale: data?.stale ?? false,
    isTradingSession: data?.is_trading_session ?? false,
  };
}
```

---

## File 2:`frontend/src/hooks/useMarketSnapshot.test.ts`(新增)

```ts
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
    expect(spy).toHaveBeenCalledWith(false);  // first call refresh=false
  });

  it("does NOT fetch when enabled=false (F4 — mode 切走)", async () => {
    const spy = vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockResolvedValue(mockSnapshot);
    renderHook(() => useMarketSnapshot(false), {
      wrapper: makeQueryWrapper(),
    });
    // 不要 await — 應該根本不被呼叫
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
    // v3 L3 fix — 不測同步 loading=true(TanStack v5 + jsdom microtask race
    // 容易 flake);只測終態 loading=false,跟 sibling hook test pattern 一致。
    let resolveFetch: (v: MarketSnapshot) => void = () => {};
    vi.spyOn(marketApi, "fetchMarketSnapshot")
      .mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useMarketSnapshot(true), {
      wrapper: makeQueryWrapper(),
    });
    // 中間 loading=true 是 implementation detail,不在公開合約;省同步 assert
    resolveFetch(mockSnapshot);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(mockSnapshot);
  });
});
```

**SC mapping**:
- SC-1:fetches on mount + exposes data
- SC-5:exposes isStale / isTradingSession / refresh→refresh=true + error path
- F4 regression:enabled=false 不 fetch
- F1 regression:refresh() 帶 refresh=true(CLAUDE.md §4 鐵則)

**注意**:`refetchInterval` 動態 callback 行為(2500 when in_session else false)用 component 整合測 + Phase 6 真實環境驗;此處單測只測 hook 對外 API 是否回對 shape。
