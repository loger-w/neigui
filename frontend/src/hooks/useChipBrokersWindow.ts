import { api } from "../lib/api";
import type { ChipBrokersWindow } from "../lib/chip-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

/**
 * N-day aggregate of broker-level chips, ending at `date`. Driven by the
 * RangeSelector value (windowDays ∈ [10, 60]). Returns the standard
 * { data, loading, error, refresh } shape; `placeholderData` keeps the
 * previous window visible while a fresh one loads on date/N changes — but
 * clears on symbol pivot so the panel never shows the previous symbol's
 * brokers (which can poison `selectedBrokerIds` keyed against the new sym).
 */
export function useChipBrokersWindow(
  symbol: string, date: string, windowDays: number,
): {
  data: ChipBrokersWindow | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<ChipBrokersWindow>({
    queryKey: ["chip-brokers-window", symbol, date, windowDays],
    queryFn: async (force, { signal }) =>
      api.chipBrokersWindow(symbol, date, windowDays, force, { signal }),
    enabled: symbol !== "" && date !== "",
    placeholderData: (prev) => (prev?.symbol === symbol ? prev : undefined),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
  };
}
