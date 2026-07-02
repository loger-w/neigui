# implementation: frontend/src/components/MarketBreadthPanel.tsx(🟢)+ .test.tsx(🟢)

對應:SC-4、SC-10。design v3 §6。

## Props / 結構

```tsx
import { useRef, type ReactElement } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { buildSegments, polylinePoints, sliceWindow, zeroLineY } from "../lib/breadth-svg";
import { eodLabel } from "../lib/market-format";
import type { Breadth } from "../lib/market-types";

type Props = { breadth: Breadth | null; eodAsOf: string | null; loaded: boolean };
export function MarketBreadthPanel({ breadth, eodAsOf, loaded }: Props): ReactElement
```

- root `<section data-testid="market-breadth-panel" className="flex flex-col min-h-0 border-r border-line p-3">`
- 標題列:`<h3 className="text-ink text-sm">市場廣度</h3>` + `<span className="text-ink-dim text-xs">{eodLabel(eodAsOf)}</span>`
- 三態(SC-4 / edge 1):
  - `!loaded` → `<div data-state="loading">`(skeleton:2 塊 `animate-pulse bg-bg-deep`;**判斷用 loaded 不用 isFetching**,SC-10c)
  - `breadth === null` → `<div data-state="unavailable" className="text-ink-dim text-xs">資料暫缺</div>`
  - 有資料 → chart 區
- chart 區(量測容器 `h-64 lg:h-full lg:flex-1 min-h-0 relative`,`useContainerSize`,R1-1/R2-1):
  - 上半 McClellan:`sliceWindow(breadth.mcclellan_series)` → `buildSegments(s, width, halfH, { includeZero: true })`;`<svg>` 內:0 線 `<line y1={zeroLineY(s, halfH)} ... stroke="var(--color-line-strong)" strokeDasharray="4 3">`;segments:pts.length===1 → `<circle r={1.5} fill="var(--color-ink)">`,否則 `<polyline points={polylinePoints(seg)} fill="none" stroke="var(--color-ink)" strokeWidth={1.2}>`
  - 標值:`McClellan {breadth.mcclellan_oscillator?.toFixed(1) ?? "—"}`
  - 下半 AD Line:同構,`includeZero: false`、stroke `var(--color-ink-dim)`、無 0 線;旁註 `<span className="text-ink-dim text-[10px]">窗口相對累計</span>`
- Signal strip(R1-5;chart 下方固定三槽 `flex gap-4 text-xs`):

```tsx
// 槽位共用小元件(檔內 private,不 export)
function SignalSlot({ label, active, testid, value, tone }: {...}): ReactElement
// active → <span data-testid={testid} data-value={value} className={`inline-block w-2 h-2 rounded-full ${tone}`} />
// inactive → <span className="inline-block w-2 h-2 rounded-full border border-line" />(無 testid)
```

  - 槽 1 label「±100」:`breadth.thrust_dot` → testid `breadth-thrust-dot`,tone `bg-accent`
  - 槽 2 label「0 線」:`breadth.centerline_cross` → testid `breadth-centerline-dot`,tone `bg-ink`
  - 槽 3 label「背離」:`breadth.known_gaps.includes("taiex_unavailable")` → 槽 3 整格改 `<span className="text-ink-dim">TAIEX 資料缺</span>`(無 dot);否則 `breadth.divergence_dot` → testid `breadth-divergence-dot`,tone `bg-ink-muted`

## 失敗測試清單(.test.tsx,先紅)

前置:`/** @vitest-environment jsdom */` + polyfill ResizeObserver + `vi.mock("../hooks/useContainerSize")` 回 `{width: 800, height: 600}`(design §16)+ `afterEach(cleanup)`。手造 Breadth props(known_gaps 分支不靠 fixture,R2-3)。

1. `資料態:標題 + 資料至日期 + McClellan 值 + polyline 存在`(SC-4;`container.querySelector("polyline")`)
2. `null 態:「資料暫缺」+ data-state=unavailable`(edge 1)
3. `taiex_unavailable:槽 3 顯示「TAIEX 資料缺」且無 breadth-divergence-dot`(edge 4)
4. `三 signal 全 active:三 dot testid 各自存在 + data-value 正確`(edge 9;thrust="above_plus_100" 等)
5. `三 signal 全 null:三 testid 皆 queryByTestId null`(inactive 槽無 testid)
6. `方向性文案 lock:queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/) → null`(SC-10a)
7. `eodAsOf null → 「最近交易日」`(edge 5)
8. `!loaded → data-state=loading,無「資料暫缺」`(SC-10c)
