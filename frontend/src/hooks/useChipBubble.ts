import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import type { ChipBubbleData } from "../lib/chip-data";

export function useChipBubble(symbol: string, date: string) {
  const [data, setData] = useState<ChipBubbleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      if (!symbol) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await api.chipBubble(symbol, date, refresh);
        if (seq !== seqRef.current) return;
        setData(result);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入泡泡圖資料失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [symbol, date],
  );

  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, loading, error, refresh };
}
