# Harness 版控生命週期補洞 — 設計

> **v2(2026-07-06)**:`design-reviewer` agent round-1 review 5 findings 全 accepted —
> R1(P0)漂移路徑驗證時點錯置 → 改 rebase-先-驗-後-merge;R2(P1)squash 與 `-d` 互斥 → 取消 squash 統一 ff;
> R3(P1)補撞名分支與不在 main 的出口;R4/R5(P2)design-skill 文字對齊、PR 路徑依賴顯式化。
> 日期:2026-07-06
> 動機:/bug /mod /refactor /perf 四流程無分支步驟(commit 直落當前 branch,通常是 main),
> 全 harness 無「主線同步檢查」與「分支清理」明文。/feat 只有生命週期的頭(Phase -1 開分支),
> 尾(Phase 8)是每次人工三選一。
> 歸屬:harness v3 系列(強制層見 `docs/specs/harness-enforcement/design.md`;本件為流程文字層)。

## 0. User 拍板決策

| 決策點 | 選擇 |
|---|---|
| 分支範圍 | **四流程一律開分支**(規則零例外,弱模型不需判斷)|
| 收尾預設 | **自動 local merge + 刪本地分支,不再三選一**(solo 無 reviewer;user 想走 PR 時口頭指定)|
| 結構 | **抽共用 skill `branch-lifecycle`**,五 command 只寫「呼叫」(複製 auto-verify 的單一 source of truth pattern)|
| /goal 契約 | **merge 移出必停清單**(驗證 gate 全綠即自動;理由:local merge 可逆 + push 仍必停有 push-gate 硬攔)|
| 機械化 | 本件為文字層;收尾檢核的 script 化留給強制層第二期(harness-check)|

## 1. 新 skill:`~/.claude/skills/branch-lifecycle/SKILL.md`

Description(供自動掛載):「分支生命週期單一 source of truth:開工(主線同步 + 開分支)與收尾(merge 回 main + 刪分支)。/feat /bug /mod /refactor /perf 開工與收尾時呼叫。」

### 開工節(各 command 第一個 phase 呼叫)

1. `git status` 確認 working tree 乾淨;不乾淨 → 停下問(commit / stash / 放棄)— 沿用 /feat Phase -1 規則
   - **當前不在 main** → 停下問(多半是上一輪流程沒收尾;分支一律從 main 開,不巢狀)
2. `git fetch origin` 後比對 local main vs origin/main:
   - **落後** → `git pull --ff-only`(步驟 1 已保證在 main 上;漂移來源:GitHub workflow 的 baseline commit、他機開發)
   - **領先**(本地 commit 未推)→ 照常繼續(solo 常態)
   - **分岔**(`--ff-only` 會失敗的狀態)→ 停下回報,不自動 rebase
   - 無遠端 / 離線 → 跳過同步,註記一行繼續(不阻塞)
3. `git switch -c <prefix>/<slug>`;prefix 對照表(零例外):

   | Command | prefix |
   |---|---|
   | /feat | `feat/` |
   | /bug | `fix/` |
   | /mod | `mod/` |
   | /refactor | `refactor/` |
   | /perf | `perf/` |

   slug 從 $ARGUMENTS 推導 kebab-case(/feat 既有慣例)。

### 收尾節(各 command Done 條件全過後、最終回報前呼叫)

1. **Gate**:該 command 的 Done 條件全過 + auto-verify 全綠。沒過不准進收尾(收尾不是逃生門)
2. 在分支上 `git fetch origin` 檢查 origin/main(**判準**:`git merge-base --is-ancestor origin/main HEAD` 成立 = 未動,不成立 = 動了 — 此判準在「local main 領先未推」的 solo 常態下不會誤判為漂移):
   - 未動 → 進步驟 3
   - **動了(漂移路徑,R1 修正)** → `git switch main` + `git pull --ff-only` → 切回分支 `git rebase main`(預設路徑分支從未推遠端,重寫安全;rebase 衝突 → `git rebase --abort` 停下回報)→ **在 rebase 後的分支上重跑 auto-verify 自動化節** — ff 保證分支樹 = merge 後 main 的最終樹,綠燈驗的就是要上 main 的狀態;紅 → 停下回報,分支保留
