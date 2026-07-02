/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ChipIntraday } from "../lib/chip-data";
import { useChipIntraday } from "./useChipIntraday";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (symbol: string): ChipIntraday => ({
  symbol,
  date: "2026-06-26",
  fetched_at: "2026-06-26T15:55:00",
  points: [
    { t: "09:00", price: 2360 },
    { t: "13:30", price: 2340 },
  ],
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useChipIntraday", () => {
  it("does not fetch when symbol is empty", async () => {
    const spy = vi.spyOn(api, "chipIntraday");
    const { result } = renderHook(() => useChipIntraday("", "2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("fires on mount and exposes data", async () => {
    const spy = vi.spyOn(api, "chipIntraday").mockResolvedValue(mk("2330"));
    const { result } = renderHook(() => useChipIntraday("2330", "2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.symbol).toBe("2330"));
    expect(spy).toHaveBeenCalledWith("2330", "2026-06-26", false, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("refresh() re-fetches with refresh=true", async () => {
    const spy = vi.spyOn(api, "chipIntraday").mockResolvedValue(mk("2330"));
    const { result } = renderHook(() => useChipIntraday("2330", "2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[2]).toBe(true);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(api, "chipIntraday").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useChipIntraday("2330", "2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });
});
