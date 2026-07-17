import { optionsApi } from "../lib/options-api";
import type { OptionsInstitutional } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useInstitutionalOptions(date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsInstitutional>({
    queryKey: ["options-institutional", date],
    queryFn: async (force, { signal }) =>
      optionsApi.institutional(date, force ? true : undefined, undefined, undefined, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
    noTradingDay: data?.no_trading_day === true,
  };
}
