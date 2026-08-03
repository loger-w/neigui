# /feat Phase -1 setup 與 state.json schema

> **指標句留在 feat.md 核心** —— Phase -1 時 state.json 尚未建立,phase 注入 hook
> 不觸發,靠 hook 指路會落空。

## Phase -1 步驟

1. 呼叫 `branch-lifecycle` 開工節:status 乾淨 + 主線同步 + 從 `$ARGUMENTS` 推導
   kebab-case `<slug>` + `git switch -c feat/<slug>`
   (monorepo / 長隔離 → 改呼叫 `superpowers:using-git-worktrees`,worktree 路徑寫
   state.json)
2. 建 `.claude/feat/<slug>/`(2026-08-03 起 artifact 目錄**常駐版控** — repo .gitignore
   以 `.claude/*` + `!.claude/feat/` 等白名單放行,`*.log` 仍排除;不再寫 `.git/info/exclude`。
   專案尚未放行時先補 .gitignore 白名單,不用 `git add -f` 短路)
3. 初始化 state.json,記錄 `start_sha`

## state.json schema

```json
{ "slug": "...", "start_sha": "...", "branch": "feat/<slug>", "worktree_path": null,
  "current_phase": -1, "completed_phases": [], "scope": null,
  "phase_6_blocked_reason": null,
  "scope_overrides": { "goal_efficiency_mode": false },
  "last_updated": "<ISO>", "project_shape": null,
  "last_commit_sha": null, "final_merge_sha": null, "self_review_head": null,
  "artifact_commit": null,
  "rollbacks": [],
  "paused": null }
```

> 2026-07-26 改版:`sc_cycle_counts` / `pending_review_rounds` / `blockers` / `phase_2_mode`
> 已自 schema 移除(16 run 實測分別為 9/16 全零、14/16 全零、16/16 空、恆 condensed;
> 依據見 RATIONALE)。舊 run 的 state.json 不回填。
> 選配欄位 `archived: true`(schema 不預建):已出貨但 state 未收尾的歷史欠帳,盤點後標記
> 封存 — `harness_lib.py` 據此跳過注入。

## rollbacks 記帳(取代 sc_cycle_counts)

- **回退發生當下 append 一筆**:`{ "sc": "SC-3" | "_unscoped", "from": 6, "to": 1,
  "reason": "<一句話>" }`。零回退的 run 維持空陣列(免維護)。
- meta-cycle 升級規則:**同一 SC 出現第 2 筆 → 停下升級回 Phase 0/1**(讀法:filter by sc)。
- Phase -1 豁免不記。
