# change-spec — mod/kline-date-bubble-days-ux(2026-08-19)

分流判定:**已成形方案**(user 指名了 UI 形式:K 線加日期 / selector 左側提示 / 按鈕固定 /
每日開收標示)→ grilling 姿態逐題自答,無方向性抉擇(SC 集合 / 對外契約不因候選互換而改寫)
→ 全部 `[auto-default]` 推進(auto.md 替代條件)。frontend-design / bencium 兩 skill 已載入,
設計決策依 bencium「先問」契約在本檔以候選 + 取捨列出,不停等。

規模:L(≥5 檔:App / ChipKlineChart / chip-kline-svg 或新 date-axis / ChipBubbleView /
chip-bubble-svg / useChipBubble),無對外 API / migration / 風險面 → 輪數同 M(spec review 1 輪
+ P0 限縮加輪 1 次);實作 dispatch opus。

## 1. 成功條件(畫面可指認)

| SC | 表述 | 驗證方式 |
|---|---|---|
| SC-1 K 線日期軸 | 籌碼總覽 K 線疊圖**最底部**多一列日期軸(高 18px):稀疏刻度 `M/D`(ink-dim,約每 70px 一個,對齊 candle 中心,不加年 — R1),hover 任一根時該列在 hover x 顯示 `YYYY-MM-DD` 深底 chip;HUD 仍無日期(白名單 W1)。疊圖高度顯式配平:`availH = totalH − LOADING_BAR_H(2) − gap − DATE_AXIS_H(18)`,`klineH = round(availH·3.5/9.5)`、`subH = floor((availH − klineH)/6)`、`lastSubH = availH − klineH − subH·5`(順帶修正既有 2px 掃描條未入帳的溢出)`[amendment 2026-08-19: review R1]`。 | vitest `ChipKlineChart.test.tsx` 新 describe(mock useContainerSize 給定 height,斷言 `LOADING_BAR_H + klineH + gap + subH·5 + lastSubH + DATE_AXIS_H === 容器高`(讀各 row 的 style.height);`kline-date-axis` 存在、tick 數 > 0、hover 後 `kline-date-axis-hover` 文字 = 該 candle date);e2e equity E46(軸可見 + tick 含 fixture 月日);截圖 `evidence/SC-1-*.png` |
| SC-2 天數標籤 | 泡泡圖統計行右端 selector **左側**出現文字「連續天數」(text-xs ink-dim),整組 `title` = `累計最近 ${days} 個交易日的分點成交(1 = 僅當日)`(動態模板,無佔位符 `[amendment 2026-08-19: R11]`),群組 `aria-label` 維持「泡泡圖天數視窗」。 | vitest:`getByText("連續天數")` 在 `bubble-days-selector` 同一容器、title 內容含當前 days、`getByRole("group",{name:"泡泡圖天數視窗"})` 仍在;e2e E38 追加:選 2 分點後「連續天數」標籤 bbox.height < 24(未逐字直排)且不在 `bubble-days-selector` 下方(wrapper flex-wrap,同行或正上方 `[amendment: review F10]`)`[amendment: Phase 6 — 原「stats row 單行」斷言在 1280+sidebar 的既有窄中欄下本就不成立,改鎖本次可控項]`;截圖 `evidence/SC-2-*.png` |
| SC-3 工具列不跑版 | 點任一天數後:**App 頂欄「重新整理」鈕寬度不變(spinner 插槽常駐,載入時才填 svg)、tabs 列 y 不變 `[amendment: Phase 6 real-env finding]`**;右工具欄 `截圖` / `輸入區間` /(mobile)`明細` 三鈕**位置與寬度不變**,無資料時 `disabled` + `opacity-50`;過濾清單鈕 / `?` 鈕位置不動;圖區顯 loading badge。 | vitest:`bubbleData=null` 時三鈕存在且 `disabled`;有資料時 enabled;守門責任在 vitest(App.test:refresh 鈕內 `refresh-spinner-slot` 常駐;ChipBubbleView.test:標籤 `whitespace-nowrap`);e2e E43 以 `page.route('**/bubble_window*', 延遲 800ms 再 continue)` 在載入期取樣:點 5 日後立即斷言 `bubble-screenshot` attached + `toBeDisabled()` + bbox.x 與切換前相等,badge 出現後再斷言 enabled `[amendment 2026-08-19: R3]`;截圖 before/after `evidence/SC-3-*.png` |
| SC-4 每日開收標示 | days>1 且資料已回:圖區背景依 `trading_dates`(槽位定義,N = trading_dates.length)由左至右均分 N 欄 `[amendment 2026-08-19: R2 — prop 帶 dates + candles 兩者]`,每欄:**底部**日期 `M/D`(y = height − PADDING.bottom − 4,避開左上 window badge / brush hint / PNG annotation `[amendment: R6]`);開→收迷你 K 身(收>開 bull 紅、收<開 bear 綠、相等 ink-dim,opacity 0.6,寬 ≤ 10px);欄寬 ≥ 96px 時「開 X」貼在開盤 y 左側、「收 Y」貼在收盤 y 右側;50–96px 時兩標籤改堆疊在底部日期上方;<50px 只畫 K 身 + 日期(每 k 欄一個,k=ceil(50/slotW))。缺 candle 的欄留空、開或收越界(yLow..yHigh 外)的欄只畫日期,不畫 K 身**與價格標籤**,該欄 `<g data-date data-oob="true">`(對齊 volume profile 跳過慣例 `[amendment: R9/R15]`)。days=1 完全不畫(W2)。 | K 身 / 顏色 / 標籤分級 / 越界的鑑別責任在 vitest `chip-bubble-daymarks-svg.test.tsx` + `chip-bubble-svg.test.tsx`(`data-testid="bubble-day-marks"` 內 N 個 `[data-date]` group、5 日僅 4 日有 candle → 仍 5 欄且其餘欄 x 不變、越界 → 無 K 身無價格標籤只有日期且 `data-oob=true`、顏色對應、標籤分級三態、bubble 像素位置不變);e2e fixture(trades 單一價位 1100、candle close 1105)下五欄**必為越界**,E43 只鎖「5 欄 + 5 欄 `data-oob=true` + 日期文字」把 fixture 事實釘死 `[amendment 2026-08-19: R13]`;視覺 evidence 一律真實環境 devtools 截圖(evidence/SC-4-*.png,含一張多日截圖 PNG 實檔);e2e E43 加斷言 `bubble-day-marks [data-date]` 5 個;截圖 `evidence/SC-4-*.png` |

