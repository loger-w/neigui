import { useCallback, useEffect, useRef, useState } from "react";
import { optionsApi } from "../lib/options-api";
import type { OptionsSpot } from "../lib/options-types";

export function useOptionsSpot(date: string) {
  const [data, setData] = useState<OptionsSpot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    async (refresh?: boolean) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const d = await optionsApi.spot(date, refresh);
        if (seq !== seqRef.current) return;
        setData(d);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入現價失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [date],
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
