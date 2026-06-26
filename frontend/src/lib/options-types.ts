export interface OILTGroup { long: number; short: number; net: number }

export interface OptionsLargeTraders {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  current: {
    top5_prop:  OILTGroup;
    top10_prop: OILTGroup;
    top5_all:   OILTGroup;
    top10_all:  OILTGroup;
  };
  series: Array<{
    date: string;
    top5_all_net:   number;
    top10_all_net:  number;
    top5_prop_net:  number;
    top10_prop_net: number;
  }>;
  no_trading_day?: boolean;
}

export interface StrikeRow {
  strike: number;
  volume: number;
  oi: number;
  oi_change: number;
}

export interface OptionsStrikeVolume {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  call: StrikeRow[];
  put:  StrikeRow[];
  no_trading_day?: boolean;
}

export interface OptionsSpot {
  date: string;
  fetched_at: string;
  as_of_date: string | null;
  as_of_session: "position" | "after_market" | null;
  spot: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  no_trading_day?: boolean;
}

// ============================================================================
// txo-chip-framework MVP1 (design v4 §2.1)
// ============================================================================

export interface InsufficientData {
  reason: string;
  required_days: number;
}

export interface OptionsMaxPainCurrent {
  max_pain: number | null;
  total_loss_ntd: number;
  strike_count: number;
  strikes_with_call_oi_only: number;
  strikes_with_put_oi_only: number;
}

export interface MaxPainHitRateEntry {
  settlement_date: string;
  max_pain_at_t_minus_1: number;
  settlement_price: number;
  deviation_pct: number;
}

export interface OptionsMaxPainHitRate {
  samples: number;
  median_abs_deviation_pct: number | null;
  hit_within_1pct: number;
  hit_within_2pct: number;
  history: MaxPainHitRateEntry[];
  latest_settlement_pending: boolean;
}

export interface OptionsMaxPain {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  current: OptionsMaxPainCurrent;
  hit_rate: OptionsMaxPainHitRate | null;
  latest_settlement_pending: boolean;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData | null;
  no_trading_day?: boolean;
}

export interface OIWallStatic {
  strike: number;
  oi: number;
}

export interface OIWallDynamic {
  strike: number;
  window_activity_oi: number;
  partial_window: boolean;
}

export interface OIWallsHitRateEntry {
  settlement_date: string;
  put_wall_at_t_minus_1: number;
  call_wall_at_t_minus_1: number;
  settlement_price: number;
  inside_band: boolean;
}

export interface OptionsOIWallsHitRate {
  samples: number;
  pct_settled_inside_band: number;
  avg_band_width_pct: number;
  history: OIWallsHitRateEntry[];
  latest_settlement_pending: boolean;
}

export interface OptionsOIWalls {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  current: {
    static_call_wall: OIWallStatic | null;
    static_put_wall: OIWallStatic | null;
    dynamic_call_wall: OIWallDynamic | null;
    dynamic_put_wall: OIWallDynamic | null;
    band_width_pct: number;
    data_quality_warnings: string[];
  };
  hit_rate: OptionsOIWallsHitRate | null;
  latest_settlement_pending: boolean;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData | null;
  no_trading_day?: boolean;
}

export type PCRRegion = "high" | "neutral" | "low" | null;

export interface PCRRegionStats {
  mean_pct: number;
  std_pct: number;
  hit_positive: number;
  samples: number;
}

export interface OptionsPCR {
  date: string;
  scope: "per_contract" | "all_months";
  contract: string | null;
  fetched_at: string;
  as_of_date?: string | null;
  current: {
    pcr: number;
    percentile: number;
    region: PCRRegion;
    thresholds: { high_pct: number; low_pct: number };
  };
  next_day_stats: {
    high_region: PCRRegionStats;
    neutral_region: PCRRegionStats;
    low_region: PCRRegionStats;
  } | null;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData | null;
  no_trading_day?: boolean;
}

export interface InstitutionalSide {
  call_net: number;
  put_net: number;
  total_net: number;
  day_change: number;
}

export interface OptionsInstitutional {
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  current: {
    foreign: InstitutionalSide;
    dealer: InstitutionalSide;
    trust: InstitutionalSide;
    session_breakdown: {
      day_session: Record<string, unknown>;
      after_hours: Record<string, unknown> | null;
    };
  };
  correlation: {
    samples: number;
    latest_corr: number;
    latest_p_value: number;
    history: Array<{ date: string; corr: number; p_value: number }>;
    is_significant: boolean;
    feature_transformation: "raw_flow" | "first_difference";
  } | null;
  data_quality_warnings: string[];
  insufficient_data?: InsufficientData | null;
  no_trading_day?: boolean;
}
