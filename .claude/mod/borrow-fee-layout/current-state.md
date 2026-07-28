# current-state — mod/borrow-fee-layout(券差頁左右分欄 + 當日統計表)

日期:2026-07-28。Baseline:pytest 689 綠 + vitest 987 綠 + build 過(pre-push 防線輸出,main@9f290ce)。

## 現況行為

- `BorrowFeePage.tsx`:單欄 layout。header(標題 / 資料日 badge / NTD·partial 註記 /
  重新整理鈕 / `BorrowFeeStockFilter` 搜尋)+ 內容區單一 `DaytradeFeeTable`(`max-w-4xl`)。
- **痛點確認**:`本日標借合計 … 本月累計 …` summary(BorrowFeePage.tsx:81-109)只在
  `selectedStock` 非 null 時 render — 必須先搜尋選股才看得到任何合計數字。
- `DaytradeFeeTable.tsx`:當日明細(payload `rows` = as_of 當日列,同股可多筆),
  欄位 市場/代號/名稱/借券股數/借券費率/本月次數,可點欄頭排序(預設 fee_rate desc),
  排序邏輯在 `borrow-fee-utils.sortRows`。
- Backend `GET /api/daytrade-fee`(services/daytrade_fee.py):月批次抓 TWSE BFIF8U +
  TPEx OpenAPI,回 `{as_of_date, rows(當日), month_counts, month_shares, no_trading_day?, partial?}`。
  **當日 per-stock 合計 payload 沒有** — 但前端可由 `rows` 自行 aggregate(summary 現在就是這樣算)。

## Caller map(grep 全量,含動態)

| 目標 | caller |
|---|---|
| `BorrowFeePage` | `App.tsx:63-64`(lazy)+ `App.tsx:615`;`App.test.tsx` mock 成 stub(只認 `data-testid="borrow-fee-page"`) |
| `DaytradeFeeTable` | 僅 `BorrowFeePage.tsx` + 自身測試 |
| `borrow-fee-utils`(sortRows/distinctStocks/matchStockOptions/formatShares/formatFee) | BorrowFeePage / DaytradeFeeTable / BorrowFeeStockFilter + 各測試 |
| `useDaytradeFee` | 僅 BorrowFeePage + 自身測試 |
| 動態用法 | 無(grep `DaytradeFeeTable|BorrowFeePage|borrow-fee-utils|distinctStocks|formatShares|matchStockOptions|sortRows` 無 template string / reflection 命中) |

## 測試覆蓋現況

- `BorrowFeePage.test.tsx`:badge/NTD/partial/空狀態/error/refresh/文案禁令 + 單檔篩選 5 例 + summary 5 例。
- `DaytradeFeeTable.test.tsx`、`borrow-fee-utils.test.ts`、`BorrowFeeStockFilter.test.tsx`。
- e2e `borrow-fee.spec.ts`:BF1 排序/標色、BF2 持久化、BF3 篩選、BF4 summary 資料級。
- backend 不動(payload 已含所需資料)。

## 現況 vs 目標

| 面向 | 現況 | 目標 |
|---|---|---|
| Layout | 單欄,只有明細表 | 左:明細表(現 DaytradeFeeTable 原樣);右:當日 per-stock 借券統計表 |
| 合計可見性 | 需搜尋選股後才見 summary | 右表常駐(有資料即顯示),免搜尋 |
| 右表排序 | n/a | 依當日合計由多到少(desc)固定 |
| 對外契約 | GET /api/daytrade-fee payload | 不動(純前端 aggregate) |
| Backward compat | n/a | 既有 filter/summary/明細表行為全保留;純新增 UI |

## 影響評估

- 純前端、payload 不動 → 無 migration、無 API compat 議題。
- `App.test.tsx` mock 掉整頁 → 不受影響。既有 BorrowFeePage 測試斷言不依賴單欄 layout
  結構(全走 testid / text)→ 預期全部不該紅。
- e2e BF1-BF4 selector 走 `fee-row` testid → 新增右表 row 需用**不同 testid**,否則
  BF1/BF3 row count assertion 會被右表污染(關鍵相容點)。
