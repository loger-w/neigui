# Harness Review Agent 定義化 — 設計

> 日期:2026-07-06
> 動機:四個 dispatch 點(/feat P1、/feat P2、/mod P3、/refactor P3)的 criteria checklist 與
> JSON 回傳格式寫在 command 文字裡,dispatch 時靠 main agent「記得抄進 prompt」— 又一個
> 弱模型會漏的自律點。定義化 = 把 reviewer 的 prompt / 格式 / 工具權限固化成 agent 檔,
> dispatch 從「組合 prompt」降級為「指名 agent type + 傳檔案路徑」。
> 歸屬:harness v3 系列(強制層 `harness-enforcement`、版控 `harness-git-lifecycle` 之後第三件)。

## 0. User 拍板決策

| 決策點 | 選擇 |
|---|---|
| 範圍 | **四個 review agent**(design / impl-spec / change-spec / refactor-plan);**不做 debug agent**(debug 需完整對話脈絡,fresh context 反而丟資訊,/bug 維持 main agent 走 systematic-debugging)|
| criteria 落點 | **內嵌 agent 定義檔**,command 刪 criteria 段只留 dispatch 一行(單一 source of truth 移轉)|
| model | **不寫 model 欄**(inherit session 模型 — 弱模型時代自然跟降,不硬編)|
| effort | design-reviewer / change-spec-reviewer 升 `medium`(judge-heavy,歷史抓到 look-ahead bias 級 bug — 鐵則 G 升級理由);impl-spec-reviewer / refactor-plan-reviewer `low`(機械對照)|

## 1. 四個 agent 檔(`~/.claude/agents/`)

| 檔 | 服務 | criteria 來源(command 對應段落搬入後刪除) |
|---|---|---|
| `design-reviewer.md` | /feat Phase 1 | feat.md「Phase 1 review criteria」九項(goal 覆蓋 / edge ≥ 3 / codebase 一致 / testability / 安全 / scope creep / 隱性假設 / 動態 trace / 量法可重現)|
| `impl-spec-reviewer.md` | /feat Phase 2 | feat.md Phase 2 步驟 3 五項(signature 對 design / 失敗測試涵蓋 SC-N edge / unit+整合雙層 / 無未授權新檔 / 範例自洽)|
| `change-spec-reviewer.md` | /mod Phase 3 | mod.md Phase 3 六項(caller 影響全評估 / backward compat 風險 / 三類分清 / 該紅 vs 不該紅明確 / scope 沒滑 / migration 可逆)|
| `refactor-plan-reviewer.md` | /refactor Phase 3 | refactor.md Phase 3 四項(每步真能保綠 / 順序合理 / scope 沒滑 / caller 沒漏)|

### 每檔固定結構

**frontmatter**:`name`、`description`(寫明「被哪個 command 哪個 phase dispatch、審什麼」)、`tools: Read, Grep, Glob`(逗號字串;唯讀 — reviewer 不准改檔案,工具層鎖死)、`effort: medium|low`(官方 schema 鍵名 `effort`,值域 low/medium/high/xhigh/max — 2026-07-06 經 claude-code-guide 查證 code.claude.com/docs/en/subagents)。不寫 `model`(省略 = inherit session 模型)。

**system prompt 四段**(四檔重複同一骨架;spec 註明:骨架改版要同步四檔):

1. **角色與對抗立場**:你是 reviewer,任務是找問題不是背書;對每條 criteria 主動找反例;不確定的疑點標 P2 而非沉默;不给修改建議以外的恭維文字。
2. **Severity 定義**(與 harness 全域語言一致):P0 = 照 spec 做下去會跑不下去 / 錯誤結果;P1 = 會卡住實作或留下高風險缺口;P2 = 可選改進。
3. **輸出鐵則**:final message = **純 JSON array**,無 markdown fence、無前後綴說明:
   `[{"id": "R1", "severity": "P0|P1|P2", "location": "<檔/節>", "problem": "...", "suggested_fix": "...", "rationale": "..."}]`
   (`impl-spec-reviewer` 的 location 用 `{"file": "...", "section": "..."}` 雙欄 — /feat Phase 2 既有慣例)。無 finding 回 `[]`。
4. **該 agent 專屬 criteria checklist**(從 command 搬入,逐項寫「檢什麼 + 怎麼算違反」)。

### Dispatch 介面(main agent 只傳)

- 待審檔案路徑(design.md / implementation/*.md / change-spec.md / refactor-plan.md)
- 上游依據路徑(brainstorm.md / design.md / Phase 1 現況表)
- round ≥ 2 時:上一輪 review JSON 路徑 + 本輪 changelog 摘要(cross-round detection,/feat P1 既有要求)

## 2. Command 接線(diff 級)

- **feat.md Phase 1**:步驟 2 改「Sub-agent 用 `design-reviewer` agent type dispatch,傳 design.md + brainstorm.md 路徑(round ≥ 2 加上一輪 JSON + changelog),JSON 寫 `design-review-round-<N>.json`」;「### Phase 1 review criteria」整段刪除(已搬入 agent)。
- **feat.md Phase 2**:步驟 2-3 改「fan-out 用 `impl-spec-reviewer` dispatch(每檔一 agent),傳該檔 + design.md 路徑」;criteria 行刪除。
- **mod.md Phase 3**:「Sub-agent(`Plan` type)review,criteria:...」改「Sub-agent 用 `change-spec-reviewer` dispatch,傳 change-spec.md + Phase 1 現況表」;criteria 列刪除。
- **refactor.md Phase 3**:同型改寫,用 `refactor-plan-reviewer`,傳 refactor-plan.md + Phase 2 測試盤點。
- **round 上限 / receiving 分類 / 退出條件全部留在 command**(流程控制不是 reviewer 的事)。

## 3. 鏡像與沉澱

- 新目錄 `docs/harness/agents/` 放四檔鏡像;README 架構圖補「Agent 定義層」段 + cp 指令補一行。
- command 改版後照既有 cp 指令同步。

## 4. 驗收標準

| SC | 條件 | 驗法 |
|---|---|---|
| SC-1 | 四個 agent 檔存在,各含四段骨架 + 專屬 criteria + 唯讀 tools | 檔案內容檢查 |
| SC-2 | 四個 command 的 criteria 段已刪且改引 agent 名 | grep:feat.md 含 `design-reviewer` 與 `impl-spec-reviewer`、mod.md 含 `change-spec-reviewer`、refactor.md 含 `refactor-plan-reviewer`;feat.md 無「Phase 1 review criteria」標題 |
| SC-3 | 真實 dispatch 一次 `design-reviewer`(拿本 spec 當受審對象跑 smoke test),回傳可 parse 的 JSON array | 實際執行 + json.loads |
| SC-4 | 鏡像一致 | diff 鏡像 vs 原檔 |

## 5. 邊界

- `/feat` Phase 4 `/code-review`(官方 skill 自有機制)與 Phase 3 implementer subagent(superpowers 管理)不動。
- criteria 內容本身不改寫(照搬),本件只搬家 + 固化格式;criteria 品質迭代走 feat-improvements 收件匣。
- Agent 檔骨架四份重複是接受的 trade-off(檔案小、無 include 機制);骨架改版同步四檔。
