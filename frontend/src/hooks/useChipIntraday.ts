import { api } from "../lib/api";
import type { ChipIntraday } from "../lib/chip-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useChipIntraday(symbol: string, date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<ChipIntraday>({
    queryKey: ["chip-intraday", symbol, date],
    queryFn: async (force, { signal }) => api.chipIntraday(symbol, date, force, { signal }),
    enabled: symbol !== "",
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
  };
}
