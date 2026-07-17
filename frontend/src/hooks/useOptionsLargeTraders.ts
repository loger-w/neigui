import { optionsApi } from "../lib/options-api";
import type { OptionsLargeTraders } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useOptionsLargeTraders(contract: string, date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsLargeTraders>({
    queryKey: ["options-large-traders", contract, date],
    queryFn: async (force, { signal }) =>
      optionsApi.largeTraders(contract, date, force ? true : undefined, { signal }),
    enabled: contract !== "",
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
    noTradingDay: data?.no_trading_day === true,
  };
}
