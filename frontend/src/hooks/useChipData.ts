import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChipHistory, ChipSummary } from "../lib/chip-data";

/**
 * Chip overview data hook.
 *
 * Three independent queries:
 * - summary: keyed by symbol + date — refetches on either change
 * - historyBase (candles + institutional + margin): cold ~1.5s
 * - historyMajor (top-15 major-net per trading day): cold ~24s
 *
 * historyBase + historyMajor run in parallel so the K-line first-paint is
 * unblocked from the per-day TradingDailyReport fan-out. Outwardly we still
 * present a single `history: ChipHistory` by merging the two payloads
 * (major[] is empty until the major query lands — `ChipKlineChart` already
 * `?? 0` falls back per date).
 *
 * Date-only changes therefore re-fetch only the summary; the K-line stays
 * visible. `placeholderData` keeps the prior summary on screen while the
 * new one loads — BUT only when the symbol is the same; on symbol pivot
 * we clear, so the panel never flashes the previous symbol's brokers.
 *
 * `loading` is OR of summary + historyBase (NOT historyMajor) so the
 * "重新整理" button doesn't stay spinning for ~24s while the slow major
 * subchart populates. `majorLoading` is exposed for the K-line's
 * major-subchart placeholder.
 */
export function useChipData(symbol: string, date: string) {
  const summaryForceRef = useRef(false);
  const historyForceRef = useRef(false);

  const summaryQ = useQuery<ChipSummary, Error>({
    queryKey: ["chip-summary", symbol, date],
    queryFn: async () => {
      const force = summaryForceRef.current;
      summaryForceRef.current = false;
      return api.chip(symbol, date, force);
    },
    enabled: symbol !== "",
    placeholderData: (prev) => (prev?.symbol === symbol ? prev : undefined),
  });

  // K 線一次抓 540 天歷史(約 360 個 trading days = 1.5 年)讓滾輪縮放純前端
  // slice 沒有 round-trip;gzipped payload ≈ 25-35KB,initial load 仍合理。
  const historyBaseQ = useQuery<ChipHistory, Error>({
    queryKey: ["chip-history", symbol, "base"],
    queryFn: async () => {
      const force = historyForceRef.current;
      return api.chipHistoryBase(symbol, 540, force);
    },
    enabled: symbol !== "",
  });

  const historyMajorQ = useQuery({
    queryKey: ["chip-history", symbol, "major"],
    queryFn: async () => {
      const force = historyForceRef.current;
      // base may clear the force flag first; major reads via fresh ref each
      // call, so refresh() flips both before they fire in parallel.
      return api.chipHistoryMajor(symbol, 540, force);
    },
    enabled: symbol !== "",
  });

  const history = useMemo<ChipHistory | null>(() => {
    if (!historyBaseQ.data) return null;
    // Merge major in once available; until then keep `major: []` so the
    // K-line subchart renders flat (existing `?? 0` fallback at
    // ChipKlineChart.tsx:81 makes this safe).
    const majorRows = historyMajorQ.data?.major ?? [];
    return { ...historyBaseQ.data, major: majorRows };
  }, [historyBaseQ.data, historyMajorQ.data]);

  const summaryLoading = summaryQ.isFetching;
  // historyLoading drives the top "重新整理" spinner; the slow major fan-out
  // gets its own flag so the global spinner doesn't stay on for 24s.
  const historyLoading = historyBaseQ.isFetching;
  const majorLoading = historyMajorQ.isFetching;
  const error = summaryQ.error ?? historyBaseQ.error ?? historyMajorQ.error;

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
      historyMajorQ.refetch().finally(() => {
        historyForceRef.current = false;
      });
    },
  };
}
