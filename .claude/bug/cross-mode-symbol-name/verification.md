# verification — fix/cross-mode-symbol-name(2026-08-19)

| gate | command | exit |
|---|---|---|
| vitest | `npx vitest run`(frontend) | 0 — 1093 passed |
| build | `npm run build`(frontend) | 0 |
| backend | 未動 backend(pytest / ruff 不適用) | — |
| e2e | 豁免:App 層 header 補名,無新 UI 元件 / 路由;既有 e2e 不含跨 mode 跳轉斷言 | — |

真實環境:見 repro.md §4 + evidence/*.png。反向驗證:repro.md §3。
Blast radius:`symbolName` 三處消費點(header / 桌面 WatchlistSidebar / 手機 WatchlistSidebar)
全改讀 `resolvedSymbolName`;`useAllSymbols` 既有唯一 caller SymbolSearch 行為不變。
