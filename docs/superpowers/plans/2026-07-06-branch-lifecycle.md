# Branch Lifecycle(版控補洞)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建 `branch-lifecycle` skill(開工/收尾/異常單一 source of truth),五個 command 接線,merge 移出 /goal 必停清單。

**Architecture:** 純 markdown 改寫:1 個新 skill 檔 + 6 個既有檔的錨點式編輯 + 鏡像同步。無程式碼、無測試迴圈;每 task 的驗證是 grep / diff 機械檢查(對應 spec SC-1~SC-4、SC-6)。

**Tech Stack:** Claude Code skills(`~/.claude/skills/`)、slash commands(`~/.claude/commands/`)。

**Spec:** `docs/specs/harness-git-lifecycle/design.md`

## Global Constraints

- Prefix 對照表(零例外):/feat → `feat/`、/bug → `fix/`、/mod → `mod/`、/refactor → `refactor/`、/perf → `perf/`。
- 收尾預設:自動 local merge(ff)+ `git branch -d`;**不自動 push**(鐵則 H + push-gate 不變)。
- 與底層 skill 衝突處必須寫「顯式覆寫 + 理由」(跨 command 統一設計慣例)。
- `~/.claude/` 是 source of truth,改完 cp 鏡像到 `docs/harness/`,repo 只 commit 鏡像。
- 所有編輯用 Edit 工具錨點替換,錨點原文以本 plan 的 old 區塊為準(來自 2026-07-06 當日檔案)。

---

### Task 1: 建 `branch-lifecycle` skill

**Files:**
- Create: `C:\Users\USER\.claude\skills\branch-lifecycle\SKILL.md`

**Interfaces:**
- Produces: skill 名 `branch-lifecycle`,含「開工節」「收尾節」「異常處理」三個標題(Task 2-4 的 command 內文引用這些節名)。

- [ ] **Step 1: 寫入 SKILL.md**(完整內容如下)

```markdown
---
name: branch-lifecycle
description: 分支生命週期單一 source of truth:開工(主線同步 + 開分支)與收尾(自動 merge 回 main + 刪分支)。/feat /bug /mod /refactor /perf 的第一個 phase 與 Done 全過後呼叫。
metadata:
  author: user
  version: "1.0.0"
---

# Branch Lifecycle

分支生命週期的**單一 source of truth** — /feat /bug /mod /refactor /perf 只寫「呼叫本 skill」,不重抄規則(同 auto-verify 慣例,防雙源 drift)。設計依據:`docs/specs/harness-git-lifecycle/design.md`(neigui repo,2026-07-06 user 拍板)。

## 開工節(各 command 第一個 phase 呼叫)

1. `git status` 確認 working tree 乾淨;不乾淨 → 停下問(commit / stash / 放棄)。
   - **當前不在 main** → 停下問(多半是上一輪流程沒收尾;分支一律從 main 開,不巢狀)。
2. `git fetch origin` 後比對 local main vs origin/main:
   - **落後** → `git pull --ff-only`(漂移來源:GitHub workflow 的 baseline commit、他機開發)
   - **領先**(本地 commit 未推)→ 照常繼續(solo 常態)
   - **分岔**(`--ff-only` 會失敗)→ 停下回報,不自動 rebase
   - 無遠端 / 離線 → 跳過同步,註記一行繼續(不阻塞)
3. `git switch -c <prefix>/<slug>`;slug 從 $ARGUMENTS 推導 kebab-case。prefix 對照表(零例外):

| Command | prefix |
|---|---|
| /feat | `feat/` |
| /bug | `fix/` |
| /mod | `mod/` |
| /refactor | `refactor/` |
| /perf | `perf/` |

## 收尾節(各 command Done 條件全過後、最終回報前呼叫)

1. **Gate**:該 command 的 Done 條件全過 + auto-verify 全綠。沒過不准進收尾(收尾不是逃生門)。
2. `git switch main` → 再次 `git fetch origin`:
   - origin/main 未動 → 直接 merge
   - origin/main 動了 → `git pull --ff-only` 後**重跑 auto-verify 自動化節**(main 變了,綠燈要重新確認)→ 全綠才 merge;紅 → 停下回報
3. `git merge <prefix>/<slug>`:預設 **fast-forward**(保留分類 commit);單一 commit 的 S 級改動可 squash(/feat Phase 8 既有規則)。
4. `git branch -d <prefix>/<slug>`(小寫 `-d`:未 merge 的分支 git 會擋,天然防誤刪)。
5. 回報時提醒 user「main 領先 origin N 個 commit,可 push」— **不自動 push**(鐵則 H + push-gate)。
6. **PR 路徑**(user 事先指定才走):`git push -u origin <branch>`(觸發 push-gate 確認)→ `gh pr create`;user 決定合併時 `gh pr merge --squash|--merge --delete-branch`(一步完成 merge + 清遠端與本地分支)。預設路徑不推分支上遠端,無遠端殘留分支問題。

## 異常處理(兩節共用)

| 情境 | 處置 |
|---|---|
| merge conflict | 停下回報(列衝突檔),不自動解 |
| `--ff-only` 失敗(main 分岔) | 停下回報,不自動 rebase |
| 收尾 gate 沒過 | 留在分支上,回對應 phase(依各 command 失敗 routing) |
| user 中途放棄 | 分支保留;/feat 標 state.json `paused: <reason>`,其他流程口頭確認後才 `git branch -D` |

## 自主模式(/goal)

merge **不在必停清單**(2026-07-06 拍板):收尾 gate 全綠即自動 local merge(可逆;push / PR 仍必停)。
```

