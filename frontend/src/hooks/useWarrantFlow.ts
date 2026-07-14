import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { WarrantFlowPayload } from "../lib/warrant-flow-data";

// 權證買賣超分點:切到 tab 才抓(SC-1 active gate);per stock+date cache
// 在 backend,前端層由 queryKey ["warrant-flow", stockId] 承擔 session cache。
// noTradingDay 僅 hook shape 慣例對齊(CLAUDE.md §4)— 前端不帶 date 參數,
// 恆 false,UI 無消費者;資料日提示走 as_of_date badge(design R13)。
export function useWarrantFlow(stockId: string, active: boolean) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<WarrantFlowPayload, Error>({
    queryKey: ["warrant-flow", stockId],
    enabled: active && !!stockId,
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.warrantFlow(stockId, force, { signal });
    },
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    noTradingDay: data?.no_trading_day ?? false,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
  };
}
