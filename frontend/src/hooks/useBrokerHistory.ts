import { useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../lib/api";
import type { BrokerDaily } from "../lib/chip-data";

function stableKey(set: Set<string>): string {
  return Array.from(set).sort().join(",");
}

/**
 * Per-broker history hook.
 *
 * Backend endpoint is a batch (one call returns many brokers), so we cannot
 * use one useQuery per broker without losing the batch. Hybrid pattern:
 *
 *  - useMutation runs the batch fetch (loading + error live here)
 *  - onSuccess writes each broker's slice into queryClient under
 *    ["broker-history", symbol, broker_id] — TanStack Query becomes the
 *    cache (replacing the prior cacheRef Map)
 *  - useQueries with enabled:false reads those cache entries reactively so
 *    `series` re-renders when setQueryData lands new data
 *  - Stale-drop falls out of the query key including symbol: a late fetch
 *    for the prior symbol writes to that symbol's cache, never the new one
 */
export function useBrokerHistory(
  symbol: string,
  brokerIds: Set<string>,
): {
  series: Map<string, BrokerDaily[]>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const queryClient = useQueryClient();
  const forceRefreshRef = useRef(false);
  // Mutation 沒有 TanStack Query queryFn 的內建 signal;symbol 切換時手動
  // abort 前一次 in-flight batch,避免 24s 冷 broker_history 佔 rate slot。
  const abortRef = useRef<AbortController | null>(null);
  const idsKey = stableKey(brokerIds);
  const requestedIds = useMemo(
    () => Array.from(brokerIds).sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey],
  );

  const mutation = useMutation<
    { brokers: Record<string, BrokerDaily[]> },
    Error,
    { ids: string[] }
  >({
    mutationFn: async ({ ids }) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      return api.chipBrokerHistory(symbol, ids, force, { signal: controller.signal });
    },
    onSuccess: (result, { ids }) => {
      for (const id of ids) {
        queryClient.setQueryData(
          ["broker-history", symbol, id],
          result.brokers[id] ?? [],
        );
      }
    },
  });

  // Symbol 切換 / unmount 時 abort 前一 batch。placeholderData:mutation 沒有,
  // 依賴 setQueryData 進 cache 才 render;abort 後不會 setQueryData,不會
  // 汙染新 symbol 的 slot。
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [symbol]);

  // Subscribe to per-broker cache slots so `series` updates when
  // setQueryData lands new data. Queries are permanently disabled — they
  // never fire HTTP themselves; the batch mutation feeds the cache.
  const queries = useQueries({
    queries: requestedIds.map((id) => ({
      queryKey: ["broker-history", symbol, id],
      queryFn: async () => [] as BrokerDaily[], // never invoked
      enabled: false,
      staleTime: Infinity,
    })),
  });

  // Memo key for the queries.data fingerprint — react-hooks/use-memo
  // expects simple expressions in deps, so we stage the computation here.
  const dataFingerprint = queries.map((q) => q.data).join("|");
  const series = useMemo(() => {
    const m = new Map<string, BrokerDaily[]>();
    requestedIds.forEach((id, i) => {
      const data = queries[i]?.data;
      if (data) m.set(id, data);
    });
    return m;
    // requestedIds is already keyed by idsKey, dataFingerprint snapshots
    // queries[*].data — together they cover both axes of change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, dataFingerprint]);

  // Fire batch fetch for any ids we don't have cached yet. Pure
  // "sync state to external system (queryClient cache)" use of Effect.
  useEffect(() => {
    if (!symbol || requestedIds.length === 0) return;
    const missing = requestedIds.filter(
      (id) =>
        queryClient.getQueryData<BrokerDaily[]>([
          "broker-history",
          symbol,
          id,
        ]) === undefined,
    );
    if (missing.length === 0) return;
    mutation.mutate({ ids: missing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, idsKey]);

  const refresh = () => {
    if (!symbol || requestedIds.length === 0) return;
    forceRefreshRef.current = true;
    // Clear cache slots so the fetch re-populates everything.
    for (const id of requestedIds) {
      queryClient.removeQueries({
        queryKey: ["broker-history", symbol, id],
        exact: true,
      });
    }
    mutation.mutate({ ids: requestedIds });
  };

  return {
    series,
    loading: mutation.isPending,
    error: mutation.error ? mutation.error.message : null,
    refresh,
  };
}