- [ ] **Step 2: SC-1 驗證**

Run: `Grep pattern "開工節|收尾節|異常處理" path C:\Users\USER\.claude\skills\branch-lifecycle\SKILL.md`(output_mode count)
Expected: 三個標題都命中(count ≥ 3 行)

---

### Task 2: 四個 command 接線(/bug /mod /refactor /perf)

**Files:**
- Modify: `C:\Users\USER\.claude\commands\bug.md`
- Modify: `C:\Users\USER\.claude\commands\mod.md`
- Modify: `C:\Users\USER\.claude\commands\refactor.md`
- Modify: `C:\Users\USER\.claude\commands\perf.md`

**Interfaces:**
- Consumes: Task 1 的節名「開工節」「收尾節」。

- [ ] **Step 1: bug.md — Phases 前插 Phase 0**

old:
```
## Phases

1. **Phase 1|重現 + 蒐證**
```
new:
```
## Phases

0. **Phase 0|工作區**:呼叫 `branch-lifecycle` 開工節(status 乾淨 + 主線同步 + `git switch -c fix/<slug>`)
1. **Phase 1|重現 + 蒐證**
```

- [ ] **Step 2: bug.md — Done 段補收尾**

old:
```
## Done
紅測試綠 + 既有測試保持綠 + regression 抽樣綠 + 反向驗證通過
```
new:
```
## Done
紅測試綠 + 既有測試保持綠 + regression 抽樣綠 + 反向驗證通過。
**全過後呼叫 `branch-lifecycle` 收尾節**(自動 merge 回 main + 刪分支),再做最終回報。
```

- [ ] **Step 3: mod.md — Phases 前插 Phase 0**

old:
```
## Phases

1. **Phase 1|摸清現況**(不能跳):
```
new:
```
## Phases

0. **Phase 0|工作區**:呼叫 `branch-lifecycle` 開工節(status 乾淨 + 主線同步 + `git switch -c mod/<slug>`)
1. **Phase 1|摸清現況**(不能跳):
```

- [ ] **Step 4: mod.md — Done 段補收尾**

old:
```
## Done
目標成功條件全綠 + 既有行為白名單全保留 + 三類 commit 分明 + migration 可逆(若有)
```
new:
```
## Done
目標成功條件全綠 + 既有行為白名單全保留 + 三類 commit 分明 + migration 可逆(若有)。
**全過後呼叫 `branch-lifecycle` 收尾節**(自動 merge 回 main + 刪分支),再做最終回報。
```

- [ ] **Step 5: refactor.md — Phases 前插 Phase 0**

old:
```
## Phases

1. **Phase 1|Why? gate**
```
new:
```
## Phases

0. **Phase 0|工作區**:呼叫 `branch-lifecycle` 開工節(status 乾淨 + 主線同步 + `git switch -c refactor/<slug>`)
1. **Phase 1|Why? gate**
```

- [ ] **Step 6: refactor.md — Done 段補收尾**

