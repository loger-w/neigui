import { optionsApi } from "../lib/options-api";
import type { OptionsPCR } from "../lib/options-types";
import { useForceRefreshQuery } from "./useForceRefreshQuery";

export function useOptionsPCR(
  date: string,
  scope: "per_contract" | "all_months",
  contract?: string,
) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<OptionsPCR>({
    queryKey: ["options-pcr", scope, contract ?? "", date],
    queryFn: async (force, { signal }) =>
      optionsApi.pcr({
        date,
        scope,
        contract: scope === "per_contract" ? contract : undefined,
        refresh: force ? true : undefined,
      }, { signal }),
    // PCR all_months works without a contract; per_contract needs one.
    enabled: scope === "all_months" || (scope === "per_contract" && !!contract),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh,
    noTradingDay: data?.no_trading_day === true,
  };
}
