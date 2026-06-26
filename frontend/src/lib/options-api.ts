import { __apiGet } from "./api";
import type {
  OptionsLargeTraders, OptionsStrikeVolume, OptionsSpot,
  OptionsMaxPain, OptionsOIWalls, OptionsPCR, OptionsInstitutional,
} from "./options-types";

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
    refresh?: boolean,
  ): Promise<OptionsStrikeVolume> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/strike_volume`, params);
  },

  spot(date?: string, refresh?: boolean): Promise<OptionsSpot> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/spot`, params);
  },

  maxPain(
    contract: string,
    date?: string,
    refresh?: boolean,
    lookback?: number,
  ): Promise<OptionsMaxPain> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    if (lookback !== undefined) params.lookback = String(lookback);
    return __apiGet(`${BASE}/max_pain`, params);
  },

  oiWalls(
    contract: string,
    date?: string,
    refresh?: boolean,
    lookback?: number,
    deltaWindow?: number,
  ): Promise<OptionsOIWalls> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    if (lookback !== undefined) params.lookback = String(lookback);
    if (deltaWindow !== undefined) params.delta_window = String(deltaWindow);
    return __apiGet(`${BASE}/oi_walls`, params);
  },

  pcr(args: {
    date?: string;
    refresh?: boolean;
    scope?: "per_contract" | "all_months";
    contract?: string;
    lookback?: number;
    highPct?: number;
    lowPct?: number;
  }): Promise<OptionsPCR> {
    const params: Record<string, string> = {};
    if (args.date) params.date = args.date;
    if (args.refresh) params.refresh = "true";
    if (args.scope) params.scope = args.scope;
    if (args.contract) params.contract = args.contract;
    if (args.lookback !== undefined) params.lookback = String(args.lookback);
    if (args.highPct !== undefined) params.high_pct = String(args.highPct);
    if (args.lowPct !== undefined) params.low_pct = String(args.lowPct);
    return __apiGet(`${BASE}/pcr`, params);
  },

  institutional(
    date?: string,
    refresh?: boolean,
    lookback?: number,
    corrWindow?: number,
  ): Promise<OptionsInstitutional> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    if (lookback !== undefined) params.lookback = String(lookback);
    if (corrWindow !== undefined) params.corr_window = String(corrWindow);
    return __apiGet(`${BASE}/institutional`, params);
  },
};
