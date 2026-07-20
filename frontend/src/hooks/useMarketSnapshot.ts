import { fetchMarketSnapshot } from "../lib/market-api";
import type { MarketSnapshot } from "../lib/market-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

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
  const { data, isFetching, error, refresh } = useForceRefreshQuery<MarketSnapshot>({
    queryKey: ["market", "snapshot"],
    queryFn: async (force, { signal }) => fetchMarketSnapshot(force, { signal }),
    enabled,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.is_trading_session) return 2500;
      return false;
    },
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 0,
    // Phase 4 R8 的 cancel-before-refetch 已收進 useForceRefreshQuery 本體
    // (fix/force-refresh-race):polling in-flight 不再吃掉 user click。
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
    lastUpdated: data?.last_tick ?? null,
    isStale: data?.stale ?? false,
    isTradingSession: data?.is_trading_session ?? false,
  };
}