## 2. 不能破壞的既有行為白名單

- **W1** K 線 HUD 無日期(CH-3b)、sel-cursor 金色 chip 顯選中日;K 線 + 6 子圖 hover / click / zoom / pan / 窗聚合 HUD 行為與測試全數不變。**子圖幾何改變 = 預期**(🔴 高度重配平,visual V1 / V4 baseline 重生)`[amendment: R5]`;anti-CLS(B3/C4:選 / 未選分點子圖高度一致)仍成立。
- **W2** days=1 泡泡圖:字串 bit-for-bit(「今日共」/「今日無顯著成交量」)、intraday 線、close 虛線、bubble 像素位置不變;`dayMarks` 未傳 / null(含 history 為 null)= 現行為 `[amendment: R14/R18]`。
- **W3** `BubbleDaysSelector` aria-label「泡泡圖設為 N 日」/ testid `bubble-days-selector` / preset 1,2,3,4,5,10,20 不變(e2e E43/E45 依賴)。
- **W4** 截圖 / 輸入區間 / 明細 鈕在**有資料**時行為與 testid 不變;截圖 PNG 檔名 / annotation 邏輯不變(E44/E45)。
- **W5** `useChipBubble` 既有 `windowMeta.windowDays / actualDays` 值不變(additive 加 `tradingDates`)。
- **W6** 泡泡圖 header 三欄 grid 尺寸(360px / minmax / auto)不變 — R15 fallback 事故(1280px 壓中欄)不得重演:標籤放 selector 同一 inline-flex,寬度只加 ~56px 於統計行 `ml-auto` 區;可證斷言 = SC-2 的 E38 追加(1280 寬選 2 分點後 selector 與 stats row 同一行)`[amendment: R7]`。
- **W7** 泡泡圖 loading badge / 累計 badge / 聚焦無成交 badge 行為不變。
- **W8** days>1 下 window badge / brush hint / 截圖 PNG annotation 三處文字仍完整可讀(day marks 日期標籤置底不與其重疊)`[amendment: R6]`;證據 = evidence/SC-4 截圖 + 一張多日截圖 PNG 實檔。
- **W9** E39 / E42 / E43 / E44 / E45(依賴圖區幾何 / 截圖管線)不該紅。

