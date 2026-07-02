# Task 3 report — MarketBreadthPanel + MarketSectorBreadthHeatmap

## STATUS: DONE

## Commits (4, TDD red/green pairs)

1. `0675e04` 🟢 test(market): MarketBreadthPanel component 測試 for SC-4 [red]
2. `4e9ae76` 🟢 feat(market): MarketBreadthPanel SC-4 [green] (red→green for 0675e04)
3. `95739b7` 🟢 test(market): MarketSectorBreadthHeatmap component 測試 for SC-5 [red]
4. `a62bc62` 🟢 feat(market): MarketSectorBreadthHeatmap SC-5 [green] (red→green for 95739b7)

## Test summary

- `MarketBreadthPanel.test.tsx`: 8/8 passed (loading/unavailable/data states, taiex_unavailable gap, all-active/all-null signal slots, directional-copy lock, eodAsOf-null fallback).
- `MarketSectorBreadthHeatmap.test.tsx`: 6/6 passed (44-row cell count, click→onSectorClick, data-fill-bin strong/weak, loading/unavailable/empty three-way state, near-duplicate sector names coexist, directional-copy lock).
- Full frontend suite (`npm test`): 475/475 passed, 50/50 files (one run showed a flaky pre-existing failure in `BrokerSearch.test.tsx` unrelated to this task — untouched file, passed both standalone and on rerun of the full suite).
- `npx tsc -b`: clean, no errors.

## Files touched (exactly the 4 listed deliverables)

- `frontend/src/components/MarketBreadthPanel.tsx`
- `frontend/src/components/MarketBreadthPanel.test.tsx`
- `frontend/src/components/MarketSectorBreadthHeatmap.tsx`
- `frontend/src/components/MarketSectorBreadthHeatmap.test.tsx`

## Concerns

- `BrokerSearch.test.tsx` (`Arrow down then Enter selects second item`) failed once when run as part of the full 50-file suite but passed standalone and on a full-suite rerun — pre-existing flake unrelated to this task's files (not touched here, out of scope to fix per task rules).
- `MarketPage.tsx` does not yet wire in these two new components (that appears to belong to a later integration task, e.g. Task 4) — left untouched per scope.
