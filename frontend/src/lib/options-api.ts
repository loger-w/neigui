import { __apiGet } from "./api";
import type { OptionsLargeTraders, OptionsStrikeVolume } from "./options-types";

const BASE = "/api/options";

export const optionsApi = {
  largeTraders(
    contract: string,
    date?: string,
    refresh?: boolean,
  ): Promise<OptionsLargeTraders> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/oi_large_traders`, params);
  },

  strikeVolume(
    contract: string,
    date?: string,
    topN?: number,
    refresh?: boolean,
  ): Promise<OptionsStrikeVolume> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (topN != null) params.top_n = String(topN);
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/strike_volume`, params);
  },
};
