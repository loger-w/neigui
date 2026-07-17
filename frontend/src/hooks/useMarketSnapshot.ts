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
      // 冷啟動期間(EOD 背景計算中)收盤後也短輪詢,計算完成自動補上;
      // 後端每次輪詢只讀 cache / 共用同一背景任務,不會重複觸發計算。
      if (d?.eod_pending) return 15_000;
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