old:
```
## Done
所有既有測試 refactor 前後都全綠 + refactor commits 純 🔵(characterization test 為 🟢 獨立 commit)+ Phase 1 動機被處理
```
new:
```
## Done
所有既有測試 refactor 前後都全綠 + refactor commits 純 🔵(characterization test 為 🟢 獨立 commit)+ Phase 1 動機被處理。
**全過後呼叫 `branch-lifecycle` 收尾節**(自動 merge 回 main + 刪分支),再做最終回報。
```

- [ ] **Step 7: perf.md — Phases 前插 Phase 0**

old:
```
## Phases

1. **Phase 1|量化目標 gate**(必須,不可跳):
```
new:
```
## Phases

0. **Phase 0|工作區**:呼叫 `branch-lifecycle` 開工節(status 乾淨 + 主線同步 + `git switch -c perf/<slug>`)
1. **Phase 1|量化目標 gate**(必須,不可跳):
```

- [ ] **Step 8: perf.md — Done 段補收尾**

old:
```
## Done
Metric 達標 + 既有測試全綠 + benchmark 入庫 + 沒退化其他 metric + before/after 對照表
```
new:
```
## Done
Metric 達標 + 既有測試全綠 + benchmark 入庫 + 沒退化其他 metric + before/after 對照表。
**全過後呼叫 `branch-lifecycle` 收尾節**(自動 merge 回 main + 刪分支),再做最終回報。
```

- [ ] **Step 9: SC-2 驗證**

Run: `Grep pattern "branch-lifecycle" path C:\Users\USER\.claude\commands output_mode count`
Expected: bug.md=2、mod.md=2、refactor.md=2、perf.md=2(feat.md / goal.md 在 Task 3/4 後才有)

---

### Task 3: feat.md 接線(Phase -1 / Phase 8)

**Files:**
- Modify: `C:\Users\USER\.claude\commands\feat.md`(Phase -1 步驟 1-3、Phase 8 步驟 1 與 4)

- [ ] **Step 1: Phase -1 步驟 1-3 收斂為開工節呼叫**

old:
```
1. `git status` 確認 working tree 乾淨;不乾淨停下問(commit / stash / 放棄)
2. 從 $ARGUMENTS 推導 kebab-case `<slug>`
3. `git switch -c feat/<slug>`(monorepo / 長隔離 → 改呼叫 `superpowers:using-git-worktrees`,worktree 路徑寫 state.json)
4. 建 `.claude/feat/<slug>/` + `echo ".claude/feat/<slug>/" >> .git/info/exclude`(Phase 8 再拿掉)
5. 初始化 state.json(schema 見尾,必含 `sc_cycle_counts._unscoped` 骨架),記錄 `start_sha`
```
new:
```
1. 呼叫 `branch-lifecycle` 開工節:status 乾淨 + 主線同步 + 從 $ARGUMENTS 推導 kebab-case `<slug>` + `git switch -c feat/<slug>`(monorepo / 長隔離 → 改呼叫 `superpowers:using-git-worktrees`,worktree 路徑寫 state.json)
2. 建 `.claude/feat/<slug>/` + `echo ".claude/feat/<slug>/" >> .git/info/exclude`(Phase 8 再拿掉)
3. 初始化 state.json(schema 見尾,必含 `sc_cycle_counts._unscoped` 骨架),記錄 `start_sha`
```

- [ ] **Step 2: Phase 8 步驟 1 改預設收尾節**

old:
```
1. 呼叫 `superpowers:finishing-a-development-branch` 取 merge / PR / cleanup 選項
```
new:
```
1. 收尾路徑:**預設走 `branch-lifecycle` 收尾節**(自動 local merge + 刪分支)— **顯式覆寫** `superpowers:finishing-a-development-branch` 的三選一互動,理由:solo 無 reviewer,user 2026-07-06 拍板自動化。user 事先指定 PR → 走收尾節 PR 路徑。執行順序:步驟 2 tag 驗證 → 步驟 3 artifact commit → 收尾節 merge
```

- [ ] **Step 3: Phase 8 步驟 4 改非預設路徑**

old:
```
4. 依使用者選:**PR**(`/code-review --comment` 落 Phase 4 已分類 findings + `gh pr create`)/ **merge**(S 可 squash;M/L 預設 fast-forward 保留分類 commit)/ **保留 branch**(state.json 標 `paused: <reason>`)
```
new:
```
4. 非預設路徑(user 指定才走):**PR**(`/code-review --comment` 落 Phase 4 已分類 findings + 收尾節 PR 路徑)/ **保留 branch**(state.json 標 `paused: <reason>`,不 merge)。merge 規則(ff / S squash)在 branch-lifecycle,不重抄
```

