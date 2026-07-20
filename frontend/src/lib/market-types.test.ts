import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "./market-types";

// market-today-only change-spec §3:舊 breadth/sector_* 四鍵 + eod_pending/
// eod_as_of 隨 EOD 管線整段移除;改測 index_strength / cap_tiers /
// sector_rotation 三新鍵(inline fixture,不再依賴 market-monitor-v2 舊 evidence
// JSON — 該檔案是已退役功能的靜態證據,不會補上新契約鍵)。
const fixture: MarketSnapshot = {
  as_of: "2026-07-20T13:07:05+08:00",
  last_tick: "2026-07-20T13:07:00",
  is_trading_session: true,
  stale: false,
  lag_seconds: 5,
  sectors: [],
  leaderboards: { gainers: [], losers: [], amount: [], volume_ratio: [] },
  universe_size: 1917,
  excluded_count: { etf: 347, warrant: 67, watch_list: 57 },
  index_strength: {
    twse: { close: 42650.6, change_rate: -0.04, median_change_rate: -1.8, spread: 1.76 },
    tpex: { close: 370.4, change_rate: -2.11, median_change_rate: -2.4, spread: 0.29 },
    tsmc: { change_rate: 1.2, contrib_points: 210.5 },
    contrib: {
      twse: {
        up: [{ stock_id: "2330", name: "台積電", change_rate: 1.2, contrib_points: 210.5 }],
        down: [],
      },
      tpex: { up: [], down: [] },
    },
  },
  cap_tiers: [
    { tier: "top50", members: 50, avg_change_rate: -0.3, up_ratio: 0.32 },
    { tier: "mid100", members: 100, avg_change_rate: -1.9, up_ratio: 0.18 },
    { tier: "rest", members: 1600, avg_change_rate: -2.2, up_ratio: 0.15 },
  ],
  sector_rotation: {
    as_of: "2026-07-20 13:07:05",
    industries: [
      {
        name: "半導體",
        members: 120,
        avg_change_rate: 0.4,
        vol_ratio: 1.31,
        subs: [{ name: "記憶體IC", members: 6, avg_change_rate: 3.1, vol_ratio: 2.4 }],
      },
    ],
  },
};

describe("MarketSnapshot contract lock (market-today-only)", () => {
  it("contract: 11 top-level keys 存在(舊 6 EOD 鍵已移除)", () => {
    const keys = [
      "as_of",
      "last_tick",
      "is_trading_session",
      "stale",
      "lag_seconds",
      "sectors",
      "leaderboards",
      "universe_size",
      "excluded_count",
      "index_strength",
      "cap_tiers",
      "sector_rotation",
    ];
    for (const k of keys) {
      expect(k in fixture).toBe(true);
    }
    for (const removed of ["breadth", "sector_breadth", "sector_volume_ratio", "sector_amount_share", "eod_pending", "eod_as_of"]) {
      expect(removed in fixture).toBe(false);
    }
  });

  it("contract: index_strength — twse/tpex 側 null 容許,tsmc 恆為物件", () => {
    const nullSides: MarketSnapshot = {
      ...fixture,
      index_strength: {
        twse: null,
        tpex: null,
        tsmc: { change_rate: null, contrib_points: null },
        contrib: { twse: null, tpex: null },
      },
    };
    expect(nullSides.index_strength.twse).toBeNull();
    expect(nullSides.index_strength.tpex).toBeNull();
    expect(nullSides.index_strength.tsmc).toEqual({ change_rate: null, contrib_points: null });
    expect(nullSides.index_strength.contrib.twse).toBeNull();

    expect(fixture.index_strength.twse?.close).toBe(42650.6);
    expect(fixture.index_strength.contrib.twse?.up.length).toBe(1);
  });

  it("contract: cap_tiers — null 或 tier/members/avg_change_rate/up_ratio 陣列", () => {
    expect(fixture.cap_tiers).not.toBeNull();
    for (const t of fixture.cap_tiers ?? []) {
      expect(["top50", "mid100", "rest"]).toContain(t.tier);
      expect(typeof t.members).toBe("number");
      expect(typeof t.avg_change_rate).toBe("number");
      expect(t.up_ratio).toBeGreaterThanOrEqual(0);
      expect(t.up_ratio).toBeLessThanOrEqual(1);
    }
    const degraded: MarketSnapshot = { ...fixture, cap_tiers: null };
    expect(degraded.cap_tiers).toBeNull();
  });

  it("contract: sector_rotation — industries/subs 遞迴 shape,null 降級容許", () => {
    expect(fixture.sector_rotation).not.toBeNull();
    const industries = fixture.sector_rotation?.industries ?? [];
    expect(industries.length).toBeGreaterThan(0);
    for (const ind of industries) {
      expect(typeof ind.name).toBe("string");
      expect(typeof ind.members).toBe("number");
      expect(typeof ind.avg_change_rate).toBe("number");
      expect(ind.vol_ratio === null || typeof ind.vol_ratio === "number").toBe(true);
      for (const sub of ind.subs) {
        expect(typeof sub.name).toBe("string");
        expect(sub.vol_ratio === null || typeof sub.vol_ratio === "number").toBe(true);
      }
    }
    const degraded: MarketSnapshot = { ...fixture, sector_rotation: null };
    expect(degraded.sector_rotation).toBeNull();
  });

  it("contract: universe_size / excluded_count 保留原契約", () => {
    expect(typeof fixture.universe_size).toBe("number");
    expect(fixture.universe_size).toBeGreaterThan(0);
    expect(typeof fixture.excluded_count.etf).toBe("number");
    expect(fixture.excluded_count.etf).toBeGreaterThanOrEqual(0);
    expect(typeof fixture.excluded_count.warrant).toBe("number");
    expect(typeof fixture.excluded_count.watch_list).toBe("number");
  });
});
