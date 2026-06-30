/**
 * E2E selector contract — design.md v6 §6。
 *
 * TESTIDS / ROLES 集中宣告。所有 spec 透過此檔 import,**不**寫 magic string。
 *
 * **FOOTER ENFORCEMENT(R2-P2-3)**:
 * 這 10 root data-testid 是 spec 契約。改名 / 移除 / 拆 wrapper 等動作必須:
 *   1. 同 PR 改 e2e/helpers/selectors.ts 對應 const
 *   2. 同 PR 改受影響的 e2e/specs/*.spec.ts
 *   3. CI E2E suite 是 enforcement gate;PR 紅 ≠ 接受
 */

export const TESTIDS = {
  // equity mode roots(Wave 1 已加)
  chipBrokersPanel: "chip-brokers-panel",
  chipKlineChart: "chip-kline-chart",
  // options mode roots(Wave 1 已加)
  optionsMaxPainCard: "options-max-pain-card",
  optionsOIWallsCard: "options-oi-walls-card",
  optionsPCRCard: "options-pcr-card",
  optionsInstitutionalCard: "options-institutional-card",
  optionsLargeTradersStrip: "options-large-traders-strip",
  optionsStrikeLadder: "options-strike-ladder",
  // market mode roots(Wave 1 已加)
  marketHeatmap: "market-heatmap",
  marketLeaderboard: "market-leaderboard",

  // 既有(component 內既有,不在 Wave 1 modify scope)
  refreshSpinner: "refresh-spinner",
  panelResizeHandle: "panel-resize-handle",
  panelInstitutional: "panel-institutional",
  callWall: "call-wall",
  putWall: "put-wall",
} as const;

export const ROLES = {
  // ModeSwitch.tsx:10-14 真實 labels(F9 — 個股 / 選擇權 / 大盤,**不是**
  // 個股籌碼 / 大盤掃描)
  modeSwitchEquity: { role: "button" as const, name: "個股" },
  modeSwitchOptions: { role: "button" as const, name: "選擇權" },
  modeSwitchMarket: { role: "button" as const, name: "大盤" },
  // active 用 aria-current='page'(F10 — 不是 data-state,Radix Tabs 已 drop)
  refresh: { role: "button" as const, name: "重新整理" },
  // RangeSelector.tsx:141 真實 aria-label(F15)
  windowDays10: { role: "button" as const, name: "設為 10 日" },
  windowDays60: { role: "button" as const, name: "設為 60 日" },
};
