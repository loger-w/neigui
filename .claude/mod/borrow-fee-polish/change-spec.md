# change-spec — mod/borrow-fee-polish(券差頁四項調整)

日期:2026-07-28。Phase 1 現況:`current-state.md`(同目錄)。

## 分流判定

已成形改法(判準 1:四項各指名 UI 形式/行為 — 滾動條貼齊、summary 區塊固定、統計表點擊
連動篩選、跳個股按鈕;判準 2:各有具體決策點)→ grilling 姿態。疊 /auto:方案完整、
無 counter-proposal → 依 auto.md 替代條件推進,實作級決策標 `[auto-default]`。
user 補充指示(mid-turn):前端問題記得呼叫 frontend-design + bencium-controlled-ux-designer
— 兩 skill 本 session 已載入生效,設計決策依其原則(層級、affordance、一致性、零跳動)。

## 成功條件(SC,畫面可指認)

- **SC-1(滾動條貼齊)**:≥1024px 時左明細欄寬受 `max-w-4xl` 上限約束,縱向滾動條
  出現在表格右緣(量法:左欄捲動容器 rect.right − 明細表 rect.right < 24px,devtools
  實測);寬螢幕剩餘空白移到統計欄右側,兩表相鄰(proximity)。
  `[auto-default: 左欄 lg:max-w-4xl(欄=表同寬)而非放寬表格 | reason: 表格 896px 上限是
  既有可讀性設計(60-75ch);挪空白比拉寬表格不動任何欄位密度]`
- **SC-2(summary 區塊常駐)**`[amendment 2026-07-28: R3 — gate 措辭與量測條件精確化]`:
  **data 載入後**(與篩選 combobox 同 gate)header 即有 summary 區塊,占位文案
  「本日標借合計 —」「本月累計 —」(ink-dim);選股後同一區塊填數字;清除選股回占位,
  區塊不消失。選股前後 header 高度零變化(量法:≥1024px viewport 下 header rect.height
  選股前後相等,devtools 實測;窄幅換行造成的高度差不在本 SC 範圍)。「看籌碼」鈕常駐該行右側,未選股 `disabled`。
  `[auto-default: 占位用「—」沿用缺值慣例 + 按鈕 disabled 態常駐 | reason: 區塊高度穩定
  是本項需求核心;disabled 鈕比條件 render 少一種跳動,affordance 誠實]`
- **SC-3(統計表點擊連動)**:點統計表任一列 → 等同在 combobox 選定該股:左明細只剩
  該股、篩選框顯示「代號 名稱」、summary 填該股數字;清除鈕行為照舊回全表。統計列
  hover 有背景變化 + cursor-pointer(可指認 affordance);鍵盤 focus + Enter 同效。
  `[auto-default: tr onClick + tabIndex + Enter,不包 button 元素 | reason: 整列命中面積
  (觸控友善)且不破壞 table 結構;app 內 MarketBreadthPanel 為 button 樣板但其為
  list-like 清單,表格列以列級互動為準]`
- **SC-4(看籌碼跳轉)**:選股後點「看籌碼」→ 切到個股(equity)mode 並帶入該股
  (走既有 `handleSymbolPick` 樣板:`setMode("equity")` + `handlePick(sid, null)`,
  sibling state 全 reset 與 market 頁跳轉零差異);券差頁 unmount、mode 持久化 equity。
  `[auto-default: 鈕放 summary 行(需先選股)、復用 handleSymbolPick 不 setTab |
  reason: 與 market 頁 onSymbolPick 行為一致(一致性原則);per-row 加鈕與 SC-3 點擊
  衝突]`
- **SC-5(既有測試)**:BF1/BF2/BF3/BF5 + 其餘 vitest 全綠不動;BF4 與 summary 兩例
  vitest 依新語意改 assertion(事前標該紅)。

## 不能破壞的既有行為白名單

1. 明細表:欄位集 / 欄頭排序 / fee_rate desc 預設 / 高費率標色 / `fee-row` testid 語意。
2. 篩選 combobox:輸入編輯解除 selection、清除鈕、無符合訊息、鍵盤導航、選定態 input
   顯示「代號 名稱」。
3. summary **數值語意**:dayTotal = 篩選後列 reduce、month_shares 缺 key 顯「—」且
   次數段不 render、map 整缺不 crash — 只有「顯示時機」變(常駐),計算與缺值處置零改動。
4. 統計表資料語意:全集 rows、張數 desc、tie-break 代號升冪、不受篩選連動(點擊連動是
   「statRow → 設 selection」單向,統計表本身列數恆為全集)。
5. header badges(資料日 / NTD / partial)/ refresh 鈕 / 方向性文案禁令 / borrow mode
   localStorage 持久化。
6. `handleSymbolPick` 既有 caller(MarketPage)行為不動 — 只新增 caller,不改函式。
7. `GET /api/daytrade-fee` payload 不動。
8. 空態兩分(全集空無統計表 + 「本月無券差資料」/ 篩選 0 列統計表仍在 + 「該檔今日
   無券差資料」)。

## Backward compat / migration

純前端。`onSymbolPick` prop optional(App.test.tsx stub 與既有測試 render 不需改);無
migration。

## E2E 歸屬(e2e-conventions 判準表)