## 3. Backward compat / migration

無 API / 資料格式 / localStorage 變更;props 全 optional additive。無 migration。

## 4. Out of scope

- HUD 重新加回日期(CH-3b 拍板保留)。
- 多日泡泡圖每日**成交量 / 高低**標示(只做開 / 收;高低留 next-time)。
- 天數 selector 改成下拉或自由輸入。
- ~~App 頂欄「重新整理」spinner 出現造成的 1-2px 寬度變化(全站既有,非本次「跑版」主因)~~ `[amendment 2026-08-19: Phase 6 real-env finding — 撤回]`:e2e E43 載入期取樣實測 `bubble-screenshot` **y 位移 42px**,root cause = 頂欄 `重新整理` 鈕載入時多出 spinner 變寬 → flex-wrap 整顆鈕掉到第二行 → tabs 與整個泡泡圖下移;這正是 user 看到的「整個頁面按鈕重新排列」。納入 SC-3(包 F 🔴):spinner 插槽常駐固定寬(`size-3.5` span 內條件放 svg),鈕寬載入前後不變。

## 5. 設計決策(bencium 候選 + 取捨;全部 `[auto-default]`)

- **R1 日期軸位置**:(a) 疊圖最底部獨立 18px 列(全部子圖共用一條時間軸,交易員慣例)/(b) 塞進 K 線 svg 底部 padB(子圖與軸分離,量能軸下方)/(c) 每子圖各畫。`[auto-default: (a) | reason: 一條軸對齊全疊圖,不重複;子圖高度僅各縮 ~3px]`。刻度格式 `M/D`(不加年:視窗 30–360 日,年份由 hover chip 補足)。
- **R2 hover 日期呈現**:(a) 軸列上 chip 跟隨 hover x /(b) 回加 HUD(違 W1)。`[auto-default: (a)]`。
- **R3 標籤文字**:「連續天數」(user 原話)vs「累計天數」。`[auto-default: 連續天數 | reason: 對齊 user 用語;title 補「累計最近 N 個交易日」語意]`。
- **R4 按鈕固定手法**:(a) 常駐 + disabled /(b) `visibility:hidden` 佔位 /(c) query `keepPreviousData` 保留舊資料。`[auto-default: (a) | reason: 與全站 RangeSelector / 重新整理 disabled 慣例一致,可讀性優於隱形佔位;(c) 會讓舊天數泡泡短暫冒充新天數,user 明說圖區可以正常 loading]`。
- **R5 每日開收圖形**:(a) 每日一欄迷你 K 身 + 貼位標籤 /(b) 全寬水平虛線每日 2 條(20 日 = 40 條,雜)/(c) 只在右價軸打刻度。`[auto-default: (a) | reason: 與 days=1 的分時線同一「X 軸 = 時間、Y 共用價格」語法,一眼可讀且不淹沒泡泡]`;色彩沿台股紅漲綠跌(K 線同源),opacity 0.6 維持背景層;文字 0.6875rem inkDim(日期)/ inkMuted(價格),`pointerEvents="none"`。
- **R6 每日資料來源**:(a) 前端由 `history.candles` ∩ `trading_dates` /(b) 後端 `/bubble_window` 加 per-day OHLC。`[auto-default: (a) | reason: 資料已在前端,零後端改動與零配額]`。

## 6. Diff 級章節(逐檔;commit 順序 🔴 → 🟢,無 🔵)`[amendment 2026-08-19: R5/R10 重排]`

