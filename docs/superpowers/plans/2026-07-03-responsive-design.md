# 全站響應式改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trash-cmoney dashboard 支援手機(<1024 堆疊)、平板/窄筆電(控制項換行、表格減欄)、大螢幕(≥1920 字級自動放大),桌面 ≥1280 視覺不變。

**Architecture:** 單一元件樹 + Tailwind 斷點 class 降級(spec 方案 A)。root font-size media query 驅動全域縮放;SVG 字級改 rem 字串自動跟進;JS 分支只用在「換容器」處(equity 三欄→堆疊、泡泡圖右欄→bottom sheet),經 `useMediaQuery` hook。

**Tech Stack:** React 19、Tailwind 4.3.1(`pointer-coarse:` variant 與 container query 內建)、vitest + jsdom、Playwright e2e。

## Global Constraints

- 深色暖棕 token / Inter Tight / bull 紅 bear 綠 一律不動(spec §3)。
- 桌面 ≥1280 視覺與現狀等價(SC5)— 所有 rem 換算以 root 16px 下 pixel 等價為準。
- media query 判斷一律 **`(max-width: 1023px)` 判 mobile、桌面為預設分支** — jsdom `matchMedia` 恆 `matches:false`,既有 vitest 測試才不會落到 mobile 分支。
- `text-2xs` 未定義(silent no-op)→ **不定義、不替換**,列「下次處理」。
- UI 文字繁中;新測試遵守專案慣例(RTL 用 `toBeTruthy`/`toBeNull`,不用 jest-dom;e2e spec 必附 `// 痛點:` 註解)。
- Commit 訊息 `<type>(<scope>): <subject>`;每個 Task 一個 commit。
- 泡泡圖 brush / 拖曳調寬 = 桌面限定(spec §3 非目標)。

## Spec 落地修正(相對 2026-07-03-responsive-design.md,Task 1 一併回寫 spec)

1. SVG 字級:**rem 字串**取代 fontScale prop + useRootFontScale hook(viewBox 1:1,rem 直接生效,零 API 改動)。
2. Equity 手機堆疊:**固定高度 flex-col**(K 線 45vh + 面板 flex-1 內捲),非整頁捲動 — 券商面板內部雙捲動區直接可用,避開 overflow 全域改動風險。

---

### Task 1: 全域字級縮放(root font-size + SVG rem + px-literal 清理)

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/lib/chip-kline-svg.tsx`, `chip-inst-bar-svg.tsx`, `chip-broker-agg-svg.tsx`, `chip-bubble-svg.tsx`, `chip-price-bar-svg.tsx`(固定字級處)
- Modify: 13 個含 `text-[Npx]` 的檔(見 Step 3 清單)
- Modify: `frontend/src/components/ChipBubbleView.tsx`(tooltip inline `fontSize: 13`)
- Modify: `docs/superpowers/specs/2026-07-03-responsive-design.md` §4.1(回寫 rem 決策)

**Interfaces:**
- Produces: 無新 API。`html` root font-size 隨 viewport 變化,所有 rem 基準文字自動縮放。

- [ ] **Step 1: index.css 加 root font-size media query**

在 `@theme` block 之後加:

```css
/* 大螢幕字級縮放(responsive spec SC1):root font-size 隨 viewport 放大,
 * Tailwind text-*/spacing 全 rem 基準一次生效。SVG 圖表文字同步改 rem 字串。 */
