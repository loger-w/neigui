# Harness PR 收尾流程 — design

2026-07-07 brainstorm 拍板。取代 `harness-git-lifecycle/design.md`(2026-07-06)的「local ff merge 預設 + PR opt-in」收尾設計;開工節與漂移處理不變,該文件其餘部分仍有效。

## 1. 目標與動機

五個流程 command(/feat /bug /mod /refactor /perf)完成後,收尾從「local ff merge(不 push)」改為「push 分支 → 開 PR → review 補齊 → 單一確認 → 自動 merge 到底」。動機:

- user 要在 merge 前**實際試用功能**,確認沒問題後一鍵完成,不想按多次。
- PR 留下 audit trail(diff、review 摘要、驗證證據集中一處)。
- 中間所有手動步驟(push、開 PR、跑 review、merge、刪分支、拉回 main)全自動化。

## 2. 已拍板決策

| 問題 | 決策 | 日期 |
|---|---|---|
| push / merge gate 鬆到什麼程度 | 單一確認點:merge 前停一次,確認後 merge 到底全自動 | 2026-07-07 |
| 確認機制 | push-gate hook 對 `gh pr merge` 的 ask 確認框**即唯一確認點**;不做對話層 + hook 雙確認 | 2026-07-07 |
| review 方式 | 補齊缺口不重跑:/feat /mod 沿用既有自評,/bug /refactor /perf 收尾補跑 `/code-review` | 2026-07-07 |
| 適用範圍 | 五個流程全改預設 PR 收尾;local merge 降為 fallback | 2026-07-07 |
| merge 方式 | `gh pr merge --rebase`(保留三類分離 commit 與 TDD tag;squash 會壓掉 commit 使 `git log --grep` 機械驗證失效) | 2026-07-07 |

## 3. 收尾節新流程(branch-lifecycle 收尾節改版)

1. **Gate 照舊**:該 command 的 Done 條件全過 + auto-verify 全綠。沒過不准進收尾。
2. **漂移檢查照舊**(`git merge-base --is-ancestor origin/main HEAD`;動了 → rebase main + 重跑 auto-verify)。**新增前置**:local main **領先** origin/main → 停下要求先推平(走鐵則 H 的 main push 確認)— 否則 PR merge 後 origin/main 與 local main 永久分岔。全 PR 模式下 main 只從 GitHub 拉,「領先未推」應逐步收斂為異常狀態。
3. **Review 補齊**(新):
   - `/bug` `/refactor` `/perf`:跑 `/code-review`(medium 檔位)→ `superpowers:receiving-code-review` 逐條分類 → P0/P1 修完才進下一步(3 輪上限,超限依鐵則 F 回報)。P2 依 mod.md 既有輸出契約:慣例 / 風格類彙總計數,疑似行為級例外展開。
   - `/feat` `/mod`:自評階段(/feat P4、/mod P5)後**有新 commit** → 只對增量 diff 補一輪 medium `/code-review`;無新 commit → 沿用自評結果,不重跑。判準:自評結束時記下當下 HEAD sha(/feat 寫入 state.json `self_review_head`;/mod 追記 change-spec.md 末尾同名欄位),收尾比對 `self_review_head..HEAD` 是否為空;欄位缺失(改版前在途 feature)保守視同有增量。
4. `git push -u origin <prefix>/<slug>`(hook 對此格式放行,見 §4)。
5. `gh pr create`,body 含:變更摘要、review 結果摘要(finding 數 + 分類)、驗證證據(測試數字 / 截圖路徑)、試用指引。
6. **單一確認點**:回報 PR URL + review 摘要 + 試用指引後,**同一 turn 直接發出** `gh pr merge --rebase --delete-branch` — push-gate hook 的 ask 確認框就是「是否 merge」提示,user 可掛著慢慢試用:
   - **allow** → merge + 遠端/本地分支刪除一步完成 → `git switch main && git pull --ff-only`,收尾完成。
   - **deny** → 流程停下收 feedback;修正後 push 更新同一個 PR(沿用步驟 4 完整 push 形式,bare `git push` 會被 ask),重新發 merge(確認點重來)。
7. **Fallback**:無遠端 / 離線 / `gh` 未認證 → 走原 local ff merge 路徑(`git switch main` + `git merge --ff-only` + `git branch -d`),回報註明 fallback 原因。

## 4. harness-push-gate hook 修改

