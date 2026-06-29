import { describe, it, expect } from "vitest";
import {
  CHANGELOG,
  CURRENT_VERSION,
  DATA_SOURCES,
  deriveCurrentVersion,
  semverGt,
  totalUpdates,
  type VersionEntry,
} from "./changelog";

describe("deriveCurrentVersion", () => {
  it("回傳空陣列時的 fallback '0.0.0'(SemVer 三段式)", () => {
    expect(deriveCurrentVersion([])).toBe("0.0.0");
  });

  it("取第一筆 entry 的 version", () => {
    const entries: VersionEntry[] = [
      { version: "0.2.0", date: "2026-07-01", changes: [] },
      { version: "0.1.0", date: "2026-06-29", changes: [] },
    ];
    expect(deriveCurrentVersion(entries)).toBe("0.2.0");
  });
});

describe("semverGt", () => {
  it("major / minor / patch 各位比較正確", () => {
    expect(semverGt("0.14.0", "0.13.0")).toBe(true);
    expect(semverGt("0.14.1", "0.14.0")).toBe(true);
    expect(semverGt("1.0.0", "0.99.99")).toBe(true);
    expect(semverGt("0.13.0", "0.14.0")).toBe(false);
    expect(semverGt("0.14.0", "0.14.0")).toBe(false);
  });
});

describe("totalUpdates", () => {
  it("加總所有 entries 的 changes 個數", () => {
    const entries: VersionEntry[] = [
      { version: "0.2.0", date: "2026-07-01", changes: [
        { kind: "feature", scope: "global", text: "a" },
        { kind: "fix", scope: "equity", text: "b" },
      ] },
      { version: "0.1.0", date: "2026-06-29", changes: [
        { kind: "feature", scope: "options", text: "c" },
      ] },
    ];
    expect(totalUpdates(entries)).toBe(3);
  });

  it("空陣列回傳 0", () => {
    expect(totalUpdates([])).toBe(0);
  });
});

describe("CHANGELOG invariants", () => {
  it("以 date 遞減排序(最新在前);同日內以 SemVer 降冪 tiebreak", () => {
    for (let i = 0; i < CHANGELOG.length - 1; i++) {
      const cur = CHANGELOG[i]!;
      const next = CHANGELOG[i + 1]!;
      const ok =
        cur.date > next.date ||
        (cur.date === next.date && semverGt(cur.version, next.version));
      expect(ok).toBe(true);
    }
  });

  it("CURRENT_VERSION 等於 CHANGELOG[0].version(value-based)", () => {
    expect(CURRENT_VERSION).toBe(CHANGELOG[0]?.version ?? "0.0.0");
  });

  it("所有 version 字串符合 SemVer 三段式 MAJOR.MINOR.PATCH", () => {
    const semverRe = /^\d+\.\d+\.\d+$/;
    for (const v of CHANGELOG) {
      expect(semverRe.test(v.version)).toBe(true);
    }
  });

  it("CHANGELOG 至少含 14 個歷史版本(retroactive 上線)", () => {
    expect(CHANGELOG.length).toBeGreaterThanOrEqual(14);
  });

  it("最新版本是 v0.17.1(三大法人 N 日加總 + 拔 subchart band)", () => {
    expect(CHANGELOG[0]?.version).toBe("0.17.1");
  });

  it("CHANGELOG 任一 entry 包含『版本資訊面板』相關條目", () => {
    const hit = CHANGELOG.some((v) =>
      v.changes.some((c) => c.text.includes("版本資訊面板")),
    );
    expect(hit).toBe(true);
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

  it("覆蓋 equity / options / global 三 scope", () => {
    const seen = new Set<string>();
    for (const v of CHANGELOG) {
      for (const c of v.changes) seen.add(c.scope);
    }
    expect(seen.has("equity")).toBe(true);
    expect(seen.has("options")).toBe(true);
    expect(seen.has("global")).toBe(true);
  });
});

describe("DATA_SOURCES", () => {
  it("包含 'FinMind'", () => {
    expect(DATA_SOURCES).toContain("FinMind");
  });
});
