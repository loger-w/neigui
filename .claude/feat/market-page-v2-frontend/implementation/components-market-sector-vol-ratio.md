# implementation: frontend/src/components/MarketSectorVolRatio.tsx(🟢)+ .test.tsx(🟢)

對應:SC-7、SC-10。design v3 §9。

## Props / 結構

```tsx
type Props = { rows: SectorVolumeRatioRow[] | null; eodAsOf: string | null; loaded: boolean };
export function MarketSectorVolRatio({ rows, eodAsOf, loaded }: Props): ReactElement
```

- root `<section data-testid="market-sector-vol-ratio" className="flex flex-col min-h-0 flex-1 p-3">`
- 標題列:「族群量能」+ `eodLabel(eodAsOf)`
- 三態同前:`!loaded` → `<div data-state="loading">` skeleton;null → `data-state="unavailable"`「資料暫缺」;`[]` → `data-state="empty"`「無符合資料」(I2-1)
- 表格(照 props 序;`overflow-y-auto min-h-0 flex-1`):
  - 欄:族群 / 今日量(萬張)/ 量比
  - 今日量:`lotsToWan(r.today_vol_lots)`
  - 量比:`r.vol_ratio?.toFixed(2) ?? "—"`
  - flag dot(**直接渲染 flag,不重算 1.5/0.7**,契約事實 7):

```tsx
{r.flag && (
  <span
    data-flag={r.flag}
    className={cn("inline-block w-2 h-2 rounded-full mr-1", r.flag === "hot" ? "bg-accent" : "bg-ink-dim")}
  />
)}
```

  - row `<tr data-testid={`svr-row-${r.sector}`}>`

## 失敗測試清單(.test.tsx,先紅)

1. `flag hot → data-flag=hot bg-accent;cold → bg-ink-dim;null → row 內無 [data-flag]`(SC-7 + edge 7)
2. `409858 lots → "41.0"`(SC-7 萬張換算)
3. `vol_ratio null → "—";2.1127 → "2.11"`(edge 7)
4. `三態`(unavailable / empty / loading)
5. `方向性文案 lock`(SC-10a)
6. `照 props 序渲染`(契約事實 10)
