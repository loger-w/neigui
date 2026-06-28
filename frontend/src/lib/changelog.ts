export type ChangeKind = "feature" | "fix";
export type ChangeScope = "equity" | "options" | "global";

export interface ChangeItem {
  kind: ChangeKind;
  scope: ChangeScope;
  text: string;
}

export interface VersionEntry {
  version: string;
  date: string;
  highlights?: string;
  changes: ChangeItem[];
}

export function deriveCurrentVersion(entries: readonly VersionEntry[]): string {
  return entries[0]?.version ?? "0.0";
}

// 最新版本排第一筆,維護者寫入時手動倒序;test 強制驗證單調遞減。
export const CHANGELOG: VersionEntry[] = [
  {
    version: "0.1",
    date: "2026-06-29",
    highlights: "首個有紀錄的版本 — 版本資訊面板上線,回顧近期主功能",
    changes: [
      { kind: "feature", scope: "global",  text: "新增版本資訊面板" },
      { kind: "feature", scope: "options", text: "TXO 籌碼框架:Max Pain / OI Walls / PCR / 法人四卡" },
      { kind: "feature", scope: "equity",  text: "K 線新增 Bollinger Bands,支援滾輪與框選縮放" },
      { kind: "feature", scope: "equity",  text: "個股券商窗支援自訂 N 日加總" },
      { kind: "feature", scope: "equity",  text: "代號搜尋支援鍵盤導航(↑↓ / Enter / Esc)" },
      { kind: "fix",     scope: "options", text: "台指期盤後價即時更新更穩定(含夜盤)" },
      { kind: "fix",     scope: "options", text: "選擇權日資料冷啟動加速(27s → 4.3s)" },
    ],
  },
];

export const CURRENT_VERSION: string = deriveCurrentVersion(CHANGELOG);

export const DATA_SOURCES = ["FinMind"] as const;
