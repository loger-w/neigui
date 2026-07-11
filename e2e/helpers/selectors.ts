/**
 * E2E selector contract — design.md v6 §6。
 *
 * TESTIDS / ROLES 集中宣告。所有 spec 透過此檔 import,**不**寫 magic string。
 *
 * **FOOTER ENFORCEMENT(R2-P2-3)**:
 * 這 16 root data-testid 是 spec 契約。改名 / 移除 / 拆 wrapper 等動作必須:
 *   1. 同 PR 改 e2e/helpers/selectors.ts 對應 const
 *   2. 同 PR 改受影響的 e2e/specs/*.spec.ts
 *   3. CI E2E suite 是 enforcement gate;PR 紅 ≠ 接受
 */

export const TESTIDS = {
  // equity mode roots(Wave 1 已加)
  chipBrokersPanel: "chip-brokers-panel",
  chipKlineChart: "chip-kline-chart",
  // options mode roots(options-page-v2 四層重排,2026-07-07)
  optionsConclusion: "options-conclusion",
  optionsRangeMap: "options-range-map",
  optionsThermometer: "options-thermometer",
  thermoTile: "thermo-tile",
  optionsAdvancedPanel: "options-advanced-panel",
  advancedToggle: "advanced-toggle",
  optionsNetTable: "options-net-table",
  // 收合層內的四卡(展開後才 visible)
  optionsMaxPainCard: "options-max-pain-card",
  optionsOIWallsCard: "options-oi-walls-card",
  optionsPCRCard: "options-pcr-card",
  optionsInstitutionalCard: "options-institutional-card",
  // market mode roots(Wave 1 已加)
  marketHeatmap: "market-heatmap",
  marketLeaderboard: "market-leaderboard",
  // market v2 panels(feat/market-page-v2-frontend)
  marketUniverseBanner: "market-universe-banner",
  marketBreadthPanel: "market-breadth-panel",
  marketSectorBreadthHeatmap: "market-sector-breadth-heatmap",
  marketSectorAmountShare: "market-sector-amount-share",
  marketSectorVolRatio: "market-sector-vol-ratio",
  marketClassicToggle: "market-classic-toggle",
  // borrow mode roots(feat/daytrade-borrow-fee)
  borrowFeePage: "borrow-fee-page",
  feeRow: "fee-row",
  feeHigh: "fee-high",
  // equity 權證 tab(feat/warrant-selector)
  warrantRow: "warrant-row",
  warrantKindBadge: "warrant-kind-badge",
  mispricingLabel: "mispricing-label",
  warrantBrokersDetail: "warrant-brokers-detail",

  // 既有(component 內既有,不在 Wave 1 modify scope)
  refreshSpinner: "refresh-spinner",
  panelResizeHandle: "panel-resize-handle",
  panelInstitutional: "panel-institutional",
  callWall: "call-wall",
  putWall: "put-wall",
} as const;

// Mutation test 教訓(2026-06-30):Playwright `name: 'X'` 預設 **substring**
// 匹配 — 改 label 從 `個股` → `個股X` 仍會被誤匹過。所有 mode 切換 button
// 改用 exact RegExp `/^...$/` 鎖死,徹底 discriminative。
export const ROLES = {
  modeSwitchEquity: { role: "button" as const, name: /^個股$/ },
  modeSwitchOptions: { role: "button" as const, name: /^選擇權$/ },
  modeSwitchMarket: { role: "button" as const, name: /^大盤$/ },
  modeSwitchBorrow: { role: "button" as const, name: /^券差$/ },
  // active 用 aria-current='page'(F10 — 不是 data-state,Radix Tabs 已 drop)
  refresh: { role: "button" as const, name: "重新整理" },
  // RangeSelector.tsx:141 真實 aria-label(F15)
  windowDays10: { role: "button" as const, name: "設為 10 日" },
  windowDays60: { role: "button" as const, name: "設為 60 日" },
};
