# Chore: $ARGUMENTS

(若 $ARGUMENTS 為空,先問我要做什麼再繼續。)

共通鐵則套用 `~/.claude/CLAUDE.md`。自主模式契約見 `~/.claude/commands/auto.md`。

## 適用範圍(輕量入口 — 不套多 phase 流程)

dependency 升級 / 補測試(不改實作)/ docs 更新 / 研究腳本(probe、一次性分析)/ 基建小事(config、CI、腳本)。

**不適用 → 轉正規流程**:改既有行為或介面 → `/mod`;東西壞了 → `/bug`;新功能 → `/feat`;純結構重構 → `/refactor`。判準:會讓既有測試紅、或 user 可感的行為差異 → 不是 chore。

## 步驟

1. **定界**:一句話確認做什麼 + 明確不做什麼。順手衝動照鐵則 B 寫進 `docs/next-time.md`,不擴 scope。
2. **動 code 就驗證**:呼叫 `auto-verify` 自動化節(依 `.claude/harness.json`)。只動 docs / 研究腳本可豁免,commit message 註明。
3. **e2e 判準檢查**(殘餘風險補丁,2026-07-19 拍板):改動若碰 UI 或行為相鄰(即使自認 chore),查 skill `e2e-conventions` 判準表定 e2e 歸屬;豁免要在 commit 註明類型。
4. **dependency 升級特別條款**:一次一個(或一組同源)、升完跑全套 `auto-verify`、breaking changes 讀 release notes 不猜。lockfile 巨 diff 單獨 commit。
5. **收尾**:小事直接 main 小 commit(多 session 並行前提:push 前重查 HEAD,偏好新 commit 不 amend);成串改動或有風險 → `branch-lifecycle` 開分支走收尾節。commit 遵循 `<type>(<scope>): <subject>`,三類不混;chore 通常不入 changelog(專案 CLAUDE.md §7)。

## 禁止(本流程特有,共通禁止見 CLAUDE.md)

- ❌ 掛 chore 之名夾帶行為改動(那是 /mod)
- ❌ 升級 dependency 後只跑「看起來相關」的測試(全套 gate 照跑)
- ❌ 研究腳本寫進 backend/frontend 正式目錄(放 `scripts/` 或 scratchpad)
