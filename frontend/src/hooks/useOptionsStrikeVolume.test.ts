/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsStrikeVolume } from "./useOptionsStrikeVolume";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mockData = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [], put: [],
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useOptionsStrikeVolume", () => {
  it("fires the api on mount without topN", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsStrikeVolume("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith("TXO202607", "2026-06-23", undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "strikeVolume").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(
      () => useOptionsStrikeVolume("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("refresh action calls api with refresh=true", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsStrikeVolume("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[2]).toBe(true));
  });
});
