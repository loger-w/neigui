/** API contract types for /api/market/snapshot — design.md §10 v3. */

export type MarketSnapshot = {
  as_of: string;
  last_tick: string | null;
  is_trading_session: boolean;
  stale: boolean;
  lag_seconds: number | null;
  sectors: Sector[];
  leaderboards: Leaderboards;
};

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
