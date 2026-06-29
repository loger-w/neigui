import type {
  ChipSummary, ChipBubbleData, ChipHistory, ChipBrokerHistory, ChipBrokersWindow,
  ChipIntraday,
} from "./chip-data";

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

// chipHistory / chipBrokerHistory 用 overload 維持「(symbol)」/「(symbol, refresh)」
// 既有呼叫,同時支援新「(symbol, days, refresh?)」形式(v3 spec §C3)。
// Object-literal method shorthand 不能寫 TS overload,所以用 explicit type
// interface 套到 property 上。
type ChipHistoryFn = {
  (symbol: string): Promise<ChipHistory>;
  (symbol: string, refresh: boolean): Promise<ChipHistory>;
  (symbol: string, days: number, refresh?: boolean): Promise<ChipHistory>;
};

function chipHistoryImpl(
  symbol: string,
  daysOrRefresh?: number | boolean,
  refresh?: boolean,
): Promise<ChipHistory> {
  const days = typeof daysOrRefresh === "number" ? daysOrRefresh : undefined;
  const r = typeof daysOrRefresh === "boolean" ? daysOrRefresh : refresh;
  const params: Record<string, string> = {};
  if (days !== undefined) params.days = String(days);
  if (r) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/history`, params);
}

// /history/base = same shape, `major: []`. Paired with /history/major for
// parallel fetch — K-line first-paint drops from ~24s cold to ~1.5s.
function chipHistoryBaseImpl(
  symbol: string,
  days: number,
  refresh?: boolean,
): Promise<ChipHistory> {
  const params: Record<string, string> = { days: String(days) };
  if (refresh) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/history/base`, params);
}

// /history/major = slim {symbol, fetched_at, last_date, major: [...]}. Runs
// the per-day TradingDailyReport fan-out independently from /history/base.
export interface ChipHistoryMajor {
  symbol: string;
  fetched_at: string;
  last_date: string;
  major: ChipHistory["major"];
  stale?: boolean;
}

function chipHistoryMajorImpl(
  symbol: string,
  days: number,
  refresh?: boolean,
): Promise<ChipHistoryMajor> {
  const params: Record<string, string> = { days: String(days) };
  if (refresh) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/history/major`, params);
}

type ChipBrokerHistoryFn = {
  (symbol: string, ids: string[]): Promise<ChipBrokerHistory>;
  (symbol: string, ids: string[], refresh: boolean): Promise<ChipBrokerHistory>;
  (symbol: string, ids: string[], days: number, refresh?: boolean): Promise<ChipBrokerHistory>;
};

function chipBrokerHistoryImpl(
  symbol: string,
  ids: string[],
  daysOrRefresh?: number | boolean,
  refresh?: boolean,
): Promise<ChipBrokerHistory> {
  const days = typeof daysOrRefresh === "number" ? daysOrRefresh : undefined;
  const r = typeof daysOrRefresh === "boolean" ? daysOrRefresh : refresh;
  const params: Record<string, string> = { ids: ids.join(",") };
  if (days !== undefined) params.days = String(days);
  if (r) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/broker_history`, params);
}

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
  chipIntraday(symbol: string, date?: string, refresh?: boolean): Promise<ChipIntraday> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/intraday`, params);
  },
  chipHistory: chipHistoryImpl as ChipHistoryFn,
  chipHistoryBase: chipHistoryBaseImpl,
  chipHistoryMajor: chipHistoryMajorImpl,
  chipBrokerHistory: chipBrokerHistoryImpl as ChipBrokerHistoryFn,
  chipBrokersWindow(
    symbol: string, date: string, days: number, refresh?: boolean,
  ): Promise<ChipBrokersWindow> {
    const params: Record<string, string> = { date, days: String(days) };
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/brokers_window`, params);
  },
  symbols(search: string): Promise<Array<{ symbol: string; name: string }>> {
    return get(`${BASE}/symbols`, { search });
  },
  symbolsAll(): Promise<Array<{ symbol: string; name: string }>> {
    return get(`${BASE}/symbols/all`);
  },
};

export { get as __apiGet };
