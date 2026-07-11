/**
 * @vitest-environment jsdom
 *
 * useWarrantQuotes — 盤中輪詢 hook。輪詢啟停的兩分支邏輯鎖在純函式
 * quotesRefetchInterval(warrant-utils.test.ts,impl-R8);此處鎖 hook
 * 的 wiring(enabled gate / refresh / extras)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantQuotesPayload } from "../lib/warrant-data";
import { useWarrantQuotes } from "./useWarrantQuotes";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantQuotesPayload>): WarrantQuotesPayload => ({
  stock_id: "2330",
  underlying_price: 100.5,
  quote_date: "2026-07-10",
  quote_time: "13:30",
  quotes: {},
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useWarrantQuotes", () => {
  it("enabled 才 fetch;暴露 quoteDate/quoteTime", async () => {
    const spy = vi.spyOn(api, "warrantQuotes").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrantQuotes("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.quoteTime).toBe("13:30"));
    expect(result.current.quoteDate).toBe("2026-07-10");
    expect(spy).toHaveBeenCalledWith(
      "2330",
      false,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("enabled=false 不 fetch", () => {
    const spy = vi.spyOn(api, "warrantQuotes").mockResolvedValue(mk());
    renderHook(() => useWarrantQuotes("2330", false), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refresh() 帶 refresh=true(跳 backend cooldown)", async () => {
    const spy = vi.spyOn(api, "warrantQuotes").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrantQuotes("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[1]).toBe(true);
  });

  it("error 終態", async () => {
    vi.spyOn(api, "warrantQuotes").mockRejectedValue(new Error("warrant_upstream"));
    const { result } = renderHook(() => useWarrantQuotes("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("warrant_upstream"), {
      timeout: 5000,
    });
  });
});
