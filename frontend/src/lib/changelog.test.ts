import { describe, it, expect } from "vitest";
import {
  CHANGELOG,
  CURRENT_VERSION,
  DATA_SOURCES,
  deriveCurrentVersion,
  type VersionEntry,
} from "./changelog";

describe("deriveCurrentVersion", () => {
  it("回傳空陣列時的 fallback '0.0'", () => {
    expect(deriveCurrentVersion([])).toBe("0.0");
  });

  it("取第一筆 entry 的 version", () => {
    const entries: VersionEntry[] = [
      { version: "0.2", date: "2026-07-01", changes: [] },
      { version: "0.1", date: "2026-06-29", changes: [] },
    ];
    expect(deriveCurrentVersion(entries)).toBe("0.2");
  });
});

describe("CHANGELOG invariants", () => {
  it("以 date 嚴格遞減排序(最新在前)", () => {
    for (let i = 0; i < CHANGELOG.length - 1; i++) {
      const cur = CHANGELOG[i]!;
      const next = CHANGELOG[i + 1]!;
      expect(cur.date >= next.date).toBe(true);
    }
  });

  it("CURRENT_VERSION 等於 CHANGELOG[0].version(value-based)", () => {
    expect(CURRENT_VERSION).toBe(CHANGELOG[0]?.version ?? "0.0");
  });
});

describe("v0.1 seed", () => {
  it("CHANGELOG 第一筆是 v0.1", () => {
    expect(CHANGELOG[0]?.version).toBe("0.1");
  });

  it("v0.1 包含至少 4 條 changes", () => {
    expect(CHANGELOG[0]?.changes.length).toBeGreaterThanOrEqual(4);
  });

  it("v0.1 changes 包含『版本資訊面板』相關條目", () => {
    const v01 = CHANGELOG[0]!;
    const hit = v01.changes.some((c) => c.text.includes("版本資訊面板"));
    expect(hit).toBe(true);
  });

  it("v0.1 changes 涵蓋近期至少 3 個既有主功能(SC-3 keywords)", () => {
    const v01 = CHANGELOG[0]!;
    const texts = v01.changes.map((c) => c.text).join("|");
    const keywords = ["Max Pain", "Bollinger", "券商窗", "鍵盤"];
    const hits = keywords.filter((k) => texts.includes(k));
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("每條 change 的 kind 屬於 feature / fix,scope 屬於 equity / options / global", () => {
    const kinds = new Set(["feature", "fix"]);
    const scopes = new Set(["equity", "options", "global"]);
    for (const v of CHANGELOG) {
      for (const c of v.changes) {
        expect(kinds.has(c.kind)).toBe(true);
        expect(scopes.has(c.scope)).toBe(true);
      }
    }
  });
});

describe("DATA_SOURCES", () => {
  it("包含 'FinMind'", () => {
    expect(DATA_SOURCES).toContain("FinMind");
  });
});
