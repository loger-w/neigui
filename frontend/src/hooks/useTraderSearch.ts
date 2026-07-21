import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { TraderHit } from "../lib/broker-flows-data";

// 分點目錄搜尋:q = debounce 後字串('' → 不打);目錄 backend 24h cache,
// 前端 staleTime 同步拉長。refresh 對齊 hook 統一 shape(design R11)。
export function useTraderSearch(q: string) {
  const { data, isFetching, error, refetch } = useQuery<TraderHit[], Error>({
    queryKey: ["broker-traders", q],
    enabled: q.length >= 1,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: ({ signal }) => api.brokerTraders(q, { signal }),
  });

  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? error.message : null,
    refresh: () => {
      void refetch();
    },
  };
}
