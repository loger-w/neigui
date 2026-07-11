import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { WarrantsPayload } from "../lib/warrant-data";

// EOD 權證快照(條款 + 昨日欄位)。enabled gate:權證 tab 未開不抓
// (App.tsx hidden 保 DOM,由 active prop 傳入)。
export function useWarrants(stockId: string, enabled: boolean) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<WarrantsPayload, Error>({
    queryKey: ["warrants", stockId],
    enabled: !!stockId && enabled,
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.warrants(stockId, force, { signal });
    },
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    asOfDate: data?.as_of_date ?? null,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
  };
}
