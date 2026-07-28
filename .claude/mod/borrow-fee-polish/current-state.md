# current-state — mod/borrow-fee-polish(券差頁四項調整)

日期:2026-07-28。Baseline:main@1e37e31 = 前一輪 merge 時 pre-push 全綠(pytest 689 /
ruff / vitest 999 / build;e2e 62 綠同日)。前情:mod/borrow-fee-layout(左右分欄 +
本日借券統計表)剛 merge,artifacts 在 `.claude/mod/borrow-fee-layout/`。

## 四項需求對應現況

| # | user 需求 | 現況(檔案/行號) | 目標 |
|---|---|---|---|
| 1 | 左表滾動條離 table 太遠 | BorrowFeePage 左欄 `lg:flex-1 lg:min-w-0 lg:overflow-y-auto`,內層 `max-w-4xl` cap 表寬 — 寬螢幕左欄撐滿 flex-1,scrollbar 在欄右緣、距表格 (欄寬−896px) 遠 | scrollbar 貼表格右緣 |
| 2 | summary 區塊固定、不要搜尋後突然多出來 | BorrowFeePage header `{data && selectedStock && ...}` gate — 選股後才 render,header 高度跳動、下方表區突移 | 區塊常駐(未選股顯占位),高度穩定 |
| 3 | 點右統計 → 左表自動篩選 | BorrowDayStatsTable 純顯示,row 無互動(上一輪 out-of-scope 入 next-time.md,本輪 user 點名要做 → 做完刪該條) | 點 stat row = 選定該股(等同 combobox 選取) |
| 4 | 按鈕直接切換到個股看籌碼 | BorrowFeePage 無 props、App.tsx:615 `<BorrowFeePage />`;跨 mode 跳轉鏈已有樣板:`handleSymbolPick`(App.tsx:284,`setMode("equity")` + `handlePick(sid, null)` 全 reset),MarketPage 以 `onSymbolPick` prop 接(App.tsx:603) | BorrowFeePage 接同款 `onSymbolPick` prop,選定股 summary 區塊放「看籌碼」鈕 |

## Caller map(grep 全量)

- `BorrowFeePage`:App.tsx:615(唯一 render,無 props)+ App.test.tsx mock stub(不吃 props,加 prop 不影響)。
- `BorrowDayStatsTable`:僅 BorrowFeePage + 自身測試。Props `{rows}`。
- `BorrowFeeStockFilter`:selected 顯示「代號 名稱」於 input(useEffect selected → setQuery),`onSelect(StockOption)` / `onClear`。**程式化 setSelectedStock 也會被 input 反映**(effect 只看 selected prop)→ item 3 直接 setSelectedStock 即可,combobox 顯示自動同步。
- `handleSymbolPick`:App.tsx:284,現僅 MarketPage 用;簽名 `(sid: string) => void`。不 setTab(handleFlowStockPick 才 setTab)。
- `DayStat`(borrow-fee-utils):`{stock_id, name, total_shares}` — 無 market;StockOption 需 market → item 3 由 page 層 `stockOptions.find()` 查(distinctStocks 已含 market),不必改 DayStat shape。
- 動態用法:無新增疑慮(上一輪已 grep,本輪目標檔同一批)。

## 受影響測試盤點

- **該紅(item 2 行為改)**:`BorrowFeePage.test.tsx` summary describe 內「選股 → summary 出現」(斷言選股前 queryByTestId null)、「清除選股 → summary 消失」;e2e BF4 末段 `toHaveCount(0)`。
- 不該紅:其餘全部(明細表 / 篩選 / 統計表 / BF1/BF2/BF3/BF5)。
- App.test.tsx:mock 掉整頁,不受 prop 新增影響。

## Backward compat

純前端;無 API / 資料改動。新 prop `onSymbolPick` 設 optional → BorrowFeePage 既有測試
render 寫法(無 props)不需全改。
