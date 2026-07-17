import { optionsApi } from "../lib/options-api";
import type { OptionsStrikeVolume } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useOptionsStrikeVolume(contract: string, date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsStrikeVolume>({
    queryKey: ["options-strike-volume", contract, date],
    queryFn: async (force, { signal }) =>
      optionsApi.strikeVolume(contract, date, force ? true : undefined, { signal }),
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
