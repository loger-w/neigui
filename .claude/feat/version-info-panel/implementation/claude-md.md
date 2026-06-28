# Implementation Spec — `CLAUDE.md` 新增「版本管理慣例」節

對應 SC-4。

---

## 插入位置

現有 `CLAUDE.md` 結構(grep 確認):
```
## 0. 目的 & 結構
## 1. 啟動 & 驗證
## 2. Python 風格
## 3. React / TypeScript 風格
## 4. 跨檔契約
## 5. 資料源
## 6. 提交慣例
## 7. 2026 共識升級路線
## 8. Lessons Learned
```

新增節:`## 7. 版本管理慣例`,插在現有 `## 6. 提交慣例` 之後。
**所有後續節編號 +1**:原 7 → 8、原 8 → 9。

---

## 新節內容

```markdown
## 7. 版本管理慣例

User-facing changelog 在 `frontend/src/lib/changelog.ts`,前端 top bar 右側 `v0.x` badge 點開即顯示。**每次 commit / PR 前必須討論一次**:本次改動要:
- **(a) 累加** 到當前最新 v0.x 的 `changes` 陣列,或
- **(b) bump** 到 v0.(x+1) 開新條目(`{ version, date, highlights, changes: [...] }`)

判準:

| 情境 | 動作 |
|---|---|
| 順手小修、未獨立發布的 WIP、單條補丁 | 累加 |
| 完成一個對使用者可感的獨立功能 | bump |
| 修一個影響使用體驗的 bug | bump |
| 一系列相關 commit 收尾(/feat 流程 Phase 8) | bump |
| 純內部 refactor / 測試補強 / 文件 | 通常不入 changelog,如要入則累加 |

實作要求:
- changelog 條目 `scope` 三選一:`equity` / `options` / `global`,**不要混用** `prop` 或自由文字
- `date` 用 `YYYY-MM-DD`(同專案其他 date 慣例)
- `text` 一句話描述使用者看得懂的內容,**不寫實作細節**(壞:「refactor brokers_window cache key」/ 好:「N 日券商窗冷啟動加速」)
- 提交 message body 註明對應版本動作,例 `chore(changelog): bump v0.1 → v0.2 for chip framework`
- 起始版本為 v0.1。**v1 留給 user 自行決定發布時點**

不在此次自動化驗證強制,屬 PR 流程紀律(類似 commit message convention)。
```

---

## SC-4 驗證

```bash
grep -n "## 7. 版本管理慣例" CLAUDE.md
# 期望:命中 1 行

grep -E "(累加|bump)" CLAUDE.md | wc -l
# 期望:≥ 2(實際上新節含 5+ 次)
```

---

## 編號順移影響

| 原節 | 新節 | 內文需要改 reference 嗎? |
|---|---|---|
| ## 7. 2026 共識升級路線 | ## 8. 2026 共識升級路線 | grep `§7` / `第 7 節` → 無發現 |
| ## 8. Lessons Learned | ## 9. Lessons Learned | grep `§8` / `第 8 節` → 無發現 |

確認:CLAUDE.md 內部無「§N」交叉引用,Edit tool 只動兩處 `## 7.` / `## 8.` 標題即可。

---

## Phase 3 注意

- 用 Edit tool 而非 Write,避免 dump 整個 CLAUDE.md
- 一次 Edit 拆三段:
  1. 在 `## 6. 提交慣例` 區段最後一行後插入完整新節
  2. `## 7. 2026 共識升級路線` → `## 8. 2026 共識升級路線`
  3. `## 8. Lessons Learned` → `## 9. Lessons Learned`
