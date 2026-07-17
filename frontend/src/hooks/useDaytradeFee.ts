import { api } from "../lib/api";
import type { BorrowFeeData } from "../lib/borrow-fee";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

// 券差 hook — BorrowFeePage 只在 borrow mode mount(App.tsx 4-way ternary),
// mount 即 fetch;不需 enabled gate。
export function useDaytradeFee() {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<BorrowFeeData>({
    queryKey: ["daytrade-fee"],
    queryFn: async (force, { signal }) => api.daytradeFee(force, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    noTradingDay: data?.no_trading_day ?? false,
    refresh,
  };
}
