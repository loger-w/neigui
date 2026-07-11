import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { WarrantQuotesPayload } from "../lib/warrant-data";
import { quotesRefetchInterval } from "../lib/warrant-utils";

// 盤中報價層:交易時段 15s 輪詢(quotesRefetchInterval 純函式決定啟停,
// 對齊 backend cooldown 10s),收盤後停輪詢、payload 為最後快照(SC-3)。
export function useWarrantQuotes(stockId: string, enabled: boolean) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<WarrantQuotesPayload, Error>({
    queryKey: ["warrant-quotes", stockId],
    enabled: !!stockId && enabled,
    refetchInterval: () => quotesRefetchInterval(new Date()),
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      // 輪詢不帶 refresh(backend cooldown 生效);手動 refresh 才跳
      return api.warrantQuotes(stockId, force, { signal });
    },
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    quoteDate: data?.quote_date ?? null,
    quoteTime: data?.quote_time ?? null,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
  };
}
