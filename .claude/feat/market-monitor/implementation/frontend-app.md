# Implementation: ModeSwitch + App.tsx wire-up

Covers:`ModeSwitch.tsx` 擴展 + `ModeSwitch.test.tsx` 補測 + `App.tsx` market mode 整合。

Design source:`../design.md` v3 §6.1、§3 file table、§11 step 13-14。

---

## File 1:`frontend/src/components/ModeSwitch.tsx`(modify)

### Diff

```diff
-export type Mode = "equity" | "options";
+export type Mode = "equity" | "options" | "market";

 const MODES: Array<{ key: Mode; label: string }> = [
   { key: "equity",  label: "個股"  },
   { key: "options", label: "選擇權" },
+  { key: "market",  label: "大盤"  },
 ];
```

**所有其他 code 不動**(button render / aria-current / onClick handler 既有邏輯都對齊新 mode)。

### ModeSwitch.test.tsx 既有測試的影響(v3 C4 修)

既有 2 條 test 因 Mode union 擴 / MODES[] 增將自動經歷:
- `"renders both modes"` test 名過時 — 重命名為 `"renders three modes"` 並補大盤 button 斷言
- `"marks the active mode with aria-current=page"` 須鎖大盤 button 在 active=options 時 aria-current=null,避免將來 regression 把大盤誤 mark active

---

## File 2:`frontend/src/components/ModeSwitch.test.tsx`(modify — F7 + v3 C4 修)

### Diff(完整 — 含重命名 + assertion 補強)

```diff
-  it("renders both modes", () => {
+  it("renders three modes", () => {
     render(<ModeSwitch value="equity" onChange={() => {}} />);
     expect(screen.getByRole("button", { name: "個股" })).toBeTruthy();
     expect(screen.getByRole("button", { name: "選擇權" })).toBeTruthy();
+    expect(screen.getByRole("button", { name: "大盤" })).toBeTruthy();
   });

   it("marks the active mode with aria-current=page", () => {
     render(<ModeSwitch value="options" onChange={() => {}} />);
     expect(
       screen.getByRole("button", { name: "選擇權" }).getAttribute("aria-current"),
     ).toBe("page");
     expect(
       screen.getByRole("button", { name: "個股" }).getAttribute("aria-current"),
     ).toBeNull();
+    // v3 C4 — 鎖 active=options 時大盤 button 必須非 active
+    expect(
+      screen.getByRole("button", { name: "大盤" }).getAttribute("aria-current"),
+    ).toBeNull();
   });
```

### 新增 test

```ts
  it("marks 大盤 as active when value is 'market'", () => {
    render(<ModeSwitch value="market" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "大盤" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "個股" }).getAttribute("aria-current"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "選擇權" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("calls onChange('market') when 大盤 clicked from equity", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "大盤" }));
    expect(spy).toHaveBeenCalledWith("market");
  });
```

**TDD 順序**(對齊 design.md §11 step 13):
1. 先在 test 加 `name: "大盤"` assertion → 跑 → **紅**(component 還沒加)
2. 改 ModeSwitch.tsx 擴 MODES + Mode union → 跑 → **綠**
3. 增 active state + onChange test → 跑 → **綠**(既有邏輯已 cover)

**SC mapping**:SC-4(3 button + active 切換)。

---

## File 3:`frontend/src/App.tsx`(modify — v3 C1 + C3 修)

### 變動範圍

**v3 C1 修**:既有結構 `App.tsx:257-422` 是 2-way ternary `{mode === "equity" ? equity : <Suspense><OptionsPage /></Suspense>}`,**不是** hidden block。原 spec 「最末加 hidden block」會在 mode="market" 時導致 OptionsPage + MarketPage 同時 mount。必須改成 3-way ternary。

**v3 C3 修**:`handleSymbolPick` 複用既有 `handlePick`,確保切回 equity 時 symbolName / selectedBrokerIds / userPickedDate.current 全部 reset,不殘留上一檔狀態。

### 變更 1:加 lazy import(line ~53,跟 OptionsPage 並排)

```diff
 const OptionsPage = lazy(() =>
   import("./components/OptionsPage").then((m) => ({ default: m.OptionsPage })),
 );
+const MarketPage = lazy(() =>
+  import("./components/MarketPage").then((m) => ({ default: m.MarketPage })),
+);
```

### 變更 2:`handleSymbolPick` 新增(複用 handlePick,line ~207 之後)

```diff
   const handlePick = (sym: string, name: string | null) => {
     setSymbol(sym);
     setSymbolName(name);
     setSelectedBrokerIds(new Set());
     userPickedDate.current = false;
   };
+
+  // v3 C3 — 跨 mode pivot:reuse handlePick 確保 sibling state 全 reset
+  const handleSymbolPick = useCallback((sid: string) => {
+    setMode("equity");
+    handlePick(sid, null);
+  }, []);  // setMode / handlePick 都是 stable identity (handlePick 在 closure 內每 render 重建但 ref 用 setSymbol 等 setter 都 stable),deps 留空安全
```

