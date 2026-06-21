import type { ChipSummary, ChipBubbleData, ChipHistory } from "./chip-data";

const BASE = "/api";

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`);
  }
  return resp.json();
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
  chipHistory(symbol: string, refresh?: boolean): Promise<ChipHistory> {
    const params: Record<string, string> = {};
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/history`, params);
  },
  symbols(search: string): Promise<Array<{ symbol: string; name: string }>> {
    return get(`${BASE}/symbols`, { search });
  },
};
