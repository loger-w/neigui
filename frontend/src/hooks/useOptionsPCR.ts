import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { optionsApi } from "../lib/options-api";
import type { OptionsPCR } from "../lib/options-types";

export function useOptionsPCR(
  date: string,
  scope: "per_contract" | "all_months",
  contract?: string,
) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<OptionsPCR, Error>({
    queryKey: ["options-pcr", scope, contract ?? "", date],
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return optionsApi.pcr({
        date,
        scope,
        contract: scope === "per_contract" ? contract : undefined,
        refresh: force ? true : undefined,
      }, { signal });
    },
    // PCR all_months works without a contract; per_contract needs one.
    enabled: scope === "all_months" || (scope === "per_contract" && !!contract),
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
