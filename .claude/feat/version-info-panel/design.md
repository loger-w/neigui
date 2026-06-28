# Design — version-info-panel (v2)

> 對應 brainstorm.md 5 條 SC。每章節標 SC-N 對映。

## Changelog
- v2 (2026-06-29):round-1 review 4 條 finding 全 accepted
  - F1 (P0):popover header `資料來源:` 後補 space 對齊 brainstorm SC-2 斷言文字
  - F2 (P1):抽 pure `deriveCurrentVersion()` helper,SC-5 空 fallback 直接測
  - F3 (P2):badge className 移除 `font-variant-numeric` no-op token
  - F4 (P2):§4.1 顯式說明既有 Suspense fallback 必須保留
- v1 (2026-06-29):初版

---

## 1. 架構與元件總覽

```
┌─────────────────────────────────────────────────────────────┐
│ <header class="topbar"> (新)                                │
│   <ModeSwitch /> (refactor 去掉外層 chrome)                 │
│   <VersionBadge /> (新,ml-auto)                            │ ← SC-1
│ </header>                                                   │
├─────────────────────────────────────────────────────────────┤
│ {mode === "equity" ? <EquityPage/> : <OptionsPage/>}        │
└─────────────────────────────────────────────────────────────┘

VersionBadge 內含 Radix Popover:
  <Popover.Root>
    <Popover.Trigger> v0.1 </Popover.Trigger>            ← SC-1
    <Popover.Portal>
      <Popover.Content>                                  ← SC-2
        <header> 版本資訊 + 資料來源: FinMind </header>
        <ul>
          {CHANGELOG.map(v => <VersionEntryItem entry={v} />)}
        </ul>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>

資料層:
  frontend/src/lib/changelog.ts
    export type ChangeKind     = "feature" | "fix"
    export type ChangeScope    = "equity" | "options" | "global"
    export interface ChangeItem  { kind, scope, text }
    export interface VersionEntry { version, date, highlights?, changes }
    export const CHANGELOG: VersionEntry[]
    export const CURRENT_VERSION: string  ← SC-5(derive + fallback "0.0")
    export const DATA_SOURCES = ["FinMind"] as const
```

---

## 2. 檔案組織與責任

| 檔案 | 動作 | 對應 SC | 責任 |
|---|---|---|---|
| `frontend/src/lib/changelog.ts` | 新 | SC-3 / SC-5 | 型別 + CHANGELOG 常數 + CURRENT_VERSION + DATA_SOURCES |
| `frontend/src/lib/changelog.test.ts` | 新 | SC-3 / SC-5 | 倒序、空陣列 fallback、v0.1 存在、changes 內容 |
| `frontend/src/components/VersionBadge.tsx` | 新 | SC-1 / SC-2 | Badge + Popover content render |
| `frontend/src/components/VersionBadge.test.tsx` | 新 | SC-1 / SC-2 | render badge、點擊開 popover、內含資料來源 |
| `frontend/src/components/ModeSwitch.tsx` | mod | SC-1 | 移除 `border-b border-line bg-bg` 外殼,由父層接管 |
| `frontend/src/App.tsx` | mod | SC-1 | 包 top bar wrapper(`<header class="...">`),內含 ModeSwitch + VersionBadge |
| `CLAUDE.md` | mod | SC-4 | 新增「## 7. 版本管理慣例」節 |

---

## 3. 資料流(SC-3 / SC-5)

```
build-time TS const CHANGELOG → import 進 VersionBadge
                              → 無 fetch、無 async、無 cache
                              → 部署即新版本 reflect
```

- **CHANGELOG 排序**:source 寫入時手動倒序(最新在前),test 驗證單調遞減,**不在 runtime sort**(避免在每次 render 排一次)
- **CURRENT_VERSION derive(F2:抽 pure helper 方便 SC-5 測空 fallback)**:
  ```ts
  export function deriveCurrentVersion(entries: readonly VersionEntry[]): string {
    return entries[0]?.version ?? "0.0";
  }
  export const CURRENT_VERSION: string = deriveCurrentVersion(CHANGELOG);
  ```
  edge:CHANGELOG 空 → `deriveCurrentVersion([]) === "0.0"`,badge render `v0.0`,popover 內容顯示「無版本紀錄」

