# Phase 5 自動化驗證 — daytrade-borrow-fee(round 1 全綠)

日期:2026-07-11;HEAD:be407b1;指令組來源:`.claude/harness.json` verify 陣列 + e2e 條件 gate。

| step | command | cwd | 結果 |
|---|---|---|---|
| backend | `python -m pytest -q` | backend/ | **544 passed, 1 skipped**(baseline 515 → +29 本 feature) |
| backend-lint | `ruff check .` | backend/ | All checks passed |
| frontend-test | `npm test` | frontend/ | **655 passed / 69 files**(baseline 626 → +29) |
| frontend-build | `npm run build`(tsc -b + vite) | frontend/ | ✓ built in 1.29s,0 TS errors |
| e2e(條件 gate:本 feature 屬「必跑」— 新 mode UI) | `npm test`(playwright) | e2e/ | **26 passed / 2 skipped(@live/@visual)**,21.6s,AI 實跑 |

無紅燈,無 retry。e2e 判準:e2e-conventions 表「新 mode UI」→ N# 擴充 + 新 BF# spec,已於 wave5 落地。
