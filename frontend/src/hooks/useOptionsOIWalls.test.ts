/**
 * @vitest-environment jsdom
 *
 * Characterization(refactor/force-refresh-query S1):拍下 forceRefreshRef
 * 現行語意 — refresh() 使下一發 fetch 帶 refresh=true(第 3 參數),初載不帶。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import type { OptionsOIWalls } from "../lib/options-types";
import { useOptionsOIWalls } from "./useOptionsOIWalls";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mockData = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
} as unknown as OptionsOIWalls;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useOptionsOIWalls", () => {
  it("mount 抓資料且不帶 refresh(第 3 參數 undefined)", async () => {
    const spy = vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsOIWalls("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("refresh() 使下一發帶 refresh=true", async () => {
    const spy = vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsOIWalls("TXO202607", "2026-06-23"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[2]).toBe(true));
  });

  it("空 contract 不 fetch(enabled gate)", () => {
    const spy = vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockData);
    renderHook(() => useOptionsOIWalls("", "2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
