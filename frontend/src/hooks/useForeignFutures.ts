import { optionsApi } from "../lib/options-api";
import type { OptionsForeignFutures } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

/** 外資台指期淨未平倉(options-page-v2 SC-5,外資格對照行)。 */
export function useForeignFutures(date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsForeignFutures>({
    queryKey: ["options-foreign-futures", date],
    queryFn: async (force, { signal }) =>
      optionsApi.foreignFutures(date, force ? true : undefined, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
    noTradingDay: data?.no_trading_day === true,
  };
}
