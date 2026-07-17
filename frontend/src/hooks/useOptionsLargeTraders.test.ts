/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsLargeTraders } from "./useOptionsLargeTraders";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mockData = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  current: {
    top5_prop:  { long: 1, short: 1, net: 0 },
    top10_prop: { long: 1, short: 1, net: 0 },
    top5_all:   { long: 1, short: 1, net: 0 },
    top10_all:  { long: 1, short: 1, net: 0 },
  },
  series: [],
};

beforeEach(() => vi.restoreAllMocks());

describe("useOptionsLargeTraders", () => {
  it("fires the api on mount and exposes the data", async () => {
    const spy = vi.spyOn(optionsApi, "largeTraders").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsLargeTraders("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith("TXO202607", "2026-06-23", undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "largeTraders").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(
      () => useOptionsLargeTraders("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("does nothing when contract is empty", async () => {
    const spy = vi.spyOn(optionsApi, "largeTraders").mockResolvedValue(mockData);
    renderHook(() => useOptionsLargeTraders("", "2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    // No await — should never be called.
    expect(spy).not.toHaveBeenCalled();
  });

  it("refresh() 使下一發帶 refresh=true(characterization,S1)", async () => {
    const spy = vi.spyOn(optionsApi, "largeTraders").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsLargeTraders("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[2]).toBe(true));
  });

  it("exposes noTradingDay flag from payload", async () => {
    vi.spyOn(optionsApi, "largeTraders").mockResolvedValue({
      ...mockData, no_trading_day: true,
    });
    const { result } = renderHook(
      () => useOptionsLargeTraders("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.noTradingDay).toBe(true));
  });
});
