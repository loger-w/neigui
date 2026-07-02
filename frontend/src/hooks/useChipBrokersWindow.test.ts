/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ChipBrokersWindow } from "../lib/chip-data";
import { useChipBrokersWindow } from "./useChipBrokersWindow";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (windowDays: number): ChipBrokersWindow => ({
  symbol: "2330",
  date: "2026-06-19",
  window_days: windowDays,
  trading_dates: ["2026-06-19"],
  actual_days: 1,
  fetched_at: "",
  top_brokers: [],
  margin: {
    margin_purchase: { balance: 0, change: 0, limit: 0 },
    short_sale: { balance: 0, change: 0, limit: 0 },
    short_balance_ratio: 0,
  },
  institutional: {
    foreign: { buy: 0, sell: 0, net: 0 },
    trust: { buy: 0, sell: 0, net: 0 },
    dealer: { buy: 0, sell: 0, net: 0 },
  },
  total_traded_lots: 0,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useChipBrokersWindow", () => {
  it("does not fetch when symbol is empty", async () => {
    const spy = vi.spyOn(api, "chipBrokersWindow");
    const { result } = renderHook(
      () => useChipBrokersWindow("", "2026-06-19", 30),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("does not fetch when date is empty", async () => {
    const spy = vi.spyOn(api, "chipBrokersWindow");
    const { result } = renderHook(
      () => useChipBrokersWindow("2330", "", 30),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("fires on mount with (symbol, date, windowDays, false)", async () => {
    const spy = vi.spyOn(api, "chipBrokersWindow").mockResolvedValue(mk(30));
    const { result } = renderHook(
      () => useChipBrokersWindow("2330", "2026-06-19", 30),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data?.symbol).toBe("2330"));
    expect(spy).toHaveBeenCalledWith("2330", "2026-06-19", 30, false, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("windowDays change triggers refetch on new queryKey", async () => {
    const spy = vi.spyOn(api, "chipBrokersWindow")
      .mockResolvedValueOnce(mk(30))
      .mockResolvedValueOnce(mk(60));
    const { rerender } = renderHook(
      ({ days }: { days: number }) =>
        useChipBrokersWindow("2330", "2026-06-19", days),
      { initialProps: { days: 30 }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    rerender({ days: 60 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]![2]).toBe(60);
  });

  it("refresh() forces api with refresh=true", async () => {
    const spy = vi.spyOn(api, "chipBrokersWindow").mockResolvedValue(mk(30));
    const { result } = renderHook(
      () => useChipBrokersWindow("2330", "2026-06-19", 30),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]![3]).toBe(true);
  });

  it("placeholderData keeps previous window visible while new loads", async () => {
    let resolveSecond!: (v: ChipBrokersWindow) => void;
    vi.spyOn(api, "chipBrokersWindow")
      .mockResolvedValueOnce(mk(30))
      .mockImplementationOnce(
        () =>
          new Promise<ChipBrokersWindow>((r) => {
            resolveSecond = r;
          }),
      );
    const { result, rerender } = renderHook(
      ({ days }: { days: number }) =>
        useChipBrokersWindow("2330", "2026-06-19", days),
      { initialProps: { days: 30 }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.data?.window_days).toBe(30));
    rerender({ days: 60 });
    // 仍可見上一窗的資料,不會 null 閃爍
    expect(result.current.data?.window_days).toBe(30);
    expect(result.current.loading).toBe(true);
    resolveSecond(mk(60));
    await waitFor(() => expect(result.current.data?.window_days).toBe(60));
  });

  it("sets error on rejection", async () => {
    vi.spyOn(api, "chipBrokersWindow").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(
      () => useChipBrokersWindow("2330", "2026-06-19", 30),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });
});
