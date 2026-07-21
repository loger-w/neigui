import type {
  ChipSummary, ChipBubbleData, ChipHistory, ChipBrokerHistory, ChipBrokersWindow,
  ChipIntraday,
} from "./chip-data";
import type { BorrowFeeData } from "./borrow-fee";
import type { WarrantQuotesPayload, WarrantsPayload } from "./warrant-data";
import type { WarrantFlowPayload } from "./warrant-flow-data";
import type { BrokerFlowsPayload, TraderSearchPayload } from "./broker-flows-data";
import { apiOrigin } from "./api-base";

const BASE = "/api";

const _cache = new Map<string, { data: unknown; ts: number; seq: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const _seqMap = new Map<string, number>();
let _seqCounter = 0;

export interface RequestOptions {
  signal?: AbortSignal;
  /** 跳過 module cache 讀寫(warrant quotes 輪詢:15s 間隔不得吃 5 分 TTL)。 */
  noCache?: boolean;
}

function cacheKey(path: string, params?: Record<string, string>): string {
  const p = { ...params };
  delete p.refresh;
  const sorted = Object.keys(p).sort();
  const qs = sorted.map((k) => `${k}=${p[k]}`).join("&");
  return qs ? `${path}?${qs}` : path;
}

async function get<T>(
  path: string,
  params?: Record<string, string>,
  options?: RequestOptions,
): Promise<T> {
  const key = cacheKey(path, params);
  const isRefresh = params?.refresh === "true";

  const seq = ++_seqCounter;
  _seqMap.set(key, seq);

  if (isRefresh) {
    _cache.delete(key);
  } else if (!options?.noCache) {
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data as T;
    }
  }

  const url = new URL(path, apiOrigin());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString(), { signal: options?.signal });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`);
  }
  const data: T = await resp.json();

  if (!options?.noCache && _seqMap.get(key) === seq) {
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
// interface 套到 property 上。所有 method 尾端接 optional RequestOptions
// 傳 AbortSignal 給 fetch,讓 TanStack Query queryFn({ signal }) 傳導取消。
type ChipHistoryFn = {
  (symbol: string): Promise<ChipHistory>;
  (symbol: string, refresh: boolean): Promise<ChipHistory>;
  (symbol: string, days: number, refresh?: boolean, options?: RequestOptions): Promise<ChipHistory>;
};

function chipHistoryImpl(
  symbol: string,
  daysOrRefresh?: number | boolean,
  refresh?: boolean,
  options?: RequestOptions,
): Promise<ChipHistory> {
  const days = typeof daysOrRefresh === "number" ? daysOrRefresh : undefined;
  const r = typeof daysOrRefresh === "boolean" ? daysOrRefresh : refresh;
  const params: Record<string, string> = {};
  if (days !== undefined) params.days = String(days);
  if (r) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/history`, params, options);
}

// /history/base = same shape, `major: []`. Paired with /history/major for
// parallel fetch — K-line first-paint drops from ~24s cold to ~1.5s.
function chipHistoryBaseImpl(
  symbol: string,
  days: number,
  refresh?: boolean,
  options?: RequestOptions,
): Promise<ChipHistory> {
  const params: Record<string, string> = { days: String(days) };
  if (refresh) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/history/base`, params, options);
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
  options?: RequestOptions,
): Promise<ChipHistoryMajor> {
  const params: Record<string, string> = { days: String(days) };
  if (refresh) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/history/major`, params, options);
}

type ChipBrokerHistoryFn = {
  (symbol: string, ids: string[]): Promise<ChipBrokerHistory>;
  (symbol: string, ids: string[], refresh: boolean): Promise<ChipBrokerHistory>;
  (
    symbol: string, ids: string[], refresh: boolean, options: RequestOptions,
  ): Promise<ChipBrokerHistory>;
  (
    symbol: string, ids: string[], days: number, refresh?: boolean, options?: RequestOptions,
  ): Promise<ChipBrokerHistory>;
};

