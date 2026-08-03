---
name: auto-verify
description: 跑「自動化驗證指令(tsc / vitest / pytest / ruff / build)」與「真實環境驗證(curl / CLI / consumer script / DevTools MCP 截圖對照)」。在 /feat /bug /mod /refactor /perf 流程的「完成前 gate」階段呼叫,確認改動沒打壞既有測試與 build。先檢查專案形狀再選對應驗證指令來源,不硬跑 `cd frontend/` 撞牆。本 skill 是形狀偵測表與驗證方式表的唯一 source of truth(command 檔不重抄)。
metadata:
  author: user
  version: "4.1.0"
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
| web | API 層 `curl` happy + ≥ 2 edge;UI SC 走「UI 畫面驗證」節(AI 截圖對照 + user 過目雙層,2026-08-03 回復) |
| 純後端 API | `curl` / `httpie` 跑 happy + ≥ 2 edge,貼 request / response 當證據 |
| CLI | 真實 argv × 3 + exit code + stdout / stderr 對照 |
| library | 一個獨立 consumer script 跑公開 API |
| worker / queue | 真實 message + retry + DLQ 驗證 |
| TUI | terminal recording(asciinema 或等價) |
| Electron / desktop | 真實啟動 + 三場景(AI 截圖對照 + user 過目) |

至少測:Happy path、≥ 2 個 edge case(空輸入 / 錯誤輸入 / 邊界值)、**抽 2 個沒改的相關功能**
確認 regression 沒打壞。

### UI 畫面驗證(2026-08-03 回復 AI 截圖層,user 拍板)

- 用 DevTools MCP(或 claude-in-chrome)開**真實頁面**,逐條 UI SC 對照「可指認」表述
  (位置 / 文字 / 顏色 / 元素)核對,截圖存 artifact `evidence/`,**檔名含 SC-N**;
  順手看 console 有無新增 error。
- 截圖對照**dispatch subagent 執行**(顯式 `model: opus`,browser 工具經 ToolSearch 載入;
  prompt 帶 SC 可指認表述清單 + 操作路徑 + evidence 落點),回傳逐 SC 判定
  (PASS / FAIL + 依據)+ 截圖路徑;main session 只裁決 FAIL 項,不自己開瀏覽器
  (2026-08-03 拍板)。
- **不回復 Playwright assertion gate 與 subsumed 條款**(2026-07-27 根因:e2e assertion
  是模型轉譯的,轉譯錯照樣綠 — 該層留在墳裡,不因本次回復復活)。
- AI 截圖核對**不取代 user 過目**:收尾回報仍逐條列可指認表述 + 操作路徑請 user 確認,
  雙層缺一不可。截圖的價值是在 user 過目前先攔明顯不符 + 留可追溯證據。
- 瀏覽器 / MCP 不可用 → 降級純 user 過目,evidence 標 `browser_unavailable: <reason>`。

**Infra 失敗 fallback**(token 過期 / 外部 503):不硬撞 — 標
`infra_fail: <reason>` 回報呼叫方流程(/feat 記 `state.json.phase_6_blocked_reason`)。

證據(log / req-res 對照)放當前 task 的 artifact 目錄(例:
`.claude/feat/<slug>/evidence/`),**檔名含 SC-N 或情境標籤**(例:`SC-2_api-edge-cases.txt`)。
