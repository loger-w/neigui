# goal_efficiency_mode(TDD commit 節奏調整)

**條件式** —— 只有啟用 `goal_efficiency_mode` 時才需要讀本檔。

## 適用與啟用

- **適用**:/feat 大量檔數(> 15 檔)且同時啟動 /auto 時,逐檔分開 commit 會爆 commit 數。
- **啟用**:寫 `state.json.scope_overrides.goal_efficiency_mode = true`。

## 效果

- Phase 3 改 **wave batch commit**,單 `[waveN]` tag,**commit body 必列該 wave 涵蓋的
  SC-N**。
- Phase 8 tag 驗證改驗「全 SC 有 wave 歸屬」,而非 `[red]` / `[green]` 配對。

## 不啟用時(預設)

維持標準 TDD:**`red` → `green` 兩 commit**;`[refactor]` 改為**有重構才加**,不列強制順序。

## wave 歸屬是半語意判定

`check_feat_tags.py` 只列 **wave → SC 的對映**,判不了「這個 SC 真的被這個 wave 涵蓋了嗎」。
該判定由 **main agent 對照 `brainstorm.md`** 做,script 不接管。
