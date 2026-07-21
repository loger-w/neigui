import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { TraderSearchPayload } from "../lib/broker-flows-data";

// 分點目錄搜尋:q = debounce 後字串('' → 不打);目錄 backend 24h cache,
// 前端 staleTime 同步拉長。refresh 對齊 hook 統一 shape(design R11)。
// F-2:data 維持 TraderHit[](= payload.hits),total 為 extras — 截斷判定
// total > data.length 由元件做。
export function useTraderSearch(q: string) {
  const { data, isFetching, error, refetch } = useQuery<TraderSearchPayload, Error>({
    queryKey: ["broker-traders", q],
    enabled: q.length >= 1,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: ({ signal }) => api.brokerTraders(q, { signal }),
  });

  return {
    data: data ? data.hits : null,
    total: data ? data.total : null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh: () => {
      void refetch();
    },
  };
}
