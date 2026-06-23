import { useCallback, useEffect, useRef, useState } from "react";
import { optionsApi } from "../lib/options-api";
import type { OptionsStrikeVolume } from "../lib/options-types";

export function useOptionsStrikeVolume(
  contract: string,
  date: string,
  topN: number = 10,
) {
  const [data, setData] = useState<OptionsStrikeVolume | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    async (refresh?: boolean) => {
      if (!contract) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const d = await optionsApi.strikeVolume(contract, date, topN, refresh);
        if (seq !== seqRef.current) return;
        setData(d);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入熱門履約價失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [contract, date, topN],
  );

  useEffect(() => { load(); }, [load]);

  return {
    data,
    loading,
    error,
    refresh: () => load(true),
    noTradingDay: data?.no_trading_day === true,
  };
}