- [ ] **Step 4: SC-3 驗證**

Run: `Grep pattern "branch-lifecycle" path C:\Users\USER\.claude\commands\feat.md output_mode count`
Expected: ≥ 3 處;`Grep pattern "顯式覆寫.*finishing-a-development-branch"` 命中 1 處

---

### Task 4: goal.md 必停清單

**Files:**
- Modify: `C:\Users\USER\.claude\commands\goal.md:20-25`

- [ ] **Step 1: merge 移出必停清單**

old:
```
### 仍必停(自動模式不豁免)
- `git push` / PR 建立 / merge(push 前列 commit 清單 + 目標 branch 給 user 確認)
```
new:
```
### 仍必停(自動模式不豁免)
- `git push` / PR 建立(push 前列 commit 清單 + 目標 branch 給 user 確認)
- **merge 不必停**(2026-07-06 拍板):`branch-lifecycle` 收尾 gate 全綠即自動 local merge(可逆;push 仍必停,有 push-gate 硬攔)
```

- [ ] **Step 2: SC-4 驗證**

Run: `Grep pattern "merge" path C:\Users\USER\.claude\commands\goal.md output_mode content`
Expected: 必停清單首行不含 merge;「merge 不必停」行存在

---

### Task 5: 鏡像同步 + README + commit

**Files:**
- Create: `docs/harness/skills/branch-lifecycle.md`(鏡像)
- Modify: `docs/harness/README.md`(架構圖 + 同步指令)
- Modify: `docs/harness/commands/*.md`(鏡像 ×6)

- [ ] **Step 1: 鏡像複製**

```bash
cp ~/.claude/commands/{feat,bug,mod,perf,refactor,goal}.md docs/harness/commands/
cp ~/.claude/skills/branch-lifecycle/SKILL.md docs/harness/skills/branch-lifecycle.md
```

- [ ] **Step 2: README.md 驗證 skill 段落補一行**

old:
```
├─ 驗證 skill(skills/auto-verify.md,~/.claude/skills/)
│   專案形狀偵測 → 自動化五步驟 + 真實環境驗證分流(單一 source of truth)
```
new:
```
├─ 驗證 skill(skills/auto-verify.md,~/.claude/skills/)
│   專案形狀偵測 → 自動化五步驟 + 真實環境驗證分流(單一 source of truth)
│
├─ 版控 skill(skills/branch-lifecycle.md,~/.claude/skills/)
│   開工(主線同步 + prefix 分支)/ 收尾(自動 merge + 刪分支)/ 異常處理
│   五個流程 command 共用(單一 source of truth;merge 不必停、push 必停)
```

- [ ] **Step 3: README.md 同步指令補一行**

old:
```
cp ~/.claude/skills/auto-verify/SKILL.md docs/harness/skills/auto-verify.md
```
new:
```
cp ~/.claude/skills/auto-verify/SKILL.md docs/harness/skills/auto-verify.md
cp ~/.claude/skills/branch-lifecycle/SKILL.md docs/harness/skills/branch-lifecycle.md
```

- [ ] **Step 4: SC-6 驗證(鏡像一致)**

```bash
diff ~/.claude/skills/branch-lifecycle/SKILL.md docs/harness/skills/branch-lifecycle.md && for f in feat bug mod perf refactor goal; do diff ~/.claude/commands/$f.md docs/harness/commands/$f.md; done
```
Expected: 全部無輸出(一致)

- [ ] **Step 5: Commit**

```bash
git add docs/harness/skills/branch-lifecycle.md docs/harness/commands/ docs/harness/README.md
git commit -m "feat(harness): branch-lifecycle skill — 四流程補分支 + 收尾自動 merge + goal 契約更新"
```

---

## 完成定義(對 spec §4)

| SC | 覆蓋 |
|---|---|
| SC-1 | Task 1 Step 2 |
| SC-2 | Task 2 Step 9 |
| SC-3 | Task 3 Step 4 |
| SC-4 | Task 4 Step 2 |
| SC-5 | 實際使用觀察(rollout gate,不在本 plan)|
| SC-6 | Task 5 Step 4 |
