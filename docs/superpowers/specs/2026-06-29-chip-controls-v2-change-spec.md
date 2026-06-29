# Chip Controls v2 — Change Spec

**Date:** 2026-06-29
**Type:** /mod follow-up(修正 v0.16.0 的「N 日區域框」位置錯放 + RangeSelector 人性化)
**Predecessor:** `2026-06-29-chip-date-controls-change-spec.md`(v0.16.0)
**Target version:** v0.17.0

---

## 1. 目標摘要

User feedback v0.16.0 後兩點:

1. **N 日區間框應該畫在 K 線上**(我先前理解錯,做在 ChipBrokersPanel 左緣)— **移除舊 panel-frame**,改在 K 線 + 所有 subchart 上加 highlight overlay
2. **RangeSelector 自訂天數要更人性化** — 把 spinbutton(滾輪/方向鍵)改成 number input,user 想選 7 / 45 / 任意值可直接打字

---

## 2. 成功條件

- **C1** windowDays > 1 時,K 線 + 5 個 subchart 共同顯示一條金黃半透明縱向 band,精準對齊 N 根 candle 範圍(start = selectedDate 往前 N-1、end = selectedDate)
- **C2** Band 左邊界用 1px solid `accent` hairline 標示;右邊界由既有 selectedIndex 金色直條兼任(不另畫)
- **C3** K 線頂部 padding 區出現「過去 N 日」chip(`bg-bg/90 border border-line-strong text-ink-muted`),只在 K 線一次,subchart 不重複
- **C4** windowDays = 1 時 → band / hairline / chip 全部不渲染(降級為純 selectedIndex)
- **C5** 舊 ChipBrokersPanel 左緣 `border-l-2 border-accent/60` 與 `data-testid="panel-window-frame"` 全部**移除**;window-header bar 背景一律回到 `bg-bg-deep/40`(windowDays=1 還是「當日」、>1 仍「過去 N 日加總」這個文案不變)
- **C6** RangeSelector spinbutton `<span>` 改為 `<input type="number" min="1" max="60" step="1" inputMode="numeric">`,寬 w-14、高 h-8、與 DateField 同 style
- **C7** Input 行為:
  - 鍵盤 ↑↓ 由瀏覽器原生提供 ±1(input type=number 內建)
  - 鍵盤 Home / End / ←→ 由元件**顯式加 onKeyDown** 提供 1 / 60 / ±1(native input 不接 Home/End/←→)
  - blur / Enter 才 commit 到父層 `onChange`;typing 過程只更新 local string state、不打 API(無 setTimeout debounce,純 commit-on-blur 模型)
  - blur 時 value 自動 clamp 到 [1, 60](70 → 60,0 → 1,非整數 → round)
  - input value == 某 preset 時,該 preset chip 自動 active(`aria-pressed=true`)
- **C8** 既有 RangeSelector 互動全保:preset click、**外層 group wheel ±1**(統一,不分 target;Shift+wheel 維持 ±1 — v0.16.0 既有實作沒有 Shift ±10,**不在此 mod 新增**)、Home/End、5 個 preset chip
- **C11** Input value 外部同步:當父層 `value` 變動(例如 preset chip click 或 RangeSelector 外的 setter)→ 若 input **非 focused** 才 sync localStr,避免 user typing 中被 clobber
- **C9** baseline 354 + 新測 ≥ 6 / tsc / build 全綠
- **C10** Console 0 error/warn

---

## 3. 不能破壞的既有行為白名單

