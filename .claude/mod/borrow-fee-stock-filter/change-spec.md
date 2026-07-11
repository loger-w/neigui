# /mod borrow-fee-stock-filter — change spec

**Date**: 2026-07-11
**規格來源**: user 於 /auto 啟動問答拍板(「對,當日單檔篩選」選項):在現有當日表格上方加標的選擇(手動輸入代號 + 從當日有列入的名單直接挑),選定後表格只顯示該檔當日筆數;選單只列當天有列入的標的 → brainstorming user-approval HARD-GATE 以此替代(/auto 契約)。
**規模**: M(BorrowFeePage + 新元件 + lib utils + e2e,4 檔源碼級)→ Phase 3 1 輪 review。

---

## 1. 成功條件(SC)

1. **SC-1** 券差頁 header 下方出現標的篩選 combobox:
   - focus(空輸入)→ 下拉列出**當日有列入券差的全部標的**(distinct stock_id 升冪,顯示 代號 + 名稱 + 市場 badge)。
   - 輸入文字 → 以「代號 prefix 或名稱 substring」過濾候選(對齊 `SymbolSearch` 既有匹配規則)。
   - 點選或鍵盤(↑↓ + Enter)選定。
2. **SC-2** 選定後表格只顯示該檔當日全部筆數(**同股多筆全列** — unit 測試 mock 必含同一 stock_id ≥2 筆,assert 選定後 row 數 = 該股筆數且他股 row 為 0,防「只回首筆」的錯誤 filter 假綠;R1),排序功能照常作用;「本月次數」欄照常顯示。
3. **SC-3** 清除:輸入框 × 鈕,或**選定態下任何輸入編輯即解除 selection 回全表**(輸入 = 重新搜尋;R3 拍板,SymbolSearch 的「pick 後 query 編輯不影響」規則不沿用)。
4. **SC-4** 輸入的代號不在當日名單 → 下拉顯示「該檔今日未列入券差」提示,不可選定(無法進入無效 filter 態)。
5. **SC-5** filter 態下若 filtered rows 為 0(refresh 後標的消失的 edge)→ 內容區顯示「該檔今日無券差資料」,篩選器仍可清除。
6. **SC-6** e2e:`borrow-fee.spec.ts` 加 BF3 — 從名單挑一檔 → row 數 = 該檔筆數且 data-stock-id 全等於該檔;清除 → row 數回全表。
7. **SC-7** 完成 gate:`pytest -q` + `ruff check .` + `npm test` + `npm run build` + e2e(BF1/BF2/BF3)+ chrome-devtools 截圖。

## 2. 不能破壞的既有行為白名單

| # | 行為 | 驗證 |
|---|---|---|
| W-1 | 預設態(未選定)= 當日全表,渲染結果與現行完全相同(row 數 / 排序 / 標色) | e2e BF1 不改且綠;`DaytradeFeeTable.test.tsx` 不動全綠 |
| W-2 | header:資料日 badge / 非交易日註記 / partial 註記 / 重新整理鈕行為 | `BorrowFeePage.test.tsx` 既有 case 不動全綠 |
| W-3 | 排序切換(欄標點擊、aria-sort) | `DaytradeFeeTable.test.tsx` 不動全綠 |
| W-4 | borrow mode 切換與 localStorage 持久化 | e2e BF2 / N# 不動全綠 |
| W-5 | `GET /api/daytrade-fee` API 契約與 backend 全部行為 | backend 零改動,`pytest -q` 全綠 |
| W-6 | 空資料態文案「本月無券差資料」(未 filter 時) | `BorrowFeePage.test.tsx` 既有 case |
| W-7 | loading(「載入中...」)/ error 態的內容區渲染(R2)| `BorrowFeePage.test.tsx` 既有 case 不動全綠 |

## 3. Backward compat / migration

- API / 資料格式 / localStorage:零變動。純前端 additive UI。無 migration。
- `DaytradeFeeTable` props 介面不變(filter 在 page 層做完再傳入)。

## 4. Out of scope

- 該檔歷史(近月各日)券差紀錄(user 啟動問答明確選「只當日」)。
- 多選 / 市場別篩選 / 費率區間篩選。
- URL query 持久化 filter 狀態。
- 泛化 `SymbolSearch` 成共用 combobox(不順手 refactor;如日後第三處需要再議,記 next-time)。

## 5. 設計(approach 決策)

**採 A:page 層 filter state + 新 combobox 元件,候選來自當日 rows。** `[auto-default: A | reason: 資料已全在 client(rows + month_counts 一次到位),table 保持純呈現層 props 不變,改動面最小]`

- 捨 B(filter 塞進 `DaytradeFeeTable` 內部):表格混入頁面級狀態,元件邊界變髒。
- 捨 C(backend `?stock_id=` query param):資料已在 client,加 API 參數是無謂的契約擴張(也會把改動升級成方向性)。

