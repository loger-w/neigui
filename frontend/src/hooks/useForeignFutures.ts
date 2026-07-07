import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { optionsApi } from "../lib/options-api";
import type { OptionsForeignFutures } from "../lib/options-types";

/** 外資台指期淨未平倉(options-page-v2 SC-5,外資格對照行)。 */
export function useForeignFutures(date: string) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<OptionsForeignFutures, Error>({
    queryKey: ["options-foreign-futures", date],
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return optionsApi.foreignFutures(date, force ? true : undefined, { signal });
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
    noTradingDay: data?.no_trading_day === true,
  };
}
