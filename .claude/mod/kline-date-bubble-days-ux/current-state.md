# current-state — mod/kline-date-bubble-days-ux(2026-08-19)

## 範圍(user 四點,均在 equity mode)

1. 籌碼總覽 K 線圖加日期
2. 泡泡圖「連續天數」selector 左側加提示
3. 泡泡圖切天數時工具列按鈕跑版 / 消失
4. 多日泡泡圖標示每一天的開盤 / 收盤

## Caller map(grep,含動態用法)

| 目標 | 檔 | caller | 備註 |
|---|---|---|---|
| `KlineChartSvg`(`lib/chip-kline-svg.tsx`) | 587 行 | `components/ChipKlineChart.tsx`(唯一元件 caller)、`lib/chip-svg-render.test.tsx`(直接 render) | `KLINE_PAD_L=12 / KLINE_PAD_R=58` import 端 = `chip-inst-bar-svg`(InstBar / MarginLine)/ `chip-broker-agg-svg` / `ChipKlineChart.handleStackMouseMove`(hoverIndex 反算)— x 幾何一律 `padL + slotW*i + slotW/2`,日期軸必逐字對齊(review R12 修正) |
| `ChipKlineChart` | 629 行 | `App.tsx:494`(唯一);`App.test.tsx` mock 掉 | 疊圖:2px 掃描條 + K 線 svg(3.5 份)+ 6 子圖(各 1 份),`totalParts = 9.5`,無 x 軸列。HUD 自 2026-07-21 CH-3b **刻意刪日期**(sel-cursor 金色 chip 仍顯選中日) |
| `ChipBubbleView` | 1303 行 | `App.tsx:567`(lazy);`App.test.tsx` mock | header 三欄 grid(搜尋 360px / 中欄 chips+統計行 / 右工具欄);`BubbleDaysSelector` 掛統計行 `ml-auto`(1/2/3/4/5/10/20 純數字,無標籤);右工具欄 `截圖` / `輸入區間` / mobile `明細` 三鈕 **`bubbleData &&` 條件渲染** |
| `BubbleChartSvg`(`lib/chip-bubble-svg.tsx`) | 1014 行 | `ChipBubbleView`、`lib/chip-bubble-svg.test.tsx`、`bubble-screenshot`(抓 svg DOM 轉 PNG) | Y = price scale(`yLow/yHigh` 由 trades 算 + 8% pad);背景層順序 grid → volume profile → intraday line(days=1 才有)→ close 虛線 → bubbles;`days` prop 只影響空狀態文案 |
| `useChipBubble` | hook | `App.tsx` | days>1 → `/bubble_window`,payload 含 `trading_dates[]` / `window_days` / `actual_days`;hook 只暴露 `windowMeta {windowDays, actualDays}`,**trading_dates 未暴露** |
| `history.candles`(`useChipData`) | App | K 線 + `closePrice` | 每根 `{date, open, high, low, close, volume}` ~360 日;多日泡泡圖每日開收可直接由此對 `trading_dates` 取,不需後端改動 |

## 現況 vs 目標

| # | 現況 | 目標 | 對外契約 / caller 影響 | backward compat |
|---|---|---|---|---|
| 1 | K 線疊圖無日期軸;僅 sel-cursor 顯選中日期、HUD 無日期(CH-3b) | 疊圖底部新增日期軸列(稀疏刻度 M/D + hover 日期 chip),HUD 維持無日期(白名單) | 子圖高度 = (totalH − gap − klineH − axisH)/6,幾何微縮;無 props 變更 | 純新增,無 migration |
| 2 | days selector 純數字鈕 | 左側加「連續天數」標籤 + title 提示 | 無 | 無 |
| 3 | 切天數 → data 變 null → 截圖 / 輸入區間 / 明細鈕卸載 → 右工具欄左縮;資料回來再長回 | 三鈕常駐,無資料時 `disabled`(視覺 opacity-50);圖區照常 loading badge | 既有 vitest「bubbleData null → 不渲染截圖鈕」該紅 → 改為「渲染但 disabled」 | 無 |
| 4 | days>1 圖上只有 close 虛線 + 累計 badge | 每日一欄(X 均分 N 槽):開→收迷你 K 身(紅漲 / 綠跌 / 平 ink-dim)+ 日期 + 「開 X」「收 Y」標籤 | `useChipBubble.windowMeta` 加 `tradingDates`(additive);`ChipBubbleView` / `BubbleChartSvg` 新增 optional `dayMarks?: { dates: string[]; candles: DailyCandle[] } | null` prop | 不傳 = 現行為(days=1 完全不動) |

## 既有測試盤點(會碰到的)

- `ChipBubbleView.test.tsx`:L2080「bubbleData null → 不渲染截圖鈕」(該紅);L544「header 有輸入區間 trigger」(不該紅);L1844-1852 days selector(不該紅;新增標籤斷言)
- `chip-bubble-svg.test.tsx`:intraday overlay 節(不該紅);新增 day-marks 節
- `ChipKlineChart.test.tsx` / `chip-svg-render.test.tsx`:zoom / HUD / crosshair(不該紅);新增日期軸節
- `useChipBubble.test.ts`:windowMeta 形狀(additive,不該紅;補 tradingDates 斷言)
- e2e:`equity.spec.ts` E# K 線斷言、visual V1(baseline 需重生:日期軸列)
