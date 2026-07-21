import { api } from "../lib/api";
import type { BrokerFlowsPayload } from "../lib/broker-flows-data";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

// 分點反查:切到 tab 且選定分點才抓(active gate,useWarrantFlow 同構);
// per (broker, day) cache 在 backend,前端 session cache 由 queryKey 承擔。
// noTradingDay 對齊跨檔契約(CLAUDE.md §4)— 回退日時 UI 顯示標註(SC-6)。
export function useBrokerDailyFlows(brokerId: string, active: boolean) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<BrokerFlowsPayload>({
    queryKey: ["broker-flows", brokerId],
    enabled: active && !!brokerId,
    queryFn: async (force, { signal }) => api.brokerDailyFlows(brokerId, force, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    noTradingDay: data?.no_trading_day ?? false,
    refresh,
  };
}
