# Chip Date Controls — Change Spec

**Date:** 2026-06-29
**Type:** /mod(改既有 feature,非新功能)
**Scope:** equity 模式的「日期切換 + 籌碼天數」UX
**Revision:** v2(2026-06-29,addressing Plan agent review CONCERNs)

---

## 1. 目標摘要

四個獨立但相關的小改動:

1. **預設籌碼天數 = 1**(現為 30)
2. **DateField 左右各加「前/後一交易日」icon button**
3. **windowDays > 1 時 ChipBrokersPanel 加區域框**(左側直條 + header bar 加深)
4. **假日 / 非交易日:選後自動 snap 到「最近的之前」交易日**(native input 無法 disable 個別日期,改 snap)

---

## 2. 成功條件

- C1 全新訪客(無 localStorage)打開頁面 → RangeSelector active = `1`、ChipBrokersPanel 無區域框、header bar 顯「當日 YYYY-MM-DD」(date 取自 `summary.date`)
- C2 既存 localStorage `chip_window_days=30` 訪客 → 仍顯示 30、區域框出現、header bar 顯「過去 30 日加總」
- C3 DateField 左側出現 ← icon button、右側出現 → icon button(icon-only,高度對齊 DateField h-8)
- C4 點 ← → date 跳到 candles 中 date < 當前 date 的最近 candle.date(同時 set `userPickedDate.current = true`)
- C5 點 → → date 跳到 candles 中 date > 當前 date 的最近 candle.date(同時 set `userPickedDate.current = true`)
- C6 手動 type 「2026-06-27」(週六)→ snap 後 onChange 收到 `2026-06-26`(或 candles 中 ≤ 2026-06-27 的最大 date),DateField input value 也顯示 snapped 值
- C7 windowDays > 1 時:ChipBrokersPanel 左緣明顯 accent 直條 + window-header bar 背景加深
- C8 baseline 全綠維持:backend 231 / frontend 327;新增測試 ≥ 8 條(下列「新測試清單」),全綠
- **C9 Stepper disabled 條件:**
  - prev disabled = `!symbol || !candles.length || date <= candles[0].date`
  - next disabled = `!symbol || !candles.length || date >= effectiveMax`,其中 `effectiveMax = min(todayStr(), candles[candles.length-1].date)`

---

## 3. 不能破壞的既有行為白名單

| ID | 行為 | 驗證方式 |
|---|---|---|
| W1 | localStorage `chip_window_days` 既有值不被覆寫(從 30 → 仍 30) | 既有 `readStoredWindowDays` 測試保留 + 新增 migration 測試(預填 localStorage 30 後 mount App,觀察 RangeSelector active) |
| W2 | OptionsHeader 的 DateField 行為**完全不變**(未傳 `snapToDates` = native input 原行為) | OptionsHeader 既有測試保留 + 新測試「未傳 snapToDates 時 onChange fire raw value」 |
| W3 | `useChipBrokersWindow` 在 `windowDays=1` 時行為正確(後端 `chip.py` `ge=1` 已支援) | hook 既有 mock factory `mk(1)` 已合法;Phase 6 真實環境 smoke 驗證 |
| W4 | K 線 `handlePickDate` 仍能正常 setDate(K 線給的本來就是交易日,onPickDate signature 不變) | 既有 ChipKlineChart 測試保留 |
| W5 | `App.tsx` 自動 fallback `lastCandleDate` effect 行為不變(只在 `!userPickedDate.current` 時觸發) | 既有 App 整合測試(若無則本 mod 新建,見 §5) |
| W6 | `windowDays=1` 時的 useChipBrokersWindow 仍能 fetch + 渲染 ChipBrokersPanel | 新增 ChipBrokersPanel 渲染測試 (windowDays=1) + Phase 6 真實環境 |
| W7 | RangeSelector preset `1` 點擊行為不變 | 既有 RangeSelector 測試保留 |
| W8 | Options 模式日期操作完全不變(scope 紀律) | 既有 OptionsPage / OptionsHeader 測試保留 |
| W9 | snap 不會把使用者鎖在非交易日(history.candles 空 / race 時) | 見 §10 R5 決策 + 對應測試 |

---

## 4. 涉及檔案清單 + 三類動作分類

### 🔵 純重構(測試不該變)

無。此 mod 不做重構。

### 🔴 行為改動(會讓既有測試紅)