| 指令形態 | 決策 |
|---|---|
| `git push -u origin (feat\|fix\|mod\|refactor\|perf)/<slug>`(嚴格 regex,slug = `[a-z0-9][a-z0-9-]*`) | **allow**(分支 push 可逆,PR 開錯可關) |
| push 含 `main`、`--force` / `-f`、`--delete` / `:refspec` 刪除 | ask 照舊 |
| bare `git push`(無法判定目標) | ask 照舊 |
| 其他任何不匹配格式 | ask(fail-closed 原則不變) |
| `gh pr merge` | ask 照舊 = 唯一確認點;reason 文字更新為「試用完按 allow 即 merge 到底;deny 則流程停下收 feedback」 |

`hooks/tests/test_harness_push_gate.py` 同步:新增放行 cases(五 prefix 各一)+ 邊界仍 ask cases(prefix 不符、force push、push main、bare push、`git push -u origin feat/x --force` 混合)。**hook 測試綠是此改動的完成前 gate**(強制層有 bug 比沒有更糟)。

## 5. 鐵則 H 修訂(`~/.claude/CLAUDE.md`)

新文字方向:

> push **流程分支**(五 prefix,開 PR 用)屬收尾自動步驟,不必停;push main / `--force` / `gh pr merge` 仍必停 user 確認。merge 確認 = push-gate hook 的 ask 框(收尾單一確認點)。`/auto` 不豁免 merge 確認。

`/auto` 必停清單同步:「`git push` / PR 建立」從必停清單移除(分支 push 自動),merge 確認點取代之。

## 6. 檔案改動清單

Source of truth(`~/.claude/`):

| 檔案 | 改動 |
|---|---|
| `skills/branch-lifecycle/SKILL.md` | 收尾節改寫(§3)+ 自主模式節更新 + version bump 2.0.0 |
| `hooks/harness-push-gate.py` | §4 |
| `hooks/tests/test_harness_push_gate.py` | §4 測試 |
| `CLAUDE.md` | 鐵則 H(§5) |
| `commands/auto.md` | 必停清單更新(§5) |
| `commands/feat.md` | Phase 8 收尾描述:PR 為預設、local merge 為 fallback;「保留 PR 決策」等措辭同步 |
| `commands/{bug,mod,refactor,perf}.md` | 收尾一行措辭:「自動 merge 回 main + 刪分支」→「PR 收尾(push → PR → review 補齊 → 確認 → auto-merge)」 |

鏡像(`docs/harness/`,README cp 清單同步):`skills/branch-lifecycle.md`、`hooks/harness-push-gate.py`、`hooks/tests/test_harness_push_gate.py`、`global-rules.md`、`commands/*.md`、README 分層架構圖與 cheat sheet 的收尾描述行。

## 7. 邊界情況

| 情境 | 處置 |
|---|---|
| merge 確認 deny | 分支與 PR 保留,流程停下收 feedback |
| 同名分支已有 open PR(`gh pr create` 失敗) | 沿用既有 PR(push 已更新它),直接進 merge 確認 |
| push 成功但 `gh pr create` 失敗(認證過期 / 斷網) | 停下回報(遠端分支已在、無 PR),不走 local fallback;恢復後重跑 create |
| rebase 衝突 / main 分岔 `--ff-only` 失敗 | 照舊停下回報,不自動解 |
| `gh pr merge --rebase` 被 GitHub 拒(不可 rebase) | 停下回報,不自動改 merge 方式 |
| 無遠端 / 離線 / gh 未認證 | local ff merge fallback,回報註明 |
| local main 領先 origin/main | 停下要求先推平(鐵則 H main push 確認) |

## 8. 不採納

- **獨立 `/ship` command**:與 branch-lifecycle 形成收尾規則雙源,違反防 drift 慣例。
- **GitHub Actions auto-merge**:驗證全在本地跑、solo 無 CI runner,over-engineering。
- **squash merge**:壓掉三類分離 commit 與 TDD tag,`git log --grep` 機械驗證失效。
- **對話層 + hook 雙確認**:user 拍板單一確認點。

## 9. 驗收條件

| # | 條件 |
|---|---|
| SC-1 | 任一流程完成後自動 push + 開 PR +(該補的)review 補跑,merge 前僅出現一次 hook 確認框 |
| SC-2 | push-gate 對 `git push -u origin fix/x` 放行;對 push main / `--force` / bare push 仍 ask(pytest 綠) |
| SC-3 | /feat 自評後無新 commit 時,收尾不重跑 review |
| SC-4 | merge 確認 deny 後,分支與 PR 保留、流程停下 |
| SC-5 | 無遠端時走 local merge fallback 且回報註明 |
| SC-6 | `docs/harness/` 鏡像同步後與 `~/.claude/` 原檔 diff 為空 |
