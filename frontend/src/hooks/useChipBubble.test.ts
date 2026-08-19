/**
 * @vitest-environment jsdom
 *
 * Characterization tests — capture useChipBubble's current behaviour before
 * the TanStack Query refactor so any post-refactor regression is caught.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ChipBubbleData, ChipBubbleWindowData } from "../lib/chip-data";
import { useChipBubble } from "./useChipBubble";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

const mk = (symbol: string): ChipBubbleData =>
  ({ symbol, fetched_at: "", brokers: [] }) as unknown as ChipBubbleData;

const mkWindow = (
  symbol: string, windowDays: number, actualDays: number, tradingDates: string[] = [],
): ChipBubbleWindowData =>
  ({
    symbol, date: "2026-06-22", fetched_at: "", trades: [],
    window_days: windowDays, trading_dates: tradingDates, actual_days: actualDays,
  }) as unknown as ChipBubbleWindowData;

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

// SC-3:days 參數分流端點。days 省略 / =1 走既有 /bubble(白名單:行為
// bit-for-bit),days>1 走 /bubble_window 並曝光 windowMeta。
describe("useChipBubble — days 分流(SC-3)", () => {
  it("days 省略 → 走 api.chipBubble,windowMeta 為 null", async () => {
    const single = vi.spyOn(api, "chipBubble").mockResolvedValue(mk("2330"));
    const window = vi.spyOn(api, "chipBubbleWindow").mockResolvedValue(mkWindow("2330", 5, 5));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.symbol).toBe("2330"));
    expect(single).toHaveBeenCalledTimes(1);
    expect(window).not.toHaveBeenCalled();
    expect(result.current.windowMeta).toBeNull();
  });

  it("days=1 → 走 api.chipBubble,windowMeta 為 null", async () => {
    const single = vi.spyOn(api, "chipBubble").mockResolvedValue(mk("2330"));
    const window = vi.spyOn(api, "chipBubbleWindow").mockResolvedValue(mkWindow("2330", 5, 5));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22", 1), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.symbol).toBe("2330"));
    expect(single).toHaveBeenCalledTimes(1);
    expect(window).not.toHaveBeenCalled();
    expect(result.current.windowMeta).toBeNull();
  });

  it("days=5 → 走 api.chipBubbleWindow 並曝光 windowMeta", async () => {
    const single = vi.spyOn(api, "chipBubble").mockResolvedValue(mk("2330"));
    const window = vi.spyOn(api, "chipBubbleWindow").mockResolvedValue(mkWindow("2330", 5, 3));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22", 5), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.symbol).toBe("2330"));
    expect(single).not.toHaveBeenCalled();
    expect(window).toHaveBeenCalledWith(
      "2330", "2026-06-22", 5, false,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.windowMeta).toEqual({ windowDays: 5, actualDays: 3, tradingDates: [] });
  });

  it("days=5 時 refresh() 帶 refresh=true 打 window 端點", async () => {
    const window = vi.spyOn(api, "chipBubbleWindow").mockResolvedValue(mkWindow("2330", 5, 5));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22", 5), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(window).toHaveBeenCalledTimes(1));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(window).toHaveBeenCalledTimes(2));
    expect(window.mock.calls[1]?.[3]).toBe(true);
  });

  it("days 改變 → queryKey 變動觸發重新 fetch", async () => {
    const single = vi.spyOn(api, "chipBubble").mockResolvedValue(mk("2330"));
    const window = vi.spyOn(api, "chipBubbleWindow").mockResolvedValue(mkWindow("2330", 5, 5));
    const { result, rerender } = renderHook(
      ({ days }: { days: number }) => useChipBubble("2330", "2026-06-22", days),
      { wrapper: makeQueryWrapper(), initialProps: { days: 1 } },
    );
    await waitFor(() => expect(single).toHaveBeenCalledTimes(1));

    rerender({ days: 5 });
    await waitFor(() => expect(window).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.windowMeta).toEqual({ windowDays: 5, actualDays: 5, tradingDates: [] }),
    );
  });
});

// SC-4:每日開收標示需要「這個視窗涵蓋哪幾個交易日」— payload 的 trading_dates
// 直接曝光成 windowMeta.tradingDates(additive,windowDays / actualDays 不變)。
describe("useChipBubble — windowMeta.tradingDates(SC-4)", () => {
  it("days>1 → tradingDates 直通 payload 的 trading_dates", async () => {
    const dates = ["2026-06-18", "2026-06-19", "2026-06-20"];
    vi.spyOn(api, "chipBubbleWindow").mockResolvedValue(mkWindow("2330", 5, 3, dates));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22", 5), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.windowMeta).not.toBeNull());
    expect(result.current.windowMeta).toEqual({
      windowDays: 5, actualDays: 3, tradingDates: dates,
    });
  });

  it("days=1 → windowMeta 仍為 null(不冒出空 tradingDates)", async () => {
    vi.spyOn(api, "chipBubble").mockResolvedValue(mk("2330"));
    const { result } = renderHook(() => useChipBubble("2330", "2026-06-22", 1), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.symbol).toBe("2330"));
    expect(result.current.windowMeta).toBeNull();
  });

  // [review F1] 消費端(App 的 bubbleDayMarks useMemo)以 windowMeta 為依賴 →
  // 資料沒變就必須是同一個物件參考,否則下游 memo 每 render 全 miss。
  it("資料未變的 rerender → windowMeta 物件參考不變(下游 memo 不 miss)", async () => {
    const dates = ["2026-06-18", "2026-06-19", "2026-06-20"];
    vi.spyOn(api, "chipBubbleWindow").mockResolvedValue(mkWindow("2330", 5, 3, dates));
    const { result, rerender } = renderHook(
      () => useChipBubble("2330", "2026-06-22", 5),
      { wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.windowMeta).not.toBeNull());
    const first = result.current.windowMeta;
    rerender();
    expect(result.current.windowMeta).toBe(first);
  });
});
