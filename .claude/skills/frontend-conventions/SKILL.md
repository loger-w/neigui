---
name: frontend-conventions
description: 前端 stack / 元件 / 版面與響應式慣例。寫改任何 frontend 元件或 hook、新增含文字的元件 / SVG renderer、寫 container query、加新 mode 頁、用 useContainerSize、改 chart overlay 事件模型、動分點名稱顯示、拍 devtools 驗證截圖前先讀。
---

# 前端 stack / 版面 / 響應式慣例

## Stack / 元件慣例(2026-07-27 自專案 CLAUDE.md §3 移入)

- **Custom hook 統一回傳 shape**:`{ data, loading, error, refresh, ...extras }`。新 hook 照這個介面開,UI 元件依賴它。
- **資料 fetching 一律 TanStack Query `useQuery`**:`queryFn: ({ signal }) => api.xxx(..., { signal })` 直傳內建 AbortSignal(cancel 鏈細節見 skill `cancel-chain`);對外回傳 shape 維持上一條。**useMutation 沒內建 signal** — `useBrokerHistory.ts` 的 AbortController pattern 是樣板。**不要**再寫手動 `seqRef` stale-drop(已全面淘汰)。
- **Function component + hooks only**。沒有 class 元件。
- **Tailwind 用 semantic token,不用原色**(`text-ink` / `text-ink-muted` / `text-ink-dim` / `text-accent` / `border-line` / `border-line-strong` / `bg-bg` / `bg-bg-deep`)。token 在 `frontend/src/index.css` 的 `@theme`。Bull = 紅 / Bear = 綠(台股慣例,**不要套美股 green-up 配色**)。
- **重元件 lazy**:跨 tab 切換的大元件(`ChipBubbleView` / `OptionsPage`)走 `React.lazy()` + `<Suspense fallback={...}>`。
- **純渲染抽到 `lib/*-svg.tsx`**:SVG 計算函式無 React 依賴,獨立單元測試(看 `chip-svg.test.ts`)。元件只負責掛 DOM。
- **`cn(...classes)`** 走 `lib/utils.ts`(`clsx` + `tailwind-merge`),不直接拼字串。
- **UI 文字一律繁體中文**(`重新整理` / `載入中` / `無交易日` …)。錯誤訊息也用繁中。Aria-label 同樣繁中。
- **Vitest 測試 colocated** `*.test.tsx` / `*.test.ts`,跑 RTL 的檔要在頂端寫 `/** @vitest-environment jsdom */` pragma(不用 global config)。`afterEach(cleanup)`。測試慣例細節見 skill `frontend-testing`。
- **Path alias** `@/` → `src/`(`vite.config.ts` + `tsconfig.app.json`),但既有 code 多用相對 import,維持就好。
- **Date 用 `YYYY-MM-DD` 字串** 在 API + state 流動;`new Date()` 只在 `App.tsx` 的 `todayStr()` 等邊界。
- **`hidden` attribute > 條件 render(tab 層級)**:tab 切換用 `<div hidden={tab !== "x"}>` 保留 DOM 避免重渲染(看 `App.tsx` overview / bubble)。**mode 層級例外**:App.tsx 的 mode 切換是 ternary(避免多頁同時 mount 抓資料,e2e N4 鎖死),加新 mode 見 skill `market-pipeline`。**需要跨 mode 切換保留的 UI 狀態不改 ternary,改掛 `hooks/useSessionState`**(sessionStorage-backed,2026-07-21 SC-8;樣板 BrokerFlowsPanel selected / MarketSectorRotation expanded)。

## 分點名稱顯示(2026-07-27 自專案 CLAUDE.md §4 移入)

- **一律走 `lib/broker-name.ts`**(兩個 FinMind dataset 名稱格式不同,前端統一;2026-07-22 mod/broker-label-search-only-id 分工):搜尋框情境(input echo + combobox dropdown)用 `formatBrokerLabel`(「id 去dash名」,例 `9801 元大松江`);其他顯示點用 `formatBrokerName`(只顯去dash名,名稱缺 fallback id)— **只動顯示字串**,selection / API / callback 契約仍以 `broker_id`(或原始 name,如 BrokerSearch)為 key。新分點顯示點不准直接印 raw name。
- 搜尋比對一律 dash-insensitive(前端 `normalizeBrokerQuery` 雙邊去 dash;backend `search_traders` 同義)。

## 字級縮放(2026-07-03 responsive 沉澱)

- **全站字級縮放機制 = root font-size media query(≥1920 112.5% / ≥2560 125%)+ 全 rem**:新 code 禁用 `text-[Npx]` px-literal(不吃縮放),SVG 內 fontSize 一律 rem 字串(viewBox 1:1 直接生效);SVG 大標籤用 `chip-theme.ts::svgLabelFont(width)` / `svgLegendFont(width)`(<500px 容器自動降級)。幾何驅動的動態字級(chip-price-bar rowH 那顆)保留 px。Trigger:新增任何含文字的元件 / SVG renderer。
- **Container query 門檻若邏輯上是「px 版面塞不塞得下」,用 px 任意值不用 rem 級距**:曾用 `@md`(28rem),2560 螢幕 root 放大後門檻變 560px > 面板寬 420px,桌面反而藏欄。改 `@[400px]:`。Trigger:寫任何 container query 減欄 / 降級。
- **觸控目標用 Tailwind `pointer-coarse:` variant(4.1+ 內建)加 min-h-11 / py 放大**,桌面視覺零影響;K 線 crosshair 這類 hover 互動在觸控上靠 tap 的 synthetic mousemove 免改即可用(overlay 是 onMouseMove + onClick 才成立,改 pointer event + pointerType 過濾就會破)。Trigger:新增可互動元件 / 改 chart overlay 事件模型。

