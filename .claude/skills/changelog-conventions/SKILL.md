---
name: changelog-conventions
description: User-facing changelog(frontend/src/lib/changelog.ts)的 text 撰寫判準與壞/好詞例對照。新增 VersionEntry、寫 change item 文字前必讀。bump 規則與 commit 前義務在專案 CLAUDE.md §7(每 commit 都要判,常駐);本 skill 只管「怎麼寫那句話」。
---

# Changelog text 撰寫判準(2026-07-06 自專案 CLAUDE.md §7 移入)

`text` 一句話 user-facing,**不寫實作細節 / 工程術語 / 具體 benchmark 數字**(讀者可能含非工程背景的人,沒 baseline 也無從理解專業詞)。

## 通用判準

**寫出「使用者體感到什麼」,不寫「工程上怎麼做」**。金融術語(`Max Pain` / `OI 牆` / `Call Wall` / `Put Wall` / `PCR` / `TXO` / `履約價` / `布林通道` / `台指期`)與 UI 標籤一致時保留,讓使用者能對應介面找到功能。

## 壞 / 好詞例對照

| 壞(工程視角) | 好(使用者體感) |
|---|---|
| `refactor brokers_window cache key` | `N 日券商窗首次開啟大幅加速` |
| `permutation 相關係數` | `附歷史相關性` |
| `T-1 look-ahead` | `結算前一交易日資料` |
| `fallback 行為` | `資料缺漏時改用最近可用日期` |
| `資料載入吞吐提升` | `資料載入更快` |
| `冷啟動 27 秒縮至 4 秒` | `首次開啟大幅加速` |
| `top bar` | `頂部` |
| `dashboard` | `分析工具` |
| `popover` | `彈出視窗` |
| `badge` | `版本號` |
| `sparkline` | `迷你走勢圖` |
| `trade list` | `成交列表` |
| `crosshair` | `十字游標` |
| `overlay` | `(略掉不另寫)` |
| `MVP` | `首版` |
| `UI 元件` | `介面元件` |
| `UX` | `體驗` |
| `OHLCV` | `K 線資訊` |
| `虛擬化` | `大量資料捲動` |
| `spinner` / `骨架動畫` | `讀取動畫指示` |

## 結構欄位(速查;完整 bump 規則見 CLAUDE.md §7)

- `kind` 二選一:`feature`(新功能 / 新視覺)或 `fix`(影響體驗的修正)
- `scope` 三選一:`equity` / `options` / `global`,**不要混用** `prop` 或自由文字
- `date` 用 `YYYY-MM-DD`(同專案其他 date 慣例)
- 最新 entry 放陣列 index 0;同一 ship event 多 commit 收尾 → 一個 entry,date = 最後 commit 日期
