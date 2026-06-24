/**
 * @vitest-environment jsdom
 *
 * Cluster B 🔴: useChipData must split summary + history into independent
 * fetches so date-pick refreshes only the right panel, not the whole page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ChipHistory, ChipSummary } from "../lib/chip-data";
import { useChipData } from "./useChipData";
import { makeQueryWrapper } from "../test-utils/query-wrapper";

beforeEach(() => vi.restoreAllMocks());

const mkSummary = (date: string): ChipSummary =>
  ({
    symbol: "2330",
    date,
    fetched_at: "",
    institutional: {
      foreign: { buy: 0, sell: 0, net: 0 },
      trust: { buy: 0, sell: 0, net: 0 },
      dealer: { buy: 0, sell: 0, net: 0 },
    },
    margin: {
      margin_purchase: { balance: 0, change: 0, limit: 0 },
      short_sale: { balance: 0, change: 0, limit: 0 },
      short_balance_ratio: 0,
    },
    top_brokers: [],
  }) as ChipSummary;

const mkHistory = (): ChipHistory =>
  ({
    symbol: "2330",
    fetched_at: "",
    last_date: "2026-06-22",
    candles: [],
    institutional: [],
    margin: [],
    major: [],
  }) as ChipHistory;

describe("useChipData split fetches", () => {
  it("initial mount fires both api.chip and api.chipHistory", async () => {
    const chipSpy = vi.spyOn(api, "chip").mockResolvedValue(mkSummary("2026-06-22"));
    const histSpy = vi.spyOn(api, "chipHistory").mockResolvedValue(mkHistory());
    renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => {
      expect(chipSpy).toHaveBeenCalledTimes(1);
      expect(histSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("date change fires api.chip ONLY (not api.chipHistory)", async () => {
    const chipSpy = vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    const histSpy = vi.spyOn(api, "chipHistory").mockResolvedValue(mkHistory());
    const { rerender } = renderHook(
      ({ d }: { d: string }) => useChipData("2330", d),
      { initialProps: { d: "2026-06-22" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(chipSpy).toHaveBeenCalledTimes(1));
    expect(histSpy).toHaveBeenCalledTimes(1);
    rerender({ d: "2026-06-21" });
    await waitFor(() => expect(chipSpy).toHaveBeenCalledTimes(2));
    expect(histSpy).toHaveBeenCalledTimes(1); // unchanged
  });

  it("symbol change fires both endpoints", async () => {
    const chipSpy = vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    const histSpy = vi.spyOn(api, "chipHistory").mockResolvedValue(mkHistory());
    const { rerender } = renderHook(
      ({ sym }: { sym: string }) => useChipData(sym, "2026-06-22"),
      { initialProps: { sym: "2330" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => {
      expect(chipSpy).toHaveBeenCalledTimes(1);
      expect(histSpy).toHaveBeenCalledTimes(1);
    });
    rerender({ sym: "2454" });
    await waitFor(() => {
      expect(chipSpy).toHaveBeenCalledTimes(2);
      expect(histSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("history persists across date change (no null flash)", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistory").mockResolvedValue(mkHistory());
    const { result, rerender } = renderHook(
      ({ d }: { d: string }) => useChipData("2330", d),
      { initialProps: { d: "2026-06-22" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.history).not.toBeNull());
    const histRef = result.current.history;
    rerender({ d: "2026-06-21" });
    // History not nulled even momentarily
    expect(result.current.history).toBe(histRef);
  });

  it("summary persists across date change while next loads (no null flash)", async () => {
    let resolveSecond!: (v: ChipSummary) => void;
    vi.spyOn(api, "chip")
      .mockResolvedValueOnce(mkSummary("2026-06-22"))
      .mockImplementationOnce(
        () =>
          new Promise<ChipSummary>((r) => {
            resolveSecond = r;
          }),
      );
    vi.spyOn(api, "chipHistory").mockResolvedValue(mkHistory());
    const { result, rerender } = renderHook(
      ({ d }: { d: string }) => useChipData("2330", d),
      { initialProps: { d: "2026-06-22" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.summary?.date).toBe("2026-06-22"));
    rerender({ d: "2026-06-21" });
    // Mid-flight: previous summary still visible, summaryLoading true
    expect(result.current.summary?.date).toBe("2026-06-22");
    expect(result.current.summaryLoading).toBe(true);
    resolveSecond(mkSummary("2026-06-21"));
    await waitFor(() => expect(result.current.summary?.date).toBe("2026-06-21"));
  });

  it("loading is OR of summaryLoading and historyLoading", async () => {
    let resolveHist!: (v: ChipHistory) => void;
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistory").mockImplementation(
      () =>
        new Promise<ChipHistory>((r) => {
          resolveHist = r;
        }),
    );
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    expect(result.current.summaryLoading).toBe(false);
    expect(result.current.historyLoading).toBe(true);
    expect(result.current.loading).toBe(true);
    resolveHist(mkHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("refresh() forces both endpoints with refresh=true", async () => {
    const chipSpy = vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    const histSpy = vi.spyOn(api, "chipHistory").mockResolvedValue(mkHistory());
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(chipSpy).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => {
      expect(chipSpy).toHaveBeenCalledTimes(2);
      expect(histSpy).toHaveBeenCalledTimes(2);
    });
    expect(chipSpy.mock.calls[1]![2]).toBe(true);
    expect(histSpy.mock.calls[1]![1]).toBe(true);
  });

  it("rapid date flip drops stale summary response (seq)", async () => {
    let resolveFirst!: (v: ChipSummary) => void;
    vi.spyOn(api, "chip")
      .mockImplementationOnce(
        () =>
          new Promise<ChipSummary>((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValueOnce(mkSummary("FRESH"));
    vi.spyOn(api, "chipHistory").mockResolvedValue(mkHistory());
    const { result, rerender } = renderHook(
      ({ d }: { d: string }) => useChipData("2330", d),
      { initialProps: { d: "2026-06-22" }, wrapper: makeQueryWrapper() },
    );
    rerender({ d: "2026-06-21" });
    await waitFor(() => expect(result.current.summary?.date).toBe("FRESH"));
    resolveFirst(mkSummary("STALE"));
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.summary?.date).toBe("FRESH"); // stale dropped
  });
});