3. `git switch main` → `git merge --ff-only <prefix>/<slug>`(**一律 fast-forward**,保留分類 commit;squash 選項取消 — 單 commit 分支 ff 結果等價,多 commit squash 會使步驟 4 的 `-d` 誤判 not-merged,R2 修正)
4. `git branch -d <prefix>/<slug>`(小寫 `-d`:未 merge 的分支會被 git 擋下,天然防誤刪)
5. 回報時提醒 user「main 領先 origin N 個 commit,可 push」— **不自動 push**(鐵則 H + push-gate 不變)
6. **PR 路徑**(user 事先指定才走;前置依賴:`gh` CLI 已認證,且 **local main == origin/main** — 領先時先走鐵則 H push 流程推平再開 PR,否則 GitHub 端 squash 會與含未推 commit 的 local main 永久分岔):`git push -u origin <branch>`(觸發 push-gate 確認)→ `gh pr create`;user 決定合併時用 `gh pr merge --squash|--merge --delete-branch`(一步完成 merge + 清遠端與本地分支)→ 最後 `git switch main && git pull --ff-only`(GitHub 端產生的 merge commit 拉回本地,補齊與預設路徑的狀態對稱)。預設路徑不推分支上遠端,故無遠端殘留分支問題

### 異常處理(兩節共用)

| 情境 | 處置 |
|---|---|
| rebase 衝突(收尾漂移路徑) | `git rebase --abort` → 停下回報(列衝突檔),不自動解 |
| `--ff-only` 失敗(main 分岔) | 停下回報,不自動 rebase |
| 收尾 gate 沒過 | 留在分支上,回對應 phase(依各 command 失敗 routing) |
| user 中途放棄 | 分支保留;/feat → state.json 標 `paused: <reason>`;其他流程 → 口頭確認後才 `git branch -D` |
| 開工 `switch -c` 撞既有同名分支(R3) | 停下問三選一:resume 該分支續作 / user 確認後 `git branch -D` 重開 / 改 slug |
| 開工時不在 main(R3) | 停下問;當前分支符合 `<prefix>/` 對照表才可選「resume 走完原流程含收尾」,否則(實驗分支 / detached HEAD)只有「user 確認處置該分支後回 main 重開」 |

## 2. 五個 command 的接線(diff 級)

- **/bug /mod /refactor /perf**:各加兩行 —
  - Phases 最前插:`Phase 0|工作區:呼叫 branch-lifecycle 開工節(prefix 見該 skill 對照表)`
  - Done 段後加:`收尾:呼叫 branch-lifecycle 收尾節(自動 merge + 刪分支),完成後回報`
- **/feat**:
  - Phase -1 步驟 1-3 改為「呼叫 branch-lifecycle 開工節」(內容等價,消重複;步驟 4-5 artifact/state 不動)
  - Phase 8 步驟 1 改為:「**預設呼叫 branch-lifecycle 收尾節**(顯式覆寫 `superpowers:finishing-a-development-branch` 的三選一互動 — 理由:solo 無 reviewer,user 2026-07-06 拍板自動化;user 事先指定 PR 則走 PR 路徑)」。步驟 2-3(tag 驗證、artifact commit)不動,順序:tag 驗證 → artifact commit → 收尾節
- **/goal**:必停清單 `push / PR / merge / 破壞性操作` 改為 `push / PR / 破壞性操作`;新增一行:「merge:branch-lifecycle 收尾 gate 全綠即自動(2026-07-06 user 拍板;local merge 可逆、push 仍必停)」

## 3. 鏡像與沉澱

- 新 skill 鏡像:`docs/harness/skills/branch-lifecycle.md`;README 架構圖與同步指令補一行
- 五個 command 改版後照 README 既有 cp 指令同步 `docs/harness/commands/`

## 4. 驗收標準

| SC | 條件 | 驗法 |
|---|---|---|
| SC-1 | skill 檔存在且含開工/收尾/異常三節 + prefix 對照表 | 檔案內容檢查 |
| SC-2 | 四 command 各含 Phase 0 開工與收尾兩行引用 | grep `branch-lifecycle` 每檔 ≥ 2 處 |
| SC-3 | /feat Phase -1/8 改引用且顯式覆寫聲明在場 | 檔案內容檢查 |
| SC-4 | /goal 必停清單無 merge 且有裁決註記 | 檔案內容檢查 |
| SC-5 | 真實走一輪:下一個 /bug 或 /mod 自動開分支 → 收尾自動 merge + 刪分支 | 觀察 checklist(證據截存):`git log --graph --oneline -20` 呈 ff 線性、`git branch --list "<prefix>/*"` 為空、收尾回報含「main 領先 origin N」字樣 |
| SC-6 | 鏡像同步一致 | diff 鏡像 vs 原檔 |

## 5. 邊界(誠實標注)

- 本件是**文字層**(模型自律),弱模型遵循度依賴 v3 第一期的注入機制兜底;「收尾檢核」的機械強制留給第二期 harness-check(屆時 push-check 狀態機可加「當前在 <prefix>/ 分支且 gate 未過 → deny merge」)。
- 多機並行開發同一分支、force-push 情境不在 scope(solo 單機為前提)。