| 檔案 | 改動 | 預期紅的既有測試 |
|---|---|---|
| `frontend/src/App.tsx` | `DEFAULT_WINDOW_DAYS` 30 → 1 | 若有測試斷言「初始 windowDays = 30」會紅(改 assertion 到 1)— 既有 codebase 中目前未發現該斷言,故預期實際**零紅**;若 Phase 4 跑出意外紅測試,代表打到無關東西,回 spec |
| `frontend/src/App.tsx` | 把 `<DateField ... onChange>` 包進「Stepper + DateField + Stepper」群組;DateField 傳 `snapToDates={tradingDays}`;onChange handler 內 set `userPickedDate.current = true` 後 `setDate(e.target.value)`(`e.target.value` 已被 DateField 包過 = snapped or raw,App 端不需感知差異)| App 整合測試若已斷言 raw DOM 結構會紅(目前 App.test.tsx 不存在,見 §5 fallback policy)|
| `frontend/src/components/ChipBrokersPanel.tsx` | windowDays=1 時 header bar 文案改「當日 {summary.date}」;windowDays>1 時 bar 背景加深 + Panel 外層加左側 accent 直條 | 既有 `ChipBrokersPanel.test.tsx`(96-147)只測 windowDays=30 / undefined,不會紅;若新加 windowDays=1 assertion 是🟢新測試,非 assertion 改寫 |

### 🟢 新功能(新測試)

| 檔案 | 新增內容 |
|---|---|
| `frontend/src/lib/trading-days.ts` (**新檔**) | 純函式:`prevTradingDay(currentDate, dates) → string \| null`、`nextTradingDay(currentDate, dates, maxDate?) → string \| null`、`snapToTradingDay(targetDate, dates) → string`(dates 空時 return targetDate);dates 內部會先去重 + 升序排序(防呼叫端輸入順序) |
| `frontend/src/lib/trading-days.test.ts` (**新檔**) | 純函式單元測試 ≥ 6 條(正常 prev/next、boundary、無更早/更晚、dates 空、亂序輸入、snap 非交易日、snap 已在列表內無改) |
| `frontend/src/components/ui/date-field.tsx` | 新增 optional prop `snapToDates?: string[]`;當提供且 onChange value 不在列表內,**改 fire `onChange` 但 event.target.value 已被換成 `snapToTradingDay(value, snapToDates)`**(透過 cloned synthetic event 或 wrapped handler);未傳 = 完全 native 行為(W2 保證:實作必須是 early-return 跳過 wrap,不能無條件包) |
| `frontend/src/components/ui/date-field.test.tsx` | 新增測試:傳 snapToDates + type 非交易日 → onChange handler 收到 snapped value(用 spy / mockFn);未傳 snapToDates → onChange 收 raw value(W2);傳空 array → 直接 forward raw value 不 snap |
| `frontend/src/components/ui/TradingDayStepper.tsx` (**新檔**) | `<button>` icon-only,props: `{ direction: "prev" \| "next"; disabled?: boolean; onClick: () => void }`;高度對齊 DateField(h-8);內含 inline SVG(統一以 stroke="currentColor" 顯示,不引入 lucide-react 等 dep);`aria-label` 固定「前一交易日」/「後一交易日」 |
| `frontend/src/components/ui/TradingDayStepper.test.tsx` (**新檔**) | render + click handler + disabled 不可點 + aria-label |
| `frontend/src/App.tsx` 包 stepper | `<div className="inline-flex items-stretch">` 內含 prev stepper / DateField / next stepper;`tradingDays` 從 `history?.candles.map(c => c.date)` 計算;stepper onClick handler set `userPickedDate.current = true` |
| `frontend/src/App.test.tsx` (**新檔,fallback policy 觸發**) | App 層整合測試 ≥ 4 條:(a) 全新訪客 RangeSelector active=1;(b) localStorage 預填 30 → active=30;(c) 點 ← → date 改變;(d) 點 → 已到最後 candle 時 disabled |

---

## 5. 既有測試逐一檢視

| 測試檔 | 影響 | 處理 |
|---|---|---|
| `App.test.tsx` | **不存在**,fallback policy:**本 mod 新建**(列在 §4 新檔) | — |
| `RangeSelector.test.tsx` | preset 列表含 1,行為不變 | 不該紅 |
| `ChipBrokersPanel.test.tsx` | 既有測試針對 windowDays=30 / undefined,**未測 windowDays=1 字串**(已確認 96-147) | 不該紅;新增 windowDays=1 用例為🟢 |
| `date-field.test.tsx` | 既有 native 行為(W2) | 不該紅(新 prop optional,實作走 early-return) |
| `OptionsHeader.test.tsx` | 未傳新 prop | 不該紅(W2) |
| 所有 hook 測試(useChipBrokersWindow / useChipData 等) | API contract 未動 | 不該紅 |

**紅 ≠ 該紅原則:** 任何不該紅的測試紅 → 回 Phase 3 看 spec 漏列什麼,**不改 assertion**。

---

## 6. Backward compat

- **API:** 零改動。`/api/chip/{symbol}/brokers_window?days=1` 後端已支援(`ge=1, le=60`)
- **localStorage:** key `chip_window_days` 不變、不 bump 版本。既有 user `30` 透過 `readStoredWindowDays()` 仍正確讀回 30(W1)
- **DateField caller:** 兩處(`App.tsx` / `OptionsHeader.tsx`)。OptionsHeader 不傳 `snapToDates` = DateField 走 early-return,onChange 不被 wrap,行為 100% 不變(W2)
- **ChipBrokersPanel windowDays:** prop 仍 optional;`windowDays === undefined` 時繼續 legacy 不渲染 header bar 與外框

