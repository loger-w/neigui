/**
 * @vitest-environment jsdom
 *
 * Cluster B 🔴: useChipData must split summary + history into independent
 * fetches so date-pick refreshes only the right panel, not the whole page.
 *
 * chip-major-lazy-window 🔴: major 改單一 query + 階梯視窗(150→300→540)。
 * 初載只抓 150;540 不再自動觸發,由 ensureMajorCoverage(可見左界日期)
 * 依覆蓋判斷升檔。該紅/不該紅清單見 .claude/mod/chip-major-lazy-window/change-spec.md §8。
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

const mkHistoryMajor = (over: Partial<ChipHistoryMajor> = {}): ChipHistoryMajor => ({
  symbol: "2330",
  fetched_at: "",
  last_date: "2026-06-22",
  major: [],
  ...over,
});

/** All three spies wired the same way every test needs. */
function spyChipApis() {
  return {
    chip: vi.spyOn(api, "chip").mockResolvedValue(mkSummary("2026-06-22")),
    base: vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory()),
    major: vi.spyOn(api, "chipHistoryMajor").mockResolvedValue(mkHistoryMajor()),
  };
}

// anchor last_date=2026-06-22 的階梯覆蓋左界(對照 date-utils.test.ts):
// 150 → 2026-01-23;300 → 2025-08-26;540 → 2024-12-29。

