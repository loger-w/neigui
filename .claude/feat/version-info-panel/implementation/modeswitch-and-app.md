# Implementation Spec — `ModeSwitch.tsx` + `App.tsx`(整合 top bar)

對應 SC-1。

---

## `ModeSwitch.tsx` — refactor 去掉外層 chrome

### Before

```tsx
return (
  <div className="shrink-0 flex border-b border-line bg-bg" role="tablist">
    {MODES.map(...)}
  </div>
);
```

### After

```tsx
return (
  <div className="flex" role="tablist">
    {MODES.map(...)}
  </div>
);
```

### 既有測試影響

`ModeSwitch.test.tsx` 已存在。可能斷言 `role="tablist"` 或 mode button 行為。Refactor 移除外層 chrome 不影響 `role` / button render,**既有測試應保持綠**。

**Phase 3 必要動作**:跑 `npm test -- ModeSwitch` 確認既有測試仍綠,**否則回退** — 既有測試紅 = refactor 動到不該動的(鐵則 C)。

---

## `App.tsx` — 包 top bar wrapper

### 修改範圍(只動 ModeSwitch render 位置 + 加 VersionBadge,**其餘 equity / options 子樹完全不動**)

#### Before(line 203-206)

```tsx
return (
  <div className="h-full flex flex-col overflow-hidden">
    <ModeSwitch value={mode} onChange={setMode} />
    {mode === "equity" ? (
      ...
```

#### After

```tsx
import { VersionBadge } from "./components/VersionBadge";
// ...

return (
  <div className="h-full flex flex-col overflow-hidden">
    <header className="shrink-0 flex items-center border-b border-line bg-bg">
      <ModeSwitch value={mode} onChange={setMode} />
      <div className="ml-auto pr-4">
        <VersionBadge />
      </div>
    </header>
    {mode === "equity" ? (
      ...
```

**關鍵約束**:
- 不刪 / 不改 既有 `<Suspense fallback={...}>` 包裹 `OptionsPage` 與 `ChipBubbleView` 的部分
- 不動 equity header(`籌碼分析` h1 / SymbolSearch / DateField / RangeSelector / 重新整理 button)
- 不動 options page 內部

### 視覺結果

```
┌─────────────────────────────────────────────────────┐
│ [個股] [選擇權]                              [v0.1] │  ← top bar (新)
├─────────────────────────────────────────────────────┤
│ 籌碼分析 [搜尋] [日期] [範圍] [重新整理]            │  ← equity header (不動)
│ [籌碼總覽] [泡泡圖]                                 │
├─────────────────────────────────────────────────────┤
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

---

## 既有測試風險評估

| 測試檔 | 風險 | 緩解 |
|---|---|---|
| `ModeSwitch.test.tsx` | 中(refactor 移除 className,但 role / button 不變) | Phase 3 跑 `npm test -- ModeSwitch` 驗 |
| `App.tsx` 無 unit 測試 | 低 | TS build + dev server smoke |
| 其他 component test | 低 | App.tsx 變動限於 top bar,各 component 獨立 |

---

## Phase 3 失敗測試對應 SC-1 補充

實際上 `App.tsx` 沒有自己的 unit test。SC-1 「top bar 在兩個 mode 都看得到 badge」由:
1. `VersionBadge.test.tsx` — 元件層測 render
2. Phase 6 DevTools 截圖兩個 mode 各一張
   共同覆蓋。

App.tsx 改動的正確性由 `npm run build`(tsc + vite build)+ Phase 6 真實環境驗證承接。
