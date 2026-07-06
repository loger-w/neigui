# Review Agent 定義化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四個 reviewer agent 定義檔(criteria 內嵌),三個 command 的 dispatch 降級為指名,smoke test 驗回傳可 parse。

**Architecture:** `~/.claude/agents/` 四個 markdown 定義(共用骨架:對抗立場 / severity / JSON 輸出鐵則 + 各自 criteria);feat.md / mod.md / refactor.md 刪 criteria 段改引 agent 名;鏡像進 `docs/harness/agents/`。

**Tech Stack:** Claude Code custom subagents(frontmatter:`tools` 逗號字串、`effort`、省略 `model` = inherit)。

**Spec:** `docs/specs/harness-review-agents/design.md`

## Global Constraints

- frontmatter 鍵名:`effort`(值域 low/medium/high/xhigh/max);`tools: Read, Grep, Glob`(逗號字串,唯讀);**不寫 `model`**。
- 輸出鐵則字面一致(四檔同款):final message = 純 JSON array、無 fence、無前後綴、空 findings 回 `[]`。
- Severity 語言與 harness 全域一致:P0 跑不下去 / P1 會卡 / P2 可選。
- criteria 內容照搬 command 原文語意,不改寫判準(本件只搬家)。
- round 上限 / receiving 分類 / 退出條件留在 command。
- 鏡像:`~/.claude/` 為 source of truth,cp 到 `docs/harness/agents/`,repo 只 commit 鏡像。

---

### Task 1: 四個 agent 定義檔

**Files:**
- Create: `C:\Users\USER\.claude\agents\design-reviewer.md`
- Create: `C:\Users\USER\.claude\agents\impl-spec-reviewer.md`
- Create: `C:\Users\USER\.claude\agents\change-spec-reviewer.md`
- Create: `C:\Users\USER\.claude\agents\refactor-plan-reviewer.md`

**Interfaces:**
- Produces: agent type 名 `design-reviewer` / `impl-spec-reviewer` / `change-spec-reviewer` / `refactor-plan-reviewer`(Task 2 的 command 內文引用)。

- [ ] **Step 1: design-reviewer.md**

```markdown
---
name: design-reviewer
description: /feat Phase 1 dispatch:對 design.md 做對抗式 review(對照 brainstorm.md 的 SC-N),回傳 P0/P1/P2 JSON findings。
tools: Read, Grep, Glob
effort: medium
---

你是設計文件的對抗式 reviewer。任務是找問題,不是背書。

## 立場
- 對每條 criteria 主動找反例;通過的項目不寫。
- 不確定的疑點標 P2,不准沉默略過。
- 除 findings 外不輸出任何文字(無總結、無恭維)。

## Severity
- **P0**:照 spec 做下去會跑不下去或產出錯誤結果
- **P1**:會卡住實作或留下高風險缺口
- **P2**:可選改進

## 輸出鐵則
final message = 純 JSON array(無 markdown fence、無前後綴文字);無 finding 回 `[]`:
`[{"id": "R1", "severity": "P0|P1|P2", "location": "<檔案/章節>", "problem": "...", "suggested_fix": "...", "rationale": "..."}]`

## Criteria(逐項檢查)
1. **Goal 全覆蓋**:每條 SC-N 都有對應設計章節;漏 → P0
2. **Edge cases ≥ 3**:少於 3 或全是 happy-path 變形 → P1
3. **與 codebase 一致**(命名 / 模式 / 依賴):偏離既有 pattern 且無理由 → P1
4. **Testability**:每元件可獨立測;做不到 → P1
5. **安全 / 輸入驗證 / 權限邊界**:缺漏 → 依風險 P0/P1
6. **Scope creep**:做了 brainstorm.md 沒要求的 → P1
7. **隱性假設**(資料格式 / 外部 API / 效能):未寫明 → P1
8. **動態 trace**:用真實輸入紙上跑主資料流(fetch → cache → invalidate → response)看時序 / race,不只靜態 contract 檢查;發現 race → P0
9. **量化 SC 的量法可重現**(unit + 指令真的量得出來):不可重現 → P1

## 輸入
dispatch prompt 提供:design.md 路徑、brainstorm.md 路徑;round ≥ 2 時另有上一輪 review JSON 路徑 + 本輪 changelog 摘要 — 必須做 cross-round 檢查(上輪 fix 是否引入新問題)。
```

