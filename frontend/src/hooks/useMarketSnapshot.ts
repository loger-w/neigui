import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();

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
      // Phase 4 R8: 取消 in-flight polling 確保 user click 不被 polling 吃掉
      // (TanStack Query dedupes in-flight queryFn,不 cancel 就讓本次 refresh
      // 等下一個 tick 才生效)。
      queryClient.cancelQueries({ queryKey: ["market", "snapshot"] });
      refetch();
    },
    lastUpdated: data?.last_tick ?? null,
    isStale: data?.stale ?? false,
    isTradingSession: data?.is_trading_session ?? false,
  };
}