| ID | 行為 | 驗證方式 |
|---|---|---|
| W1 | App.tsx wiring(stepper / DateField snap / DEFAULT=1)行為不變 | 既有 App 真實環境 + 既有 stepper 測試 |
| W2 | OptionsHeader DateField 行為不變(snapToDates / onValueChange 未傳) | 既有 OptionsHeader 測試 |
| W3 | RangeSelector preset click 行為(value 100% match preset 時 active)不變 | 既有 RangeSelector preset 測試 |
| W4 | RangeSelector wheel ±1 / Shift+wheel ±10 / Home/End 不變 | 既有 RangeSelector wheel 測試 |
| W5 | RangeSelector 對外接口 `{ value, onChange, disabled }` 不變 | App.tsx caller 不需改動 |
| W6 | ChipBrokersPanel windowDays=1 顯「當日」/ >1 顯「過去 N 日加總」文案不變 | 既有 ChipBrokersPanel.test 中對應條 |
| W7 | useChipBrokersWindow 行為不變(API 契約零改) | hook 測試保留 |
| W8 | K 線既有功能(zoom / pan / hover crosshair / BB / MA / selectedIndex / loading badge)全保 | 既有 ChipKlineChart 真實環境 |
| W9 | Subchart 既有 X 軸對齊不變 | 既有 subchart svg 測試 |

---

## 4. 涉及檔案 + 三類動作分類

### 🔴 行為改動(會讓對應既有測試紅)

| 檔案 | 改動 | 預期紅 |
|---|---|---|
| `frontend/src/components/ChipBrokersPanel.tsx` | 移除 `isMultiDay` 計算 + `border-l-2 border-accent/60` className + `data-testid="panel-window-frame"`;window-header bar 一律 `bg-bg-deep/40`(不再 isMultiDay 切換) | `ChipBrokersPanel.test.tsx` 中「multi-day region framing」describe 三條(2026-06-29 v1 加的)會紅 → **刪除這個 describe**(行為已 deprecate,測試應隨之刪) |
| `frontend/src/components/ui/RangeSelector.tsx` | 把 spinbutton `<span>` 替換為 `<input type=number>` + 加 debounce + blur clamp;wheel listener 改 attach 在 input 而非 group | 若既有測試斷言「spinbutton」role 存在會紅 → **改 assertion 為 input** + 改 spinbutton role 測試為 input |

### 🟢 新功能(新測試)

| 檔案 | 新增 |
|---|---|
| `frontend/src/lib/chip-kline-svg.tsx` | 加 `rangeBand?: { startIdx: number; endIdx: number } \| null` prop,在 grid 之後 / volume bar 之前(L327~330)插入 `<rect>` band 與左邊界 `<line>` hairline + 頂部 `<g>` chip |
| `frontend/src/lib/chip-inst-bar-svg.tsx` | InstBarSvg 與 MarginLineSvg 兩個元件各加 `rangeBand` prop + 渲染 band(無 chip)|
| `frontend/src/lib/chip-broker-agg-svg.tsx` | 加 `rangeBand` prop + 渲染 band |
| `frontend/src/components/ChipKlineChart.tsx` | 接受新 prop `windowDays?: number`;計算 `rangeBand = windowDays > 1 ? { startIdx: max(0, selectedIndex - windowDays + 1), endIdx: selectedIndex } : null`;當 selectedIndex == null(冷啟動)`rangeBand = null` |
| `frontend/src/App.tsx` | 給 `<ChipKlineChart>` 傳 `windowDays={windowDays}` |
| `frontend/src/lib/chip-svg.test.ts`(或新檔) | 純函式測 `computeRangeBand(selectedIndex, windowDays, candleCount)`,涵蓋:正常 / windowDays=1 / 起點不足 N / selectedIndex=null |
| 各 svg 元件測試(若已存在的話)| 加 「rangeBand=undefined 不渲染 rect」與「rangeBand=...渲染 rect 且 X 對齊」測試 |
| `frontend/src/components/ui/RangeSelector.test.tsx` | 加新測試:input typing + blur clamp + debounce + Enter commit + input value == preset 時 chip auto-active |

### 🔵 純重構

無 — 此次沒做純結構改寫。

---

## 5. 設計細節(實作參考,不綁死)

### K 線 range highlight

- **xScale 共用:** `KLINE_PAD_L`、`KLINE_PAD_R` 在 `chip-kline-svg.tsx` 已 export(檔頭常數區),所有 subchart import 用同樣公式
  - `slotW = (width - PAD_L - PAD_R) / candles.length`
  - `bandX = PAD_L + slotW * startIdx`(start candle 的 left edge)
  - `bandWidth = slotW * (endIdx - startIdx + 1)`
