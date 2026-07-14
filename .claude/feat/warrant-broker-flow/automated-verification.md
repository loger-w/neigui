# Automated Verification — warrant-broker-flow

Round 1(2026-07-14 11:55,HEAD = 4dc2166)全綠,一次過:

| # | 指令 | cwd | 結果 |
|---|---|---|---|
| 1 | `python -m pytest -q` | backend/ | exit 0 — **702 passed, 1 skipped**(含 test_warrant_flow.py 24 + contract 5) |
| 2 | `ruff check .` | backend/ | exit 0 — All checks passed |
| 3 | `npm test`(vitest run) | frontend/ | exit 0 — **81 files / 755 passed**(含 flow data/hook/panel/App 32) |
| 4 | `npm run build`(tsc -b + vite) | frontend/ | exit 0 — built in 1.31s |
| 5 | `npm test`(playwright,清 .cache 後) | e2e/ | exit 0 — **35 passed, 2 skipped**(@live/@visual 慣例跳過;含新 E14 + NTD2) |

E2E 判準:equity mode UI 新增 → 必跑類型(e2e-conventions),已實跑非豁免。
exit code 直取,無管線後綴(auto-verify 紀律)。
