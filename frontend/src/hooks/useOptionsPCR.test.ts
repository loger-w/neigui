/**
 * @vitest-environment jsdom
 *
 * Characterization(refactor/force-refresh-query S1):拍下 forceRefreshRef
 * 現行語意 — refresh() 使下一發 pcr 參數物件帶 refresh:true,初載不帶。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import type { OptionsPCR } from "../lib/options-types";
import { useOptionsPCR } from "./useOptionsPCR";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mockData = {
  date: "2026-06-23", scope: "all_months", contract: null, fetched_at: "x",
  series: [],
} as unknown as OptionsPCR;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useOptionsPCR", () => {
  it("mount(all_months)抓資料且 refresh 參數 undefined", async () => {
    const spy = vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsPCR("2026-06-23", "all_months"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy.mock.calls[0]?.[0]?.refresh).toBeUndefined();
  });

  it("refresh() 使下一發帶 refresh:true", async () => {
    const spy = vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockData);
    const { result } = renderHook(
      () => useOptionsPCR("2026-06-23", "all_months"),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[0]?.refresh).toBe(true));
  });

  it("per_contract 無 contract 不 fetch(enabled gate)", () => {
    const spy = vi.spyOn(optionsApi, "pcr").mockResolvedValue(mockData);
    renderHook(() => useOptionsPCR("2026-06-23", "per_contract"), {
      wrapper: makeQueryWrapper(),
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
