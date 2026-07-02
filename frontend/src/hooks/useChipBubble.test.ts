/**
 * @vitest-environment jsdom
 *
 * Characterization tests — capture useChipBubble's current behaviour before
 * the TanStack Query refactor so any post-refactor regression is caught.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ChipBubbleData } from "../lib/chip-data";
import { useChipBubble } from "./useChipBubble";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (symbol: string): ChipBubbleData =>
  ({ symbol, fetched_at: "", brokers: [] }) as unknown as ChipBubbleData;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useChipBubble", () => {
  it("does not fetch when symbol is empty", async () => {
    const spy = vi.spyOn(api, "chipBubble");
    const { result } = renderHook(() => useChipBubble("", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("fires on mount and exposes data", async () => {
    const spy = vi.spyOn(api, "chipBubble").mockResolvedValue(mk("2330"));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.symbol).toBe("2330"));
    expect(spy).toHaveBeenCalledWith("2330", "2026-06-22", false, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("refresh() re-fetches with refresh=true", async () => {
    const spy = vi.spyOn(api, "chipBubble").mockResolvedValue(mk("2330"));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[2]).toBe(true);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(api, "chipBubble").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });
});
