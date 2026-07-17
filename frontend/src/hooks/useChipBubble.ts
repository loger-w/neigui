import { api } from "../lib/api";
import type { ChipBubbleData } from "../lib/chip-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useChipBubble(symbol: string, date: string) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<ChipBubbleData>({
    queryKey: ["chip-bubble", symbol, date],
    queryFn: async (force, { signal }) => api.chipBubble(symbol, date, force, { signal }),
    enabled: symbol !== "",
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
  };
}
