---
name: branch-lifecycle
description: 分支生命週期單一 source of truth:開工(主線同步 + 開分支)與收尾(push → PR → review 補齊 → 自動 merge,全程無確認;離線 fallback local merge)。/feat /bug /mod /refactor /perf 的第一個 phase 與 Done 全過後呼叫。
metadata:
  author: user
  version: "3.0.0"
---

# Branch Lifecycle

分支生命週期的**單一 source of truth** — /feat /bug /mod /refactor /perf 只寫「呼叫本 skill」,
不重抄規則。

**異常路徑(rebase 衝突 / `--ff-only` 失敗 / 撞既有分支 / `gh` 失敗 / flake triage 等)見
`references/exceptions.md`** — 撞到才讀。

## 開工節(各 command 第一個 phase 呼叫)

1. `git status` 確認 working tree 乾淨;不乾淨 → 停下問(commit / stash / 放棄)。
   - **當前不在 main** → 停下問(分支一律從 main 開,不巢狀)。
2. `git fetch origin` 後比對 local main vs origin/main:
   - **落後** → `git pull --ff-only`
   - **領先**(本地 commit 未推)→ 直接 `git push` 推平(鐵則 H 全自動),回覆附 commit 清單告知
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
   另跑 `git status --porcelain` 檢查**證據檔不得 untracked**(`docs/specs/<slug>/` 截圖、
   evidence 檔)— 有就先 commit 上分支再續。
2. 在分支上 `git fetch origin` 檢查兩件事:
   - **origin/main 動了沒**(判準:`git merge-base --is-ancestor origin/main HEAD` 成立 = 未動):
     未動 → 續;**動了** → `git switch main` + `git pull --ff-only` → 切回分支
     `git rebase main` → 在 rebase 後的分支上**重跑 auto-verify 自動化節**;紅 → 停下回報,
     分支保留。
   - **local main 領先 origin/main 沒**(判準:`git rev-list --count origin/main..main` > 0):
     領先 → 直接推平後續行 — 否則 PR merge 後 origin/main 與 local main 永久分岔。
3. **Review 補齊**(merge 前對完整 diff 的最終 review;原則「補齊缺口不重跑」):
   依 `~/.claude/harness/refs/review-protocol.md` **C 節**執行 —— /bug /refactor /perf 跑一輪
   medium;/feat /mod 讀 `self_review_head` 判增量,為空則不重跑。
4. `git push -u origin <prefix>/<slug>` — **單獨一條指令下**(便於 pre-push 測試防線輸出 triage)。
   push 前檢查與紅燈 triage 見 `references/exceptions.md`。
5. `gh pr create`,body 四段:變更摘要 / review 結果摘要(finding 數 + 分類)/ 驗證證據
   (測試數字、截圖路徑)/ 試用指引。同分支已有 open PR → push 已更新它,跳過 create。
6. **自動 merge**(鐵則 H,無確認):回報 PR URL + review 摘要 + 試用指引後,**同一 turn 直接發**
   `gh pr merge --rebase --delete-branch`:
   - 成功 → GitHub rebase merge + 遠端 / 本地分支刪除 → `git switch main` +
     `git pull --ff-only`,收尾完成。
   - merge 方式一律 `--rebase`:保留三類分離 commit 與 TDD tag(squash 會壓掉,
     `git log --grep` 機械驗證失效)。
7. **Fallback(無遠端 / 離線 / gh 未認證)**:`git switch main` →
   `git merge --ff-only <prefix>/<slug>`(一律 fast-forward,保留分類 commit)→
   `git branch -d <prefix>/<slug>`,回報註明 fallback 原因 + main 領先 origin N 個 commit 可 push。
