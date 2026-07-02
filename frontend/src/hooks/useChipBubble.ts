import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChipBubbleData } from "../lib/chip-data";

export function useChipBubble(symbol: string, date: string) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<ChipBubbleData, Error>({
    queryKey: ["chip-bubble", symbol, date],
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.chipBubble(symbol, date, force, { signal });
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
