# implementation: frontend/src/components/MarketSectorAmountShare.tsx(🟢)+ .test.tsx(🟢)

對應:SC-6、SC-10。design v3 §8。

## Props / 結構

```tsx
type Props = { rows: SectorAmountShareRow[] | null; eodAsOf: string | null; loaded: boolean };
export function MarketSectorAmountShare({ rows, eodAsOf, loaded }: Props): ReactElement
```

- root `<section data-testid="market-sector-amount-share" className="flex flex-col min-h-0 flex-1 p-3 border-b border-line">`
- 標題列:「族群資金流向」+ `eodLabel(eodAsOf)`
- 三態同前:`!loaded` → `<div data-state="loading">` skeleton;null → `data-state="unavailable"`「資料暫缺」;`[]` → `data-state="empty"`「無符合資料」(I2-1,data-state 三字面值四 panel 一致)
- 表格(`overflow-y-auto min-h-0 flex-1`;**照 props 序渲染,不 sort**,契約事實 10):
  - 欄:族群 / 成交占比 / Δ20MA(**欄名「成交占比」不寫「占大盤」**,SC-6)
  - 占比:`pctText(r.today_share, 1)`
  - Δ:`signedPctPoints(r.share_delta_20ma)`;色:

```tsx
const deltaClass =
  r.share_delta_20ma == null ? "text-ink-dim"
  : r.share_delta_20ma > 0 ? "text-accent"
  : "text-ink-muted";   // < 0 與 0 都 ink-muted(0 非 accent,邊界)
```

  - row `<tr data-testid={`sas-row-${r.sector}`}>`

## 失敗測試清單(.test.tsx,先紅)

(無 useContainerSize → 不需 ResizeObserver 前置)

1. `照 props 序渲染不重排`(SC-6;傳入亂序 [B(0.1), A(0.4)],assert DOM 序 = props 序 B→A)
2. `Δ 正 → text-accent 且文字 "+0.16";負 → text-ink-muted "-0.59";null → "—" text-ink-dim;0 → "0.00" text-ink-muted`(SC-6 + edge 8;className 用 el.className.includes 驗)
3. `today_share 0.40561 → "40.6%"`(R1-2 換算)
4. `三態`(unavailable / empty / loading)
5. `方向性文案 lock`(SC-10a)