describe("useChipData split fetches", () => {
  it("initial mount fires summary + base(540) + ONE major(150); 540 never auto-fires", async () => {
    const { chip, base, major } = spyChipApis();
    renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(1);
      expect(base).toHaveBeenCalledTimes(1);
      expect(major).toHaveBeenCalledTimes(1);
    });
    expect(base.mock.calls[0]![1]).toBe(540);
    expect(major.mock.calls[0]![1]).toBe(150);
    // lazy-window 核心:150 落地後靜置,不得自動補 540
    await new Promise((r) => setTimeout(r, 50));
    expect(major).toHaveBeenCalledTimes(1);
  });

  it("major failure surfaces error; no retry storm", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    const major = vi
      .spyOn(api, "chipHistoryMajor")
      .mockRejectedValue(new Error("major_unavailable"));
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBe("major_unavailable"));
    expect(major).toHaveBeenCalledTimes(1);
  });

  it("date change fires api.chip ONLY (not history endpoints)", async () => {
    const { chip, base, major } = spyChipApis();
    const { rerender } = renderHook(
      ({ d }: { d: string }) => useChipData("2330", d),
      { initialProps: { d: "2026-06-22" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(chip).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    expect(base).toHaveBeenCalledTimes(1);
    rerender({ d: "2026-06-21" });
    await waitFor(() => expect(chip).toHaveBeenCalledTimes(2));
    expect(base).toHaveBeenCalledTimes(1); // unchanged
    expect(major).toHaveBeenCalledTimes(1); // unchanged
  });

  it("symbol change refires all three; major resets to fast 150", async () => {
    const { chip, base, major } = spyChipApis();
    const { rerender } = renderHook(
      ({ sym }: { sym: string }) => useChipData(sym, "2026-06-22"),
      { initialProps: { sym: "2330" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(1);
      expect(base).toHaveBeenCalledTimes(1);
      expect(major).toHaveBeenCalledTimes(1);
    });
    rerender({ sym: "2454" });
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(2);
      expect(base).toHaveBeenCalledTimes(2);
      expect(major).toHaveBeenCalledTimes(2);
    });
    expect(major.mock.calls[1]![0]).toBe("2454");
    expect(major.mock.calls[1]![1]).toBe(150);
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

  it("loading = summaryLoading OR historyLoading; majorLoading clears when 150 lands", async () => {
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
    // continues without blocking the "重新整理" spinner.
    resolveBase(mkHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.majorLoading).toBe(true);
    // 150 window lands → the visible subchart has data, overlay must clear.
    majorResolvers[0]!(mkHistoryMajor());
    await waitFor(() => expect(result.current.majorLoading).toBe(false));
  });

  it("refresh() forces summary + base + current-tier major with refresh=true", async () => {
    const { chip, base, major } = spyChipApis();
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => {
      expect(chip).toHaveBeenCalledTimes(2);
      expect(base).toHaveBeenCalledTimes(2);
      expect(major).toHaveBeenCalledTimes(2);
    });
    expect(chip.mock.calls[1]![2]).toBe(true);
    expect(base.mock.calls[1]![1]).toBe(540);
    expect(base.mock.calls[1]![2]).toBe(true);
    expect(major.mock.calls[1]![1]).toBe(150); // 未升檔 → 當前檔位 = 150
    expect(major.mock.calls[1]![2]).toBe(true);
  });

  it("history merges base + major: major[] empty until major lands", async () => {
    let resolveMajor!: (v: ChipHistoryMajor) => void;
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue({
      ...mkHistory(),
      candles: [
        { date: "2026-06-22", open: 1, high: 1, low: 1, close: 1, volume: 0 },
      ],
    });
    vi.spyOn(api, "chipHistoryMajor").mockImplementation(
      () =>
        new Promise<ChipHistoryMajor>((r) => {
          resolveMajor = r;
        }),
    );
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), { wrapper: makeQueryWrapper() });
    // base lands first → K-line ready, major still empty
    await waitFor(() => expect(result.current.history?.candles.length).toBe(1));
    expect(result.current.history?.major).toEqual([]);
    expect(result.current.majorLoading).toBe(true);
    // major arrives → merged in
    resolveMajor(mkHistoryMajor({ major: [{ date: "2026-06-22", major_net: 123 }] }));
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

describe("useChipData major ladder (chip-major-lazy-window)", () => {
  it("ensureMajorCoverage escalates to the smallest sufficient tier (300)", async () => {
    const { major } = spyChipApis();
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    // 2025-12-01 早於 150 覆蓋左界(2026-01-23)、晚於 300 的(2025-08-26)→ 300
    act(() => result.current.ensureMajorCoverage("2025-12-01"));
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2));
    expect(major.mock.calls[1]![1]).toBe(300);
  });

  it("escalates straight to 540 when 300 is insufficient (tier skip)", async () => {
    const { major } = spyChipApis();
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    // 2025-01-01 早於 300 覆蓋左界(2025-08-26)→ 直跳 540
    act(() => result.current.ensureMajorCoverage("2025-01-01"));
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2));
    expect(major.mock.calls[1]![1]).toBe(540);
  });

  it("idempotent: fromDate within coverage / repeated reports fire nothing extra (SC-3)", async () => {
    const { major } = spyChipApis();
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    // 覆蓋內 → no-op
    act(() => result.current.ensureMajorCoverage("2026-03-01"));
    // 同一出界日期重複回報(拖曳連續事件)→ 只升一次
    act(() => result.current.ensureMajorCoverage("2025-12-01"));
    act(() => result.current.ensureMajorCoverage("2025-12-01"));
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(major).toHaveBeenCalledTimes(2);
    expect(major.mock.calls[1]![1]).toBe(300);
  });

  it("keeps previous tier rows visible while escalation is in flight (placeholder)", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    let resolveSecond!: (v: ChipHistoryMajor) => void;
    vi.spyOn(api, "chipHistoryMajor")
      .mockResolvedValueOnce(
        mkHistoryMajor({ major: [{ date: "2026-06-22", major_net: 1 }] }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ChipHistoryMajor>((r) => {
            resolveSecond = r;
          }),
      );
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.history?.major.length).toBe(1));
    act(() => result.current.ensureMajorCoverage("2025-12-01"));
    await waitFor(() => expect(result.current.majorFetching).toBe(true));
    // 升檔在途:前檔 rows 保留、整版 overlay 不重現
    expect(result.current.history?.major.length).toBe(1);
    expect(result.current.majorLoading).toBe(false);
    resolveSecond(
      mkHistoryMajor({
        major: [
          { date: "2025-12-01", major_net: 2 },
          { date: "2026-06-22", major_net: 1 },
        ],
      }),
    );
    await waitFor(() => expect(result.current.history?.major.length).toBe(2));
    expect(result.current.majorFetching).toBe(false);
  });

  it("symbol pivot clears the placeholder — no previous-symbol rows flash", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    vi.spyOn(api, "chipHistoryMajor")
      .mockResolvedValueOnce(
        mkHistoryMajor({ major: [{ date: "2026-06-22", major_net: 99 }] }),
      )
      .mockImplementation(() => new Promise<ChipHistoryMajor>(() => {}));
    const { result, rerender } = renderHook(
      ({ sym }: { sym: string }) => useChipData(sym, "2026-06-22"),
      { initialProps: { sym: "2330" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(result.current.history?.major.length).toBe(1));
    rerender({ sym: "2454" });
    // 新 symbol 的 base 落地後,major 必須是空的(不能殘留 2330 的 rows)
    await waitFor(() => expect(result.current.history).not.toBeNull());
    expect(result.current.history?.major).toEqual([]);
    expect(result.current.majorLoading).toBe(true);
  });

  it("R1(a): report arriving before anchor exists is applied once 150 lands", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    let resolveFirst!: (v: ChipHistoryMajor) => void;
    const major = vi
      .spyOn(api, "chipHistoryMajor")
      .mockImplementationOnce(
        () =>
          new Promise<ChipHistoryMajor>((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValue(mkHistoryMajor());
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    // 初載在途(anchor null)使用者就 zoom-out 出界 → 需求要被記住
    act(() => result.current.ensureMajorCoverage("2025-12-01"));
    expect(major).toHaveBeenCalledTimes(1);
    resolveFirst(mkHistoryMajor());
    // 150 落地 → 補跑 effect 對記住的 fromDate 升檔
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2));
    expect(major.mock.calls[1]![1]).toBe(300);
  });

  it("R1(b): stale report from the previous symbol never escalates the new one", async () => {
    const { major } = spyChipApis();
    const { result, rerender } = renderHook(
      ({ sym }: { sym: string }) => useChipData(sym, "2026-06-22"),
      { initialProps: { sym: "2330" }, wrapper: makeQueryWrapper() },
    );
    await waitFor(() => expect(major).toHaveBeenCalledTimes(1));
    act(() => result.current.ensureMajorCoverage("2025-01-01")); // 2330 → 540
    await waitFor(() => expect(major).toHaveBeenCalledTimes(2));
    rerender({ sym: "2454" });
    // 2454 回到 150;其 major 落地時,舊 symbol 的 fromDate 不得誤升 2454
    await waitFor(() => expect(major).toHaveBeenCalledTimes(3));
    expect(major.mock.calls[2]![0]).toBe("2454");
    expect(major.mock.calls[2]![1]).toBe(150);
    await new Promise((r) => setTimeout(r, 50));
    expect(major).toHaveBeenCalledTimes(3);
  });

  it("majorCoverageStart reflects the LANDED tier (placeholder keeps old value mid-flight)", async () => {
    vi.spyOn(api, "chip").mockResolvedValue(mkSummary("d"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    let resolveSecond!: (v: ChipHistoryMajor) => void;
    vi.spyOn(api, "chipHistoryMajor")
      .mockResolvedValueOnce(mkHistoryMajor())
      .mockImplementationOnce(
        () =>
          new Promise<ChipHistoryMajor>((r) => {
            resolveSecond = r;
          }),
      );
    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(result.current.majorCoverageStart).toBe("2026-01-23"));
    act(() => result.current.ensureMajorCoverage("2025-12-01"));
    await waitFor(() => expect(result.current.majorFetching).toBe(true));
    expect(result.current.majorCoverageStart).toBe("2026-01-23"); // 前檔的
    resolveSecond(mkHistoryMajor());
    await waitFor(() => expect(result.current.majorCoverageStart).toBe("2025-08-26"));
  });
});

