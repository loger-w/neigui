import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
export function useChipData(symbol, date) {
    const [summary, setSummary] = useState(null);
    const [history, setHistory] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const seqRef = useRef(0);
    const load = useCallback(async (refresh = false) => {
        if (!symbol)
            return;
        const seq = ++seqRef.current;
        setLoading(true);
        setError(null);
        try {
            const [s, h] = await Promise.all([
                api.chip(symbol, date, refresh),
                api.chipHistory(symbol, refresh),
            ]);
            if (seq !== seqRef.current)
                return;
            setSummary(s);
            setHistory(h);
        }
        catch (err) {
            if (seq !== seqRef.current)
                return;
            setError(err instanceof Error ? err.message : "載入籌碼資料失敗");
        }
        finally {
            if (seq === seqRef.current)
                setLoading(false);
        }
    }, [symbol, date]);
    useEffect(() => {
        setSummary(null);
        setHistory(null);
        setError(null);
        load();
    }, [load]);
    const refresh = useCallback(() => load(true), [load]);
    return { summary, history, loading, error, refresh };
}