- **Band fill / hairline 視覺 token:**
  - fill = accent (`#f0b429`)、fillOpacity 0.07(§11 接受 0.06-0.10 微調)
  - 左邊界 stroke = accent、strokeOpacity 0.45(§11 接受 0.40-0.55)
  - subchart band y = 該 svg 全高(從 0 到 height,因為 subchart 沒 padT/padB 概念類似 K 線),涵蓋整條 bar 區
  - **K 線**內 band y = `padT` height = `chartH`(只 price plot 區;不含 volume sub-area,避免跟成交量 bar 衝突 — 實作可微調)
- **「過去 N 日」chip 渲染位置(避開 K 線既有 OHLCV / MA-BB legend + 避免與 zoom-hud overlap):**
  - **不放 K 線 svg 內**(svg 內 padT 區已塞 OHLCV header 與 MA/BB legend,左半已滿)
  - **不 band-anchored**(band 在右邊 + windowDays 小時 chip.left 會撞 zoom-hud@right-2 z-30 → 視覺被遮);chip 是「panel 級資訊」(告訴 user 現在 windowDays 是多少),不需精確錨定 band 起點 — band 左邊界 hairline 已負責「起點視覺」
  - 改放在 **ChipKlineChart.tsx** 層 absolute position **固定 top-left**:`<div className="absolute z-20 pointer-events-none" style={{ top: 8, left: 8 }}>過去 {N} 日</div>`
  - 樣式對齊 `kline-zoom-hud`(11-12px / px-2 py-0.5 / `bg-bg-deep/80 border border-line text-ink-dim`)
  - z-20 < zoom-hud (z-30) / loading-badge (z-30) — top-left 與 zoom-hud(top-right)/ loading-badge(top-center)空間互斥,不會 overlap
- **Render order(語意,不綁行號):** grid → **band fill + 左邊界 hairline** 插這(在 volume 之前)→ volume separator → volume bars → candles → BB → MA → ... → selectedIndex(原本就在最上層,自然覆蓋 band 右側,兼任右邊界)
- **windowDays=1:** ChipKlineChart 直接傳 `rangeBand={null}`,所有 svg 條件渲染 `{rangeBand && <rect ... />}` 為 null 時 no-op;chip overlay 也不渲染
- **selectedIndex 兼任右邊界:** 既有 selectedIndex 邏輯不動

### RangeSelector Pattern A

- **JSX 結構:**
  ```
  <div role="group" aria-label="N 日加總視窗">
    {presets.map(n => <button aria-pressed={value === n} onClick={() => onChange(n)}>...</button>)}
    <input
      type="number" min={1} max={60} step={1} inputMode="numeric"
      value={localStr}
      onChange={e => setLocalStr(e.target.value)}
      onBlur={commitWithClamp}
      onKeyDown={handleInputKeyDown}  // Home/End/←/→/Enter
      aria-label="自訂 N 日"
      className="w-14 h-8 ..."
    />
  </div>
  ```
- **commit-on-blur 模型:** 內部 `localStr` state,typing 過程即時更新 localStr 讓 user 看到輸入(input value=localStr),只在 blur / Enter 時 parseInt + clamp + call 父層 `onChange(clamped)`。**無 setTimeout debounce**,不會丟 keystroke,API 只在 commit 觸發
- **顯式 keyboard handler(input native 不支援 Home/End/←→):**
  - Enter → commitWithClamp(blur 也一樣)
  - Home → setLocalStr("1") + commit
  - End → setLocalStr("60") + commit
  - ArrowLeft → 視為 Backspace 不攔截(browser 預設游標移動)
  - ArrowRight → 同上不攔截
  - ArrowUp/Down → **不**攔截,讓 browser native ±1 處理(自然 fire onChange,localStr 立即更新)
  - 註:既有 RangeSelector 的 spinbutton 上 ← = -1 / → = +1,但這是因為 spinbutton 沒游標;number input 有游標,←→ 是游標移動,**這是合理的行為變化**(語意一致 with 一般 input),寫進 spec 而非破壞性更動
