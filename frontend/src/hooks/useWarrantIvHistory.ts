import { api } from "../lib/api";
import type { WarrantIvHistoryPayload } from "../lib/warrant-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

// IV 歷史展開:row 展開才抓(SC-7 lazy 單發;樣板 useWarrantBrokers)。
// warrantId=null = 未展開。
export function useWarrantIvHistory(warrantId: string | null) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<WarrantIvHistoryPayload>({
    queryKey: ["warrant-iv-history", warrantId],
    enabled: !!warrantId,
    queryFn: async (force, { signal }) => api.warrantIvHistory(warrantId!, force, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
  };
}
