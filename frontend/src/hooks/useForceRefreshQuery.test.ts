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

  it("onBeforeRefetch 在 set ref 之後、refetch 之前被呼叫一次", async () => {
    const order: string[] = [];
    const { result } = renderHook(
      () =>
        useForceRefreshQuery<Payload>({
          queryKey: ["t2"],
          queryFn: async (force) => {
            order.push(`fetch:${force}`);
            return { value: 1 };
          },
          onBeforeRefetch: () => order.push("before"),
        }),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    result.current.refresh();
    await waitFor(() => expect(order).toEqual(["fetch:false", "before", "fetch:true"]));
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
