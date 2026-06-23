import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Sym = { symbol: string; name: string };

let cache: Sym[] | null = null;
let inflight: Promise<Sym[]> | null = null;

function load(): Promise<Sym[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api
    .symbolsAll()
    .then((s) => {
      cache = s;
      inflight = null;
      return s;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

export function useAllSymbols() {
  const [symbols, setSymbols] = useState<Sym[]>(() => cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    load()
      .then((s) => {
        if (!cancelled) {
          setSymbols(s);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "載入股票清單失敗");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { symbols, loading, error };
}

export function __resetAllSymbolsCacheForTesting(): void {
  cache = null;
  inflight = null;
}