@media (min-width: 1920px) {
  html { font-size: 112.5%; }
}
@media (min-width: 2560px) {
  html { font-size: 125%; }
}
```

- [ ] **Step 2: SVG 固定字級改 rem 字串**

換算表(root 16px 下 pixel 等價):`9→"0.5625rem"`、`11→"0.6875rem"`、`12→"0.75rem"`、`13→"0.8125rem"`、`14→"0.875rem"`、`20→"1.25rem"`、`22→"1.375rem"`。

- `chip-kline-svg.tsx`:L326/L487/L550 `fontSize={11}` → `fontSize="0.6875rem"`;L500 `fontSize={22}` → `"1.375rem"`;L519/L522/L529 `fontSize={20}` → `"1.25rem"`
- `chip-inst-bar-svg.tsx`:L58/L114/L174/L246 `fontSize={22}` → `"1.375rem"`
- `chip-broker-agg-svg.tsx`:L74 `fontSize={22}` → `"1.375rem"`
- `chip-bubble-svg.tsx`:`fontSize={13}` → `"0.8125rem"`(L89/L691);`fontSize={11}` → `"0.6875rem"`(L605/L622/L632/L730/L745)
- `chip-price-bar-svg.tsx`:L43 `fontSize={14}` → `"0.875rem"`;L133/L143 `fontSize={12}` → `"0.75rem"`。**L85 的 `Math.min(12, Math.max(8, rowH - 2))` 是幾何驅動動態字級,保持 px 不動。**
- `ChipBubbleView.tsx` tooltip style:`fontSize: 13` → `fontSize: "0.8125rem"`

- [ ] **Step 3: `text-[Npx]` → rem 等值 arbitrary value**

換算:`text-[9px]→text-[0.5625rem]`、`[10px]→[0.625rem]`、`[11px]→[0.6875rem]`、`[13px]→[0.8125rem]`、`[16px]→[1rem]`、`[18px]→[1.125rem]`(遇其他值同除 16)。

涵蓋檔案(36 處):`MarketBreadthPanel.tsx`、`lib/options-svg.tsx`、`MarketHeatmap.tsx`、`MarketLeaderboard.tsx`、`MarketSectorBreadthHeatmap.tsx`、`OptionsHeader.tsx`、`OptionsInstitutionalCard.tsx`、`OptionsMaxPainCard.tsx`、`OptionsOIWallsCard.tsx`、`OptionsLargeTradersStrip.tsx`、`OptionsStrikeLadder.tsx`、`OptionsPCRCard.tsx`、`VersionBadge.tsx`。

驗證 gate:`rg 'text-\[\d+px\]' frontend/src` 必須 0 hit。

- [ ] **Step 4: 回寫 spec §4.1**(fontScale prop → rem 字串決策 + 理由)

- [ ] **Step 5: 跑測試 + build**

Run(`frontend/`): `npm test`、`npm run build`
Expected: 全綠(rem 換算 pixel 等價,不應有 snapshot/assertion 變化;svg render test 若 assert `fontSize` 數字則同步改 assertion 為 rem 字串 — 這屬「事前標為該變」的 assertion)。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(frontend): 大螢幕字級自動放大 — root font-size 斷點 + SVG/px-literal 改 rem"
```

---

### Task 2: `useMediaQuery` hook(TDD)

**Files:**
- Create: `frontend/src/hooks/useMediaQuery.ts`
- Test: `frontend/src/hooks/useMediaQuery.test.ts`

**Interfaces:**
- Produces: `useMediaQuery(query: string): boolean` — Task 3/5 以 `useMediaQuery("(max-width: 1023px)")` 判 mobile。

- [ ] **Step 1: 寫紅測試**

```ts
/** @vitest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

type Listener = (e: { matches: boolean }) => void;

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    fire(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useMediaQuery", () => {
  it("回傳目前 match 狀態", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(true);
  });

  it("media change 事件觸發 re-render", () => {
    const ctl = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);
    act(() => ctl.fire(true));
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npm test -- useMediaQuery`
Expected: FAIL — module not found。

- [ ] **Step 3: 實作**

```ts
import { useSyncExternalStore } from "react";

/** 響應式 JS 分支用。判斷方向一律「mobile 為 match、桌面為預設」
 *  (`(max-width: 1023px)`)— jsdom matchMedia 恆 false,vitest 下元件
 *  自動落在桌面分支,既有測試不受影響。 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
  );
}
```

- [ ] **Step 4: 跑測試確認綠**(`npm test -- useMediaQuery` PASS)

- [ ] **Step 5: Commit** — `feat(frontend): useMediaQuery hook(響應式 JS 分支基礎)`

---

### Task 3: Equity 頁響應式(header 換行 + 手機堆疊 + 觸控目標)

**Files:**
- Modify: `frontend/src/App.tsx`(header L281-365、overview grid L373-415)
- Modify: `frontend/src/components/ModeSwitch.tsx`(觸控目標)
- Modify: `docs/superpowers/specs/2026-07-03-responsive-design.md` §4.3(回寫固定高度堆疊決策)

**Interfaces:**
- Consumes: `useMediaQuery`(Task 2)。
- Produces: `const isMobile = useMediaQuery("(max-width: 1023px)")` pattern — Task 5 沿用。

- [ ] **Step 1: header 改 flex-wrap 兩群**

`App.tsx` header 內層(L284 `<div className="flex items-center gap-3">`)改為:

