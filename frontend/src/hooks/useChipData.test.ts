/**
 * @vitest-environment jsdom
 *
 * Cluster B 🔴: useChipData must split summary + history into independent
 * fetches so date-pick refreshes only the right panel, not the whole page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ChipHistoryMajor } from "../lib/api";
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

const mkHistoryMajor = (): ChipHistoryMajor => ({
  symbol: "2330",
  fetched_at: "",
  last_date: "2026-06-22",
  major: [],
});

/** All three spies wired the same way every test needs. */
function spyChipApis() {
  return {
    chip: vi.spyOn(api, "chip").mockResolvedValue(mkSummary("2026-06-22")),
    base: vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory()),
    major: vi.spyOn(api, "chipHistoryMajor").mockResolvedValue(mkHistoryMajor()),
  };
}

describe("useChipData split fetches", () => {
  it("initial mount fires summary + base + major fast(150) then full(540)", async () => {
    const { chip, base, major } = spyChipApis();
    renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(1);
      expect(base).toHaveBeenCalledTimes(1);
      // fast 150d window first; full 540d fires only after fast succeeds
      expect(major).toHaveBeenCalledTimes(2);
    });
    expect(major.mock.calls[0]![1]).toBe(150);
    expect(major.mock.calls[1]![1]).toBe(540);
  });

  it("full 540 does NOT fire until fast 150 resolves", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    const majorResolvers: ((v: ChipHistoryMajor) => void)[] = [];
    const major = vi.spyOn(api, "chipHistoryMajor").mockImplementation(
      () =>
        new Promise<ChipHistoryMajor>((r) => {
          majorResolvers.push(r);
        }),
    );
    renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    expect(major.mock.calls[0]![1]).toBe(150);
    // fast still pending → full must not have fired
    await new Promise((r) => setTimeout(r, 30));
    expect(major).toHaveBeenCalledTimes(1);
    majorResolvers[0]!(mkHistoryMajor());
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2));
    expect(major.mock.calls[1]![1]).toBe(540);
  });

  it("fast failure surfaces error and never fires full", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    const major = vi
      .spyOn(api, "chipHistoryMajor")
      .mockRejectedValue(new Error("major_unavailable"));
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("major_unavailable"));
    expect(major).toHaveBeenCalledTimes(1); // fast only — full stays gated
  });

  it("date change fires api.chip ONLY (not history endpoints)", async () => {
    const { chip, base, major } = spyChipApis();
    const { rerender } = renderHook(
      ({ d }: { d: string }) => useChipData("2330", d),
      { initialProps: { d: "2026-06-22" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(chip).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2)); // fast + full
    expect(base).toHaveBeenCalledTimes(1);
    rerender({ d: "2026-06-21" });
    await waitFor(() => expect(chip).toHaveBeenCalledTimes(2));
    expect(base).toHaveBeenCalledTimes(1); // unchanged
    expect(major).toHaveBeenCalledTimes(2); // unchanged
  });

  it("symbol change fires all three endpoints", async () => {
    const { chip, base, major } = spyChipApis();
    const { rerender } = renderHook(
      ({ sym }: { sym: string }) => useChipData(sym, "2026-06-22"),
      { initialProps: { sym: "2330" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(1);
      expect(base).toHaveBeenCalledTimes(1);
      expect(major).toHaveBeenCalledTimes(2); // fast + full
    });
    rerender({ sym: "2454" });
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(2);
      expect(base).toHaveBeenCalledTimes(2);
      expect(major).toHaveBeenCalledTimes(4); // fast + full again
    });
  });

  it("history persists across date change (no null flash)", async () => {
    spyChipApis();
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
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    vi.spyOn(api, "chipHistoryMajor").mockResolvedValue(mkHistoryMajor());
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

  it("loading = summaryLoading OR historyLoading; majorLoading clears on FAST landing", async () => {
    let resolveBase!: (v: ChipHistory) => void;
    const majorResolvers: ((v: ChipHistoryMajor) => void)[] = [];
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockImplementation(
      () =>
        new Promise<ChipHistory>((r) => {
          resolveBase = r;
        }),
    );
    vi.spyOn(api, "chipHistoryMajor").mockImplementation(
      () =>
        new Promise<ChipHistoryMajor>((r) => {
          majorResolvers.push(r);
        }),
    );
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    expect(result.current.summaryLoading).toBe(false);
    expect(result.current.historyLoading).toBe(true);
    expect(result.current.majorLoading).toBe(true);
    expect(result.current.loading).toBe(true);
    // Resolving base alone is enough to flip global `loading` off — major
    // continues in background without blocking the "重新整理" spinner.
    resolveBase(mkHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.majorLoading).toBe(true);
    // FAST window lands → the visible subchart has data, overlay must clear
    // even though the background 540d fill is still pending.
    majorResolvers[0]!(mkHistoryMajor());
    await waitFor(() => expect(result.current.majorLoading).toBe(false));
  });

  it("refresh() forces all endpoints (fast + full major) with refresh=true", async () => {
    const { chip, base, major } = spyChipApis();
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2));
    act(() => result.current.refresh());
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(2);
      expect(base).toHaveBeenCalledTimes(2);
      expect(major).toHaveBeenCalledTimes(4);
    });
    expect(chip.mock.calls[1]![2]).toBe(true);
    expect(base.mock.calls[1]![1]).toBe(540);
    expect(base.mock.calls[1]![2]).toBe(true);
    // Refresh re-fires both major windows, each forced.
    const refreshedDays = [major.mock.calls[2]![1], major.mock.calls[3]![1]].sort((a, b) => a - b);
    expect(refreshedDays).toEqual([150, 540]);
    expect(major.mock.calls[2]![2]).toBe(true);
    expect(major.mock.calls[3]![2]).toBe(true);
  });

  it("base carries days=540; major fast=150 then full=540", async () => {
    const { base, major } = spyChipApis();
    renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => {
      expect(base).toHaveBeenCalledTimes(1);
      expect(major).toHaveBeenCalledTimes(2);
    });
    expect(base.mock.calls[0]![1]).toBe(540);
    expect(major.mock.calls[0]![1]).toBe(150);
    expect(major.mock.calls[1]![1]).toBe(540);
  });

  it("merged major uses fast rows first, then full rows replace them", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    vi.spyOn(api, "chipHistoryMajor")
      .mockResolvedValueOnce({
        ...mkHistoryMajor(),
        major: [{ date: "2026-06-22", major_net: 1 }],
      })
      .mockResolvedValueOnce({
        ...mkHistoryMajor(),
        major: [
          { date: "2026-06-21", major_net: 2 },
          { date: "2026-06-22", major_net: 1 },
        ],
      });
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    // full (2 rows) eventually replaces fast (1 row); fast row visible en route
    await waitFor(() => expect(result.current.history?.major.length).toBe(2));
    expect(result.current.history?.major[0]?.major_net).toBe(2);
  });

  it("history merges base + major: major[] empty until major lands", async () => {
    let resolveMajor!: (v: ReturnType<typeof mkHistoryMajor>) => void;
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue({
      ...mkHistory(),
      candles: [
        { date: "2026-06-22", open: 1, high: 1, low: 1, close: 1, volume: 0 },
      ],
    });
    vi.spyOn(api, "chipHistoryMajor").mockImplementation(
      () =>
        new Promise<ReturnType<typeof mkHistoryMajor>>((r) => {
          resolveMajor = r;
        }),
    );
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    // base lands first → K-line ready, major still empty
    await waitFor(() => expect(result.current.history?.candles.length).toBe(1));
    expect(result.current.history?.major).toEqual([]);
    expect(result.current.majorLoading).toBe(true);
    // major arrives → merged in
    resolveMajor({
      symbol: "2330",
      fetched_at: "",
      last_date: "2026-06-22",
      major: [{ date: "2026-06-22", major_net: 123 }],
    });
    await waitFor(() => expect(result.current.history?.major.length).toBe(1));
    expect(result.current.history?.major[0]?.major_net).toBe(123);
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
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    vi.spyOn(api, "chipHistoryMajor").mockResolvedValue(mkHistoryMajor());
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
