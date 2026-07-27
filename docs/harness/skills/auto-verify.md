---
name: auto-verify
description: 跑「自動化驗證指令(tsc / vitest / pytest / ruff / build)」與「真實環境驗證(dev server + DevTools MCP + 截圖 / curl / CLI)」。在 /feat /bug /mod /refactor /perf 流程的「完成前 gate」階段呼叫,確認改動沒打壞既有測試與 build。先檢查專案形狀再選對應驗證指令來源,不硬跑 `cd frontend/` 撞牆。本 skill 是形狀偵測表與驗證方式表的唯一 source of truth(command 檔不重抄)。
metadata:
  author: user
  version: "3.1.0"
---

# Auto-Verify

完成前 gate:自動化驗證 + 真實環境驗證,雙層證據才算 Done。
**本 skill 是「專案形狀 → 驗證指令」與「feature shape → 真實環境驗證方式」兩張表的唯一
source of truth** — command 只寫「呼叫 auto-verify」,不重抄表格。

> 本 skill 負責**跑指令拿證據**;`verification-before-completion` 負責**回頭核對
> 動機**(重讀 brainstorm.md / SC-N / metric 目標)。順序:本 skill 全綠 → 才進那一支。兩者都
> 過才是 Done。專案層 `<project>/CLAUDE.md` 可覆寫本 skill 的預設指令(就近原則)。

## 自動化驗證五步驟(monorepo / frontend+backend 預設)

| # | 指令 | 工作目錄 | 必須 |
|---|------|---------|------|
| 1 | `npx tsc -b` | `frontend/` | 0 errors |
| 2 | `npx vitest run` | `frontend/` | 全綠 |
| 3 | `python -m pytest -v` | `backend/` | 全綠 |
| 4 | `ruff check .` | `backend/` | 0 issues |
| 5 | `npm run build` | `frontend/` | 成功 |

**指令組來源優先序**:專案有 `.claude/harness.json` → 自動化驗證以其 `verify` 陣列為準
(與 git pre-push hook 共用,單一 source of truth);沒有 → 用本 skill 的形狀對應表。
**Stale 偵測**:verify 陣列任一 `cwd` 目錄不存在 → 整檔視為 stale(殘留模板),fallback
專案 CLAUDE.md / 形狀對應表,並提醒 user 修 harness.json — 不硬跑不存在的目錄。

**E2E 是 harness.json 之外的條件 gate**(刻意不入 verify 陣列 — 太慢,pre-push 不跑):
有 Playwright e2e 的專案,verify 陣列全綠**不等於自動化驗證完成** — 還要依專案 e2e 判準
(neigui:skill `e2e-conventions` 判準表)判定本次改動是否必跑 e2e;屬豁免類型 → commit
message 註明(如 `[no-e2e: internal refactor]`)。

任一步紅 → 停下修,套鐵則 F「失敗處理 3 次上限」。

**驗證 / 長跑指令不得接管線後綴**(`| tail` / `| head` / `| grep` 等)— pipeline 會把 exit
code 換成末端指令的,紅燈顯示成假綠燈。要摘要就先重導到檔案再讀,或分開檢查 exit code
(bash `$?` / PowerShell `$LASTEXITCODE`)。

**驗證指令與 commit 禁止同一 shell 鏈**(上一條的姊妹條,同族 = exit code 完整性):
PowerShell `;` 不看 exit code、Windows PowerShell 5.1 亦無 `&&`,`vitest ...; git commit ...`
會紅著 commit。先跑驗證、確認 exit code 綠,再**單獨下** commit 指令。

## 非 monorepo 專案形狀對應

當專案沒有 `frontend/` / `backend/` 分層,**先檢查專案形狀再選指令來源**:

| Shape | 指令來源 |
|---|---|
| frontend-only | `package.json` scripts(tsc / vitest / build) |
| backend-only | `pyproject.toml` / `Makefile`(pytest / ruff) |
| fullstack | 上方五步驟 |
| CLI / library | 專案 README / Makefile / `package.json` |
| worker / monorepo(workspace) | 專案 CLAUDE.md > 根 `package.json` workspace > Makefile |

**偵測不到驗證指令 → 停下來問 user**,不硬跑不存在的目錄。

可並行的步驟(frontend tsc/vitest/build 與 backend pytest/ruff)同時跑,**合併單一報告**。

## 真實環境驗證(依 feature shape 分流)

| Shape | 真實環境驗證方式 |
|---|---|
| web | `/run` 啟動 → Chrome DevTools MCP 操作 → Console 0 errors / 0 red warnings + 截圖 |
| 純後端 API | `curl` / `httpie` 跑 happy + ≥ 2 edge,貼 request / response 當證據 |
| CLI | 真實 argv × 3 + exit code + stdout / stderr 對照 |
| library | 一個獨立 consumer script 跑公開 API |
| worker / queue | 真實 message + retry + DLQ 驗證 |
| TUI | terminal recording(asciinema 或等價) |
| Electron / desktop | 真實啟動 + 三場景 + 截圖 |

至少測:Happy path、≥ 2 個 edge case(空輸入 / 錯誤輸入 / 邊界值)、**抽 2 個沒改的相關功能**
確認 regression 沒打壞。

**Subsumed 判定**(web):該情境已有 Playwright e2e 覆蓋(spec 跑過真 backend + 真 browser)
→ 標 `subsumed by e2e`,不重複 DevTools MCP 截圖。**限縮:只適用純 regression 情境** —
本輪新增 / 改動的 UI 第一輪一律真截圖(e2e assertion 是模型轉譯的,轉譯錯照樣綠;
新畫面首次人眼驗證不可被 e2e 頂替)。

**Infra 失敗 fallback**(token 過期 / browser MCP 斷線 / 外部 503):不硬撞 — 標
`infra_fail: <reason>` 回報呼叫方流程(/feat 記 `state.json.phase_6_blocked_reason`),
browser MCP 斷線先試 `--isolated` profile,再退 curl + 元件測試替代覆蓋。

證據(截圖 / log / req-res 對照)放當前 task 的 artifact 目錄(例:
`.claude/feat/<slug>/evidence/`),**檔名含 SC-N 或情境標籤**(例:`SC-2_login-empty-input.png`)。
