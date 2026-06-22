import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
function stableKey(set) {
    return Array.from(set).sort().join(",");
}
export function useBrokerHistory(symbol, brokerIds) {
    const cacheRef = useRef(new Map());
    const seqRef = useRef(0);
    const [series, setSeries] = useState(new Map());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        cacheRef.current.clear();
        setSeries(new Map());
        setError(null);
    }, [symbol]);
    const idsKey = stableKey(brokerIds);
    const fetchMissing = useCallback(async (forceAll) => {
        if (!symbol || brokerIds.size === 0) {
            setSeries(new Map());
            setLoading(false);
            return;
        }
        const requested = Array.from(brokerIds);
        const missing = forceAll
            ? requested
            : requested.filter((id) => !cacheRef.current.has(id));
        if (missing.length === 0) {
            const next = new Map();
            for (const id of requested) {
                const v = cacheRef.current.get(id);
                if (v)
                    next.set(id, v);
            }
            setSeries(next);
            return;
        }
        const seq = ++seqRef.current;
        setLoading(true);
        setError(null);
        try {
            const result = await api.chipBrokerHistory(symbol, missing, forceAll);
            if (seq !== seqRef.current)
                return;
            for (const id of missing) {
                cacheRef.current.set(id, result.brokers[id] ?? []);
            }
            const next = new Map();
            for (const id of requested) {
                const v = cacheRef.current.get(id);
                if (v)
                    next.set(id, v);
            }
            setSeries(next);
        }
        catch (err) {
            if (seq !== seqRef.current)
                return;
            setError(err instanceof Error ? err.message : "broker_history_failed");
        }
        finally {
            if (seq === seqRef.current)
                setLoading(false);
        }
    }, 
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, idsKey]);
    useEffect(() => {
        fetchMissing(false);
    }, [fetchMissing]);
    const refresh = useCallback(() => {
        cacheRef.current.clear();
        fetchMissing(true);
    }, [fetchMissing]);
    return { series, loading, error, refresh };
}
