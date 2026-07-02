# Task 1 report — lib/market-types.ts + market-types.test.ts

對應:SC-1(design v3 §2)。commit 序列:紅 `2fc6573` → 綠 `2ca7d0c`。

## 檔案

- 新增:`frontend/src/lib/market-types.test.ts`(runtime contract lock,4 tests,對齊 `options-contract.test.ts` 的 cross-root fixture import pattern)
- 修改:`frontend/src/lib/market-types.ts`(追加 `ExcludedCount` / `BreadthPoint` / `Breadth` / `SectorBreadthRow` / `SectorVolumeRatioRow` / `SectorAmountShareRow` 型別 + `MarketSnapshot` 追加 7 欄,既有 7 欄 + 既有型別逐字未動)
- 機械更新(僅補欄位,未動任何 assertion):`frontend/src/hooks/useMarketSnapshot.test.ts`(`mockSnapshot`)、`frontend/src/components/MarketPage.test.tsx`(`mockResolvedValue` — 該檔僅 1 處呼叫,已用 Grep 確認無遺漏)

## RED 證據(`npx tsc -b` in frontend/,commit `2fc6573` 之後、型別未補前跑)

```
src/lib/market-types.test.ts(3,15): error TS2305: Module '"./market-types"' has no exported member 'Breadth'.
src/lib/market-types.test.ts(30,36): error TS2339: Property 'breadth' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(53,17): error TS2339: Property 'sector_breadth' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(54,28): error TS2339: Property 'sector_breadth' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(62,17): error TS2339: Property 'sector_volume_ratio' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(63,28): error TS2339: Property 'sector_volume_ratio' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(68,17): error TS2339: Property 'sector_amount_share' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(69,28): error TS2339: Property 'sector_amount_share' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(80,14): error TS2339: Property 'eod_as_of' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(81,26): error TS2339: Property 'eod_as_of' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(82,46): error TS2339: Property 'eod_as_of' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(84,24): error TS2339: Property 'universe_size' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(85,17): error TS2339: Property 'universe_size' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(86,24): error TS2339: Property 'excluded_count' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(87,17): error TS2339: Property 'excluded_count' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(88,24): error TS2339: Property 'excluded_count' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(89,17): error TS2339: Property 'excluded_count' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(90,24): error TS2339: Property 'excluded_count' does not exist on type 'MarketSnapshot'.
src/lib/market-types.test.ts(91,17): error TS2339: Property 'excluded_count' does not exist on type 'MarketSnapshot'.
```

型別未 export、`MarketSnapshot` 缺新欄位 → 全數 property-not-exist,符合 spec 描述的紅相位(tsc 紅而非 runtime assert 紅,因 fixture 本身 key 齊全)。

## GREEN 證據

`npx tsc -b`(frontend/,型別補上後):無輸出、exit clean。

`npm test`(vitest run,frontend/):

```
 Test Files  45 passed (45)
      Tests  428 passed (428)
   Start at  17:29:18
   Duration  6.18s
```

45 個測試檔全過、428 個 test 全綠(含新增的 4 個 contract lock test + 兩個機械更新的既有 mock 測試檔)。

## Self-review

- Fixture 實值先用 Python 逐欄核對(`universe_size=1917`、`excluded_count={etf:347,warrant:67,watch_list:57}`、`eod_as_of="2026-07-02"`、`breadth.thrust_dot=None`、`breadth.centerline_cross="above"`、`breadth.divergence_dot=None`、`ad_line_series`/`mcclellan_series` 各 128 筆、`known_gaps=[]`)— 與 spec 型別定義 + test 期望值域一致,無 drift。
- `mcclellan_series.length > 60`(spec test 2 的暖機 pad window 斷言)在 fixture 為 128,滿足。
- Sector row 值域(`pct` / `today_share` ∈ [0,1]、`vol_ratio`/`share_delta_20ma` number|null)逐筆迴圈檢查,而非只驗第一筆。
- `git status --short` 確認本次 commit 只碰 3 個目標檔(`market-types.ts` / `useMarketSnapshot.test.ts` / `MarketPage.test.tsx`),`market-types.test.ts` 已在紅 commit 單獨進去,未混入其他 artifact。
- 既有 `MarketSnapshot` 7 欄與既有型別(`Sector` / `StockTile` / `Leaderboards` / `LeaderboardRow`)逐字未動 — diff 只在檔尾新增,未觸碰原有 5 個型別區塊。
- 兩個 mock 更新僅新增欄位,未改動任何既有 assertion(`expect(...)` 行數與內容不變),符合「機械更新」要求。
- Windows CRLF 警告(`LF will be replaced by CRLF`)為既有 git 設定行為,非本次改動引入的問題,不處理。

## 未做 / 留待後續

- 本 task 範圍只到型別 + mock,不含任何 UI 元件消費新欄位(留給後續 task)。