function chipBrokerHistoryImpl(
  symbol: string,
  ids: string[],
  daysOrRefresh?: number | boolean,
  refreshOrOptions?: boolean | RequestOptions,
  options?: RequestOptions,
): Promise<ChipBrokerHistory> {
  const days = typeof daysOrRefresh === "number" ? daysOrRefresh : undefined;
  // Case A:(sym, ids, refresh: bool) or (sym, ids, refresh: bool, options)
  //   → daysOrRefresh is boolean
  // Case B:(sym, ids, days: number, refresh?: bool, options?) → 4th arg boolean
  let r: boolean | undefined;
  let opts: RequestOptions | undefined;
  if (typeof daysOrRefresh === "boolean") {
    r = daysOrRefresh;
    opts = (refreshOrOptions as RequestOptions | undefined) ?? undefined;
  } else {
    r = typeof refreshOrOptions === "boolean" ? refreshOrOptions : undefined;
    opts = options;
  }
  const params: Record<string, string> = { ids: ids.join(",") };
  if (days !== undefined) params.days = String(days);
  if (r) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/broker_history`, params, opts);
}

export const api = {
  chip(
    symbol: string, date?: string, refresh?: boolean, options?: RequestOptions,
  ): Promise<ChipSummary> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}`, params, options);
  },
  chipBubble(
    symbol: string, date?: string, refresh?: boolean, options?: RequestOptions,
  ): Promise<ChipBubbleData> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/bubble`, params, options);
  },
  chipIntraday(
    symbol: string, date?: string, refresh?: boolean, options?: RequestOptions,
  ): Promise<ChipIntraday> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/intraday`, params, options);
  },
  chipHistory: chipHistoryImpl as ChipHistoryFn,
  chipHistoryBase: chipHistoryBaseImpl,
  chipHistoryMajor: chipHistoryMajorImpl,
  chipBrokerHistory: chipBrokerHistoryImpl as ChipBrokerHistoryFn,
  chipBrokersWindow(
    symbol: string, date: string, days: number, refresh?: boolean, options?: RequestOptions,
  ): Promise<ChipBrokersWindow> {
    const params: Record<string, string> = { date, days: String(days) };
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/brokers_window`, params, options);
  },
  daytradeFee(refresh?: boolean, options?: RequestOptions): Promise<BorrowFeeData> {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = "true";
    return get(`${BASE}/daytrade-fee`, params, options);
  },
  warrants(
    stockId: string, refresh?: boolean, options?: RequestOptions,
  ): Promise<WarrantsPayload> {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = "true";
    return get(`${BASE}/warrants/${stockId}`, params, options);
  },
  warrantQuotes(
    stockId: string, refresh?: boolean, options?: RequestOptions,
  ): Promise<WarrantQuotesPayload> {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = "true";
    // 輪詢資料恆走 noCache(module cache TTL 5 分鐘會吞掉 15s 輪詢)
    return get(`${BASE}/warrants/${stockId}/quotes`, params, { ...options, noCache: true });
  },
  warrantFlow(
    stockId: string, refresh?: boolean, options?: RequestOptions,
  ): Promise<WarrantFlowPayload> {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = "true";
    return get(`${BASE}/warrants/${stockId}/flow`, params, options);
  },
  brokerTraders(
    search: string, options?: RequestOptions,
  ): Promise<TraderSearchPayload> {
    return get(`${BASE}/broker/traders`, { search }, options);
  },
  brokerDailyFlows(
    brokerId: string, refresh?: boolean, options?: RequestOptions,
  ): Promise<BrokerFlowsPayload> {
    const params: Record<string, string> = { broker_id: brokerId };
    if (refresh) params.refresh = "true";
    return get(`${BASE}/broker/daily-flows`, params, options);
  },
  symbols(
    search: string, options?: RequestOptions,
  ): Promise<Array<{ symbol: string; name: string }>> {
    return get(`${BASE}/symbols`, { search }, options);
  },
  symbolsAll(options?: RequestOptions): Promise<Array<{ symbol: string; name: string }>> {
    return get(`${BASE}/symbols/all`, undefined, options);
  },
};

export { get as __apiGet };
