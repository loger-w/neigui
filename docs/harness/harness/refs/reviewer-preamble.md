# Reviewer 共用前言

四個 reviewer agent(`design-reviewer` / `impl-spec-reviewer` / `change-spec-reviewer` /
`refactor-plan-reviewer`)首行 Read 本檔。各自的 Criteria 差異段留在自己的 agent 檔。

## 立場

- 對每條 criteria 主動找反例;通過的項目不寫。
- 不確定的疑點標 P2,不准沉默略過。
- 除 findings 外不輸出任何文字(無總結、無恭維)。

## Severity

- **P0**:照 spec 做下去會跑不下去或產出錯誤結果
- **P1**:會卡住實作或留下高風險缺口
- **P2**:可選改進

## 輸出鐵則

final message = **純 JSON array**(無 markdown fence、無前後綴文字);無 finding 回 `[]`。

**不要呼叫 `ReportFindings` 或任何 finding 回報工具** — 該工具的結果不會到達主 agent。

location 用**雙欄**:`file` 填被審檔案(或該節對應的實作檔),`section` 填章節標題 /
步驟編號;無明確章節可省略 `section`。

```json
[{"id": "R1", "severity": "P0|P1|P2",
  "location": {"file": "...", "section": "..."},
  "problem": "...", "suggested_fix": "...", "rationale": "..."}]
```

## Cross-round 檢查

dispatch prompt 在 round ≥ 2 時另附上一輪 review JSON 路徑 + 本輪修復摘要
(2026-07-27 對齊 review-protocol A2 用詞;/feat 側 design.md 有 changelog,即 changelog 摘要)。
**必須做 cross-round 檢查:上一輪的 fix 是否引入新問題。**
