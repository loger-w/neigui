# /feat Phase 8 收尾 + Phase 8.5 沉澱

## Phase 8:整合與收尾

執行順序:**tag 驗證 → artifact commit → graphify 圖更新(若有)→ 收尾節**。

1. **Commit tag 機械化驗證**:
   ```bash
   python ~/.claude/hooks/check_feat_tags.py --state .claude/feat/<slug>/state.json
   ```
   四類 tag 掃描 / `[green]`→`[red]` 配對 / 豁免((a) `[lock]` + `mutation-verified`、
   (b) body 含 `Phase 6 real-env finding` 的 design-amend)/ wave 模式判定**固化在
   script**(規則不重抄;script 有 pytest 護住)。

   **wave 模式的「全 SC 有 wave 歸屬」屬半語意判定** —— script 只列 wave→SC 對映,由
   main agent 對照 brainstorm.md 核。

   FAIL 且無豁免 → 回 Phase 3 rebase commit message(**不增計數**)。

2. **Artifact commit**(2026-08-03 起 artifact 目錄常駐版控,`.git/info/exclude` 舞步退役):
   ```bash
   git add ".claude/feat/<slug>/" && git commit -m "chore(feat-<slug>): artifacts"
   ```
   repo `.gitignore` 尚未放行 → 先補白名單(`.claude/*` + `!.claude/feat/` 等,`*.log`
   仍排除),不允許 `git add -f` 短路。worktree 輪注意:artifact 一開始就寫主 tree
   (CLAUDE.md §8 教訓),commit 也在主 tree 做。

3. **graphify 圖更新(條件式)**:`graphify-out/` 存在且本輪動了 code →
   `graphify <專案根> --update`(AST 增量,免 LLM、零 token);不存在則跳過,不在收尾建圖。

4. **收尾路徑**:預設走 `branch-lifecycle` 收尾節(push → PR → review 補齊 → 自動 merge)。

   **UI 驗收點(2026-08-03 改版:AI 截圖層回復)**:本輪新增 / 改動的 UI SC → Phase 6 應已有
   AI 截圖對照(auto-verify「UI 畫面驗證」節,evidence/ 含 SC-N 截圖);收尾回報仍**逐條列
   SC 可指認表述 + 對應操作路徑**(哪個頁 / 點哪裡)請 user 過目確認 — 雙層缺一不可,
   回報裡沒列 = 未完成收尾。

5. **非預設路徑(user 指定才走)**:保留 branch(state.json 標 `paused: <reason>`,
   不 push 不 merge)。merge 規則在 `branch-lifecycle`,不重抄。

6. **Worktree 清理(若有)**:`git worktree remove <path>` + `git branch -d feat/<slug>`

## Phase 8.5:沉澱(閉環)

### (A) Domain 學習 → 依目的地規則

| 學到的東西 | 去處 |
|---|---|
| Code-anchored 專案慣例(引用檔名 / 函式 / pattern) | 專案 `.claude/skills/` 對應主題 skill(索引見專案 CLAUDE.md);沒有合適主題才開新 skill |
| 每 session 必讀的契約 / 風格 | 專案 CLAUDE.md |
| 帳號 / 偏好 / 名單 / 跨專案通用 | `~/.claude/projects/<project>/memory/` + MEMORY.md 索引 |

**GC pass(寫入前強制)**:先搜同主題舊條目 → 合併 / 翻新 / 刪除,**不准只往上疊**。
含數字的條目必標日期;date-bound 條目必寫失效條件。

### (B) 流程瑕疵候選 → `~/.claude/feat-improvements.md` 收件匣

判準:不是 domain 學習,而是 phase 漏 / gate 失效 / 文件層斷裂。

```markdown
## YYYY-MM-DD (feature: <slug>, project: <name>)
- [proposed] Phase <N>: <問題敘述>
  Severity: P0(跑不下去)/ P1(會卡)/ P2(可選)
  Source: <發現情境>
  Proposed_fix: <建議>
```

不直接改 /feat(走獨立 meta-review)。

### (C) Meta-review 觸發檢查(Done 的一部分)

讀 inbox 統計未 resolved 條目:**P0 → 立即提醒 user;同 phase 或同族 ≥ 3 條 → 強烈建議
user 排 meta-review**。
