/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsStrikeVolume } from "./useOptionsStrikeVolume";

const mockData = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [], put: [],
};

beforeEach(() => vi.restoreAllMocks());

describe("useOptionsStrikeVolume", () => {
  it("fires the api on mount with top_n=10 by default", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    const { result } = renderHook(() =>
      useOptionsStrikeVolume("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith("TXO202607", "2026-06-23", 10, undefined);
  });

  it("passes a custom topN", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    renderHook(() => useOptionsStrikeVolume("TXO202607", "2026-06-23", 5));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][2]).toBe(5);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "strikeVolume").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useOptionsStrikeVolume("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });
});
