import { useRef } from "react";
import {
  useQuery,
  useQueryClient,
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
 * - refresh() = set ref → cancelQueries → refetch(fix/force-refresh-race):
 *   TanStack 對 in-flight fetch 的 refetch() 會 join 不重跑 queryFn,旗標
 *   不會被 refresh 觸發的請求消費 — 先 cancel 讓 refetch 必然重跑 queryFn,
 *   refresh 意圖立即生效(原 useMarketSnapshot R8 實戰解法,收進 helper)。
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
}

export function useForceRefreshQuery<T>(options: ForceRefreshQueryOptions<T>): {
  data: T | undefined;
  isFetching: boolean;
  error: Error | null;
  refresh: () => void;
} {
  const forceRefreshRef = useRef(false);
  const queryClient = useQueryClient();
  const { queryFn, ...rest } = options;

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
      queryClient.cancelQueries({ queryKey: options.queryKey });
      refetch();
    },
  };
}