- **Wheel handler:** 仍 attach 在外層 group(沿用既有 listener)、**不**依 target 區分,wheel ±1 統一 call `onChange(clamp(value ± 1))`。input 上 wheel 也走這個路徑(不依賴 browser native step 的 cross-browser 不穩行為)
- **input value == preset:** active 判斷不變(`active = n === value`),preset chip click 觸發父層 onChange → 父層 setValue → useEffect 同步 localStr(僅在 input 非 focus 時),確保 input 顯示與 chip active 同步
- **a11y:** 既有 `role=spinbutton` `<span>` 整段移除(改成 input,native role 已是 spinbutton);維持外層 group + aria-pressed on chips
- **localStr 外部同步:** `useEffect(() => { if (!inputRef.current?.matches(":focus")) setLocalStr(String(value)); }, [value])`

---

## 6. Backward compat

- **RangeSelector 對外 props:** `{ value: WindowDays; onChange: (v: WindowDays) => void; disabled?: boolean }` 不變 — App.tsx caller 零改動
- **localStorage `chip_window_days`:** 不 bump 版本、不 schema 改;既有 user 值仍正確讀回
- **K 線 SVG prop additions:** 全為 optional + default `undefined`;若有第三方/測試直接 render Svg 元件不傳 rangeBand,行為與目前 100% 一致
- **No API 改動**

---

## 7. Migration

- 既有 user localStorage `chip_window_days=30` 用戶:**保留**(不強制 reset)
- v0.16.0 ChipBrokersPanel 的 panel-window-frame 視覺消失 → 改在 K 線上看到 highlight(替代體驗,不破壞功能)
- **Migration 可逆性:** revert v0.17.0 commits 即還原。K 線 svg 加的 optional prop 不影響既有 caller

---

## 8. Out of scope(寫進 next-time)

- ❌ K 線 highlight 帶動畫淡入/淡出(每次 windowDays 變動會 flash,YAGNI)
- ❌ RangeSelector 加 popover/slider(Pattern A 已夠;若日後 user 反饋還是麻煩再加 popover)
- ❌ K 線 highlight 對 Options 模式(Options 不用 windowDays)
- ❌ K 線頂部 chip 加 close button / interactive(純標示)

---

## 9. 實作順序(三類分開 commit)

**Commit 1(🔴 行為改動 — panel-frame deprecation)**
- `ChipBrokersPanel.tsx`: 移除 isMultiDay 計算、border-l、data-testid、bar 加深
- `ChipBrokersPanel.test.tsx`: 刪除 multi-day region framing describe(3 條)

**Commit 2(🟢 純新增 — K 線 range highlight)**
- `chip-kline-svg.tsx` / `chip-inst-bar-svg.tsx` / `chip-broker-agg-svg.tsx`: 加 rangeBand prop + render <rect> + hairline + (K 線) chip
- `ChipKlineChart.tsx`: 計算 rangeBand + 傳給 4 svg
- `App.tsx`: 傳 windowDays 給 ChipKlineChart
- 新測試:純函式 computeRangeBand + 4 svg rangeBand prop 行為

**Commit 3(🟢 純新增 — RangeSelector Pattern A)**
- `RangeSelector.tsx`: spinbutton span → input type=number + debounce + blur clamp
- `RangeSelector.test.tsx`: 新測 input behavior;改既有 spinbutton role 測試

**Commit 4(chore)**
- changelog 0.17.0 entry + DevTools MCP 真實環境驗證截圖

---

## 10. 風險點 + 決策

