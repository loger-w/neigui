import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChipIntraday } from "../lib/chip-data";

export function useChipIntraday(symbol: string, date: string) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<ChipIntraday, Error>({
    queryKey: ["chip-intraday", symbol, date],
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.chipIntraday(symbol, date, force, { signal });
    },
    enabled: symbol !== "",
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
  };
}
