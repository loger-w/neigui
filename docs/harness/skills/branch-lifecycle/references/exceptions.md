# branch-lifecycle 異常處理

**條件式** —— 撞到異常時才需要讀本檔。開工節與收尾節的正常路徑在 `SKILL.md`。

## 異常處理表(兩節共用)

| 情境 | 處置 |
|---|---|
| rebase 衝突(收尾漂移路徑) | `git rebase --abort` → 停下回報(列衝突檔),不自動解 |
| `--ff-only` 失敗(main 分岔) | 停下回報,不自動 rebase |
| 收尾 gate 沒過 | 留在分支上,回對應 phase(依各 command 失敗 routing) |
| user 中途放棄 | 分支保留;/feat 標 state.json `paused: <reason>`,其他流程口頭確認後才 `git branch -D` |
| 開工 `switch -c` 撞既有同名分支 | 停下問三選一:resume 該分支續作 / user 確認後 `git branch -D` 重開 / 改 slug |
| 開工時不在 main | 停下問;當前分支符合 `<prefix>/` 對照表才可選「resume 走完原流程含收尾」,否則(實驗分支 / detached HEAD)只有「user 確認處置該分支後回 main 重開」 |
| `gh pr create` 撞同分支既有 open PR | 沿用該 PR(push 已更新它),直接進自動 merge |
| 步驟 4 push 成功但步驟 5 `gh pr create` 失敗(認證過期 / 斷網) | 停下回報(遠端分支已在、尚無 PR),**不走 local fallback**(會刪本地分支留遠端孤兒);恢復後重跑 `gh pr create` 續行 |
| `gh pr merge --rebase` 被 GitHub 拒(不可 rebase) | 停下回報,不自動改 merge 方式 |
| local main 領先 origin/main(收尾) | 直接推平(在 main 上 `git push`,附 commit 清單告知)後再續收尾 |
| Detached HEAD / main 被其他 worktree 占用(開工) | 基準點一律取 `origin/main`(fetch 後),不信任何 local main;先跑 `git merge-base --is-ancestor main origin/main` 驗 local main 是否 stale(不成立 = 在落後或分岔線上,勿當基準) |

## pre-push 測試紅的 triage

先**單獨重跑紅檔**:

- 綠 → 負載型 flake(該測試記 `docs/next-time.md`),可重推**一次**
- 仍紅 → 真紅,回對應 phase,**不准盲目重推**

## push 前的資源檢查

確認無背景 dev server / e2e / browser 進程佔資源(`Get-Process python,node` 級檢查)。
