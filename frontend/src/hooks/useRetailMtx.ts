import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { optionsApi } from "../lib/options-api";
import type { OptionsRetailMtx } from "../lib/options-types";

/** 散戶小台多空比(options-page-v2 SC-4,溫度計列)。 */
export function useRetailMtx(date: string) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<OptionsRetailMtx, Error>({
    queryKey: ["options-retail-mtx", date],
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return optionsApi.retailMtx(date, force ? true : undefined, { signal });
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