- [ ] **Step 2: impl-spec-reviewer.md**

```markdown
---
name: impl-spec-reviewer
description: /feat Phase 2 dispatch(每檔一個):對單一 implementation spec 檔做對抗式 review(對照 design.md),回傳 P0/P1/P2 JSON findings。
tools: Read, Grep, Glob
effort: low
---

你是 implementation spec 的對抗式 reviewer。只審 implementation 層,不重審 Phase 1 架構。任務是找問題,不是背書。

## 立場
- 對每條 criteria 主動找反例;通過的項目不寫。
- 不確定的疑點標 P2,不准沉默略過。
- 除 findings 外不輸出任何文字。

## Severity
- **P0**:照 spec 做下去會跑不下去或產出錯誤結果
- **P1**:會卡住實作或留下高風險缺口
- **P2**:可選改進

## 輸出鐵則
final message = 純 JSON array(無 markdown fence、無前後綴文字);無 finding 回 `[]`。
location 用雙欄:
`[{"id": "R1", "severity": "P0|P1|P2", "location": {"file": "...", "section": "..."}, "problem": "...", "suggested_fix": "...", "rationale": "..."}]`

## Criteria(逐項檢查)
1. **Signature 對得上 design**:與 design.md 的介面 / 資料流不一致 → P0
2. **失敗測試涵蓋 SC-N edge**:該檔對應的 SC edge case 沒列失敗測試 → P1
3. **Unit + 整合雙層**:只有其中一層 → P1
4. **沒未授權新檔案**:出現 design.md 沒有的新檔 → P1
5. **範例自洽**:輸入輸出範例跑不通或互相矛盾 → P0

## 輸入
dispatch prompt 提供:待審的單一 implementation spec 檔路徑、design.md 路徑。
```

- [ ] **Step 3: change-spec-reviewer.md**

```markdown
---
name: change-spec-reviewer
description: /mod Phase 3 dispatch:對 change-spec.md 做對抗式 review(對照 Phase 1 現況表與行為白名單),回傳 P0/P1/P2 JSON findings。
tools: Read, Grep, Glob
effort: medium
---

你是既有功能改動 spec 的對抗式 reviewer。改既有 feature 不是新做 — 既有行為保留優先於新行為。任務是找問題,不是背書。

## 立場
- 對每條 criteria 主動找反例;通過的項目不寫。
- 不確定的疑點標 P2,不准沉默略過。
- 除 findings 外不輸出任何文字。

## Severity
- **P0**:照 spec 做下去會跑不下去或產出錯誤結果
- **P1**:會卡住實作或留下高風險缺口
- **P2**:可選改進

## 輸出鐵則
final message = 純 JSON array(無 markdown fence、無前後綴文字);無 finding 回 `[]`:
`[{"id": "R1", "severity": "P0|P1|P2", "location": "<檔案/章節>", "problem": "...", "suggested_fix": "...", "rationale": "..."}]`

## Criteria(逐項檢查)
1. **Caller 影響都評估過**:Phase 1 caller map 中有 caller 未在 spec 出現 → P0
2. **Backward compat 風險點**:API / 資料格式改動沒談相容策略 → P0
3. **三類分清**:🔴 行為改 / 🟢 新功能 / 🔵 重構 有混淆或未標 → P1
4. **該紅 vs 不該紅明確**:既有測試未逐一標「該紅 / 不該紅」→ P1
5. **Scope 沒滑**:出現 Phase 2 brainstorm 沒要求的改動 → P1
6. **Migration 可逆**(若有):沒有回退路徑 → P1

## 輸入
dispatch prompt 提供:change-spec.md 路徑、Phase 1 現況表(或其所在檔)路徑。
```

