import { useRef } from "react";
import {
  useQuery,
  type QueryFunctionContext,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";

/**
 * forceRefreshRef 樣板的共用層(refactor/force-refresh-query,2026-07-17)。
 *
 * TanStack Query 的 refetch() 不能帶參數,而「重新整理」需要讓 backend 收到
 * ?refresh=true 恰好一次 — 舊樣板(useRef 旗標 + queryFn read→clear)複製了
 * 18 個 hook,收斂到這裡。語意與原樣板逐字相同:
 * - queryFn 收 force(read→clear 由本 helper 做);`force ? true : undefined`
 *   之類的轉換留在呼叫端,api 呼叫形狀不變。
 * - refresh() = set ref → (onBeforeRefetch) → refetch。
 * - 已知 race 原樣保留:旗標由「下一個執行的 queryFn」消費,非 refresh 的
 *   in-flight fetch 可能提前吃掉(pattern 級,修復屬行為改動另案處理)。
 *
 * 只回傳 {data, isFetching, error, refresh} — 不 spread query result:
 * TanStack v5 tracked props 下 spread 會擴大訂閱面、增加 re-render。
 *
 * 不適用:useBrokerHistory(useMutation + AbortController 樣板,見 CLAUDE.md §3)、
 * useChipData(雙 query 複合 refresh)。
 */
interface ForceRefreshQueryOptions<T>
  extends Omit<UseQueryOptions<T, Error>, "queryFn"> {
  queryFn: (force: boolean, ctx: QueryFunctionContext<QueryKey>) => Promise<T>;
  /** refresh() 於 set ref 之後、refetch 之前呼叫(useMarketSnapshot 的
   * cancelQueries 掛點:防 polling 的 in-flight fetch dedupe 掉本次 refetch)。 */
  onBeforeRefetch?: () => void;
}

export function useForceRefreshQuery<T>(options: ForceRefreshQueryOptions<T>): {
  data: T | undefined;
  isFetching: boolean;
  error: Error | null;
  refresh: () => void;
} {
  const forceRefreshRef = useRef(false);
  const { queryFn, onBeforeRefetch, ...rest } = options;

  const { data, isFetching, error, refetch } = useQuery<T, Error>({
    ...rest,
    queryFn: (ctx) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return queryFn(force, ctx);
    },
  });

  return {
    data,
    isFetching,
    error,
    refresh: () => {
      forceRefreshRef.current = true;
      onBeforeRefetch?.();
      refetch();
    },
  };
}
