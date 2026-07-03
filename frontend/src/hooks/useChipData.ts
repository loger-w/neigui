import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChipHistory, ChipSummary } from "../lib/chip-data";

// 主力線兩段式視窗(perf-major-fastpath):FinMind TradingDailyReport 只接受
// 單日查詢,每個交易日 1 request — 540 日曆日 ≈ 360 requests ≈ 24s(15/s)。
// 先抓 150 日曆日(≈100 交易日,覆蓋 K 線預設 KLINE_ZOOM_DEFAULT=90 根 +
// 假期緩衝)讓可見副圖 ~7s 有資料,540 全量降級為背景補齊。
const MAJOR_FAST_DAYS = 150;
const MAJOR_FULL_DAYS = 540;

/**
 * Chip overview data hook.
 *
 * Four independent queries:
 * - summary: keyed by symbol + date — refetches on either change
 * - historyBase (candles + institutional + margin): cold ~1.5s
 * - majorFast (top-15 major-net, last 150 calendar days): cold ~7s
 * - historyMajor (major-net full 540d): cold ~24s, gated on majorFast
 *
 * majorFast fires with historyBase in parallel; historyMajor starts only
 * after majorFast succeeds (sequencing avoids duplicate per-day FinMind
 * fetches — the backend's per-day cache `{symbol}_{d}_major` makes the
 * 540d fan-out skip the ~100 days the fast window already fetched).
 * Outwardly we still present a single `history: ChipHistory` by merging:
 * full rows win once landed, fast rows fill in before that, `major: []`
 * until either arrives (`ChipKlineChart` already `?? 0` falls back).
 *
 * Date-only changes therefore re-fetch only the summary; the K-line stays
 * visible. `placeholderData` keeps the prior summary on screen while the
 * new one loads — BUT only when the symbol is the same; on symbol pivot
 * we clear, so the panel never flashes the previous symbol's brokers.
 *
 * `loading` is OR of summary + historyBase (NOT the major queries) so the
 * "重新整理" button doesn't stay spinning while the slow major fan-out
 * populates. `majorLoading` drives the K-line major-subchart overlay and
 * clears as soon as ANY major rows exist — the background 540d fill never
 * re-covers a subchart that already has visible data.
 */
export function useChipData(symbol: string, date: string) {
  const summaryForceRef = useRef(false);
  const historyForceRef = useRef(false);

  const summaryQ = useQuery<ChipSummary, Error>({
    queryKey: ["chip-summary", symbol, date],
    queryFn: async ({ signal }) => {
      const force = summaryForceRef.current;
      summaryForceRef.current = false;
      return api.chip(symbol, date, force, { signal });
    },
    enabled: symbol !== "",
    placeholderData: (prev) => (prev?.symbol === symbol ? prev : undefined),
  });

  // K 線一次抓 540 天歷史(約 360 個 trading days = 1.5 年)讓滾輪縮放純前端
  // slice 沒有 round-trip;gzipped payload ≈ 25-35KB,initial load 仍合理。
  const historyBaseQ = useQuery<ChipHistory, Error>({
    queryKey: ["chip-history", symbol, "base"],
    queryFn: async ({ signal }) => {
      const force = historyForceRef.current;
      return api.chipHistoryBase(symbol, MAJOR_FULL_DAYS, force, { signal });
    },
    enabled: symbol !== "",
  });

  const majorFastQ = useQuery({
    queryKey: ["chip-history", symbol, "major", MAJOR_FAST_DAYS],
    queryFn: async ({ signal }) => {
      const force = historyForceRef.current;
      return api.chipHistoryMajor(symbol, MAJOR_FAST_DAYS, force, { signal });
    },
    enabled: symbol !== "",
  });

  const historyMajorQ = useQuery({
    queryKey: ["chip-history", symbol, "major"],
    queryFn: async ({ signal }) => {
      const force = historyForceRef.current;
      // fast may clear the force flag first; full reads via fresh ref each
      // call, so refresh() flips both before they fire.
      return api.chipHistoryMajor(symbol, MAJOR_FULL_DAYS, force, { signal });
    },
    // Gated: fires only after the fast window lands, so the two fan-outs
    // never race on the same per-day FinMind fetches.
    enabled: symbol !== "" && majorFastQ.isSuccess,
  });

  const history = useMemo<ChipHistory | null>(() => {
    if (!historyBaseQ.data) return null;
    // Merge major in once available — full 540d wins over the fast 150d
    // window; until either lands keep `major: []` so the K-line subchart
    // renders flat (existing `?? 0` fallback at ChipKlineChart.tsx:81).
    const majorRows = historyMajorQ.data?.major ?? majorFastQ.data?.major ?? [];
    return { ...historyBaseQ.data, major: majorRows };
  }, [historyBaseQ.data, historyMajorQ.data, majorFastQ.data]);

  const summaryLoading = summaryQ.isFetching;
  // historyLoading drives the top "重新整理" spinner; the slow major fan-out
  // gets its own flag so the global spinner doesn't stay on for seconds.
  const historyLoading = historyBaseQ.isFetching;
  const hasMajor = historyMajorQ.data != null || majorFastQ.data != null;
  const majorLoading = !hasMajor && (majorFastQ.isFetching || historyMajorQ.isFetching);
  const error =
    summaryQ.error ?? historyBaseQ.error ?? majorFastQ.error ?? historyMajorQ.error;

  return {
    summary: summaryQ.data ?? null,
    history,
    loading: summaryLoading || historyLoading,
    summaryLoading,
    historyLoading,
    majorLoading,
    error: error ? error.message : null,
    refresh: () => {
      summaryForceRef.current = true;
      historyForceRef.current = true;
      summaryQ.refetch();
      historyBaseQ.refetch();
      // Both major windows re-fire forced; per-day backend caches keep the
      // duplicate cost to ~2 requests (today + price-range call).
      Promise.allSettled([majorFastQ.refetch(), historyMajorQ.refetch()]).then(() => {
        historyForceRef.current = false;
      });
    },
  };
}