---

## 7. Migration

- 既有 localStorage `chip_window_days=30` 用戶:**保留**他們的設定。新 default = 1 只影響全新用戶(`localStorage.getItem` returns null 的分支)
- 既有 user 想體驗 1 天 default → 透過 RangeSelector 手動選 1 即可
- **Migration 可逆性:** 改回 `DEFAULT_WINDOW_DAYS = 30` 即還原。零 schema 變更、零資料遷移

---

## 8. Out of scope(寫進 next-time)

- ❌ Options 模式套用同樣的前/後天 + snap + 區域框
- ❌ 換 calendar library(react-day-picker / Radix Calendar)
- ❌ 接政府開放資料國定假日 API
- ❌ snap 後顯示 toast / banner / 任何使用者通知
- ❌ 前/後天按鈕的 keyboard shortcut(可後續 enhancement)

---

## 9. 實作順序(三類分開 commit)

**Commit 1(🟢 純新增,測試不該紅)**
- `frontend/src/lib/trading-days.ts` + test(6 條)
- `frontend/src/components/ui/TradingDayStepper.tsx` + test(4 條)
- `frontend/src/components/ui/date-field.tsx` 加 `snapToDates` optional + test(3 條新增,W2 既有保留)

**Commit 2(🔴 行為改動,部分既有測試可能紅)**
- `App.tsx`: `DEFAULT_WINDOW_DAYS = 1`、wire prev/next stepper、傳 snapToDates、stepper onClick set userPickedDate
- `ChipBrokersPanel.tsx`: header bar windowDays=1 文案改「當日 {date}」、N>1 加區域框 + bar 加深
- `ChipBrokersPanel.test.tsx`: 新增 windowDays=1 用例(🟢 仍是新測,但放這 commit 是因依賴實作)

**Commit 3(🟢 整合測試)**
- `frontend/src/App.test.tsx`(**新建**)≥ 4 條整合測試

---

## 10. 風險點與決策

- **R1** snap 時 candles 為空(symbol 尚未選 / 初次載入):`snapToTradingDay` 在 dates 空時 return 原 targetDate(不 snap)。DateField 在 `snapToDates === undefined || .length === 0` 時走 early-return,onChange 收 raw value(W2 + 不擋 user)
- **R2** 「下一交易日」上限:`nextTradingDay(currentDate, dates, maxDate?)` 第三參 optional;App.tsx 傳 `min(todayStr(), lastCandle.date)`,避免使用者點到未來日撞 422
- **R3** localStorage 既有 user `30` 不強制 reset(scope 紀律)
- **R4** 純函式 `prev/next/snap` 內部去重 + 升序排序,deterministic;測試覆蓋亂序輸入
- **R5(NEW)** 初次載入 race — history.candles 尚未到 + user 直接 type 非交易日:
  - 情境:DateField 走 R1 早退(snapToDates 空)→ onChange 收 raw value(週六)→ 進入 App state
  - 考慮過的方案:讓 DateField 在 snap noop 時不 set userPickedDate,讓 App.tsx fallback effect 還能接手
  - **否決理由:** DateField 與 App.tsx state 之間引入「snap 發生與否」的隱式 contract,實作複雜且易誤讀
  - **採用決策:** App.tsx 的 DateField onChange handler **一律** set `userPickedDate.current = true`(與既有行為一致),user 在 race 後必須再用 stepper / RangeSelector 重整。**不做 noop 偵測**(YAGNI)
  - **副作用接受:** race 期間 user type 週六字串進 App state,後續 fetch 可能撞 422 / no-data → 沿用既有 `useChipData` / `useChipBrokersWindow` error handling,**不為此情境加特例**
- **R6(NEW)** symbol 未選時:prev / next stepper 兩按鈕都 disabled(C9 列入條件)。DateField 仍可手動 type 但 snap 不會發生(R1)— 與既有「未選 symbol 但可改日期」行為一致
- **R7(NEW)** stepper 計算 `effectiveMax` 涉及 `todayStr()`,跨天會 stale。決策:**不做 timer refresh**(YAGNI,使用者重新整理頁面即可)

---

## 11. 設計留白(不寫死,Phase 4 自由發揮)

以下事項 spec 只給方向,不綁實作細節:

- 區域框視覺:**左側 accent 直條 + window-header bar 背景加深**(寬度 / 色階由實作決定,RangeSelector active state 已用 `bg-accent/[0.08]` 可參考)
- Stepper icon SVG path:**inline `<polyline>` 或 `<path>`**(實作者自行畫),只要 stroke 用 `currentColor`、aria-hidden
- ChipBrokersPanel 取 `summary.date` 渲染「當日」文案的方式:既有 panelSummary 已含 date(`App.tsx` 已 wire),元件 props 不需新增
- `trading-days.ts` 函式內部資料結構:Set / Map / sorted array 自由,只要 public API 維持
