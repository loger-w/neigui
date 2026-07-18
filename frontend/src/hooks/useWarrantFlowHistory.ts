import { api } from "../lib/api";
import type { WarrantFlowHistoryPayload } from "../lib/warrant-flow-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

// 外部淨額時序:切到 tab 才抓(active gate,useWarrantFlow 同構)。
// refresh() 對映 ?backfill=true(顯式補建 ≤3 缺日),非 refresh 語意 —
// design warrant-flow-net-history §3.2 divergence。
export function useWarrantFlowHistory(stockId: string, active: boolean) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<WarrantFlowHistoryPayload>({
    queryKey: ["warrant-flow-history", stockId],
    enabled: active && !!stockId,
    queryFn: (force, { signal }) => api.warrantFlowHistory(stockId, force, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
  };
}
