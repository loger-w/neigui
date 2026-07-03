# 全站響應式改造(手機 / 小螢幕 / 大螢幕字級)設計

日期:2026-07-03
狀態:已與 user 對齊(方案 A:內容驅動響應式,單一元件樹)

## 1. 背景與問題

目前前端是純桌面設計:`h-screen` + `overflow-hidden` 固定高度版面,全 app 僅 8 處
responsive breakpoint(集中在 MarketPage / OptionsChipPanel),字級固定 `text-xs` / `text-sm`。

User 回報三個問題:

1. **大螢幕字太小** — 字級固定,2K/4K 螢幕無放大機制。
2. **小螢幕擠、資訊卡在一起** — equity header 單列 6 組控制項無換行;ChipBrokersPanel
   固定 px 欄寬(8 欄)窄容器溢出;user 自己的筆電就會遇到。
3. **手機幾乎無法使用** — 三欄 grid 無堆疊降級;拖曳把手只綁 mouse event;
   hover 互動(K 線 crosshair / 泡泡 tooltip)觸控上不存在。

## 2. 目標與成功標準

| # | 成功標準 | 驗證方式 |
|---|---|---|
| SC1 | ≥1920px 螢幕基礎字級放大 12.5%、≥2560px 放大 25%,含 SVG 圖表文字 | DevTools MCP 2560px 截圖對照 |
| SC2 | 375px 寬(iPhone SE 級)三個 mode 都能瀏覽:無水平溢出、無重疊、可捲動 | e2e viewport 375×667 smoke + 截圖 |
| SC3 | 768–1279px(平板/窄筆電)equity 保留並排,header 換行不溢出、表格不爆欄 | e2e viewport 1024×768 + 截圖 |
| SC4 | 手機上核心互動可用:搜尋、切 mode、切日期、選券商、tap 看 K 線 crosshair、tap 泡泡看明細 | e2e + DevTools MCP 手動驗 |
| SC5 | ≥1280px 桌面版面與現狀視覺等價(不 regression) | e2e visual baseline 比對 |
| SC6 | 手機互動元素觸控目標 ≥44×44px;input 字級 ≥16px(防 iOS 聚焦縮放) | e2e assertion + 截圖抽查 |

## 3. 非目標(明確排除)

- 泡泡圖 brush 框選、批量跳轉總覽的觸控等價 — 桌面限定。
- 拖曳調整面板寬度的觸控版 — `<lg` 堆疊後無此需求。
- 視覺主題改動:深色暖棕 token、Inter Tight 字體、bull 紅 / bear 綠一律不動。
- PWA / 離線支援、手機專屬手勢系統(pinch zoom 等)。
- User-agent 裝置嗅探 — 一律 CSS media query + `(pointer: coarse)`。

## 4. 設計

### 4.1 全域字級縮放(SC1)

`index.css` 加 root font-size media query:

```css
@media (min-width: 1920px) { html { font-size: 112.5%; } }
@media (min-width: 2560px) { html { font-size: 125%; } }
```

Tailwind text/spacing 全是 rem 基準,一次生效且比例不失衡。

**SVG 圖表文字**(實作時修正:改 rem 字串,取代原 fontScale 參數方案):
`lib/*-svg.tsx` 的 SVG viewBox 全是 1:1(`0 0 ${width} ${height}`),SVG 內
`fontSize="0.6875rem"` 這類 rem 字串直接吃 root font-size 自動縮放 — 零 API
改動、零 hook,root 16px 下與原 px 值 pixel 等價(SC5 安全)。固定字級全數
換 rem;幾何驅動的動態字級(chip-price-bar 依 rowH 計算那顆)保留 px。
同理,元件內 `text-[Npx]` Tailwind arbitrary value 也不吃 root 縮放,全站
36 處一併換成 `text-[N/16rem]`。

### 4.2 斷點策略(SC2/SC3)

Tailwind 標準斷點,三層版面:

| 區間 | 版面 |
|---|---|
| `<lg`(<1024,手機 + 直向平板)| 上下堆疊、單欄、整頁垂直捲動 |
| `lg`–`<xl`(1024–1279)| 並排保留,控制項換行、表格減欄 |
| `≥xl`(≥1280)| 現狀 |

- 觸控判斷:CSS `(pointer: coarse)`;需要 JS 分支處(泡泡明細容器切換、crosshair
  事件模式)用新 hook `hooks/useMediaQuery.ts`(`window.matchMedia` + subscribe,
  回傳 boolean)。
- 拖曳把手 `<lg` 隱藏。
- `<lg` 時 App 外層由 `overflow-hidden` 改為允許頁面捲動(equity 堆疊頁需要);
  `≥lg` 維持固定高度版面不變。

### 4.3 Equity 頁(重災區)

- **Header**:6 組控制項分兩群 —「標題 + 搜尋 + 代號名稱」/「日期 stepper 組 +
  RangeSelector + 重新整理」。外層 `flex-wrap`,窄螢幕自動兩列;`<sm` 搜尋框
  `w-full`(現固定 220px)。
