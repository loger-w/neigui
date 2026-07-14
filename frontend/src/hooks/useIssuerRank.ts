import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { IssuerRankPayload } from "../lib/warrant-data";

// 發行商信任排行(全市場,queryKey 不含 stockId)。enabled gate:
// IssuerRankPanel 展開才抓(收盤 proxy 排行,計算在 backend lazy build)。
export function useIssuerRank(enabled: boolean) {
  const forceRefreshRef = useRef(false);

  const { data, isFetching, error, refetch } = useQuery<IssuerRankPayload, Error>({
    queryKey: ["issuer-rank"],
    enabled,
    queryFn: async ({ signal }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return api.issuerRank(force, { signal });
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
  };
}