| 包 | 檔 | 類別 | 動什麼 |
|---|---|---|---|
| A | `components/ChipBubbleView.tsx` | 🔴 | 右工具欄 `截圖` / `輸入區間` / mobile `明細` 三鈕改常駐 + `disabled={!bubbleData}` + `disabled:opacity-50 disabled:cursor-default`(先改 L2080 測試紅 → 實作綠) |
| B | `components/ChipKlineChart.tsx` | 🔴 | 疊圖高度顯式配平:`LOADING_BAR_H=2` / `DATE_AXIS_H=18` 常數,`availH` 三式(SC-1),底部先預留空的 axis 列容器(`data-testid="kline-date-axis-row"`, height 18);5 個子圖 row 加 `data-testid="kline-sub-row"`(broker row 維持 `chip-broker-row`);紅測試 = 由 kline svg 容器 / kline-sub-row×5 / chip-broker-row / kline-date-axis-row 讀 style.height 求和 + `LOADING_BAR_H` 常數(掃描條 className 含 `h-0.5` 另斷言)+ gap === 容器高 `[amendment: R19]` |
| C | `components/ChipBubbleView.tsx` | 🟢 | `BubbleDaysSelector` 外包 `inline-flex items-center gap-1.5`,左加 `<span className="text-xs text-ink-dim">連續天數</span>`,整組動態 `title` |
| D | `lib/chip-kline-svg.tsx` | 🟢 | 純函式 `pickDateTicks(n, slotW, minGapPx=70): number[]`:`step = max(1, ceil(minGap/slotW))`,取 0, step, 2step…;永遠含 0 與 n−1;若 n−1 與前一 tick 距離 < minGap 則刪掉前一個(n=1 → [0])`[amendment: R17]` + `formatTickDate("YYYY-MM-DD") → "M/D"`(去前導零);`DateAxisSvg({dates, width, height, hoverIndex})` memo 元件(**`slotW = (width − KLINE_PAD_L − KLINE_PAD_R) / dates.length`**,x = KLINE_PAD_L + slotW·i + slotW/2,與 `handleStackMouseMove` 逐字同式 `[amendment: R16]`;vitest 加座標級斷言:給定 width/n 第 i 個 tick 的 x 屬性 = 上式;tick 0.6875rem CHIP.inkDim;hover chip rect `rgba(15,12,8,0.85)` + text CHIP.ink;testid `kline-date-axis` / `kline-date-axis-tick` / `kline-date-axis-hover`) |
| D | `components/ChipKlineChart.tsx` | 🟢 | axis 列容器內 render `DateAxisSvg`(dates = derived.candles.map(date),hoverIndex 直傳) |
| E | `hooks/useChipBubble.ts` | 🟢 | `windowMeta` 加 `tradingDates: string[]`(additive) |
| E | `App.tsx` | 🟢 | `bubbleDayMarks = useMemo(() => (windowMeta && history ? { dates: windowMeta.tradingDates, candles: history.candles.filter(c => dateSet.has(c.date)) } : null), [windowMeta, history])`(history null → null,退回現行為)`[amendment: R18]`;傳 `dayMarks` 給 ChipBubbleView |
| E | `lib/chip-bubble-daymarks-svg.tsx`(新) | 🟢 | 純函式 `layoutDayMarks({dates, candles, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight, bottomY}) → DayMarkSlot[]`(slotW = cW/dates.length、i = dates.indexOf、缺 candle 空欄、越界不畫 K 身、標籤分級三態)+ `DayMarksLayer` memo 元件(`data-testid="bubble-day-marks"`,每欄 `<g data-date>`,`pointerEvents="none"`) |
| E | `lib/chip-bubble-svg.tsx` | 🟢 | `BubbleChartProps.dayMarks?: { dates: string[]; candles: DailyCandle[] } | null`;插在 volume profile 之後、close 虛線之前;`days<=1` 或 null 不畫 |
| E | `components/ChipBubbleView.tsx` | 🟢 | 透傳 `dayMarks` 給 BubbleChartSvg |
| F | `App.tsx` / `components/ChipBubbleView.tsx` | 🔴 | `[amendment: Phase 6 real-env finding]` 頂欄 refresh 鈕 spinner 插槽常駐(`<span data-testid="refresh-spinner-slot" className="inline-flex size-3.5 shrink-0">{isLoading && <svg…/>}</span>`,既有 `refresh-spinner` testid 語意不變);「連續天數」span 加 `whitespace-nowrap`、wrapper `shrink-0`(1280 + sidebar 下中欄僅 ~90px,標籤曾逐字直排) |

