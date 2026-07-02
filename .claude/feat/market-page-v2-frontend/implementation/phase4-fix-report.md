# Phase 4 Code Review Round 1 — Fix Report

Branch: `feat/market-page-v2-frontend`
Findings source: `.claude/feat/market-page-v2-frontend/code-review-round-1.json`
Fixed 8 accepted findings: CR1-0, CR1-3, CR1-4, CR1-5, CR1-6, CR1-10, CR1-11, CR1-13.

## Commits

| SHA | Message |
|---|---|
| `22e15ca` | 🟢 test(market): cold-load 量測 regression test for SC-4/SC-5 [red] |
| `cd49732` | 🔴 fix(market): containerRef 掛恆存 wrapper,冷載入後圖表不再空白 SC-4/SC-5 [green] |
| `2c48649` | 🟢 test(market): Δ 顯示與顏色同源 rounding 邊界 for SC-6 [red] |
| `502a81c` | 🔴 fix(market): Δ 顏色改用與顯示同源的四捨五入值 SC-6 [green] |
| `b0a7729` | 🟢 test(market): 載入狀態與訊號槽 a11y for SC-10 [red] |
| `c4f6c61` | 🔴 fix(market): loading role=status + 訊號槽 aria SC-10 [green] |
| `12eaab9` | 🟢 test(market): review 抽驗 lock — x 座標/props 序/grid 順序 (mutation-verified) SC-3/SC-7/SC-9 |

---

## Group A — CR1-10 / CR1-11 (P0 conditional-ref bug)

**Root cause**: `containerRef` was attached only inside the "data loaded" JSX
branch of `MarketBreadthPanel.tsx` / `MarketSectorBreadthHeatmap.tsx`. First
mount always renders the loading skeleton (no ref attached anywhere), so
`useContainerSize`'s single `useEffect` (deps `[ref, measure]`, both
referentially stable) runs once with `ref.current === null`, early-returns,
and never re-runs — even after the data branch mounts and a DOM node finally
receives the ref. Result: `width`/`height` stay `{0,0}` forever post cold
load, so McClellan/AD-Line SVGs render `width=0`/`height=0` and
`layoutCells(rows, 0, 0)` returns `[]` (its `w<=0` guard).

**Red test** (`frontend/src/components/MarketColdLoad.test.tsx`, new file):
deliberately does **not** mock `useContainerSize` (all other component tests
mock it to `{width:800,height:600}`, which hides this exact bug). Instead it
polyfills `ResizeObserver` and stubs `Element.prototype.getBoundingClientRect`
to return `{width:800,height:600,...}`, renders with `loaded=false`, then
`rerender`s with `loaded=true` + minimal data, and asserts the SVG picks up
`width="800"` (breadth panel) / 2 `sb-cell-*` buttons render (heatmap).

Red run before fix:
```
✗ MarketBreadthPanel: expected '0' to be '800'
✗ MarketSectorBreadthHeatmap: expected +0 to be 2 (received 0)
```

