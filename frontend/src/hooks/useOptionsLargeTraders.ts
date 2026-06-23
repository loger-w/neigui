import { useCallback, useEffect, useRef, useState } from "react";
import { optionsApi } from "../lib/options-api";
import type { OptionsLargeTraders } from "../lib/options-types";

export function useOptionsLargeTraders(contract: string, date: string) {
  const [data, setData] = useState<OptionsLargeTraders | null>(null);
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
        const d = await optionsApi.largeTraders(contract, date, refresh);
        if (seq !== seqRef.current) return;
        setData(d);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入大戶資料失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [contract, date],
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
