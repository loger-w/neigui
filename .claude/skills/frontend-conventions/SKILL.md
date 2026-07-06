---
name: frontend-conventions
description: 前端版面與響應式慣例。新增含文字的元件 / SVG renderer、寫 container query、加新 mode 頁、用 useContainerSize、改 chart overlay 事件模型、拍 devtools 驗證截圖前先讀。
---

# 前端版面 / 響應式慣例

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