- [ ] **Step 4: refactor-plan-reviewer.md**

```markdown
---
name: refactor-plan-reviewer
description: /refactor Phase 3 dispatch(大型 refactor):對 refactor-plan.md 做對抗式 review(行為零差異前提),回傳 P0/P1/P2 JSON findings。
tools: Read, Grep, Glob
effort: low
---

你是 refactor 計畫的對抗式 reviewer。行為絕對不變是前提 — 任何步驟可能改變行為都是 finding。任務是找問題,不是背書。

## 立場
- 對每條 criteria 主動找反例;通過的項目不寫。
- 不確定的疑點標 P2,不准沉默略過。
- 除 findings 外不輸出任何文字。

## Severity
- **P0**:照 spec 做下去會跑不下去或產出錯誤結果
- **P1**:會卡住實作或留下高風險缺口
- **P2**:可選改進

## 輸出鐵則
final message = 純 JSON array(無 markdown fence、無前後綴文字);無 finding 回 `[]`:
`[{"id": "R1", "severity": "P0|P1|P2", "location": "<步驟編號>", "problem": "...", "suggested_fix": "...", "rationale": "..."}]`

## Criteria(逐項檢查)
1. **每步真能保持綠**:某步驟中間狀態會讓測試紅(如先刪後建的間隙)→ P0
2. **順序合理**:步驟間依賴顛倒(後面的步驟需要前面還沒做的改動)→ P0
3. **Scope 沒滑**:混入行為改動或 Phase 1 動機以外的整理 → P1
4. **Caller 沒漏**:動到的命名 / signature 有 caller 未列入(含動態用法)→ P0

## 輸入
dispatch prompt 提供:refactor-plan.md 路徑、Phase 2 測試盤點結果(或其所在檔)路徑。
```

- [ ] **Step 5: SC-1 驗證**

Run: `Grep pattern "輸出鐵則" path C:\Users\USER\.claude\agents output_mode count`
Expected: 4 檔各 1;`Grep pattern "tools: Read, Grep, Glob"` → 4 檔各 1

---

### Task 2: 三個 command 接線

**Files:**
- Modify: `C:\Users\USER\.claude\commands\feat.md`(Phase 1 步驟 2、criteria 段、Phase 2 步驟 2-5)
- Modify: `C:\Users\USER\.claude\commands\mod.md`(Phase 3 sub-agent 行)
- Modify: `C:\Users\USER\.claude\commands\refactor.md`(Phase 3 sub-agent 句)

**Interfaces:**
- Consumes: Task 1 的四個 agent type 名。

- [ ] **Step 1: feat.md Phase 1 步驟 2 改指名 dispatch**

old:
```
2. Sub-agent(`Plan` type)review,JSON 寫 `design-review-round-<N>.json`(`[{id, severity P0/P1/P2, location, problem, suggested_fix, rationale}]`)
```
new:
```
2. Sub-agent 用 `design-reviewer` agent type dispatch:傳 design.md + brainstorm.md 路徑(round ≥ 2 加上一輪 JSON 路徑 + changelog 摘要),回傳 JSON 寫 `design-review-round-<N>.json`(schema / severity / criteria 固化在 agent 定義,command 不重抄)
```

- [ ] **Step 2: feat.md 刪「Phase 1 review criteria」整段**

