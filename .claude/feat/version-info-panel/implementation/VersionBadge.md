# Implementation Spec — `frontend/src/components/VersionBadge.tsx` + `VersionBadge.test.tsx`

對應 SC-1 / SC-2。

---

## `VersionBadge.tsx`

### Imports

```tsx
import type { ReactElement } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import {
  CHANGELOG, CURRENT_VERSION, DATA_SOURCES,
  type VersionEntry, type ChangeItem, type ChangeScope,
} from "../lib/changelog";
```

> Note:既有專案用法為 `import { Tabs as TabsPrimitive } from "radix-ui"`(見 `ui/tabs.tsx`)和 `import { Slot } from "radix-ui"`(見 `ui/button.tsx`)。沿用同 pattern,**不要**寫 `import * as Popover from "@radix-ui/react-popover"`。

### 公開元件 signature

```tsx
export function VersionBadge(): ReactElement
```

無 props(資料皆 import)。

### 內部結構

```tsx
export function VersionBadge(): ReactElement {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`版本資訊,目前 v${CURRENT_VERSION}`}
          className="px-2 py-1 text-xs text-ink-muted hover:text-accent border border-line hover:border-accent transition-colors cursor-pointer tabular-nums"
        >
          v{CURRENT_VERSION}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={6}
          align="end"
          className="z-50 w-[360px] max-h-[60vh] overflow-y-auto bg-bg-deep border border-line shadow-lg"
        >
          <header className="sticky top-0 bg-bg-deep border-b border-line px-3 py-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">版本資訊</h2>
            <span className="text-[10px] text-ink-dim uppercase tracking-wide">
              {`資料來源: ${DATA_SOURCES.join(" / ")}`}
            </span>
          </header>
          <ul className="divide-y divide-line">
            {CHANGELOG.length === 0 ? (
              <li className="px-3 py-4 text-sm text-ink-dim">無版本紀錄</li>
            ) : (
              CHANGELOG.map((v) => <VersionEntryItem key={v.version} entry={v} />)
            )}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function VersionEntryItem({ entry }: { entry: VersionEntry }): ReactElement {
  const features = entry.changes.filter((c) => c.kind === "feature");
  const fixes    = entry.changes.filter((c) => c.kind === "fix");
  return (
    <li className="px-3 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-ink tabular-nums">v{entry.version}</span>
        <span className="text-xs text-ink-dim tabular-nums">{entry.date}</span>
      </div>
      {entry.highlights && (
        <p className="mt-1 text-xs text-ink-muted">{entry.highlights}</p>
      )}
      {entry.changes.length === 0 ? (
        <p className="mt-2 text-xs text-ink-dim">(無條目)</p>
      ) : (
        <>
          {features.length > 0 && <Section label="新增功能" items={features} />}
          {fixes.length > 0 && <Section label="修正" items={fixes} />}
        </>
      )}
    </li>
  );
}

function Section({ label, items }: { label: string; items: ChangeItem[] }): ReactElement {
  return (
    <div className="mt-2">
      <div className="text-[10px] text-ink-dim uppercase tracking-wide">{label}</div>
      <ul className="mt-0.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-xs text-ink-muted">
            <span className="mr-1 px-1 text-[10px] border border-line text-ink-dim">
              {scopeLabel(it.scope)}
            </span>
            {it.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function scopeLabel(s: ChangeScope): string {
  return s === "equity" ? "個股" : s === "options" ? "選擇權" : "全局";
}
```

### a11y

- Trigger button `aria-label` 含目前版本號
- Esc / Tab focus 由 Radix 內建
- 不額外加 `role` / `aria-haspopup`

---

## `VersionBadge.test.tsx`

### 檔頭 pragma

```tsx
/**
 * @vitest-environment jsdom
 */
```

### Imports(沿用 ModeSwitch.test.tsx 風格 — 無 jest-dom、無 user-event)

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VersionBadge } from "./VersionBadge";
import { CURRENT_VERSION } from "../lib/changelog";

afterEach(() => {
  cleanup();
});
```

> ⚠ 專案**沒裝** `@testing-library/jest-dom` 也**沒裝** `@testing-library/user-event`,既有 `ModeSwitch.test.tsx` / `OptionsLargeTradersStrip.test.tsx` 都用 `fireEvent` + 原生 vitest matcher(`toBeTruthy()` / `toBeNull()` / `getAttribute()`)。新測試 **必須**沿用同 pattern,不要寫 `toBeInTheDocument()` / `toHaveTextContent()`。

### 失敗測試清單

#### SC-1 — badge render

```tsx
describe("VersionBadge — SC-1", () => {
  it("render trigger button 含 aria-label『版本資訊』", () => {
    render(<VersionBadge />);
    const btn = screen.getByRole("button", { name: /版本資訊/ });
    expect(btn).toBeTruthy();
  });

  it("trigger button 文字為 v${CURRENT_VERSION}", () => {
    render(<VersionBadge />);
    const btn = screen.getByRole("button", { name: /版本資訊/ });
    expect(btn.textContent).toBe(`v${CURRENT_VERSION}`);
  });
});
```

#### SC-2 — 點擊開 popover 顯示 changelog + 資料來源

```tsx
describe("VersionBadge — SC-2", () => {
  it("初始未開:popover h2 標題不在 DOM", () => {
    render(<VersionBadge />);
    expect(screen.queryByRole("heading", { name: "版本資訊" })).toBeNull();
  });

  it("點擊 trigger 後 popover 開,顯示『資料來源: FinMind』", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    expect(screen.getByText("資料來源: FinMind")).toBeTruthy();
    // 不用 getAllByText(/v0\.1/) 因為 trigger 本就含 v0.1 — 改用 popover-only 證據:
    // `版本資訊面板` 文字 + h2 標題 — 見下面測試。
  });

  it("popover 內含『版本資訊面板』seed 條目", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    expect(screen.getByText(/版本資訊面板/)).toBeTruthy();
  });

  it("popover 顯示 scope 標籤(個股 / 選擇權 / 全局)", () => {
    render(<VersionBadge />);
    fireEvent.click(screen.getByRole("button", { name: /版本資訊/ }));
    // v0.1 seed 三種 scope 都有
    expect(screen.getAllByText("全局").length).toBeGreaterThan(0);
    expect(screen.getAllByText("個股").length).toBeGreaterThan(0);
    expect(screen.getAllByText("選擇權").length).toBeGreaterThan(0);
  });
});
```

### 範例自洽性確認

- `aria-label={`版本資訊,目前 v${CURRENT_VERSION}`}` 內含「版本資訊」→ `getByRole('button', { name: /版本資訊/ })` 可命中
- popover content `<h2>版本資訊</h2>` 也含「版本資訊」 → SC-2 第一個 `queryByText` 加 `selector: "h2"` 過濾,避免命中 trigger 的 aria-label

### Test 失敗 → 通過範例

- `VersionBadge.tsx` 不存在 → import error,3 個 describe 全紅
- 純 stub `export function VersionBadge() { return null; }` → SC-1 紅 + SC-2 全紅
- 加 trigger button(aria-label + text)→ SC-1 綠,SC-2 仍紅
- 加 popover content → SC-2 全綠