```jsx
<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
  <div className="flex items-center gap-3 min-w-0 flex-1 basis-full sm:basis-auto sm:flex-none">
    <h1 className="text-2xl text-ink font-semibold mr-2 shrink-0">籌碼分析</h1>
    <div className="flex-1 min-w-[140px] sm:flex-none sm:w-[220px]">
      <SymbolSearch onPick={handlePick} />
    </div>
    {symbol && (
      <div className="flex items-baseline gap-1.5 text-sm shrink-0">
        <span className="text-ink font-medium">{symbol}</span>
        {symbolName && <span className="text-ink-muted">{symbolName}</span>}
      </div>
    )}
  </div>
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
    {/* 既有 TradingDayStepper + DateField + RangeSelector + 重新整理 button 原封搬入 */}
  </div>
</div>
```

重新整理 button 加 `pointer-coarse:min-h-11`;tab 按鈕(籌碼總覽/泡泡圖)各加 `pointer-coarse:min-h-11 pointer-coarse:px-5`。

- [ ] **Step 2: overview 三欄 grid 加 mobile 堆疊分支**

`App.tsx` 頂部加 `import { useMediaQuery } from "./hooks/useMediaQuery";`,component 內加 `const isMobile = useMediaQuery("(max-width: 1023px)");`。

L374-415 overview 區改為:

```jsx
<div hidden={tab !== "overview"} className="h-full">
  {isMobile ? (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="h-[45vh] min-h-[260px] shrink-0 border-b border-line">
        <ChipKlineChart {/* 同桌面 props */} />
      </div>
      <div className="flex-1 min-h-0">
        <ChipBrokersPanel {/* 同桌面 props */} />
      </div>
    </div>
  ) : (
    /* 既有三欄 grid + resize handle,原封不動 */
  )}
</div>
```

props 兩分支完全相同(從既有 JSX 複製)。resize handle 只存在桌面分支。

- [ ] **Step 3: ModeSwitch 觸控目標**

`ModeSwitch.tsx` button className 加 `pointer-coarse:min-h-11`(既有 `px-5 py-2` 保留)。

- [ ] **Step 4: 驗證 K 線 crosshair 觸控行為**

讀 `lib/chip-kline-svg.tsx` hover 事件掛法。行動裝置 tap 會派發 synthetic mousemove → crosshair 大概率免改。若 hover 走 `onPointerMove` + pointerType 過濾或 tap 後不顯示:在 overlay 的既有 click/pointer handler 內同步 `onHoverIndex(i)`。此步驟結論(免改 or 補丁 diff)記錄於 commit message。

- [ ] **Step 5: 跑測試 + build**(`npm test`、`npm run build` 全綠;jsdom 下 isMobile=false,既有測試走桌面分支)

- [ ] **Step 6: 回寫 spec §4.3 + Commit** — `feat(frontend): equity 頁手機堆疊 + header 換行 + 觸控目標`

---

### Task 4: ChipBrokersPanel container query 減欄

**Files:**
- Modify: `frontend/src/components/ChipBrokersPanel.tsx`

**Interfaces:**
- Consumes: Tailwind 4 內建 container query(`@container` / `@md:`,28rem = 448px)。
- Produces: 無 — 純 CSS 降級,jsdom 測試(查文字/DOM 存在)不受影響。

- [ ] **Step 1: panel root 加 `@container`**

L203 `className="h-full flex flex-col overflow-hidden"` → 加 `@container`。

- [ ] **Step 2: 欄寬與 cell 加 container variant**

窄容器(<28rem)隱藏「買均/賣均」欄(手機保住「誰、買賣超多少」原則):

- BrokerRow `cls`(L73-75)改:
  - net:`"grid-cols-[22px_28px_1fr_64px_52px_52px] @md:grid-cols-[22px_28px_1fr_64px_56px_56px_52px_52px]"`
  - volume:`"grid-cols-[22px_28px_1fr_52px_52px_56px] @md:grid-cols-[22px_28px_1fr_56px_56px_52px_52px_56px]"`
- 買均/賣均 cell(L129-134 net、L140-145 volume)各加 `hidden @md:block`。
- header 欄寬常數(L197-198)同步改;header 的「買均」「賣均」`<span>` 加 `hidden @md:block`。
- BrokerRow 觸控目標:root `py-2` 改 `py-2 pointer-coarse:py-3`。

- [ ] **Step 3: 跑測試**(`npm test -- ChipBrokersPanel` PASS — jsdom 不算 container query,cell 仍在 DOM)

- [ ] **Step 4: Commit** — `feat(frontend): 券商面板窄容器隱藏均價欄(container query)`

---

### Task 5: 泡泡圖手機版(堆疊 + 明細 bottom sheet)

**Files:**
- Modify: `frontend/src/components/ChipBubbleView.tsx`

