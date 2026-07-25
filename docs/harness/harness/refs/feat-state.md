# /feat Phase -1 setup 與 state.json schema

> **指標句留在 feat.md 核心** —— Phase -1 時 state.json 尚未建立,phase 注入 hook
> 不觸發,靠 hook 指路會落空。

## Phase -1 步驟

1. 呼叫 `branch-lifecycle` 開工節:status 乾淨 + 主線同步 + 從 `$ARGUMENTS` 推導
   kebab-case `<slug>` + `git switch -c feat/<slug>`
   (monorepo / 長隔離 → 改呼叫 `superpowers:using-git-worktrees`,worktree 路徑寫
   state.json)
2. 建 `.claude/feat/<slug>/` + `echo ".claude/feat/<slug>/" >> .git/info/exclude`
   (Phase 8 再拿掉)
3. 初始化 state.json,記錄 `start_sha`

## state.json schema

```json
{ "slug": "...", "start_sha": "...", "branch": "feat/<slug>", "worktree_path": null,
  "current_phase": -1, "completed_phases": [], "scope": null,
  "phase_2_mode": null,
  "pending_review_rounds": { "phase_1": 0, "phase_2": 0, "phase_4": 0 },
  "blockers": [], "phase_6_blocked_reason": null,
  "scope_overrides": { "goal_efficiency_mode": false },
  "last_updated": "<ISO>", "project_shape": null,
  "last_commit_sha": null, "final_merge_sha": null, "self_review_head": null,
  "artifact_commit": null,
  "sc_cycle_counts": {
    "_unscoped": { "phase_1": 0, "phase_2": 0, "phase_3": 0, "phase_4": 0,
                   "phase_5": 0, "phase_6": 0, "phase_7": 0, "total": 0 }
  },
  "paused": null }
```

## sc_cycle_counts 稀疏記帳

- 初始化**只建 `_unscoped`**;`SC-N` 條目在該 SC **首次回退時才建**,且只含實際發生過的
  phase 欄 + `total`。零回退的 SC 不出現在 state。
- `phase_7` 欄是「Phase 7 判定失敗後回退到該 phase」的記錄欄;**Phase 7 自身不
  increment**。
- meta-cycle 升級規則(同 SC ≥ 2 次 / 跨 phase 累計 ≥ 3 次 → 升回 Phase 0/1)讀法不變。
