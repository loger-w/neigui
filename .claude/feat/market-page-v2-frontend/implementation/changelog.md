# implementation: frontend/src/lib/changelog.ts(🟢)

對應:SC-12。design v3 §14。§7 版本規則:新 panel 家族 = 使用者可感新功能 → MINOR,0.18.2 → 0.19.0。

CHANGELOG 陣列 index 0 插入(date 用 Phase 6 完成日,先佔 2026-07-02,收尾時校正):

```ts
  {
    version: "0.19.0",
    date: "2026-07-02",
    highlights: "大盤掃描全面改版:市場廣度、族群參與度、資金流向",
    changes: [
      { kind: "feature", scope: "global", text: "大盤掃描新增市場廣度指標與訊號標記" },
      { kind: "feature", scope: "global", text: "大盤掃描新增族群參與度分布圖,可看各族群強弱" },
      { kind: "feature", scope: "global", text: "大盤掃描新增族群資金流向與量能對照表" },
      { kind: "feature", scope: "global", text: "大盤掃描標示已過濾 ETF / 權證 / 處置股" },
      { kind: "feature", scope: "global", text: "原有大盤畫面保留於「經典檢視」區塊" },
    ],
  },
```

- ChangeItem **無 date 欄**(spec §11 草稿 shape 是錯的,照 changelog.ts 現行型別)
- text 無工程術語 / 無 benchmark 數字;金融/UI 名詞與介面標籤一致
- 既有 `changelog.test.ts` 的 date 單調遞減 + semver 降冪 assert 需仍綠(0.19.0 > 0.18.2 ✓)
- **既有 assertion「該變」清單(I3-1,鐵則 E 事前標記)**:`changelog.test.ts:82-83` `it("最新版本是 v0.18.2(大盤掃描大幅加速)")` 硬編 top-entry 版本 — 同 commit 改為 `expect(CHANGELOG[0]?.version).toBe("0.19.0")` + test 名同步(此 test 本意即鎖「最新 entry」,版本推進屬其預期演化);全檔 audit 過僅此一處硬編 top-entry

## 失敗測試清單

無新測試 — 既有 changelog.test.ts 是 gate(插入後跑綠即可)。紅相位不適用(資料檔追加),隨 SC-12 收尾 commit(🟢)。
