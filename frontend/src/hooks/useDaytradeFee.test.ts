/**
 * @vitest-environment jsdom
 *
 * useDaytradeFee — 券差 hook(useChipBubble 樣板)。頁面只在 borrow mode
 * mount(App.tsx 4-way ternary),mount 即 fetch。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { BorrowFeeData } from "../lib/borrow-fee";
import { useDaytradeFee } from "./useDaytradeFee";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (over?: Partial<BorrowFeeData>): BorrowFeeData => ({
  as_of_date: "2026-06-26",
  rows: [],
  month_counts: {},
  ...over,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useDaytradeFee", () => {
  it("mount 即 fetch 並暴露 data(帶 AbortSignal)", async () => {
    const spy = vi.spyOn(api, "daytradeFee").mockResolvedValue(mk());
    const { result } = renderHook(() => useDaytradeFee(), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.as_of_date).toBe("2026-06-26"));
    expect(spy).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.noTradingDay).toBe(false);
  });

  it("refresh() 帶 refresh=true 重抓", async () => {
    const spy = vi.spyOn(api, "daytradeFee").mockResolvedValue(mk());
    const { result } = renderHook(() => useDaytradeFee(), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]?.[0]).toBe(true);
  });

  it("no_trading_day flag 導出為 noTradingDay", async () => {
    vi.spyOn(api, "daytradeFee").mockResolvedValue(mk({ no_trading_day: true }));
    const { result } = renderHook(() => useDaytradeFee(), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.noTradingDay).toBe(true));
  });

  it("error 終態(TanStack v5 retry backoff — waitFor 5s)", async () => {
    vi.spyOn(api, "daytradeFee").mockRejectedValue(new Error("borrow_fee_upstream"));
    const { result } = renderHook(() => useDaytradeFee(), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("borrow_fee_upstream"), {
      timeout: 5000,
    });
    expect(result.current.data).toBeNull();
  });
});
