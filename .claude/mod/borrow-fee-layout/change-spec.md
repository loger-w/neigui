# change-spec — mod/borrow-fee-layout(券差頁:左明細 + 右當日借券統計)

日期:2026-07-28。Phase 1 現況:`current-state.md`(同目錄)。

## 分流判定

已成形改法(命中判準 1:UI 形式指名 — 左明細表 / 右當日 per-stock 統計表、免搜尋常駐、
由多到少排序;判準 2:有可追問決策點 — 單位 / 響應式 / 是否連動篩選)→ grilling 姿態。
疊 /auto:方案完整、無 counter-proposal → 依 auto.md 替代條件推進,實作級決策標
`[auto-default]`(下列各處)。

## 需求(user 原句拆解)

1. 券差頁改左右分欄:左 = 既有明細 Table,右 = 「當天所有借券股數統計(張數)」表。
2. 痛點:目前要搜尋選股才顯示「本日標借合計」→ 統計表要**免搜尋常駐**。
3. 右表**由統計多到少排序**(desc)。

## 成功條件(SC,畫面可指認)

- **SC-1(常駐統計)**:進入券差頁、不做任何搜尋/選股,內容區即見「本日借券統計」表:
  當日每檔一列,欄位 = 代號 / 名稱 / 張數;張數 = 該檔當日 `lending_shares` 合計 ÷ 1000
  (unit = 張,1 張 = 1,000 股;量法 = e2e fixture 手算,見 BF5)。表標題「本日借券統計」+
  單位註記「單位:張」可指認。
  - `[auto-default: 單位顯示「張」、整千顯整數、非整千顯 1 位小數 | reason: user 原句指名
    「統計張數」;上游 lending_shares 慣例為千股整數,小數 fallback 防 odd-lot 靜默錯值]`
  - `[auto-default: 欄位僅 代號/名稱/張數,不帶市場 badge/費率/次數 | reason: user 只要
    「股數統計」;右欄寬有限,鐵則 B 不加未要求欄位]`
- **SC-2(排序)**:統計表固定依張數 desc 排列,同張數 tie-break 代號升冪;不提供欄頭
  切換排序。fixture 手算預期順序:`8069(25) → 2434(21) → 1513(14) → 5483(3) → 8046(3)`
  (06-26 當日;5483/8046 同 3 張,代號升冪)。
  - `[auto-default: 固定排序不做 sortable 欄頭 | reason: user 指名單一排序;明細表已有
    可排序全欄位,統計表是 overview]`
- **SC-3(不連動篩選)**:單檔篩選只過濾左側明細;統計表恆為當日全集(選股後右表列數
  不變)。`[auto-default: 右表不受篩選影響 | reason: 「當天的所有」原句;篩選後全集
  overview 消失會重演痛點]`
- **SC-4(響應式)**:視窗 ≥1024px(`lg:`)左右分欄 — 左明細 flex-1、右統計固定寬,
  兩欄各自獨立垂直捲動;<1024px 堆疊(明細在前、統計在後),單一捲動容器,功能不變。
  - `[auto-default: lg breakpoint + 桌面雙欄獨立捲動、mobile 明細優先堆疊 | reason:
    明細 max-w-4xl≈56rem + 統計 ~20rem 需 ≥lg 才塞得下;獨立捲動讓長明細不把統計推出
    視野(常駐可見即痛點解);mobile 保持主資訊優先]`
- **SC-5(空態)**`[amendment 2026-07-28: R3 — rows 指涉改全集、兩態明分]`:
  **`data.rows`(全集,非篩選後)**空時統計表整個不 render + 「本月無券差資料」置中訊息
  原樣;篩選後 0 列但全集非空 → 統計表**仍在** + 「該檔今日無券差資料」訊息原樣(與 SC-3
  一致)。

## 不能破壞的既有行為白名單

1. 明細表:欄位集 / 欄頭可排序 / 預設 fee_rate desc / 高費率(≥3.5%)accent 標色
   (`fee-high` testid)/ `fee-row` testid + `data-stock-id`(e2e BF1、BF3 的 row count
   語意 — **新統計表 row 必用不同 testid**)。
2. 單檔篩選全行為:選定只剩該檔、清除回全表、編輯輸入即回全表、data null 不渲染篩選器
   (BF3 + BorrowFeePage 篩選 5 例)。
3. 選股 summary:`本日標借合計 / 本月累計 / (N 次)` 全部既有語意含缺值處置(BF4 +
   summary 5 例)— 本次**不移除**(統計表給全集、summary 給選定股本月維度,不重疊)。
4. header:標題 / 資料日 badge / 非交易日註記 / 上櫃資料缺註記 / 重新整理鈕(spinner +
   aria)。
5. 空狀態訊息文案兩則原樣。
6. 方向性文案禁令(整頁無 軋空/回補/做多/做空/賣壓/買點)。
7. borrow mode localStorage 持久化(BF2)、App.tsx lazy 掛載。
8. 對外契約:`GET /api/daytrade-fee` payload 不動(純前端 aggregate)。

## Backward compat / migration

純前端新增 UI,無 API / 資料格式 / 儲存改動 → 無 migration。舊 payload(缺
`month_shares` 的版本 skew)不影響統計表(只用 `rows`)。

## E2E 歸屬(e2e-conventions 判準表)

borrow mode UI 改動 → `e2e/specs/borrow-fee.spec.ts` 加 **BF5**(免搜尋常駐 + 資料級
排序/張數 assertion);既有 BF1-BF4 不該紅(fee-row 語意保留)。visual.spec 無 borrow
baseline → 不動 V#。fixture 不改 → 不清 cache 需求、MANIFEST 不涉及。

## Out of scope(順手衝動 → docs/next-time.md)