注意:`handlePick` 在 closure 內每次 render 重建,但其內呼叫的 setter (`setSymbol`/`setSymbolName`/`setSelectedBrokerIds`)及 `userPickedDate.current` 都 React stable,`useCallback([])` 安全。

### 變更 3:把既有 2-way ternary 改 3-way(v3 C1 主修)

找到既有 line 257-422 block,把:
```tsx
{mode === "equity" ? (
  <div className="flex-1 flex flex-col overflow-hidden">
    ... equity 整段 ...
  </div>
) : (
  <Suspense fallback={...}>
    <OptionsPage />
  </Suspense>
)}
```
改成:
```tsx
{mode === "equity" ? (
  <div className="flex-1 flex flex-col overflow-hidden">
    ... equity 整段(不動,line 258-411 維持原樣) ...
  </div>
) : mode === "options" ? (
  <Suspense
    fallback={
      <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
        載入選擇權頁面...
      </div>
    }
  >
    <OptionsPage />
  </Suspense>
) : (
  <Suspense
    fallback={
      <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
        載入大盤掃描...
      </div>
    }
  >
    <MarketPage
      isActive={mode === "market"}
      onSymbolPick={handleSymbolPick}
    />
  </Suspense>
)}
```

**為何不用 hidden**:CLAUDE.md §3 講「`hidden` attribute > 條件 render」是 tab 切換內保 DOM(equity 內 overview / bubble 兩 tab 大家共享狀態,不能重 mount)。但 mode 之間沒有共享 state,既有 App.tsx 也是 ternary 條件 render — 維持既有風格。

### 變更 4:既有 ModeSwitch 不動(Mode union 擴展自動拿到「大盤」button)

### 變更 5:確認 `useCallback` 已在 line 1 imports(既有已 import,grep 確認 `useCallback` 在 `import { lazy, Suspense, useCallback, ...}`)

### 不動清單(明示避免 scope creep)
- 既有 equity mode 行為(三大法人 / 主力券商 / K 線 / N 日 window)
- 既有 options mode 行為
- 既有 localStorage 持久化(mode 已有,symbol 沒有,維持不動)
- 既有 ChipBubbleView / OptionsPage lazy import 不動
- `handlePick`(line 202-207)不動 — 它是 SymbolSearch 用,handleSymbolPick reuse 它

### Test File:無
App.tsx 無單測(專案約定 — grep `App.test` 確認不存在)。SC-4 真實環境驗證走 chrome-devtools-mcp 三 mode 切換截圖,並驗證 mode="market" 時 OptionsPage 不在 DOM。

### 沒有 test 檔
App.tsx 沒有現存單測(專案未為 App.tsx 寫 test,根據 grep 確認)— Phase 6 真實環境驗證(chrome-devtools-mcp 三 mode 切換 screenshot)涵蓋 SC-4 driving force。

**SC mapping**:SC-4(mode 新 + localStorage + lazy + Suspense + symbol pivot)。

---

## File 4:`frontend/src/hooks/useContainerSize.ts`(既有 — 不動)

MarketHeatmap 依賴此 hook。Phase 3 開工前 verify 既有檔在 `frontend/src/hooks/useContainerSize.ts`(根據 design.md §6.3 引用 `useContainerSize` 對齊 chip-kline-svg pattern)。若不存在 → 改用 `useRef + useEffect + ResizeObserver` inline。

**驗證**:Phase 3 step 10(MarketHeatmap)實作前 `grep -r useContainerSize frontend/src` 確認存在;若不存在 fallback inline。

---

## TDD step granularity for this file group(對齊 design.md §11 step 13-14)

| Step | 動作 | TDD phase |
|---|---|---|
| 13.1 | `ModeSwitch.test.tsx` 加「大盤」button assertion | 🟢 [red] |
| 13.2 | `pytest`(實際 `npm test ModeSwitch`)→ 確認紅 | (verify) |
| 13.3 | `ModeSwitch.tsx` Mode union + MODES[] 加 market | 🟢 [green] |
| 13.4 | `npm test ModeSwitch` → 綠 | (verify) |
| 13.5 | 新增 active state / onChange test → 跑 → 應該已綠(refactor 不必)| 🟢 [green] same commit |
| 13.6 | commit:`🟢 feat(market): SC-4 ModeSwitch 擴大盤 button [green]` | (commit) |
| 14.1 | App.tsx 加 MarketPage lazy import | 🟢 [green] |
| 14.2 | App.tsx 加 handleSymbolPick | 🟢 [green] |
| 14.3 | App.tsx 加 market mode hidden div + Suspense | 🟢 [green] |
| 14.4 | `npm run build` → tsc 過 | (verify) |
| 14.5 | commit:`🟢 feat(market): SC-4 App.tsx 接 market mode 跨 pivot [green]` | (commit) |
