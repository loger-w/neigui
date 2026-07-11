/**
 * @vitest-environment jsdom
 *
 * useWarrants — EOD 快照 hook(enabled gate:tab 未開不抓)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { WarrantsPayload } from "../lib/warrant-data";
import { useWarrants } from "./useWarrants";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<WarrantsPayload>): WarrantsPayload => ({
  as_of_date: "2026-07-09",
  warrants: [],
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useWarrants", () => {
  it("enabled 才 fetch,並暴露 asOfDate", async () => {
    const spy = vi.spyOn(api, "warrants").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrants("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.asOfDate).toBe("2026-07-09"));
    expect(spy).toHaveBeenCalledWith(
      "2330",
      false,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("enabled=false / 空 symbol 不 fetch", () => {
    const spy = vi.spyOn(api, "warrants").mockResolvedValue(mk());
    renderHook(() => useWarrants("2330", false), { wrapper: makeQueryWrapper() });
    renderHook(() => useWarrants("", true), { wrapper: makeQueryWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refresh() 帶 refresh=true", async () => {
    const spy = vi.spyOn(api, "warrants").mockResolvedValue(mk());
    const { result } = renderHook(() => useWarrants("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[1]).toBe(true);
  });

  it("error 終態(retry backoff — waitFor 5s)", async () => {
    vi.spyOn(api, "warrants").mockRejectedValue(new Error("warrant_upstream"));
    const { result } = renderHook(() => useWarrants("2330", true), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("warrant_upstream"), {
      timeout: 5000,
    });
    expect(result.current.data).toBeNull();
  });
});
