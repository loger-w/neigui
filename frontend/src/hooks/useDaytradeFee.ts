import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { BorrowFeeData } from "../lib/borrow-fee";

// 券差 hook — BorrowFeePage 只在 borrow mode mount(App.tsx 4-way ternary),
// mount 即 fetch;不需 enabled gate。
export function useDaytradeFee() {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<BorrowFeeData, Error>({
    queryKey: ["daytrade-fee"],
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.daytradeFee(force, { signal });
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
