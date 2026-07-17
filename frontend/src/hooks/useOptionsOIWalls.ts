import { optionsApi } from "../lib/options-api";
import type { OptionsOIWalls } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useOptionsOIWalls(contract: string, date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsOIWalls>({
    queryKey: ["options-oi-walls", contract, date],
    queryFn: async (force, { signal }) =>
      optionsApi.oiWalls(contract, date, force ? true : undefined, undefined, undefined, { signal }),
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
