# superpowers 顯式覆寫(操作面)

呼叫 `superpowers:brainstorming` / `superpowers:writing-plans` /
`superpowers:finishing-a-development-branch` 時才需要讀本檔。**覆寫的理由**已記在
`~/.claude/harness/RATIONALE.md`,此處只寫怎麼做。

| 被覆寫的行為 | 本 harness 的做法 |
|---|---|
| `brainstorming` / `writing-plans` 的 `docs/superpowers/` 產物落點 | 一律改 `.claude/<type>/<slug>/`(`<type>` = feat / mod / bug / refactor / perf) |
| 「設計文件先 commit」 | **不提前 commit**。artifact 統一釘在專案內,收尾 phase 才一次 commit |
| `finishing-a-development-branch` 的三選一互動 | 改走 `branch-lifecycle` 收尾節(push → PR → review 補齊 → 自動 merge,全程無確認) |
| `requesting-code-review` 與 `subagent-driven-development` 的「repeat until approved」無上限迴圈 | 改為輪數上限制(各 command 自訂)。**Tech pivot 想重置計數必須先向 user 回報並取得批准**,不准自行續跑超限 |
| 鐵則 G 的退出條件「無 P0/P1」 | /feat Phase 1/2 改為「無 P0 且 P1 ≤ 2」,餘 P1 逐條寫入 `## Known Risks` 落檔追蹤;Phase 4(2026-07-26 起)改為「accepted 修完 + 自動化測試綠」單輪退場 |
