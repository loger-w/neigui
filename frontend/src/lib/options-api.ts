import { __apiGet, type RequestOptions } from "./api";
import type {
  OptionsLargeTraders, OptionsStrikeVolume, OptionsSpot,
  OptionsMaxPain, OptionsOIWalls, OptionsPCR, OptionsInstitutional,
  OptionsRetailMtx, OptionsForeignFutures,
} from "./options-types";

const BASE = "/api/options";

export const optionsApi = {
  largeTraders(
    contract: string,
    date?: string,
    refresh?: boolean,
    options?: RequestOptions,
  ): Promise<OptionsLargeTraders> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/oi_large_traders`, params, options);
  },

  strikeVolume(
    contract: string,
    date?: string,
    refresh?: boolean,
    options?: RequestOptions,
  ): Promise<OptionsStrikeVolume> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/strike_volume`, params, options);
  },

  spot(
    date?: string,
    refresh?: boolean,
    options?: RequestOptions,
  ): Promise<OptionsSpot> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/spot`, params, options);
  },

  maxPain(
    contract: string,
    date?: string,
    refresh?: boolean,
    lookback?: number,
    options?: RequestOptions,
  ): Promise<OptionsMaxPain> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    if (lookback !== undefined) params.lookback = String(lookback);
    return __apiGet(`${BASE}/max_pain`, params, options);
  },

  oiWalls(
    contract: string,
    date?: string,
    refresh?: boolean,
    lookback?: number,
    deltaWindow?: number,
    options?: RequestOptions,
  ): Promise<OptionsOIWalls> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    if (lookback !== undefined) params.lookback = String(lookback);
    if (deltaWindow !== undefined) params.delta_window = String(deltaWindow);
    return __apiGet(`${BASE}/oi_walls`, params, options);
  },

  pcr(
    args: {
      date?: string;
      refresh?: boolean;
      scope?: "per_contract" | "all_months";
      contract?: string;
      lookback?: number;
      highPct?: number;
      lowPct?: number;
    },
    options?: RequestOptions,
  ): Promise<OptionsPCR> {
    const params: Record<string, string> = {};
    if (args.date) params.date = args.date;
    if (args.refresh) params.refresh = "true";
    if (args.scope) params.scope = args.scope;
    if (args.contract) params.contract = args.contract;
    if (args.lookback !== undefined) params.lookback = String(args.lookback);
    if (args.highPct !== undefined) params.high_pct = String(args.highPct);
    if (args.lowPct !== undefined) params.low_pct = String(args.lowPct);
    return __apiGet(`${BASE}/pcr`, params, options);
  },

  institutional(
    date?: string,
    refresh?: boolean,
    lookback?: number,
    corrWindow?: number,
    options?: RequestOptions,
  ): Promise<OptionsInstitutional> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    if (lookback !== undefined) params.lookback = String(lookback);
    if (corrWindow !== undefined) params.corr_window = String(corrWindow);
    return __apiGet(`${BASE}/institutional`, params, options);
  },

  retailMtx(
    date?: string,
    refresh?: boolean,
    options?: RequestOptions,
  ): Promise<OptionsRetailMtx> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/retail_mtx`, params, options);
  },

  foreignFutures(
    date?: string,
    refresh?: boolean,
    options?: RequestOptions,
  ): Promise<OptionsForeignFutures> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/foreign_futures`, params, options);
  },
};
