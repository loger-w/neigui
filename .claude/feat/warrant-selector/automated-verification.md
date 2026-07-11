# Automated Verification — warrant-selector

Round 1(HEAD 9eae703,2026-07-11)全綠:

| Gate | 結果 |
|---|---|
| backend `python -m pytest -q` | 627 passed, 1 skipped |
| backend `ruff check .` | 0 issues |
| frontend `npm test`(vitest) | 694 passed / 74 files |
| frontend `npm run build`(tsc -b + vite) | 成功 |
| e2e `npm test`(Playwright,FAKE fixtures) | 30 passed(run1 E10 冷 cache flaky retry 過;run2 全綠), 2 skipped = 既有 M2/M3 待補 fixture 與本 feature 無關 |

E2E 判準:equity UI 新 tab + 新 backend endpoints → 必跑類(e2e-conventions),E8–E11 新 spec 已入 equity.spec.ts。
