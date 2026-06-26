import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChipHistory, ChipSummary } from "../lib/chip-data";

/**
 * Chip overview data hook.
 *
 * Split into two independent queries:
 * - summary: keyed by symbol + date — refetches on either change
 * - history: keyed by symbol only  — refetches on symbol change only
 *
 * Date-only changes therefore re-fetch only the summary; the K-line stays
 * visible. `placeholderData` keeps the prior summary on screen while the
 * new one loads — BUT only when the symbol is the same; on symbol pivot
 * we clear, so the panel never flashes the previous symbol's brokers.
 *
 * `loading` remains the OR of both isFetching flags for back-compat with
 * the header "重新整理" button.
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

  const historyQ = useQuery<ChipHistory, Error>({
    queryKey: ["chip-history", symbol],
    queryFn: async () => {
      const force = historyForceRef.current;
      historyForceRef.current = false;
      return api.chipHistory(symbol, force);
    },
    enabled: symbol !== "",
  });

  const summaryLoading = summaryQ.isFetching;
  const historyLoading = historyQ.isFetching;
  const error = summaryQ.error ?? historyQ.error;

  return {
    summary: summaryQ.data ?? null,
    history: historyQ.data ?? null,
    loading: summaryLoading || historyLoading,
    summaryLoading,
    historyLoading,
    error: error ? error.message : null,
    refresh: () => {
      summaryForceRef.current = true;
      historyForceRef.current = true;
      summaryQ.refetch();
      historyQ.refetch();
    },
  };
}
