import { optionsApi } from "../lib/options-api";
import type { OptionsRetailMtx } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

/** 散戶小台多空比(options-page-v2 SC-4,溫度計列)。 */
export function useRetailMtx(date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsRetailMtx>({
    queryKey: ["options-retail-mtx", date],
    queryFn: async (force, { signal }) =>
      optionsApi.retailMtx(date, force ? true : undefined, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
    noTradingDay: data?.no_trading_day === true,
  };
}