---

## 4. UI / a11y 規格(SC-1 / SC-2)

### 4.1 Top bar 結構(App.tsx 改寫)

```tsx
<div className="h-full flex flex-col overflow-hidden">
  <header className="shrink-0 flex items-center border-b border-line bg-bg">
    <ModeSwitch value={mode} onChange={setMode} />
    <div className="ml-auto pr-4">
      <VersionBadge />
    </div>
  </header>
  {mode === "equity" ? (...) : (
    <Suspense fallback={/* 既有 fallback 不可省略,見下方 */}>
      <OptionsPage/>
    </Suspense>
  )}
</div>
```

**F4 重要備註**:既有 App.tsx 對 `OptionsPage` 與 `ChipBubbleView` 的 `<Suspense fallback={...}>` 必須**逐字保留**(equity 中 bubble tab fallback「載入泡泡圖元件...」、options fallback「載入選擇權頁面...」)。Phase 2 改 App.tsx 時只動 top bar wrapper,**不要 collapse 既有 Suspense fallback**。

### 4.2 ModeSwitch refactor

before:
```tsx
<div className="shrink-0 flex border-b border-line bg-bg" role="tablist"> ... </div>
```
after:
```tsx
<div className="flex" role="tablist"> ... </div>
```
理由:外層 chrome(border / bg / shrink)由新 top bar wrapper 接管,ModeSwitch 只負責 mode 按鈕本身。

### 4.3 VersionBadge 視覺

```tsx
<Popover.Root>
  <Popover.Trigger asChild>
    <button
      type="button"
      aria-label={`版本資訊,目前 v${CURRENT_VERSION}`}
      className="px-2 py-1 text-xs text-ink-muted hover:text-accent border border-line hover:border-accent transition-colors cursor-pointer tabular-nums"
    >
      v{CURRENT_VERSION}
    </button>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
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
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
```

### 4.4 VersionEntryItem 子元件(inline,同檔)

```tsx
function VersionEntryItem({ entry }: { entry: VersionEntry }) {
  const features = entry.changes.filter(c => c.kind === "feature");
  const fixes    = entry.changes.filter(c => c.kind === "fix");
  return (
    <li className="px-3 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-ink">v{entry.version}</span>
        <span className="text-xs text-ink-dim">{entry.date}</span>
      </div>
      {entry.highlights && (
        <p className="mt-1 text-xs text-ink-muted">{entry.highlights}</p>
      )}
      {entry.changes.length === 0 ? (
        <p className="mt-2 text-xs text-ink-dim">(無條目)</p>
      ) : (
        <>
          {features.length > 0 && (
            <Section label="新增功能" items={features} />
          )}
          {fixes.length > 0 && (
            <Section label="修正" items={fixes} />
          )}
        </>
      )}
    </li>
  );
}

function Section({ label, items }: { label: string; items: ChangeItem[] }) {
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

### 4.5 a11y / 鍵盤(走 Radix Popover 預設)

- Trigger button `aria-label="版本資訊,目前 v0.1"`
- Esc 關閉、Tab focus trap、focus 回 trigger → Radix 內建
- Trigger 上 `aria-expanded` 由 Radix 自動管
- 不需 `aria-haspopup`(Radix 處理)

---

## 5. v0.1 Seed 內容(SC-3)

```ts
export const CHANGELOG: VersionEntry[] = [
  {
    version: "0.1",
    date: "2026-06-29",
    highlights: "首個有紀錄的版本 — 版本資訊面板上線,回顧近期主功能",
    changes: [
      { kind: "feature", scope: "global",  text: "新增版本資訊面板(header v0.x badge + popover changelog)" },
      { kind: "feature", scope: "options", text: "TXO 籌碼框架:Max Pain / OI Walls / PCR / Institutional 四卡" },
      { kind: "feature", scope: "equity",  text: "K-line Bollinger Bands overlay + 滾輪 / brush 縮放" },
      { kind: "feature", scope: "equity",  text: "N 日券商窗加總 + RangeSelector spinbutton" },
      { kind: "feature", scope: "equity",  text: "代號搜尋鍵盤導航(↑↓ / Enter / Esc)" },
      { kind: "fix",     scope: "options", text: "TX spot 包含夜盤、60s polling 更穩定" },
      { kind: "fix",     scope: "options", text: "TaiwanOptionDaily 每日 cache 加速冷啟動(27s → 4.3s)" },
    ],
  },
];
```

---

## 6. CLAUDE.md 「版本管理慣例」節(SC-4)

插入位置:現有「## 6. 提交慣例」後,「## 7. 2026 共識升級路線」前,作為新 `## 7. 版本管理慣例`(原 7 / 8 順移為 8 / 9)。

