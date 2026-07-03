/** API contract types for /api/market/snapshot — design.md §10 v3. */

export type MarketSnapshot = {
  as_of: string;
  last_tick: string | null;
  is_trading_session: boolean;
  stale: boolean;
  lag_seconds: number | null;
  sectors: Sector[];
  leaderboards: Leaderboards;
  universe_size: number;
  excluded_count: ExcludedCount;
  eod_as_of: string | null;
  /** EOD 背景計算尚未完成(冷啟動期間);optional — 舊後端無此欄。 */
  eod_pending?: boolean;
  breadth: Breadth | null;
  sector_breadth: SectorBreadthRow[] | null;
  sector_volume_ratio: SectorVolumeRatioRow[] | null;
  sector_amount_share: SectorAmountShareRow[] | null;
};

export type ExcludedCount = { etf: number; warrant: number; watch_list: number };

export type BreadthPoint = { date: string; value: number | null };

export type Breadth = {
  ad_line_value: number | null;
  mcclellan_oscillator: number | null;
  ad_line_series: BreadthPoint[];
  mcclellan_series: BreadthPoint[];
  thrust_dot: "above_plus_100" | "below_minus_100" | null;
  centerline_cross: "above" | "below" | null;
  divergence_dot: "bearish" | "bullish" | null;
  known_gaps: string[];
};

export type SectorBreadthRow = { sector: string; members: number; above_ma20: number; pct: number };

export type SectorVolumeRatioRow = {
  sector: string;
  today_vol_lots: number;
  vol_ratio: number | null;
  flag: "hot" | "cold" | null;
};

export type SectorAmountShareRow = { sector: string; today_share: number; share_delta_20ma: number | null };

export type Sector = {
  id: string;
  name: string;
  member_count: number;
  avg_change_rate: number;
  total_amount: number;
  stocks: StockTile[];
};

export type StockTile = {
  stock_id: string;
  name: string;
  change_rate: number;
  total_amount: number;
  market_value: number | null;
};

export type Leaderboards = {
  gainers: LeaderboardRow[];
  losers: LeaderboardRow[];
  amount: LeaderboardRow[];
  volume_ratio: LeaderboardRow[];
};

export type LeaderboardRow = {
  stock_id: string;
  name: string;
  change_rate: number;
  total_amount: number;
  volume_ratio: number | null;
  sector: string;
};
