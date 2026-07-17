import { optionsApi } from "../lib/options-api";
import type { OptionsMaxPain } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useMaxPain(contract: string, date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsMaxPain>({
    queryKey: ["options-max-pain", contract, date],
    queryFn: async (force, { signal }) =>
      optionsApi.maxPain(contract, date, force ? true : undefined, undefined, { signal }),
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