細節 auto-defaults:
- 候選清單資料:`distinctStocks(rows)` 純函式(dedup by stock_id、取首見 name/market、代號升冪)。`[auto-default: 由 rows 推導,不另抓 universe | reason: user 拍板「選單只列當天有列入的」]`
- 匹配規則:代號 `startsWith` + 名稱 `includes`(小寫化),對齊 `SymbolSearch.tsx:24`。`[auto-default: 沿用既有規則 | reason: 同 app 內行為一致]`。**對齊範圍僅匹配式**:SymbolSearch 的 20 筆 cap 與「空 query 回 []」皆**不沿用**(候選 = 當日名單全集、空 query 回全部,靠 max-h + overflow 捲動;R4 by design)。
- data 為 null(初載 / error)時 filter **不渲染**(options 來源不存在;R2)。`[auto-default]`
- 選定態呈現:輸入框顯示 `代號 名稱` + × 清除鈕;Escape 關下拉。`[auto-default]`
- filter 態 0 rows 提示「該檔今日無券差資料」。`[auto-default: 不自動清除 selection | reason: 狀態可見可控,避免 refresh 中途 selection 無聲消失]`

## 6. E2E 歸屬(e2e-conventions 判準)

券差 mode UI 新互動功能 → **需要 e2e**,歸 `e2e/specs/borrow-fee.spec.ts` 加 **BF3**(fixture 既有:twse 3 檔 + tpex 2 檔 @ 2026-06-26,足夠驗 filter/清除)。fixture 不需改 → 不碰 MANIFEST / .cache 議題(仍照慣例跑前清 `e2e/.cache`)。selector 對 snapshot 校準,痛點註解必寫。

---

# Phase 3 — Diff 級 spec

三類分離:本次**全部 🟢 新功能**(additive UI;無 🔴 行為改動 — 預設態渲染不變;無 🔵 重構)。

## 逐檔

| 檔 | 類別 | 內容 |
|---|---|---|
| `frontend/src/lib/borrow-fee-utils.ts` | 🟢 | 加 `distinctStocks(rows): StockOption[]`(`{stock_id, name, market}`,dedup + 升冪)與 `matchStockOptions(options, query): StockOption[]`(空 query 回全部;否則代號 prefix / 名稱 substring) |
| `frontend/src/lib/borrow-fee-utils.test.ts` | 🟢 | 新 describe:dedup(同股多筆取一)、升冪、name/market 取首見、空 query 全回、prefix/substring 匹配、大小寫 |
| `frontend/src/components/BorrowFeeStockFilter.tsx` | 🟢 | 新 combobox 元件(props: `options`, `selected: StockOption \| null`, `onSelect`, `onClear`)。仿 `SymbolSearch` 鍵盤/blur-timer pattern;繁中 aria-label;semantic tokens;`data-testid="borrow-fee-stock-filter"`(input)+ `data-testid="stock-filter-clear"`(× 鈕)+ option `role="option"`。空 query focus 顯示全部候選;無匹配顯示「該檔今日未列入券差」。 |
| `frontend/src/components/BorrowFeeStockFilter.test.tsx` | 🟢 | 開下拉列全候選 / 輸入過濾 / 點選觸發 onSelect / Enter 選定 / 無匹配提示且不可選 / × 觸發 onClear / Escape 關下拉 |
| `frontend/src/components/BorrowFeePage.tsx` | 🟢 | 加 `selected` state;header 下方掛 `BorrowFeeStockFilter`(options = `distinctStocks(data.rows)`);傳給表格的 rows 改 `selected ? rows.filter(股) : rows`;filter 態 0 rows 顯示「該檔今日無券差資料」。既有 JSX 其餘不動。 |
| `frontend/src/components/BorrowFeePage.test.tsx` | 🟢 | 加 case:選定後只剩該檔 row(**mock 含同股 2 筆,assert row 數 = 2 且他股 0**;R1)/ 編輯輸入即回全表(R3)/ 清除回全表 / filter 態 0 rows 文案。既有 case **零修改**。 |
| `e2e/specs/borrow-fee.spec.ts` | 🟢 | 加 BF3(痛點註解:client-side filter 的資料級 assertion,防 silent 全空/全不過濾) |
| `e2e/helpers/selectors.ts` | 🟢 | 加 `borrowFeeStockFilter` / `stockFilterClear` testid 常數 |
| `frontend/src/lib/changelog.ts` | 🟢 | VersionEntry MINOR bump(使用者可感 UX 新增);文字撰寫前讀 `changelog-conventions` |

## 既有測試標記

- 該紅的:**無**。
- 不該紅的:全部(BF1/BF2、`BorrowFeePage.test.tsx`、`DaytradeFeeTable.test.tsx`、`borrow-fee-utils.test.ts` 既有 describe、backend 全部)。任何一個紅 = 打到不該動的,回頭查。

## 新測試清單

上表 🟢 各測試檔條目 + BF3。

## Commit 計畫(TDD,🟢 紅先行)

1. `🟢 test(frontend): 券差單檔篩選 — utils/元件/頁面紅測試 [red]`
2. `🟢 feat(frontend): 券差頁當日單檔篩選 combobox [green]`
3. `🟢 test(e2e): BF3 券差單檔篩選 filter/清除`
4. changelog entry(併入 2 或獨立 chore,依 changelog-conventions)

## Review 紀錄

- Round 1(change-spec-reviewer):R1 P1(SC-2 同股多筆無測試鎖)→ 已修 SC-2 + 逐檔表;R2/R3/R4 P2(null 態渲染、選定態編輯語意、匹配規則對齊範圍)→ 全數採納修入 §1/§2/§5。無殘留 P0/P1。

self_review_head: (Phase 5 填)
