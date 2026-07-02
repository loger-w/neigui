# implementation: frontend/src/components/MarketSectorBreadthHeatmap.tsx(🟢)+ .test.tsx(🟢)

對應:SC-5、SC-10。design v3 §7。

## Props / 結構

```tsx
type Props = {
  rows: SectorBreadthRow[] | null;
  eodAsOf: string | null;
  loaded: boolean;
  onSectorClick: (sector: string) => void;
};
export function MarketSectorBreadthHeatmap({ rows, eodAsOf, loaded, onSectorClick }: Props): ReactElement
```

- root `<section data-testid="market-sector-breadth-heatmap" className="flex flex-col min-h-0 p-3">`
- 標題列:「族群參與度」+ `eodLabel(eodAsOf)` + 副標 `<span className="text-ink-dim text-[10px]">站上 20 日均線比例</span>`
- 三態:`!loaded` → `<div data-state="loading">` skeleton(I2-1,四 panel 一致,MarketPage 整合測試 #5 依賴);`rows === null` → `data-state="unavailable"`「資料暫缺」;`rows.length === 0` → `data-state="empty"`「無符合資料」(edge 2,與 null 態文案不同);有資料 → cells
- cells 區(`relative h-64 lg:h-full lg:flex-1 min-h-0` + `useContainerSize`):
  - `layoutCells(rows, width, height)` 包 `useMemo`(MarketHeatmap.tsx:19-22 樣板)
  - 每 cell:絕對定位 HTML button(R1-6):

```tsx
<button
  type="button"
  key={c.sector}
  data-testid={`sb-cell-${c.sector}`}
  data-fill-bin={c.bin}
  onClick={() => onSectorClick(c.sector)}
  className={cn("absolute overflow-hidden text-left cursor-pointer rounded-sm px-1", BIN_CLASS[c.bin])}
  style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
>
  <span className="block text-[10px] truncate">{c.sector}</span>
  <span className="block text-[10px]">{pctText(c.pct, 0)}</span>
</button>
```

  - `BIN_CLASS: Record<BreadthBin, string>`(design §5 色票定案表):
    strong `bg-accent/70 text-ink` / mid `bg-accent/35 text-ink` / weak `bg-line-strong/50 text-ink-muted` / cold `bg-bg-deep text-ink-dim`
    (**嚴禁 bull/bear**)

## 失敗測試清單(.test.tsx,先紅)

前置同 BreadthPanel(ResizeObserver polyfill + mock useContainerSize 800×600)。

1. `44 rows(fixture 實值取 3 筆 + 湊 44)→ 44 個 sb-cell-* 全 render`(SC-5 彈性 cells;不 hardcode 44 — assert cells 數 === rows.length)
2. `click cell → onSectorClick(該 sector 中文名字串)`(SC-5;vi.fn + fireEvent.click)
3. `data-fill-bin 正確`(pct 0.8 → strong;0.4 → weak)
4. `null 態 / 空態 / loading 態三分`(edge 2;data-state 各異)
5. `近似重複名兩 rows(「運動休閒」「運動休閒類」)→ 兩 cell 並存`(edge 10)
6. `方向性文案 lock`(SC-10a)