- **三欄 grid**(`App.tsx` `gridTemplateColumns: 1fr 4px ${panelWidth}px`):
  `<lg` 改單欄堆疊 — K 線圖 `h-[45vh]` 在上、ChipBrokersPanel 自然高度接在下、
  整個 tab 區 `overflow-y-auto`。`≥lg` 維持三欄 + 拖曳把手 + panelWidth 持久化。
- **ChipBrokersPanel 表格**:欄寬 `grid-cols-[22px_28px_1fr_64px…]` 在窄容器爆版。
  以容器寬度(非 viewport)降級:窄時隱藏次要欄,保留核心「排名 / 券商名 /
  買賣超 / 均價」;具體取捨實作時依欄位資料重要性定案,原則 = 手機至少保住
  「誰、買賣超多少」。
- **K 線 crosshair**:hover 驅動 → 觸控裝置(`pointer: coarse`)改 tap 顯示、
  tap 空白處關閉;桌面 hover 行為不變。

### 4.4 泡泡圖(可看可點,重互動桌面限定)

- `<lg`:右欄 400px 明細(`grid-cols-[1fr_400px]`)改為 tap 泡泡後從底部彈出的
  sheet(`position: fixed` 底部、`max-h-[60vh]` 內捲)。關閉路徑:右上 X、
  tap sheet 外部、(有既有手勢庫才做下滑,無則不引入新依賴)。
- 泡泡 SVG 縮放到容器寬;hover tooltip 觸控改 tap 觸發。
- brush 框選:觸控裝置不註冊 handler(桌面不變)。

### 4.5 Options / Market 頁(輕修)

- **Options**:四卡 `md:grid-cols-2 xl:grid-cols-4` 已存在 ✓。補:OptionsHeader
  控制項 `flex-wrap`;大戶 strip `grid-cols-4` → `<md` 改 `grid-cols-2`(2×2);
  strike ladder `<lg` 外層 `overflow-x-auto` 橫向捲動。
- **Market**:主 grid `grid-cols-1 lg:grid-cols-[3fr_4fr_3fr]` 已存在 ✓。補:
  classic 檢視 `h-[560px]` → `<lg` 改自適應高;leaderboard 表格窄螢幕減欄;
  heatmap tile tap 選股確認可用(touch target)。

### 4.6 觸控與可及性硬規格(SC6,來自 UX skill)

- 互動元素觸控目標 ≥44×44px:`(pointer: coarse)` 下 ModeSwitch / tab / stepper /
  重新整理等按鈕 padding 放大達標(視覺桌面不變)。
- 手機上 text input(SymbolSearch / DateField)字級 ≥16px,防 iOS 聚焦自動縮放。
- 動畫維持既有 `motion-reduce:animate-none` 慣例;新增 sheet 進出場動畫
  200–300ms `ease-out`,同樣掛 motion-reduce。
- 觸控裝置隱藏 hover-only 視覺(hover 樣式天然不觸發,無需特別處理;但凡
  「僅靠 hover 才能發現」的功能都要有 tap 等價,4.3/4.4 已涵蓋)。

## 5. 測試與交付

- **單元測試**:`useMediaQuery`(matchMedia mock)、`useRootFontScale`、
  `lib/*-svg` fontScale 乘算、ChipBrokersPanel 減欄邏輯。既有測試不得紅。
- **e2e**(依 CLAUDE.md 判準表):
  - 視覺大改 → `visual.spec.ts` V# 加 375×667 / 768×1024 baseline
    (`npm run test:update-snapshots`)。
  - E#/O#/M# 各加一組 375×667 viewport 關鍵流程 smoke;viewport 一律
    `test.use({ viewport })` 導航前固定(既有慣例)。
  - 每個新 spec 上方 `// 痛點:` 註解(既有慣例)。
- **真實環境**:DevTools MCP 截圖 375 / 768 / 1440 / 2560 四寬度,
  存 `docs/specs/responsive/screenshots/`。
- **Changelog**:MINOR bump,user-facing 文案方向:「支援手機與平板瀏覽;
  大螢幕文字自動放大」。
- **Commit 分批**(🔴 行為改動類,各自獨立):
  1. 全域字級縮放 + SVG fontScale
  2. equity 頁響應式(header / 堆疊 / 表格減欄 / crosshair tap)
  3. 泡泡圖手機版(bottom sheet / tap tooltip)
  4. options / market 補強
  5. e2e + visual baseline + changelog

## 6. 風險

| 風險 | 緩解 |
|---|---|
| root font-size 放大讓 ≥1920 桌面既有版面爆版(px 定寬容器 vs rem 內容) | SC5 visual baseline 抓;px 定寬處(panelWidth、popover w-[320px] 等)逐一檢查 |
| `<lg` 改頁面捲動與既有 `h-full overflow-hidden` 慣例衝突(§9 known pitfall:flex-1 min-h-0) | 只在 `<lg` 分支改捲動模式,`≥lg` DOM 結構不動;e2e 幾何量測鎖 |
| SVG fontScale 乘上去後文字與幾何(tick 間距、label 避讓)碰撞 | 只乘文字;截圖驗 2560px;碰撞明顯的 renderer 個案調 |
| jsdom 測不到 matchMedia / 觸控行為 | hook 單測 mock matchMedia;真實行為走 e2e + DevTools MCP(既有慣例:jsdom 測不到的用 real-env 補) |