- **R1** Band 在 panning / zoom 時邊界對齊問題:`xScale` 依 `candles.length` 動態計算,zoom 改變 `visibleDays` → candles 數變 → slotW 變。`startIdx / endIdx` 必須基於**當前 derived.candles**(已 sliced),不能用 fullDerived index。決策:`ChipKlineChart` 內計算 rangeBand 時用 `derived.candles` 找 selectedDate 的 index(同 selectedIndex 邏輯)
- **R2** selectedDate 不在當前 derived.candles 內(滾出視窗)→ selectedIndex=null → rangeBand=null,所有 svg 不渲染。決策:這是預期行為,不算 bug;user 滾回 selectedDate 在範圍內,band 重新出現
- **R3** windowDays > selectedIndex + 1(eg windowDays=30 但 selectedIndex=5 = 只剩 6 根 candle 在前)→ clamp `startIdx = max(0, selectedIndex - windowDays + 1)` = 0,band 從左邊起始。決策:不顯示 chip 上的 N(避免 user 誤以為「實際 6 日」變成「30 日」)— 仍顯示「過去 N 日」字樣,但 actual coverage 可能 < N(這跟 backend 的 actualDays<windowDays 一致)
- **R4(updated)** Input typing 過程 + wheel listener 衝突:wheel 在 input 上會被 browser 視為 native step,可能撞我們的 wheel ±1。決策(對齊 §5):**wheel listener attach 外層 group、不依 target 區分**,wheel ±1 統一 call `onChange(clamp(value ± 1))`,**不**依賴 browser native step(Firefox 不接、Safari 不穩)。input 內 wheel 仍走這 group listener(preventDefault 擋頁面 scroll、自家 ±1)
- **R5** Native input number 在 Firefox/Safari 字寬會跳:用 `tabular-nums` className + fixed w-14 控
- **R6** Input controlled `value` 與 `localStr` 同步:外部 prop value 變(例如 preset click)→ useEffect 同步 localStr
- **R7** ~~debounce timer 在 unmount 時~~:已採 commit-on-blur 模型,**無 setTimeout 需 cleanup**(R7 過時,留作 history)
- **R8(NEW)** selectedDate 滾出 K 線視窗 → rangeBand=null → band 消失 + chip 消失,但 ChipBrokersPanel 仍顯「過去 N 日加總」(其資料 keyed on App.tsx 的 `date` state,跟 K 線 zoom 解耦)。決策:**接受此視覺不一致**(scope 紀律,user 主動 pan 走是 user 行為);**不**為此加 affordance(toast / panel side indicator)。Phase 7 驗證時觀察 user 是否真會撞到
- **R9(NEW)** windowDays > selectedIndex + 1(冷啟動 / 上市未滿):startIdx clamp 到 0。K 線 chip **一律顯示 user 選的 windowDays N**(例「過去 30 日」),不顯示 actualDays;band 寬度自然反映實際 candle 數(start 從第 1 根 candle 起)。理由:K 線 chip 是「user intent」,actualDays 是「資料現實」屬於 ChipBrokersPanel 的職責(panel header 已有「(實際 X 日)」提示)。兩個 component 各司其職,不重複資訊
- **R10(NEW)** K 線頂部 chip 與 OHLCV info row / MA-BB legend overlap:chip 不放 svg 內 padT 區,改放 ChipKlineChart absolute pos(svg 之上 z-20),避開既有 OHLCV (`y=padT-6=34`) 與 MA legend (`y=padT+14=54`) 區
- **R11(NEW)** RangeSelector input 在父層 value 變動時 sync 防 clobber:useEffect 內檢查 `document.activeElement !== inputRef.current`(或 `.matches(":focus")`),user typing 中不覆寫 localStr

---

## 11. 設計留白(實作可微調)

- band 的 fill 透明度 `0.06 ~ 0.10` 範圍內自由(實作目視確認對 BB/MA 干擾最小)
- 左邊界 hairline 透明度 `0.40 ~ 0.55` 範圍內自由
- 「過去 N 日」chip 字級 / padding 與既有 `kline-zoom-hud` 樣式對齊(11-12px,px-2 py-0.5)
- Wheel handler 統一 attach 外層 group、不依 target 切;cross-browser native step 不可靠故不依賴
- K 線 chip top/left 與 K 線 div 內側 padding 自由(只要不撞 OHLCV / zoom-hud / loading-badge)
- BrokerAggBarSvg 是否吃 rangeBand:**可**(視覺一致)。實作若覺得多餘可省;若省 → spec C1 「所有 subchart」改為「K 線 + 法人/融資融券 subchart(broker 列除外)」
