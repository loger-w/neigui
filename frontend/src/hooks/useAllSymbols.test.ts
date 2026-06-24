/**
 * @vitest-environment jsdom
 *
 * Characterization tests — capture useAllSymbols's current behaviour before
 * the TanStack Query refactor. The module-level cache (and its
 * `__resetAllSymbolsCacheForTesting` reset) is part of the current contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import { useAllSymbols, __resetAllSymbolsCacheForTesting } from "./useAllSymbols";

beforeEach(() => {
  vi.restoreAllMocks();
  __resetAllSymbolsCacheForTesting();
});
afterEach(() => cleanup());

describe("useAllSymbols", () => {
  it("fires on mount and exposes symbols", async () => {
    const spy = vi.spyOn(api, "symbolsAll").mockResolvedValue([
      { symbol: "2330", name: "台積電" },
    ]);
    const { result } = renderHook(() => useAllSymbols());
    await waitFor(() => expect(result.current.symbols.length).toBe(1));
    expect(result.current.symbols[0]?.symbol).toBe("2330");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(api, "symbolsAll").mockRejectedValue(new Error("net"));
    const { result } = renderHook(() => useAllSymbols());
    await waitFor(() => expect(result.current.error).toBe("net"));
    expect(result.current.loading).toBe(false);
  });

  it("loading is true while in-flight then false after resolve", async () => {
    let resolveIt!: (v: { symbol: string; name: string }[]) => void;
    vi.spyOn(api, "symbolsAll").mockImplementation(
      () => new Promise((r) => { resolveIt = r; }),
    );
    const { result } = renderHook(() => useAllSymbols());
    expect(result.current.loading).toBe(true);
    resolveIt([{ symbol: "2330", name: "台積電" }]);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
