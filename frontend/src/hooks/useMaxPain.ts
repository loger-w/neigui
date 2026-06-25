import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { optionsApi } from "../lib/options-api";
import type { OptionsMaxPain } from "../lib/options-types";

export function useMaxPain(contract: string, date: string) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<OptionsMaxPain, Error>({
    queryKey: ["options-max-pain", contract, date],
    queryFn: async () => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return optionsApi.maxPain(contract, date, force ? true : undefined);
    },
    enabled: contract !== "",
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh: () => {
      forceRefreshRef.current = true;
      refetch();
    },
    noTradingDay: data?.no_trading_day === true,
  };
}
