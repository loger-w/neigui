/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useForeignFutures } from "./useForeignFutures";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

// 痛點:options-page-v2 SC-5 — 外資期貨對照行的資料通路。

const mockData = {
  date: "2026-06-26", fetched_at: "x", as_of_date: "2026-06-26",
  current: { long_oi: 6178, short_oi: 87230, net_oi: -81052 },
  series: [{ date: "2026-06-26", net_oi: -81052 }],
  data_quality_warnings: [],
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useForeignFutures", () => {
  it("fires the api on mount with signal", async () => {
    const spy = vi.spyOn(optionsApi, "foreignFutures").mockResolvedValue(mockData);
    const { result } = renderHook(() => useForeignFutures("2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith(
      "2026-06-26", undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "foreignFutures").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useForeignFutures("2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("refresh action calls api with refresh=true", async () => {
    const spy = vi.spyOn(optionsApi, "foreignFutures").mockResolvedValue(mockData);
    const { result } = renderHook(() => useForeignFutures("2026-06-26"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[1]).toBe(true));
  });
});
