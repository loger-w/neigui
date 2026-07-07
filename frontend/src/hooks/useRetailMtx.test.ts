/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useRetailMtx } from "./useRetailMtx";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

// 痛點:options-page-v2 SC-4 — 溫度計散戶格的資料通路,標準 hook shape
// {data, loading, error, refresh, noTradingDay}(CLAUDE.md §3)。

const mockData = {
  date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: { retail_long: 36000, retail_short: 31000, ratio: 0.12 },
  series: [{ date: "2026-06-26", ratio: 0.12 }],
  dropped_days: 0,
  data_quality_warnings: [],
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useRetailMtx", () => {
  it("fires the api on mount with signal", async () => {
    const spy = vi.spyOn(optionsApi, "retailMtx").mockResolvedValue(mockData);
    const { result } = renderHook(() => useRetailMtx("2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith(
      "2026-06-26", undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "retailMtx").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRetailMtx("2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("refresh action calls api with refresh=true", async () => {
    const spy = vi.spyOn(optionsApi, "retailMtx").mockResolvedValue(mockData);
    const { result } = renderHook(() => useRetailMtx("2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[1]).toBe(true));
  });

  it("exposes noTradingDay flag", async () => {
    vi.spyOn(optionsApi, "retailMtx").mockResolvedValue({
      ...mockData, no_trading_day: true,
    });
    const { result } = renderHook(() => useRetailMtx("2026-06-28"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.noTradingDay).toBe(true));
  });
});
