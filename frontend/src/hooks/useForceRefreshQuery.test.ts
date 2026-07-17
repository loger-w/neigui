/**
 * @vitest-environment jsdom
 *
 * useForceRefreshQuery — forceRefreshRef 樣板共用層的行為合約:
 * consume-and-clear、refresh 標記下一發、onBeforeRefetch 順序。
 * refetchInterval callback 用例同時是型別編譯測試(R3:query.state.data
 * 需推導為 T | undefined,S4 useMarketSnapshot 遷移的前置驗證)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useForceRefreshQuery } from "./useForceRefreshQuery";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

interface Payload { value: number; is_live?: boolean }

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useForceRefreshQuery", () => {
  it("初載 force=false,refresh() 後下一發 force=true,再下一發回 false(consume-and-clear)", async () => {
    const calls: boolean[] = [];
    const { result } = renderHook(
      () =>
        useForceRefreshQuery<Payload>({
          queryKey: ["t1"],
          queryFn: async (force) => {
            calls.push(force);
            return { value: calls.length };
          },
        }),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(calls).toEqual([false]);

    result.current.refresh();
    await waitFor(() => expect(calls).toEqual([false, true]));

    result.current.refresh();
    await waitFor(() => expect(calls).toEqual([false, true, true]));
  });


  it("error 終態暴露 Error 物件;enabled:false 不 fetch", async () => {
    const spy = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderHook(
      () =>
        useForceRefreshQuery<Payload>({
          queryKey: ["t3"],
          queryFn: spy,
          retry: false,
        }),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");

    const gated = vi.fn(async () => ({ value: 1 }));
    renderHook(
      () =>
        useForceRefreshQuery<Payload>({
          queryKey: ["t3b"],
          queryFn: gated,
          enabled: false,
        }),
      { wrapper: makeQueryWrapper() },
    );
    expect(gated).not.toHaveBeenCalled();
  });

  it("in-flight fetch 期間按 refresh() — 必須立即補發帶 force=true 的請求(不被 dedupe 吃掉)", async () => {
    // race 重現(fix/force-refresh-race):TanStack 在 in-flight 期間的
    // refetch() 會 join 既有 fetch,不重跑 queryFn — refresh 旗標沒被
    // refresh 觸發的請求消費,使用者拿到未 refresh 的舊資料。
    let resolveFirst!: (v: Payload) => void;
    const calls: boolean[] = [];
    const { result } = renderHook(
      () =>
        useForceRefreshQuery<Payload>({
          queryKey: ["t5"],
          queryFn: (force) => {
            calls.push(force);
            if (calls.length === 1) {
              return new Promise<Payload>((r) => {
                resolveFirst = r;
              });
            }
            return Promise.resolve({ value: calls.length });
          },
        }),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(calls).toEqual([false])); // 初載在途(未 resolve)

    result.current.refresh();
    resolveFirst({ value: 1 });

    // 修後:in-flight 被 cancel,refresh 觸發的新 fetch 帶 force=true
    await waitFor(() => expect(calls).toEqual([false, true]));
  });

  it("refetchInterval callback 收到 query.state.data 為 T | undefined(型別編譯用例,R3)", async () => {
    const seen: Array<boolean | undefined> = [];
    const { result } = renderHook(
      () =>
        useForceRefreshQuery<Payload>({
          queryKey: ["t4"],
          queryFn: async () => ({ value: 1, is_live: false }),
          refetchInterval: (query) => {
            // 型別驗證點:query.state.data 必須可安全存取 Payload 欄位
            seen.push(query.state.data?.is_live);
            return false;
          },
          refetchIntervalInBackground: false,
        }),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data?.value).toBe(1));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
  });
});