borrow mode UI / 跨 mode 跳轉 → `borrow-fee.spec.ts`:BF4 改 assertion(summary 常駐)、
新增 **BF6**(點統計列連動篩選 + 看籌碼跳 equity;跳轉後只斷言 mode 切換與券差頁
unmount,不依賴 8069 的 chip fixture)。SC-1 幾何與 SC-2 高度穩定屬視覺量測 →
devtools 實測 + 截圖(visual.spec 無 borrow baseline,不動 V#)。fixture 不改。

## Out of scope

- 統計表 per-row 看籌碼鈕(與點擊連動衝突)。
- equity 方向的回跳鏈(個股 → 券差)。
- 統計表加欄 / 欄頭排序(next-time.md 既有條目續留)。

---

# Diff 級 spec(Phase 3)

三類:**🔴 行為改動** = item 1(layout CSS)+ item 2(summary 常駐;既有 assertion 該紅);
**🟢 新功能** = item 3(點擊連動)+ item 4(看籌碼跳轉)。無 🔵。
Commit 順序:🔴(red:改該紅 assertion → green:實作)→ 🟢(red → green)。

## 🔴 `frontend/src/components/BorrowFeePage.tsx`(item 1 + 2)

- 左欄 className 加 `lg:max-w-4xl`(保留 flex-1 min-w-0 overflow),內層 `max-w-4xl`
  wrapper 可留可去(留 — 行為等價,少動)。
- summary 區塊 gate 由 `data && selectedStock` 改 `data`(常駐):
  - 選股態:現有數字內容零改動(白名單 3)。
  - 未選股態:「本日標借合計 —」「本月累計 —」(text-ink-dim,同行高)。
  - 行尾加「看籌碼」鈕(`data-testid="jump-to-equity"`,border 樣式同 refresh 鈕縮小版,
    `disabled={!selectedStock}`,onClick →
    `() => { if (selectedStock) onSymbolPick?.(selectedStock.stock_id); }`
    `[amendment 2026-07-28: R1 — disabled 不做 type narrowing,guard 寫進 handler,
    禁 non-null assertion]`)。
  - testid `borrow-fee-stock-summary` 沿用(e2e BF4 改斷內容非存在性)。
- Props 加 `onSymbolPick?: (stockId: string) => void`。

## 🔴 既有測試改 assertion(該紅清單)

| 檔 | 例 | 改法 |
|---|---|---|
| `BorrowFeePage.test.tsx` | 「選股 → summary 出現」 | 改:選股前 summary **存在**且含「—」,選股後填數字 |
| `BorrowFeePage.test.tsx` | 「清除選股 → summary 消失」 | 改:清除後 summary **仍在**、內容回「—」占位 |
| `e2e BF4` 末段 | `toHaveCount(0)` | 改:清除後 summary 可見且含「本日標借合計 —」 |

其餘全部不該紅。

## 🟢 `frontend/src/components/BorrowDayStatsTable.tsx`(item 3)

- Props 加 `onPickStock?: (stockId: string) => void`。
- `<tr>` 加 `onClick={() => onPickStock?.(s.stock_id)}`、`tabIndex={0}`、
  `onKeyDown`(Enter/Space 同 click;**Space 分支 `e.preventDefault()`** — 統計欄本身
  lg:overflow-y-auto,不擋會選股同時跳捲)、`cursor-pointer hover:bg-line-strong/30
  focus-visible:bg-line-strong/30 transition-colors`(focus affordance 與 hover 同階)、
  `aria-label="篩選 <代號> <名稱>"`。`[amendment 2026-07-28: R2]` 測試一併覆蓋 Space +
  preventDefault。

## 🟢 `frontend/src/components/BorrowFeePage.tsx`(item 3 接線)

- `<BorrowDayStatsTable rows={data.rows} onPickStock={handleStatPick} />`;
  `handleStatPick = (sid) => { const o = stockOptions.find(...); if (o) setSelectedStock(o); }`
  (StockOption 含 market,combobox input 由既有 effect 自動同步顯示)。

## 🟢 `frontend/src/App.tsx`(item 4 接線)

- `<BorrowFeePage onSymbolPick={handleSymbolPick} />`(App.tsx:615;handleSymbolPick 不動)。

## 🟢 `e2e/helpers/selectors.ts` + `e2e/specs/borrow-fee.spec.ts`

- TESTIDS 加 `jumpToEquity: "jump-to-equity"`。
- BF6:點統計首列(8069)→ `fee-row` 剩 1 列且 data-stock-id=8069、summary 含
  「本日標借合計 25,000 股」+ 「本月累計 26,000 股」+「(2 次)」
  `[amendment 2026-07-28: R4 — 補 tpex 月聚合資料級鎖;手算 06-25 1,000 + 06-26 25,000,
  distinct dates 2]`;點「看籌碼」→ `borrow-fee-page` 消失、mode button 個股
  `aria-current="page"`、localStorage mode=equity。

## 🟢 新測試清單

| 檔 | cases |
|---|---|
| `BorrowDayStatsTable.test.tsx` | row click 呼叫 onPickStock(stock_id);Enter 鍵同效;無 handler 不炸 |
| `BorrowFeePage.test.tsx` | 點 stat row → fee-row 剩該股 + summary 填數字;看籌碼鈕未選股 disabled;選股後點擊呼叫 onSymbolPick(sid) |

## 其他義務

- Changelog:MINOR → 0.45.0(一個 entry 多 change items,同 ship event);寫前
  changelog-conventions 已載入。
- next-time.md:click-to-filter 條目做完即刪。
- `changelog.test.ts` 最新版本鎖 → 該紅改 0.45.0(事前標)。

self_review_head: 7c62a8bc78853224117990e65bbb5aa49da8ec7c