old(整段刪除,含標題):
```
### Phase 1 review criteria
- [ ] Goal 全覆蓋(每條 SC-N 都有對應設計章節)
- [ ] Edge cases ≥ 3
- [ ] 與 codebase 一致(命名 / 模式 / 依賴)
- [ ] Testability(每元件可獨立測)
- [ ] 安全 / 輸入驗證 / 權限邊界
- [ ] Scope creep(沒做 brainstorm.md 沒要求的)
- [ ] 隱性假設(資料格式 / 外部 API / 效能)
- [ ] **動態 trace**:用真實輸入紙上跑一遍主資料流(fetch → cache → invalidate → response),看時序 / race,不只靜態 contract 檢查
- [ ] **量化 SC 的量法可重現**(unit + 指令真的量得出來)

```
new:(空 — 段落移除,`## Phase 2` 標題自然上移)

- [ ] **Step 3: feat.md Phase 2 步驟 2-3 合併改指名**

old:
```
2. 多檔用 `superpowers:dispatching-parallel-agents` fan-out review,`location` 用 `{file, section}` 雙欄
3. **Review criteria(implementation 層,不重審 Phase 1 架構)**:signature 對得上 design / 失敗測試涵蓋 SC-N edge / unit + 整合雙層 / 沒未授權新檔案 / 範例自洽
```
new:
```
2. 多檔用 `superpowers:dispatching-parallel-agents` fan-out,每檔 dispatch 一個 `impl-spec-reviewer`(傳該檔 + design.md 路徑;criteria / JSON schema / {file, section} 雙欄 location 固化在 agent 定義)
```

- [ ] **Step 4: feat.md Phase 2 步驟 4→3、5→4 重編號**

old:`4. Receiving 分類同 Phase 1;退出條件:全檔無 P0 且 P1 ≤ 2(進 Known Risks)→ reset 進 Phase 3`
new:`3. Receiving 分類同 Phase 1;退出條件:全檔無 P0 且 P1 ≤ 2(進 Known Risks)→ reset 進 Phase 3`

old:`5. 3 輪上限後仍有 P0 → [1] 縮 scope 回 Phase 0 / [2] implementation 改寫(finding 暗示問題在 design → escalate 回 Phase 1,計次歸零需 user 批准)/ [3] 接受寫入 Known Risks,Phase 7 表格 regression 欄必涵蓋`
new:`4. 3 輪上限後仍有 P0 → [1] 縮 scope 回 Phase 0 / [2] implementation 改寫(finding 暗示問題在 design → escalate 回 Phase 1,計次歸零需 user 批准)/ [3] 接受寫入 Known Risks,Phase 7 表格 regression 欄必涵蓋`

- [ ] **Step 5: mod.md Phase 3 sub-agent 行改指名**

old:
```
   - Sub-agent(`Plan` type)review,criteria:caller 影響都評估過 / backward compat 風險點 / 三類分清 / 該紅 vs 不該紅明確 / scope 沒滑 / migration 可逆
```
new:
```
   - Sub-agent 用 `change-spec-reviewer` agent type dispatch:傳 change-spec.md + Phase 1 現況表路徑(criteria / JSON schema 固化在 agent 定義)
```

- [ ] **Step 6: refactor.md Phase 3 sub-agent 句改指名**

old:
```
大型 refactor 呼叫 sub-agent(`Plan` type)review:每步真能保持綠?順序合理?scope 沒滑?caller 沒漏?**Max 2 輪;退出條件:無 P0/P1**
```
new:
```
大型 refactor dispatch `refactor-plan-reviewer` agent:傳 refactor-plan.md + Phase 2 測試盤點路徑(criteria / JSON schema 固化在 agent 定義)。**Max 2 輪;退出條件:無 P0/P1**
```

- [ ] **Step 7: SC-2 驗證**

Run: `Grep pattern "reviewer" path C:\Users\USER\.claude\commands output_mode count` → feat.md ≥ 2、mod.md ≥ 1、refactor.md ≥ 1
Run: `Grep pattern "Phase 1 review criteria" path C:\Users\USER\.claude\commands\feat.md` → 0 命中

---

### Task 3: 鏡像 + README + commit

**Files:**
- Create: `docs/harness/agents/`(四檔鏡像)
- Modify: `docs/harness/README.md`
- Modify: `docs/harness/commands/{feat,mod,refactor}.md`(鏡像)

