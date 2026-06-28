# Implementation Spec — `frontend/src/lib/changelog.ts` + `changelog.test.ts`

對應 SC-3 / SC-5。

---

## `changelog.ts`

### Exports

```ts
export type ChangeKind = "feature" | "fix";
export type ChangeScope = "equity" | "options" | "global";

export interface ChangeItem {
  kind: ChangeKind;
  scope: ChangeScope;
  text: string;
}

export interface VersionEntry {
  version: string;
  date: string;            // YYYY-MM-DD
  highlights?: string;
  changes: ChangeItem[];
}

export function deriveCurrentVersion(entries: readonly VersionEntry[]): string;
export const CHANGELOG: VersionEntry[];
export const CURRENT_VERSION: string;
export const DATA_SOURCES: readonly ["FinMind"];
```

### `deriveCurrentVersion` 行為

```ts
deriveCurrentVersion([])
// → "0.0"

deriveCurrentVersion([{ version: "0.1", date: "2026-06-29", changes: [] }])
// → "0.1"

deriveCurrentVersion([
  { version: "0.2", date: "2026-07-01", changes: [] },
  { version: "0.1", date: "2026-06-29", changes: [] },
])
// → "0.2"  (取第一筆,責任在源頭手動排序)
```

### `CHANGELOG` 內容(v0.1 seed)

```ts
export const CHANGELOG: VersionEntry[] = [
  {
    version: "0.1",
    date: "2026-06-29",
    highlights: "首個有紀錄的版本 — 版本資訊面板上線,回顧近期主功能",
    changes: [
      { kind: "feature", scope: "global",  text: "新增版本資訊面板(header v0.x badge + popover changelog)" },
      { kind: "feature", scope: "options", text: "TXO 籌碼框架:Max Pain / OI Walls / PCR / Institutional 四卡" },
      { kind: "feature", scope: "equity",  text: "K-line Bollinger Bands overlay + 滾輪 / brush 縮放" },
      { kind: "feature", scope: "equity",  text: "N 日券商窗加總 + RangeSelector spinbutton" },
      { kind: "feature", scope: "equity",  text: "代號搜尋鍵盤導航(↑↓ / Enter / Esc)" },
      { kind: "fix",     scope: "options", text: "TX spot 包含夜盤、60s polling 更穩定" },
      { kind: "fix",     scope: "options", text: "TaiwanOptionDaily 每日 cache 加速冷啟動(27s → 4.3s)" },
    ],
  },
];

export const CURRENT_VERSION: string = deriveCurrentVersion(CHANGELOG);

export const DATA_SOURCES = ["FinMind"] as const;
```

### 排序契約

- 寫入時手動倒序(最新 date 在 index 0)
- 不在 runtime sort(避免 render-time cost + 確保 source of truth 在 commit diff)
- test 強制驗證 invariant

---

## `changelog.test.ts`

### 不需 jsdom — 純資料測試

檔頭**不加** `/** @vitest-environment jsdom */`(預設 node 環境足夠)。

### 失敗測試清單(對應 SC)

#### SC-3 / SC-5 — `deriveCurrentVersion`(pure helper)

```ts
import { describe, it, expect } from "vitest";
import {
  CHANGELOG, CURRENT_VERSION, DATA_SOURCES,
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
```

#### SC-5 — CHANGELOG 倒序 invariant

```ts
describe("CHANGELOG", () => {
  it("以 date 嚴格遞減排序(最新在前)", () => {
    for (let i = 0; i < CHANGELOG.length - 1; i++) {
      const cur = CHANGELOG[i]!;
      const next = CHANGELOG[i + 1]!;
      expect(cur.date >= next.date).toBe(true);
    }
  });

  it("CURRENT_VERSION 等於 CHANGELOG[0].version(value-based,非 tautology)", () => {
    expect(CURRENT_VERSION).toBe(CHANGELOG[0]?.version ?? "0.0");
  });
});
```

#### SC-3 — v0.1 seed 條件

```ts
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
```

### 失敗 → 通過範例

- **新檔 `changelog.ts` 不存在** → import 失敗,vitest 5 個 describe 全紅(red 階段)
- 寫 stub `export const CHANGELOG: VersionEntry[] = []` + 其他 export → 部分綠(`deriveCurrentVersion`、`DATA_SOURCES`),v0.1 seed 4 個測試紅
- 填入完整 seed → 全綠
