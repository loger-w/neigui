/**
 * @vitest-environment jsdom
 *
 * useWarrantFlow — 切到 tab 才抓(SC-1 active gate;per stock cache 由
 * TanStack queryKey 承擔)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantFlowPayload } from "../lib/warrant-flow-data";
import { useWarrantFlow } from "./useWarrantFlow";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantFlowPayload>): WarrantFlowPayload => ({
  as_of_date: "2026-07-13",
  truncated: false,
  total_traded: 3,
  analyzed: 3,
  unmapped_count: 1,
  empty_reason: null,
  summary: {
    call: { buy_value: 5046, sell_value: 3003 },
    put: { buy_value: 400, sell_value: 100 },
  },
  top_buy_branches: [],
  top_sell_branches: [],
  warrants: [],
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useWarrantFlow", () => {
  it("active=false 不 fetch(SC-1:切到 tab 才發請求)", () => {
    const spy = vi.spyOn(api, "warrantFlow").mockResolvedValue(mk());
    renderHook(() => useWarrantFlow("2330", false), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("active 轉 true 才 fetch,並暴露 data", async () => {
    const spy = vi.spyOn(api, "warrantFlow").mockResolvedValue(mk());
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useWarrantFlow("2330", active),
      { wrapper: makeQueryWrapper(), initialProps: { active: false } },
    );
    expect(spy).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.data?.as_of_date).toBe("2026-07-13");
    expect(result.current.noTradingDay).toBe(false);
  });

  it("symbol 空字串不 fetch", () => {
    const spy = vi.spyOn(api, "warrantFlow").mockResolvedValue(mk());
    renderHook(() => useWarrantFlow("", true), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refresh() 帶 force=true 重抓", async () => {
    const spy = vi.spyOn(api, "warrantFlow").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrantFlow("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    result.current.refresh();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[0]?.[1]).toBeFalsy();
    expect(spy.mock.calls[1]?.[1]).toBe(true);
  });

  it("error 終態暴露 message(TanStack retry backoff → waitFor 5s)", async () => {
    vi.spyOn(api, "warrantFlow").mockRejectedValue(new Error("伺服器暫時無法回應"));
    const { result } = renderHook(() => useWarrantFlow("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 5000 });
    expect(result.current.error).toBe("伺服器暫時無法回應");
    expect(result.current.loading).toBe(false);
  });
});
