import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { optionsApi } from "../lib/options-api";
import type { OptionsSpot } from "../lib/options-types";

export function useOptionsSpot(date: string) {
  // forceRefreshRef carries the user's "重新整理" intent through the next
  // refetch so backend gets ?refresh=true exactly once. TanStack Query's
  // own cache invalidation is not enough — backend ignores stale only when
  // this flag is set.
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<OptionsSpot, Error>({
    queryKey: ["options-spot", date],
    queryFn: async () => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return optionsApi.spot(date, force ? true : undefined);
    },
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
    noTradingDay: data?.no_trading_day === true,
  };
}
