/** API contract types for /api/market/snapshot — market-today-only change-spec §3. */

export type MarketSnapshot = {
  as_of: string;
  last_tick: string | null;
  is_trading_session: boolean;
  stale: boolean;
  lag_seconds: number | null;
  universe_size: number;
  excluded_count: ExcludedCount;
  index_strength: IndexStrength;
  cap_tiers: CapTier[] | null;
  sector_rotation: SectorRotation | null;
};

export type ExcludedCount = { etf: number; warrant: number; watch_list: number };

// ---------------------------------------------------------------------------
// SC-1 — 大盤強弱卡(index_strength)
// ---------------------------------------------------------------------------

export type IndexSide = {
  close: number;
  change_rate: number;
  median_change_rate: number | null;
  spread: number | null;
};

export type IndexContribEntry = {
  stock_id: string;
  name: string;
  change_rate: number;
  contrib_points: number;
};

export type IndexContribGroup = { up: IndexContribEntry[]; down: IndexContribEntry[] };

export type IndexStrength = {
  twse: IndexSide | null;
  tpex: IndexSide | null;
  tsmc: { change_rate: number | null; contrib_points: number | null };
  contrib: { twse: IndexContribGroup | null; tpex: IndexContribGroup | null };
};

// ---------------------------------------------------------------------------
// SC-2 — 權值 vs 中小分層(cap_tiers)
// ---------------------------------------------------------------------------

export type CapTier = {
  tier: "top50" | "mid100" | "rest";
  members: number;
  avg_change_rate: number;
  up_ratio: number;
};

// ---------------------------------------------------------------------------
// SC-3 — 族群輪動三層(sector_rotation + sector_members drill-down)
// ---------------------------------------------------------------------------

export type SectorRotationGroup = {
  name: string;
  members: number;
  avg_change_rate: number;
  vol_ratio: number | null;
};

export type SectorRotationIndustry = SectorRotationGroup & { subs: SectorRotationGroup[] };

export type SectorRotation = {
  as_of: string;
  industries: SectorRotationIndustry[];
};

export type SectorMemberRow = {
  stock_id: string;
  name: string;
  change_rate: number | null;
  vol_ratio: number | null;
  total_amount: number | null;
};

/** GET /api/market/sector_members response shape (not part of snapshot payload). */
export type SectorMembers = {
  industry: string;
  sub_industry: string | null;
  members: SectorMemberRow[];
};

// 經典檢視(heatmap / leaderboard)型別已於 MK-4(mod/batch-ui-update)整刪。
