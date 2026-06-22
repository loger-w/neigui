import type { ChipSummary, ChipBubbleData, ChipHistory } from "./chip-data";

const BASE = "/api";

const _cache = new Map<string, { data: unknown; ts: number; seq: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const _seqMap = new Map<string, number>();
let _seqCounter = 0;

function cacheKey(path: string, params?: Record<string, string>): string {
  const p = { ...params };
  delete p.refresh;
  const sorted = Object.keys(p).sort();
  const qs = sorted.map((k) => `${k}=${p[k]}`).join("&");
  return qs ? `${path}?${qs}` : path;
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const key = cacheKey(path, params);
  const isRefresh = params?.refresh === "true";

  const seq = ++_seqCounter;
  _seqMap.set(key, seq);

  if (isRefresh) {
    _cache.delete(key);
  } else {
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data as T;
    }
  }

  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`);
  }
  const data: T = await resp.json();

  if (_seqMap.get(key) === seq) {
    _cache.set(key, { data, ts: Date.now(), seq });
    if (_cache.size > CACHE_MAX_ENTRIES) {
      const oldest = _cache.keys().next().value;
      if (oldest !== undefined) {
        _cache.delete(oldest);
        _seqMap.delete(oldest);
      }
    }
  }

  return data;
}

export function clearApiCache(): void {
  _cache.clear();
  _seqMap.clear();
}

export { _cache as __testCache, CACHE_TTL, CACHE_MAX_ENTRIES };

export const api = {
  chip(symbol: string, date?: string, refresh?: boolean): Promise<ChipSummary> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}`, params);
  },
  chipBubble(symbol: string, date?: string, refresh?: boolean): Promise<ChipBubbleData> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/bubble`, params);
  },
  chipHistory(symbol: string, refresh?: boolean): Promise<ChipHistory> {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/history`, params);
  },
  symbols(search: string): Promise<Array<{ symbol: string; name: string }>> {
    return get(`${BASE}/symbols`, { search });
  },
};
