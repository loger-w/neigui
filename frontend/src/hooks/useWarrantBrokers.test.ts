/**
 * @vitest-environment jsdom
 *
 * useWarrantBrokers — row 展開才抓(SC-6 lazy 單發,不 fan-out 全表)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantBrokersPayload } from "../lib/warrant-data";
import { useWarrantBrokers } from "./useWarrantBrokers";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantBrokersPayload>): WarrantBrokersPayload => ({
  data_date: "2026-07-09",
  rows: [{ broker_name: "凱基-台北", buy: 900, sell: 100, net: 800 }],
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useWarrantBrokers", () => {
  it("warrantId=null 不 fetch(未展開)", () => {
    const spy = vi.spyOn(api, "warrantBrokers").mockResolvedValue(mk());
    renderHook(() => useWarrantBrokers(null), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("展開後單發抓 + 暴露 dataDate", async () => {
    const spy = vi.spyOn(api, "warrantBrokers").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrantBrokers("030012"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.dataDate).toBe("2026-07-09"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.data?.rows[0]?.net).toBe(800);
  });

  it("全空(data_date null)不視為 error", async () => {
    vi.spyOn(api, "warrantBrokers").mockResolvedValue(mk({ data_date: null, rows: [] }));
    const { result } = renderHook(() => useWarrantBrokers("030012"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.dataDate).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