## JS 響應式分支

- **jsdom 沒有 `window.matchMedia`(是 undefined,不是 matches:false)**:`hooks/useMediaQuery.ts` 已 feature-detect 回 false;判斷方向一律 `(max-width: 1023px)` 判 mobile、桌面為預設分支,vitest 下元件自動走桌面分支。雙分支共用的 JSX 抽變數不複製。Trigger:元件需要 JS 換容器(非純 CSS 降級)時。

## Layout / 量測

- **App 下的 mode page root 用 `flex-1 min-h-0`,不用 `h-full`**:App root 是 `flex flex-col`,flex item 的 `h-full` = 100% 容器高,不是「扣掉 nav 的剩餘空間」→ 頁面下溢 nav 高度被 `overflow-hidden` 靜默裁切。Trigger:加新 mode 頁時。
- **`useContainerSize` 的 ref 必掛「恆存 wrapper」**(loading / unavailable / data 三態都 mount 的元素):hook null-ref 時 early-return 且永不重跑,ref 若只掛 data 分支,冷載入會永遠 0×0 空白。regression lock 寫法見 skill `frontend-testing`。Trigger:元件用 useContainerSize 且有多態渲染時。
- **延遲 mount 的容器(bottom sheet / modal)內用 useContainerSize,ref + hook 必須宣告在「隨容器 mount 的元件」內部**(掛 parent 的 ref 會踩 null-ref 永不重跑陷阱)。ChipBubbleView 的 DetailPanel 是樣板。Trigger:sheet / dialog 內放需量測的 SVG 圖表。

## 驗證截圖

- **devtools MCP 截圖 close-up 用 PIL crop 整頁截圖,不用 `body.style.zoom`**:zoom 會污染 useContainerSize 量測(ResizeObserver 以 zoom 後幾何重排,拍完 reset 也可能留下爆版 layout)。Trigger:real-env 要 panel 級 close-up 證據時。
- **<500px 窄視窗驗證用 `emulate` viewport,且 emulate 會整頁重載**(2026-08-13 bubble-streak-screenshot):`resize_page` 下限 = Chrome 視窗 500px,拍 430px 手機寬必走 `emulate`;emulate 重載會清掉 symbol / tab / 天數等全部 state,呼叫後要重走選股流程再驗。Trigger:real-env 拍行動版截圖時。
- **long task 效能量測必用真實 input 派送,禁在 `evaluate_script` 內 `.click()`**(2026-08-13 實測):注入 script 的 click 會把「注入函式續段 + React 同步渲染 + GC」併成同一個 task,量出 1129ms 假 long task;改真實 input 事件後同互動實為 17ms 級。Trigger:任何以 DevTools trace 量互動 blocking time 時。

## 色彩語意(2026-07-11 /feat warrant-selector 沉澱)

- **`--color-accent` 與 `--color-bull` 同色值(#e85a4f)**:accent 用於「互動態」(active tab / hover / focus)是全站慣例沒問題;但**資料標籤 / badge / 數值標色(非互動態)禁用 accent** — 視覺上就是多頭紅,撞「紅綠保留多空」鐵則。中性強調改用 ink 強度階(text-ink / text-ink-muted / text-ink-dim)+ 實底(bg-ink/10)vs 框線(border-line-strong)區分,零色相。regression lock 寫法:`expect(el.className).not.toMatch(/accent|bull|bear/)`(WarrantSelector.test.tsx 是樣板)。Trigger:新增任何資料 badge / 標籤 / 分級標色時。
- **列表 React key 勿用顯示名稱**:FinMind 分點同名可重複(彰銀買賣各一列,real-env 實測)→ key 帶 index 或穩定 id。Trigger:render 上游回傳的列表資料時。
- **Categorical identity 色(多實體同畫面識別)用 `chip-bubble-svg.ts::BROKER_PALETTE` 樣板**(2026-07-27 bubble-multi-broker):6 色刻意排除紅綠色相(多空保留鐵則),值經 dataviz validator 於 dark surface #0e0c08 驗證(前 3 slot all-pairs PASS、全 6 adjacent PASS);同時上限(可選數)一律 `= PALETTE.length` 單一 source,不另硬編;>3 同畫面的辨識靠 secondary encoding(tooltip / legend / 列名標籤)補足,是 dataviz relief 規則的合規前提。配色 slot 用「最小未占用 idx」配發(移除不重配其他實體,防整組跳色)。Trigger:任何需要多實體專屬色的新 UI(新 palette 先跑 validator,勿目測)。
- **圖內背景資料層(recessive context layer)樣板 = `chip-bubble-svg.tsx` volume profile 節**(2026-08-11 bubble-volume-profile):(1) 恆以全量資料計算,不隨前景 filter(選取 / 區間)變 — 背景脈絡定位對齊 axes-stable 原則;(2) 比例分母取 **clip 前**全量 max,y-range clip 只決定畫不畫(否則 fallback 軸下存活條被拉伸滿格,非量峰呈現成滿格);(3) 條繪製範圍(中心 ± h/2)clamp 進 chart 內區,邊界值不半截畫進刻度帶;(4) `pointerEvents="none"` + 中性暖灰 `rgba(124,111,85,α)`(intradayLine 同色系,非紅綠非 accent);(5) 全量聚合必 useMemo — brush 拖曳每幀 re-render,render body 不得掃全量 trades。Trigger:任何 chart 要疊全量背景分布(量能 / 密度 / 直方)層時。
