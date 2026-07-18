/**
 * @vitest-environment jsdom
 *
 * useWarrantFlowHistory — 外部淨額時序 hook(useWarrantFlow 同構;
 * refresh() 對映 backfill=true,不是 refresh 語意 — design §3.2 divergence)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantFlowHistoryPayload } from "../lib/warrant-flow-data";
import { useWarrantFlowHistory } from "./useWarrantFlowHistory";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantFlowHistoryPayload>): WarrantFlowHistoryPayload => ({
  window: 20,
  built: 2,
  missing_count: 18,
  backfilled: 0,
  empty_reason: null,
  days: [
    {
      date: "2026-07-10",
      status: "built",
      call: { trade_value: 1e8, external_net: 100 },
      put: { trade_value: 1e7, external_net: null },
    },
    {
      date: "2026-07-13",
      status: "built",
      call: { trade_value: 1.2e8, external_net: -50 },
      put: { trade_value: 1.1e7, external_net: 30 },
    },
  ],
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useWarrantFlowHistory", () => {
  it("active=false / symbol 空 不 fetch", () => {
    const spy = vi.spyOn(api, "warrantFlowHistory").mockResolvedValue(mk());
    renderHook(() => useWarrantFlowHistory("2330", false), { wrapper: makeQueryWrapper() });
    renderHook(() => useWarrantFlowHistory("", true), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("active 時 fetch 且首發不帶 backfill;暴露 { data, loading, error, refresh }", async () => {
    const spy = vi.spyOn(api, "warrantFlowHistory").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrantFlowHistory("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBeFalsy(); // 預設 cache-only,零補建
    expect(result.current.data?.built).toBe(2);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refresh).toBe("function");
  });

  it("refresh() 帶 backfill=true(SC-3 顯式補建)", async () => {
    const spy = vi.spyOn(api, "warrantFlowHistory").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrantFlowHistory("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    result.current.refresh();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[1]).toBe(true);
  });

  it("error 終態暴露 message(retry backoff → waitFor 5s)", async () => {
    vi.spyOn(api, "warrantFlowHistory").mockRejectedValue(new Error("伺服器暫時無法回應"));
    const { result } = renderHook(() => useWarrantFlowHistory("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 5000 });
    expect(result.current.error).toBe("伺服器暫時無法回應");
  });
});