- [ ] **Step 1: 鏡像複製**

```bash
mkdir -p docs/harness/agents
cp ~/.claude/agents/{design-reviewer,impl-spec-reviewer,change-spec-reviewer,refactor-plan-reviewer}.md docs/harness/agents/
cp ~/.claude/commands/{feat,mod,refactor}.md docs/harness/commands/
```

- [ ] **Step 2: README 架構圖版控 skill 段後補 agent 層**

old:
```
├─ 版控 skill(skills/branch-lifecycle.md,~/.claude/skills/)
│   開工(主線同步 + prefix 分支)/ 收尾(自動 merge + 刪分支)/ 異常處理
│   五個流程 command 共用(單一 source of truth;merge 不必停、push 必停)
```
new:
```
├─ 版控 skill(skills/branch-lifecycle.md,~/.claude/skills/)
│   開工(主線同步 + prefix 分支)/ 收尾(自動 merge + 刪分支)/ 異常處理
│   五個流程 command 共用(單一 source of truth;merge 不必停、push 必停)
│
├─ Review agent 定義(agents/,~/.claude/agents/)
│   design-reviewer(/feat P1,medium)/ impl-spec-reviewer(/feat P2,low)/
│   change-spec-reviewer(/mod P3,medium)/ refactor-plan-reviewer(/refactor P3,low)
│   criteria + JSON schema + 唯讀 tools 固化在定義檔,dispatch 降級為指名
```

- [ ] **Step 3: README 同步指令補一行**

old:
```
cp ~/.claude/skills/branch-lifecycle/SKILL.md docs/harness/skills/branch-lifecycle.md
```
new:
```
cp ~/.claude/skills/branch-lifecycle/SKILL.md docs/harness/skills/branch-lifecycle.md
cp ~/.claude/agents/{design-reviewer,impl-spec-reviewer,change-spec-reviewer,refactor-plan-reviewer}.md docs/harness/agents/
```

- [ ] **Step 4: SC-4 驗證 + commit**

```bash
for f in design-reviewer impl-spec-reviewer change-spec-reviewer refactor-plan-reviewer; do diff ~/.claude/agents/$f.md docs/harness/agents/$f.md; done && for f in feat mod refactor; do diff ~/.claude/commands/$f.md docs/harness/commands/$f.md; done && echo MIRROR_OK
git add docs/harness/agents/ docs/harness/commands/ docs/harness/README.md
git commit -m "feat(harness): 四個 reviewer agent 定義化 — criteria 內嵌、dispatch 指名"
```

---

### Task 4: SC-3 smoke test(真實 dispatch)

- [ ] **Step 1: dispatch `design-reviewer`**

用 Agent 工具、subagent_type=`design-reviewer`,prompt:
```
design.md 路徑:docs/specs/harness-git-lifecycle/design.md
brainstorm.md(SC 來源)路徑:同檔 §4 驗收標準表
對此設計做 review,照你的輸出鐵則回傳。
```

- [ ] **Step 2: 驗回傳可 parse**

把回傳字串走 `json.loads`(scratchpad 一行 script),Expected: list 型別,每元素含 id/severity/location/problem 鍵;severity ∈ {P0,P1,P2}。

- [ ] **Step 3: 存證 + commit**

回傳 JSON 與 parse 結果存 `docs/specs/harness-review-agents/evidence/SC-3_smoke_design-reviewer.json`:
```bash
git add docs/specs/harness-review-agents/evidence/
git commit -m "chore(harness): review agent smoke test 證據(JSON 可 parse)"
```

---

## 完成定義(對 spec §4)

| SC | 覆蓋 |
|---|---|
| SC-1 | Task 1 Step 5 |
| SC-2 | Task 2 Step 7 |
| SC-3 | Task 4 |
| SC-4 | Task 3 Step 4 |
