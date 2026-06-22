import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { ChipHistory, ChipSummary } from "../lib/chip-data";

/**
 * Chip overview data hook.
 *
 * Split into two independent fetches (F3):
 * - summary: depends on symbol + date — refetched on either change
 * - history: depends on symbol only — refetched on symbol change only
 *
 * Date-only changes therefore re-fetch only the right-panel summary; the
 * K-line stays visible and the previously-loaded summary is kept on
 * screen while the new one loads (smoother UX than the prior
 * "blank → reload" cycle).
 *
 * `loading` remains the OR of both flags for back-compat with the header
 * "重新整理" button; callers can subscribe to `summaryLoading` /
 * `historyLoading` individually for scoped indicators.
 */
export function useChipData(symbol: string, date: string) {
  const [summary, setSummary] = useState<ChipSummary | null>(null);
  const [history, setHistory] = useState<ChipHistory | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summarySeqRef = useRef(0);
  const historySeqRef = useRef(0);

  // Symbol change resets BOTH so stale data for the prior symbol doesn't
  // flash. Also bumps seqRefs so any in-flight prior-symbol fetch is
  // treated as stale on resolve.
  useEffect(() => {
    summarySeqRef.current += 1;
    historySeqRef.current += 1;
    setSummary(null);
    setHistory(null);
    setError(null);
  }, [symbol]);

  const loadSummary = useCallback(
    async (refresh = false) => {
      if (!symbol) return;
      const seq = ++summarySeqRef.current;
      setSummaryLoading(true);
      setError(null);
      try {
        const s = await api.chip(symbol, date, refresh);
        if (seq !== summarySeqRef.current) return;
        setSummary(s);
      } catch (err) {
        if (seq !== summarySeqRef.current) return;
        setError(err instanceof Error ? err.message : "載入籌碼資料失敗");
      } finally {
        if (seq === summarySeqRef.current) setSummaryLoading(false);
      }
    },
    [symbol, date],
  );

  const loadHistory = useCallback(
    async (refresh = false) => {
      if (!symbol) return;
      const seq = ++historySeqRef.current;
      setHistoryLoading(true);
      setError(null);
      try {
        const h = await api.chipHistory(symbol, refresh);
        if (seq !== historySeqRef.current) return;
        setHistory(h);
      } catch (err) {
        if (seq !== historySeqRef.current) return;
        setError(err instanceof Error ? err.message : "載入歷史資料失敗");
      } finally {
        if (seq === historySeqRef.current) setHistoryLoading(false);
      }
    },
    [symbol],
  );

  // Summary auto-fires on symbol or date change (deps via loadSummary).
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // History auto-fires only on symbol change (deps via loadHistory).
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const refresh = useCallback(() => {
    loadSummary(true);
    loadHistory(true);
  }, [loadSummary, loadHistory]);

  return {
    summary,
    history,
    loading: summaryLoading || historyLoading,
    summaryLoading,
    historyLoading,
    error,
    refresh,
  };
}
