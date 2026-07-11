import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { WarrantBrokersPayload } from "../lib/warrant-data";

// 分點展開:row 展開才抓(SC-6;FinMind T+1 單發,不 fan-out 全表)。
// warrantId=null = 未展開。
export function useWarrantBrokers(warrantId: string | null) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<WarrantBrokersPayload, Error>({
    queryKey: ["warrant-brokers", warrantId],
    enabled: !!warrantId,
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.warrantBrokers(warrantId!, force, { signal });
    },
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    dataDate: data?.data_date ?? null,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
  };
}