既有測試:
- **該紅**:`ChipBubbleView.test.tsx` L2080「bubbleData null → 不渲染截圖鈕」→ 改「渲染但 disabled」(包 A);visual V1(equity-2330.png)+ V4(equity-2330-mobile.png)baseline 重生(包 B/D 幾何)`[amendment: R4]`。
- **不該紅**:其餘全部(chip-svg-render / ChipKlineChart zoom-HUD-crosshair-anti-CLS / useChipBubble / chip-bubble-svg 既有 describe / e2e E39 E42 E43 E44 E45 E31);**E5**(`chip-kline-chart` 容器文字不得匹配 `\d{4}/\d{2}/\d{2}`)綠燈前提 = 刻度 `M/D`、hover chip `YYYY-MM-DD`(dash),日期軸不得用斜線年月日 `[amendment: R20]`。
- 新測試:D 純函式(`pickDateTicks` 首末含、間距、`formatTickDate`);`ChipKlineChart.test.tsx` 日期軸 describe(高度和 = 容器高、軸存在、hover chip);`useChipBubble.test.ts` tradingDates;`chip-bubble-daymarks-svg.test.tsx`(SC-4 條列);`chip-bubble-svg.test.tsx`(dayMarks 缺 / days=1 不畫、bubble 像素位置不變);`ChipBubbleView.test.tsx`(連續天數標籤 + title + group aria / 三鈕 disabled 三態 / dayMarks 透傳)。

## 7. E2E 歸屬(e2e-conventions 判準表)

- equity mode UI → `equity.spec.ts`:新增 **E46**(日期軸可見 + tick 含 `6/26`? fixture 最後 candle 2026-06-26 → 末刻度含「6/26」;hover 後 chip 文字 `2026-06-26`);**E43 追加**(切 5 日後 `bubble-day-marks [data-date]` count 5;`bubble-screenshot` bounding box x 前後相等)。
- E38 追加 selector 同行斷言(R7);E43 追加 route 延遲取樣三鈕 disabled + bbox 不變(R3)+ `bubble-day-marks [data-date]` count 5。
- visual V1(equity top)+ V4(equity mobile 45vh 疊圖)baseline 需重生 → PR 註明 + push 後觸發 `e2e-update-snapshots` workflow;mobile 下 subH ≈ 28px,截圖時確認子圖標籤未壓掉 `[amendment: R4]`。

## 8. Edge cases

1. `trading_dates` 有日但 `history.candles` 缺該日(資料 lag)→ 該欄跳過不畫,其餘照畫。
2. 20 日 + 窄容器(slotW < 50)→ 只畫 K 身 + 稀疏日期,不畫價格標籤(不重疊)。
3. 開 == 收(平盤)→ K 身退化為 1px 橫線 ink-dim,標籤仍照分級畫。
4. open/close 任一超出 `yLow..yHigh`(broker fallback 軸)→ 該欄只畫日期不畫 K 身與價格標籤(對齊 volume profile「越界跳過不畫」慣例)`[amendment: R9]`。
8. `actual_days < window_days`(部分日 fetch 失敗 / 無成交)→ payload 無逐日成交 meta,前端無法判定哪一欄無成交,欄位照畫、badge 的「實際 X 日」維持唯一提示(已知限制,R8 記 next-time)。
5. K 線 zoom 到 30 日 / 360 日 → 首末必含 + 相鄰 tick 間距 ≥ 70px(末根例外由 pickDateTicks 刪前一個吸收)`[amendment: R17]`。
6. hover 離開 → hover chip 隱藏;selectedDate 不在日期軸重複標(sel-cursor 已有)。
7. mobile(<lg)泡泡圖:標籤「連續天數」與 selector 一起換行,不撐寬中欄。

## 9. 執行約束

- 前端慣例:semantic token / rem 字級 / `pointerEvents="none"` 背景層 / 純幾何函式抽 lib 可測(frontend-conventions)。
- 三類分離 commit,包順序 A🔴(工具列常駐)→ B🔴(疊圖高度配平)→ C🟢(連續天數標籤)→ D🟢(日期軸)→ E🟢(每日開收);每包 red→green。
- 觸及範圍測試:各包只跑相關 vitest 檔;全套 + build + e2e(equity E43/E46)由 main session 波尾親跑。

## self_review_head

`self_review_head`: 見 progress.md 末列(fix 波後 HEAD),收尾增量 review 以此為基準。