describe("useChipData refresh 旗標 race(fix/force-refresh-race)", () => {
  it("in-flight 期間按 refresh() — summary 必須立即補發帶 refresh=true 的請求(不被 dedupe 吃掉)", async () => {
    let resolveFirst!: (v: ChipSummary) => void;
    const chipSpy = vi
      .spyOn(api, "chip")
      .mockImplementationOnce(
        () => new Promise<ChipSummary>((r) => { resolveFirst = r; }),
      )
      .mockResolvedValue(mkSummary("2026-06-22"));
    vi.spyOn(api, "chipHistoryBase").mockResolvedValue(mkHistory());
    vi.spyOn(api, "chipHistoryMajor").mockResolvedValue(mkHistoryMajor());

    const { result } = renderHook(() => useChipData("2330", "2026-06-22"), {
      wrapper: makeQueryWrapper(),
    });
    await waitFor(() => expect(chipSpy).toHaveBeenCalledTimes(1)); // 初載在途

    act(() => result.current.refresh());
    resolveFirst(mkSummary("2026-06-22"));

    // 修後:in-flight 被 cancel,refresh 觸發的新 fetch 帶 force=true
    await waitFor(() => expect(chipSpy).toHaveBeenCalledTimes(2));
    expect(chipSpy.mock.calls[1]![2]).toBe(true);
  });
});