```markdown
## 7. 版本管理慣例

User-facing changelog 在 `frontend/src/lib/changelog.ts`,前端 top bar 右側 `v0.x` badge 點開即顯示。**每次 commit / PR 前必須討論一次**:本次改動要:
- **(a) 累加** 到當前最新 v0.x 的 `changes` 陣列,或
- **(b) bump** 到 v0.(x+1) 開新條目(`{ version, date, highlights, changes: [...] }`)

判準:
| 情境 | 動作 |
|---|---|
| 順手小修、未獨立發布的 WIP、單條補丁 | 累加 |
| 完成一個對使用者可感的獨立功能 | bump |
| 修一個影響使用體驗的 bug | bump |
| 一系列相關 commit 收尾(/feat 流程 Phase 8) | bump |
| 純內部 refactor / 測試補強 / 文件 | 通常不入 changelog,如要入則累加 |

實作要求:
- changelog 條目 scope 三選一:`equity` / `options` / `global`,**不要混用** `prop` 或自由文字
- `date` 用 `YYYY-MM-DD`(同專案其他 date 慣例)
- `text` 一句話描述使用者看得懂的內容,**不寫實作細節**(壞:「refactor brokers_window cache key」/ 好:「N 日券商窗冷啟動加速」)
- 提交 message body 註明對應版本動作,例 `chore(changelog): bump v0.1 → v0.2 for chip framework`
- 起始版本為 v0.1。**v1 留給 user 自行決定發布時點**

不在此次自動化驗證強制,屬 PR 流程紀律(類似 commit message convention)。
```

---

## 7. 安全 / 邊界 / 隱性假設

- **無外部輸入** — CHANGELOG 是 build-time 常數,無 XSS / 注入面
- **無 PII** — 純功能描述
- **無 backend** — 不影響 API contract、不需 backend cache invalidation
- **不影響 hot path** — Popover 用 React.lazy 不必要(常數 + Radix 已 tree-shake),直接 import OK
- **隱性假設**:
  - `radix-ui` 1.6.0 (umbrella) 確實 export Popover primitive(已知為事實,文件確認)
  - Tailwind 4 `@theme` semantic tokens (`bg-bg-deep`, `border-line`, `text-ink*`) 已存在於 `index.css`(專案既有)
  - `ModeSwitch` 沒有其他 consumer(grep 驗證,僅 App.tsx 一處使用)

---

## 8. Testability(每元件可獨立測)

| 元件 | 測試類型 | 主要 assertion |
|---|---|---|
| `changelog.ts` | 純資料 unit | 倒序、空陣列 fallback、v0.1 schema |
| `VersionBadge` | RTL render + user-event click | render badge text、aria-label、點開後 popover 內容(含 `資料來源: FinMind`、`v0.1`、change text) |
| `ModeSwitch` | 既有測試不破 | refactor 後仍能切 mode、`role="tablist"` 仍在 |
| `App.tsx` | smoke(既有 SymbolSearch 測試已涵蓋 mount) | top bar 包含 VersionBadge(`screen.getByRole('button', { name: /版本資訊/ })`) |
| `CLAUDE.md` | bash grep | `grep "版本管理慣例" CLAUDE.md` 命中 1 |

---

## 9. Known Risks(目前 0 項)

(設計階段未識別任何接受的風險,若 review 後出現再補)

---

## 10. SC-N 對應章節索引

| SC | 章節 |
|---|---|
| SC-1 | §1 架構圖、§4.1 top bar、§4.3 trigger button |
| SC-2 | §4.3 Popover content、§5 seed、§4.4 VersionEntryItem |
| SC-3 | §2 檔案組織、§5 seed、§8 testability |
| SC-4 | §6 CLAUDE.md 節 |
| SC-5 | §3 資料流、§8 testability(空 fallback) |
