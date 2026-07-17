/**
 * @vitest-environment jsdom
 *
 * Characterization(refactor/force-refresh-query S1):拍下 forceRefreshRef
 * 現行語意 — refresh() 使下一發 fetch 帶 refresh=true,初載與後續不帶。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import type { OptionsInstitutional } from "../lib/options-types";
import { useInstitutionalOptions } from "./useInstitutionalOptions";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mockData = {
  date: "2026-06-23", fetched_at: "x", series: [],
} as unknown as OptionsInstitutional;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useInstitutionalOptions", () => {
  it("mount 抓資料且不帶 refresh(第 2 參數 undefined)", async () => {
    const spy = vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockData);
    const { result } = renderHook(() => useInstitutionalOptions("2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("refresh() 使下一發帶 refresh=true", async () => {
    const spy = vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockData);
    const { result } = renderHook(() => useInstitutionalOptions("2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[1]).toBe(true));
  });

  it("noTradingDay 由 payload 派生", async () => {
    vi.spyOn(optionsApi, "institutional").mockResolvedValue({
      ...mockData, no_trading_day: true,
    } as OptionsInstitutional);
    const { result } = renderHook(() => useInstitutionalOptions("2026-06-23"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.noTradingDay).toBe(true));
  });
});
