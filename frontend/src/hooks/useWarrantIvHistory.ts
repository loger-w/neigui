import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { WarrantIvHistoryPayload } from "../lib/warrant-data";

// IV 歷史展開:row 展開才抓(SC-7 lazy 單發;樣板 useWarrantBrokers)。
// warrantId=null = 未展開。
export function useWarrantIvHistory(warrantId: string | null) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<WarrantIvHistoryPayload, Error>({
    queryKey: ["warrant-iv-history", warrantId],
    enabled: !!warrantId,
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.warrantIvHistory(warrantId!, force, { signal });
    },
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
