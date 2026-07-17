import { api } from "../lib/api";
import type { WarrantFlowPayload } from "../lib/warrant-flow-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

// 權證買賣超分點:切到 tab 才抓(SC-1 active gate);per stock+date cache
// 在 backend,前端層由 queryKey ["warrant-flow", stockId] 承擔 session cache。
// noTradingDay 僅 hook shape 慣例對齊(CLAUDE.md §4)— 前端不帶 date 參數,
// 恆 false,UI 無消費者;資料日提示走 as_of_date badge(design R13)。
export function useWarrantFlow(stockId: string, active: boolean) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<WarrantFlowPayload>({
    queryKey: ["warrant-flow", stockId],
    enabled: active && !!stockId,
    queryFn: async (force, { signal }) => api.warrantFlow(stockId, force, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    noTradingDay: data?.no_trading_day ?? false,
    refresh,
  };
}