- 統計表 row 點擊帶入單檔篩選(click-to-filter)。
- 統計表加市場 badge / 費率 / 次數欄、欄頭排序。
- 本月維度的全市場統計(month_shares 全集表)。
- backend 增 per-stock day aggregate 欄位。

---

# Diff 級 spec(Phase 3)

`[amendment 2026-07-28: R2 — 三類重分]`:utils / 新元件 / selectors / 測試屬 🟢 新功能;
**BorrowFeePage 內容區分欄 + 捲動結構整合屬 🔴 行為改動**(既有頁 user 可感 layout 改動,
獨立 commit;既有測試仍零紅預期 — 零紅是覆蓋空隙,不改變 🔴 歸類)。無獨立 🔵。
Commit 順序:🟢(utils + 元件 + selectors,紅→綠)→ 🔴(page 整合,紅→綠)。

## 🟢 `frontend/src/lib/borrow-fee-utils.ts`

- 新增 `export interface DayStat { stock_id: string; name: string; total_shares: number }`。
- 新增 `aggregateDayStats(rows: BorrowFeeRow[]): DayStat[]` — 依 stock_id 加總
  `lending_shares`(name 取首見),排序:total desc → stock_id asc。
- 新增 `formatLots(shares: number): string` — `(shares / 1000).toLocaleString("en-US",
  { maximumFractionDigits: 1 })`(四捨五入至 1 位小數、千分位含小數分支)。
  `[amendment 2026-07-28: R5 — 鎖定捨入/千分位規則]` 測試對:`3000→"3"`、`25000→"25"`、
  `1234→"1.2"`、`1900→"1.9"`、`2500000→"2,500"`。

## 🟢 `e2e/helpers/selectors.ts` `[amendment 2026-07-28: R1 — 補漏列]`

- TESTIDS 加 `borrowDayStats: "borrow-day-stats"`、`dayStatRow: "day-stat-row"`
  (registry no-magic-string 契約;BF5 依此 import)。

## 🟢 `frontend/src/components/BorrowDayStatsTable.tsx`(新檔)

- Props `{ rows: BorrowFeeRow[] }`;內部 `aggregateDayStats` + render 表。
- 結構:標題「本日借券統計」+ 註記「單位:張」;表欄 代號 / 名稱 / 張數(右對齊
  tabular-nums)。root `data-testid="borrow-day-stats"`,row `data-testid="day-stat-row"` +
  `data-stock-id`。semantic token only,數字 ink 階層(非互動態禁 accent — 色彩語意鐵則)。

## 🔴 `frontend/src/components/BorrowFeePage.tsx` `[amendment 2026-07-28: R2 — 改標 🔴]`

- 內容區改分欄容器:`overflow-y-auto lg:overflow-hidden lg:flex lg:gap-x-6`;
  左欄(既有 `max-w-4xl` 明細)`lg:flex-1 lg:min-w-0 lg:overflow-y-auto`;
  右欄 `<BorrowDayStatsTable rows={data.rows} />`(**全集 rows,非篩選後**)
  `lg:w-72 lg:shrink-0 lg:overflow-y-auto`,mobile 排明細後。
  `[amendment 2026-07-28: R6 — 回填定值]` `[auto-default: lg:w-72(18rem)+ lg:gap-x-6 |
  reason: 統計表三欄窄表 18rem 足;1280 viewport 驗算 1280−48(px-6×2)−24(gap)−288 =
  920px 左欄 > 明細 max-w-4xl 需縮量,無擠壓]`。
- 空態分支:分欄外層以 `data && data.rows.length > 0` gate 統計表、明細區維持原 ternary
  (SC-5 兩態)。`[amendment 2026-07-28: R4 — 空態高度基準]` 篩選 0 列且統計表並存時,
  空態訊息容器改 `min-h-40` 置中(mobile 堆疊流中 `h-full` 失去高度基準);全集空
  (統計表不 render)維持整區 `h-full` 置中。
- header / filter / summary 區塊零改動。

## 🟢 測試

| 檔 | 動作 | 預期 |
|---|---|---|
| `borrow-fee-utils.test.ts` | 加 `aggregateDayStats`(同股多筆加總 / desc / tie-break / 空陣列)+ `formatLots`(整千、非整千、千分位)cases | 新增,先紅後綠 |
| `BorrowDayStatsTable.test.tsx`(新檔) | 列數 = distinct stocks、順序 desc、張數換算顯示、testid | 新增,先紅後綠 |
| `BorrowFeePage.test.tsx` | 加:未選股即有 `borrow-day-stats`;選股後 `day-stat-row` 數不變(SC-3);rows 空無統計表(SC-5);篩選後 0 列時統計表仍在 | 新增,先紅後綠 |
| 既有全部(page 17 例 / table / utils / filter / App) | 不動 | **零紅**(不該紅) |
| `e2e/specs/borrow-fee.spec.ts` | 加 BF5:免搜尋 `borrow-day-stats` 可見、`day-stat-row` 5 列、順序 `8069,2434,1513,5483,8046`、首列張數 `25` | 新增;BF1-BF4 零紅 |

## 既有測試該紅/不該紅

- 該紅:無。
- 不該紅:全部(本 mod 純新增;任何既有紅 = 打到無關東西,回頭查)。

## 其他義務

- Changelog:user 可感 UX 改動 → MINOR bump(寫 entry 前讀 `changelog-conventions`)。
- 實作前呼叫 `frontend-design` + `bencium-controlled-ux-designer`(user 2026-07-07 指示)。
- commit 前 cat `docs/next-time.md` 並補 out-of-scope 條目。

self_review_head: ed5228983bbb8bf8ba98b2c4eb59c1c57bf1c810
