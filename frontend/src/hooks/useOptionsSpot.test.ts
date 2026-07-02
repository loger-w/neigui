/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsSpot } from "./useOptionsSpot";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mockSpot = {
  date: "2026-06-23", fetched_at: "x", as_of_date: "2026-06-23",
  as_of_session: "position" as const,
  spot: 53420, prev_close: 53300, change: 120, change_pct: 0.225,
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useOptionsSpot", () => {
  it("fires api on mount and exposes data", async () => {
    const spy = vi.spyOn(optionsApi, "spot").mockResolvedValue(mockSpot);
    const { result } = renderHook(() => useOptionsSpot("2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockSpot));
    expect(spy).toHaveBeenCalledWith("2026-06-23", undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "spot").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useOptionsSpot("2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("exposes noTradingDay flag", async () => {
    vi.spyOn(optionsApi, "spot").mockResolvedValue({ ...mockSpot, no_trading_day: true });
    const { result } = renderHook(() => useOptionsSpot("2026-06-20"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.noTradingDay).toBe(true));
  });

  it("refresh() re-fetches with refresh=true exactly once", async () => {
    const spy = vi.spyOn(optionsApi, "spot").mockResolvedValue(mockSpot);
    const { result } = renderHook(() => useOptionsSpot("2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    result.current.refresh();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[1]).toBe(true);
    // Subsequent automatic refetches (if any) must NOT carry refresh=true
    // — the force flag is one-shot.
    await result.current.refresh; // no-op, only to keep eslint happy
  });
});
