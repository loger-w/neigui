# repro — 從大盤 / 券差跳到籌碼,股票只顯示代號不顯示名稱

## 1. 重現(loop-first)

- 症狀:market mode(今日三卡 / 排行)或 borrow mode 點某檔股票 → 切到 equity,header
  `symbol` 旁沒有 `symbolName`(只有「2330」,沒有「台積電」)。
- 紅指令:`npm test -- src/App.test.tsx -t "跨 mode"`(vitest,見 App.test.tsx 新 case
  「market → equity 跳轉後 header 顯示股名」「borrow → equity …」)。
- 手動:開 :5173,ModeSwitch → 大盤 → 點任一 stock → 觀察 header。

## 2. Root cause

`App.tsx` `handleSymbolPick(sid)` 為 MarketPage / BorrowFeePage 的 `onSymbolPick(stockId)`
接點,直接 `handlePick(sid, null)` — 名稱通道不存在;而 header 只在 `symbolName` 非 null
時渲染名稱。`handleFlowStockPick`(分點反查)也可能收到 null name(design v3 §3.5)。
SymbolSearch 走 `onPick(symbol, name)` 所以只有搜尋路徑有名字。

候選:(A) 五個 caller 簽名加 name(MarketBreadthPanel / MarketSectorRotation /
MarketVolumeRatioPanel / MarketPage / BorrowFeePage 逐層透傳);(B) App 層以
`useAllSymbols()`(SymbolSearch 已在 equity mount 時打同一 queryKey,零額外請求)補名:
`symbolName ?? symbols.find(...)?.name`。
採 (B) `[auto-default: B | reason: 單點修覆蓋所有 null-name 進入點(market / borrow /
flows),不動 5 檔 caller 簽名;資料同源 SymbolSearch,不多一個請求]`。

## 3. 反向驗證

(見下方追加)
