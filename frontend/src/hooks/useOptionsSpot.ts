import { optionsApi } from "../lib/options-api";
import type { OptionsSpot } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useOptionsSpot(date: string) {
  // force 旗標讓「重新整理」把 ?refresh=true 恰好帶一次 — TanStack Query
  // 自身的 cache invalidation 不夠,backend 只認這個旗標跳過 stale。
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsSpot>({
    queryKey: ["options-spot", date],
    queryFn: async (force, { signal }) =>
      optionsApi.spot(date, force ? true : undefined, { signal }),
    // TX spot is the freshest data point on the dashboard — pair the 1-min
    // backend cache TTL with a 1-min frontend poll so the visible price
    // tracks the live tape without the user clicking 重新整理.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
    noTradingDay: data?.no_trading_day === true,
  };
}