**Fix**: restructured both components so the ref-bearing wrapper div (with the
original `h-64 lg:h-full lg:flex-1 min-h-0 ...` sizing classes) is
unconditionally mounted, and the loading / unavailable / data-state content
renders *inside* it as children — matching the `MarketHeatmap.tsx:25`
always-mounted-ref pattern. `MarketBreadthPanel` splits the previous single
`body` variable into `chartArea` (goes inside the ref'd wrapper) and
`signalRow` (rendered as a sibling below, unaffected by measurement).
`MarketSectorBreadthHeatmap` keeps its existing three-state `body` but moves
`ref={containerRef}` from the data-branch div to a wrapper that now always
exists.

Post-fix: all 6 files in the affected set (`MarketColdLoad.test.tsx`,
`MarketBreadthPanel.test.tsx`, `MarketSectorBreadthHeatmap.test.tsx`,
`MarketPage.test.tsx`, plus the two component files) — 42 tests pass,
including the pre-existing `vi.mock`-based tests (DOM structure/testids for
loading/unavailable/data states unchanged).

---

## Group B — CR1-13 (Δ color/display rounding boundary)

**Root cause**: `MarketSectorAmountShare.tsx` colored `deltaClass` off the raw
`r.share_delta_20ma` value while the displayed text
(`signedPctPoints`) rounds to 2dp. A value like `-0.00003` displays as
`"0.00"` but was colored `text-ink-muted` (arguably fine) while `+0.00003`
also displays `"0.00"` yet the raw-value branch (`> 0`) picks `text-accent` —
color and displayed digits disagree at the rounding boundary.

**Red test**: added to `MarketSectorAmountShare.test.tsx` — rows with
`share_delta_20ma = -0.00003` and `+0.00003`; asserts both display `"0.00"`
and both get `text-ink-muted` (never `text-accent`). Failed pre-fix:
```
✗ tinyPos: expected true to be false (had text-accent)
```

**Fix**: derive `pts = r.share_delta_20ma == null ? null : Number((r.share_delta_20ma * 100).toFixed(2))` (same rounding as `signedPctPoints`) and branch color off `pts` instead of the raw value. `pts === 0` (including the boundary cases) now consistently renders `text-ink-muted`.

---

## Group C — CR1-0 / CR1-3 (a11y)

1. **CR1-0**: `SignalSlot`'s active dot gets `aria-label={`${label} 訊號觸發`}`
   (e.g. `"±100 訊號觸發"`); inactive dot gets `aria-hidden="true"`.
2. **CR1-3**: the `data-state="loading"` skeleton div in all four panels
   (`MarketBreadthPanel`, `MarketSectorBreadthHeatmap`,
   `MarketSectorAmountShare`, `MarketSectorVolRatio`) gets `role="status"` +
   `aria-label="載入中"`.

**Red tests**: 5 new tests across the four component test files (loading
a11y ×4 + signal-slot a11y ×1 in `MarketBreadthPanel.test.tsx`). Pre-fix all
5 failed with `expected null to be 'status'` / `expected null to be '±100 訊號觸發'`.

**Fix**: added the attributes as specified; all 5 tests green, no regression
in the other 26 tests in those 4 files.

---

## Group D — CR1-4 / CR1-5 / CR1-6 (test-gap locks, mutation-verified)

These lock already-correct behavior — no implementation change, only test
strengthening. Each was verified by mutating the implementation, confirming
the strengthened test goes red, then reverting via `git checkout --
<file>` and confirming green again.

### CR1-4 — `breadth-svg.test.ts` full-series x mapping

Added x assertions to the existing `[null,5,7,null,3]` test:
`w=100, pad=4, len=5 → step=(100-8)/4=23`.
- `segments[0].pts[0].x === 27` (d1, full-series i=1)
- `segments[0].pts[1].x === 50` (d2, i=2)
- `segments[1].pts[0].x === 96` (d4, i=4, `= w-pad`)

**Mutation**: rewrote `buildSegments` in `breadth-svg.tsx` to track a
segment-local index (`localIdx`, reset to 0 at each gap) instead of the
full-series index `i`, so `mapX(localIdx)` is used.

**Mutation red**:
```
✗ expected 4 to be 27 (segments[0].pts[0].x)
```
Reverted with `git checkout -- frontend/src/lib/breadth-svg.tsx`; re-ran →
14/14 green.

### CR1-5 — `MarketSectorVolRatio.test.tsx` props-order test

Old test used two rows with identical `today_vol_lots`/`vol_ratio`, so a
stable sort by any numeric field wouldn't visibly reorder them. Replaced with
`B族群 {vol_ratio:0.5, today_vol_lots:50000}` then
`A族群 {vol_ratio:2.0, today_vol_lots:200000}` — any ascending/descending
numeric re-sort flips the asserted `[B, A]` order.

**Mutation**: added `[...rows].sort((a,b)=>b.vol_ratio!-a.vol_ratio!)` before
`.map()` in `MarketSectorVolRatio.tsx`.

**Mutation red**:
```
✗ expected ['svr-row-A族群','svr-row-B族群'] to deeply equal ['svr-row-B族群','svr-row-A族群']
```
Reverted with `git checkout -- frontend/src/components/MarketSectorVolRatio.tsx`;
re-ran → 7/7 green.

### CR1-6 — `MarketPage.test.tsx` DOM-order test

Extended the existing SC-9 DOM-order test to also assert
`market-v2-grid` precedes `market-classic-toggle` via
`compareDocumentPosition(...) & Node.DOCUMENT_POSITION_FOLLOWING`.

**Mutation**: reordered `MarketPage.tsx` JSX to render the classic-view
`<section>` before the `market-v2-grid` div.

**Mutation red**:
```
✗ expected +0 to be truthy (grid→classicToggle FOLLOWING bit unset)
```
Reverted with `git checkout -- frontend/src/components/MarketPage.tsx`;
re-ran → 9/9 green.

---

## Final verification

```
$ cd frontend && npm test
 Test Files  54 passed (54)
      Tests  505 passed (505)

$ cd frontend && npx tsc -b
(no output, exit 0)
```

No files outside the named scope (8 accepted findings + their test/impl
files) were touched. No `--no-verify`, no jest-dom/user-event usage (all
assertions use `getAttribute` / `textContent` / `className.includes` /
`querySelector`, per project convention).
