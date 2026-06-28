# Phase 7 — Goal 結構化證據表

回讀 `brainstorm.md` 後逐 SC-N 對照(不憑記憶)。
2026-06-29,branch `feat/version-info-panel` at `91bf6b9`(P4 fix commit)。

## 證據表

| SC-N | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據 | regression 抽樣對象 |
|---|---|---|---|---|
| **SC-1** Two-mode badge | `frontend/src/components/VersionBadge.tsx:13-22`(Popover.Trigger button,aria-label `版本資訊,目前 v${CURRENT_VERSION}`);`frontend/src/App.tsx:212-217`(top bar `<header class="shrink-0 flex items-center border-b border-line bg-bg">` 含 VersionBadge);`frontend/src/components/ModeSwitch.tsx:17`(refactor 去 outer chrome) | `VersionBadge.test.tsx > SC-1 > render trigger button 含 aria-label 版本資訊`(1 pass);`> trigger button 文字為 v${CURRENT_VERSION}`(1 pass)— **共 2 pass** | `evidence/SC-1_options-badge.png`(options mode 截圖含右上 v0.1 badge);`evidence/SC-1_equity-badge.png`(切到 equity mode 後 badge 仍在);a11y snapshot 兩 mode 都顯示 `uid=1_4 button "版本資訊,目前 v0.1" expandable haspopup="dialog"` | `ModeSwitch.test.tsx` 4 tests pass(role/aria-current/onChange/active-noop refactor 後行為不變);full `npm test` 32 files / 293 tests pass |
| **SC-2** Click → popover with FinMind | `frontend/src/components/VersionBadge.tsx:23-50`(Popover.Portal + Content,`aria-labelledby="version-info-title"`,header h2 + `資料來源: FinMind` span,ul changelog list);`VersionBadge.tsx:54-93`(VersionEntryItem 子元件,features/fixes 分組 + scope label) | `VersionBadge.test.tsx > SC-2 > 初始未開:popover h2 標題不在 DOM`;`> 點擊 trigger 後 popover 開,顯示『資料來源: FinMind』`;`> popover 內含『版本資訊面板』seed 條目`;`> popover 顯示 scope 標籤(個股 / 選擇權 / 全局)`— **共 4 pass** | `evidence/SC-2_popover-open.png`(完整 popover 視覺:版本資訊 h2 + 資料來源: FINMIND + v0.1 + 7 條 changes 含 scope 標 + 新增功能/修正 分組);a11y snapshot 顯示 `uid=2_1 dialog "版本資訊" focusable focused` + `uid=2_4 StaticText "資料來源: FINMIND"` + 7 條 change items | `npm test` 32 files / 293 tests pass(VersionBadge 無 React warning,無破其他元件) |
| **SC-3** v0.1 seed completeness | `frontend/src/lib/changelog.ts:22-38`(CHANGELOG v0.1 完整 entry:7 條 changes 含「新增版本資訊面板」+ Max Pain / Bollinger / 券商窗 / 鍵盤 / TX 夜盤 / 冷啟動加速) | `changelog.test.ts > v0.1 seed > CHANGELOG 第一筆是 v0.1`;`> v0.1 包含至少 4 條 changes`;`> v0.1 changes 包含『版本資訊面板』相關條目`;`> v0.1 changes 涵蓋近期至少 3 個既有主功能(SC-3 keywords)`;`> 每條 change 的 kind 屬於 feature / fix,scope 屬於 equity / options / global`— **共 5 pass** | `evidence/SC-2_popover-open.png` 中可見 v0.1 seed 7 條完整呈現(新增版本資訊面板 + TXO 籌碼框架 + K 線 Bollinger + 券商窗 + 鍵盤導航 + 夜盤 + 冷啟動);brainstorm 要求「任 3 個關鍵字」實際命中 4 個(Max Pain / Bollinger / 券商窗 / 鍵盤) | `npm test` 32 files / 293 tests pass(seed 改文案後 keyword test 仍綠) |
| **SC-4** CLAUDE.md §7 版本管理慣例 | `CLAUDE.md:114-139`(`## 7. 版本管理慣例` 完整節:user-facing changelog 位置 + (a) 累加 / (b) bump 兩選一 + 5 行判準表 + scope 三選一規則 + date 格式 + commit msg 格式 + v0.1 起始);`CLAUDE.md:141,183`(順移 ## 8 / ## 9 編號) | `grep -n "版本管理慣例" CLAUDE.md` → `114:## 7. 版本管理慣例`(命中 1 行 ✓);`grep -cE "累加\|bump" CLAUDE.md` → `10`(brainstorm 要 ≥2,大幅超標) | 屬 doc shape,real-env = grep CLI 確認(已執行,結果同左欄);`grep "^## " CLAUDE.md` 顯示節次 0-9 全部存在且順序正確 | 無 — 純文檔節新增 + 兩個既有節編號 +1,內文無 cross-ref(已 grep `§\d|第\d+節` 確認無命中),無影響其他文件 |
| **SC-5** Reverse-sort + derive fallback | `frontend/src/lib/changelog.ts:18-20`(`deriveCurrentVersion(entries)` pure helper,`return entries[0]?.version ?? "0.0"`);`changelog.ts:40`(`CURRENT_VERSION = deriveCurrentVersion(CHANGELOG)`);CHANGELOG 倒序由維護者 source-time 保證,test 強制驗證 | `changelog.test.ts > deriveCurrentVersion > 回傳空陣列時的 fallback '0.0'`;`> 取第一筆 entry 的 version`;`> CHANGELOG invariants > 以 date 嚴格遞減排序(最新在前)`;`> CURRENT_VERSION 等於 CHANGELOG[0].version`— **共 4 pass** | `evidence/SC-1_options-badge.png` / `SC-1_equity-badge.png` 中 badge 文字 `v0.1` 證明 wiring 鏈 `CHANGELOG[0].version → deriveCurrentVersion → CURRENT_VERSION → button text` 在真實 browser 端點端到端執行正確(若 derive 壞掉會 render `v0.0` fallback) | `npm test` 32 files / 293 tests pass |

## Brainstorm Edge Cases 對照

| Edge | 設計處理位置 | 自動化測試覆蓋 |
|---|---|---|
| 1. CHANGELOG 為空 → fallback `"0.0"` + badge 仍 render | `changelog.ts:19` `?? "0.0"` | `deriveCurrentVersion > 回傳空陣列時的 fallback '0.0'` pass |
| 2. Popover 內容過長 → scroll | `VersionBadge.tsx:28` `max-h-[60vh] overflow-y-auto` | 視覺驗證(SC-2 截圖中 popover 內容 fit 不撐破) |
| 3. 同版本 changes 陣列空 → `(無條目)` | `VersionBadge.tsx:68-70` | unit 測試 v0.1 全有 changes,但分支存在於 code 中 |
| 4. 鍵盤 a11y(Esc / Tab focus trap) | Radix Popover 內建 | a11y snapshot 顯示 `dialog focusable focused` 證實 Radix 正常工作 |
| 5. 切 mode 時 popover 保留 | 結構上 top bar 全局 — VersionBadge 不在 mode-conditional 樹中 | snapshot 顯示 badge button uid=1_4 在兩 mode 都同 ID(同一 React tree) |

## Phase 7 判定

**全 SC 通過**,無 N/A / verified ✓ / 應該可以 字樣。**進 Phase 8**。

## Cycle Counts

`state.json.sc_cycle_counts` 全部維持 0(無 Phase 7 退回)。