**Interfaces:**
- Consumes: `useMediaQuery`(Task 2)、既有 `selectedBrokerId` state。
- Produces: 桌面 DOM 不變(既有測試走桌面分支)。

- [ ] **Step 1: 抽 DetailPanel 共用元件**

把右欄內容(L394-421:price bar div + TradeList 雙欄)抽成同檔 local component:

```tsx
function DetailPanel({ priceBarRef, priceBarSize, priceAggs, filteredBuyRows, filteredSellRows, selectedBrokerName, onSelect, buySort, sellSort, onBuySortChange, onSellSortChange }: {/* 對應 props 型別 */}) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div ref={priceBarRef} className="h-[180px] shrink-0 border-b border-line">
        {priceBarSize.width > 0 && priceAggs.length > 0 && (
          <PriceBarSvg data={priceAggs} width={priceBarSize.width} height={180} />
        )}
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-line">
        <TradeList rows={filteredBuyRows} side="buy" selectedBroker={selectedBrokerName} onSelect={onSelect} sortSpec={buySort} onSortChange={onBuySortChange} />
        <TradeList rows={filteredSellRows} side="sell" selectedBroker={selectedBrokerName} onSelect={onSelect} sortSpec={sellSort} onSortChange={onSellSortChange} />
      </div>
    </div>
  );
}
```

桌面分支右欄改用 `<DetailPanel .../>`(視覺零變化)。

- [ ] **Step 2: mobile 分支 + bottom sheet**

```tsx
const isMobile = useMediaQuery("(max-width: 1023px)");
const [sheetOpen, setSheetOpen] = useState(false);
// tap 泡泡選中分點 → 自動開 sheet(mobile only)
useEffect(() => {
  if (isMobile && selectedBrokerId) setSheetOpen(true);
}, [isMobile, selectedBrokerId]);
```

root:`isMobile ? "h-full flex flex-col overflow-hidden" : "h-full grid grid-cols-[1fr_400px] gap-0 overflow-hidden"`。mobile 時左欄佔滿;header bar 加「明細」按鈕(`pointer-coarse:min-h-11`)開 sheet。sheet JSX(mobile only):

```jsx
{isMobile && sheetOpen && (
  <>
    <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setSheetOpen(false)} aria-hidden="true" />
    <div
      role="dialog" aria-label="分點成交明細"
      className="fixed inset-x-0 bottom-0 z-50 h-[70vh] flex flex-col bg-bg-deep border-t border-line-strong rounded-t-lg animate-[sheet-up_0.25s_ease-out] motion-reduce:animate-none"
    >
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-line">
        <span className="text-sm text-ink-muted">成交明細{selectedBrokerName ? ` — ${selectedBrokerName}` : ""}</span>
        <button type="button" aria-label="關閉明細" onClick={() => setSheetOpen(false)}
          className="text-ink-dim hover:text-ink cursor-pointer px-2 py-1 pointer-coarse:min-h-11">×</button>
      </div>
      <div className="flex-1 min-h-0"><DetailPanel {/* 同 props */} /></div>
    </div>
  </>
)}
```

`index.css` 加 keyframes:

```css
@keyframes sheet-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
```

- [ ] **Step 3: brush 桌面限定**

讀 `lib/chip-bubble-svg.tsx` 的 `onYBrush` 掛法:若 prop optional → mobile 傳 `undefined`;若 required → `onYBrush={isMobile ? () => {} : handleYBrush}` 並確認 brush 手勢不攔截觸控捲動(需要時在 svg brush 起點 handler 加 `pointerType === "mouse"` 過濾)。「輸入區間」按鈕 mobile 保留(手動輸入是觸控可用的 range 入口)。

- [ ] **Step 4: 跑測試 + build**(`npm test`、`npm run build` 全綠 — jsdom 走桌面分支)

- [ ] **Step 5: Commit** — `feat(frontend): 泡泡圖手機版 — 明細改底部彈出、單點互動`

---

### Task 6: Options / Market 補強 + popover 防溢出

**Files:**
- Modify: `frontend/src/components/OptionsHeader.tsx`、`OptionsLargeTradersStrip.tsx`、`OptionsStrikeLadder.tsx`
- Modify: `frontend/src/components/MarketPage.tsx`、`MarketLeaderboard.tsx`
- Modify: `frontend/src/components/VersionBadge.tsx`、`BrokerFilterPopover.tsx`、`BubbleHelpButton.tsx`

**Interfaces:** 純 class 改動,無 API 變化。

- [ ] **Step 1: OptionsHeader 換行**

L34 `flex items-center gap-3` → `flex flex-wrap items-center gap-x-3 gap-y-2`;refresh button 加 `pointer-coarse:min-h-11`;spot 區 `ml-auto` 保留(wrap 後自成一列靠右)。

- [ ] **Step 2: OptionsLargeTradersStrip 2×2**

L41(skeleton)與 L72 `grid grid-cols-4 gap-4` → `grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4`。

- [ ] **Step 3: OptionsStrikeLadder 橫向捲動**

讀該檔 root 容器,table/ladder 外層包 `overflow-x-auto`(手機表格完整可及,不擠壓)。

- [ ] **Step 4: MarketPage / MarketLeaderboard**

- `MarketPage.tsx` L105 `h-[560px]` → `h-auto lg:h-[560px]`(mobile 自然高,heatmap/leaderboard 內部有自己的高度處理則保底 `min-h-[320px]`,實作時看渲染結果)。
- `MarketLeaderboard.tsx`:讀檔;若表格固定多欄,外層加 `overflow-x-auto`;row 觸控目標 `pointer-coarse:py-2.5`(對照現值調)。

- [ ] **Step 5: popover 防手機溢出**

- `VersionBadge.tsx` `w-[360px]` → `w-[360px] max-w-[calc(100vw-2rem)]`
- `BrokerFilterPopover.tsx`、`BubbleHelpButton.tsx` `w-[320px]` → `w-[320px] max-w-[calc(100vw-2rem)]`

- [ ] **Step 6: 跑測試 + build + Commit** — `feat(frontend): options/market 頁手機版面補強 + popover 防溢出`

---

### Task 7: e2e + visual baseline + changelog + 真實環境驗證

**Files:**
- Modify: `e2e/specs/equity.spec.ts`、`options.spec.ts`、`market.spec.ts`(各加 mobile viewport smoke)
- Modify: `e2e/specs/visual.spec.ts`(V4-V6 mobile/tablet baseline)
- Modify: `frontend/src/lib/changelog.ts`(0.21.0 entry)
- Create: `docs/specs/responsive/screenshots/`(DevTools MCP 證據)

- [ ] **Step 1: 各 mode spec 加 mobile viewport smoke**

pattern(equity 例,O#/M# 比照;編號接該檔現有最大值 +1):

```ts
test.describe("E?: mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("E?: 375px 下搜尋→K線+面板堆疊、無水平溢出", async ({ page }) => {
    // 痛點:手機用戶「幾乎無法使用」— 三欄 grid 無降級、resize handle 綁 mouse。
    // 鎖 SC2:堆疊 layout 存在 + body 無水平捲動。
    await installFixtureClock(page);
    await page.goto("/");
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await page.waitForSelector(`[data-testid="${TESTIDS.chipBrokersPanel}"]`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("panel-resize-handle")).toHaveCount(0);
  });
});
```

options/market 同型:goto + 等 root testid + assert 無水平溢出。

- [ ] **Step 2: visual.spec.ts 加 V4-V6**(375×667 equity / 375×667 options / 768×1024 market,`test.use({ viewport })`,`// 痛點:` 註解)

- [ ] **Step 3: changelog 0.21.0**

`CHANGELOG` 陣列 index 0 插入:

```ts
{
  version: "0.21.0",
  date: "<最後 commit 日>",
  highlights: "支援手機與小螢幕瀏覽",
  changes: [
    { kind: "feature", scope: "global", text: "支援手機與平板瀏覽,版面自動調整為直向堆疊" },
    { kind: "feature", scope: "global", text: "大螢幕上文字自動放大,更易閱讀" },
    { kind: "feature", scope: "equity", text: "泡泡圖在手機上點選分點即可從底部開啟成交明細" },
  ],
},
```

- [ ] **Step 4: 完成 gate**(auto-verify)

`backend/`: `python -m pytest -q`(無後端改動,確認未破);`frontend/`: `npm test`、`npm run build`;`e2e/`: `npm test`。全綠。visual baseline 走 GitHub `e2e-update-snapshots` workflow(Win32 skip,本機生不了)。

- [ ] **Step 5: DevTools MCP 真實截圖**

dev server 起 backend(:8000)+ frontend(:5173),`resize_page` 至 375×667 / 768×1024 / 1440×900 / 2560×1440 各截 equity(含選股後)+ options + market,存 `docs/specs/responsive/screenshots/`。核對 SC1-SC6 逐項。

- [ ] **Step 6: Commit** — `feat(frontend): 響應式 e2e smoke + visual baseline + changelog 0.21.0` 與 `chore(frontend): responsive verification screenshots`
