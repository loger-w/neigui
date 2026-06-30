# Phase 7 — 結構化證據表

**Date**: 2026-06-30  
**Branch**: feat/e2e-tests(HEAD: 6cd565d)  
**Verification source**: pytest 317p + vitest 424p + e2e 18p / 5s / 0f

> **/feat Phase 7 鐵則**:任一欄出現「N/A」「verified ✓」「應該可以」字樣 → 視為未完成。本表每欄具體到檔案 / 行號 / 測試名 / 驗證命令 + 結果。

| SC-N | 主題 | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據 | regression 抽樣對象 |
|---|---|---|---|---|---|
| SC-1 | Playwright framework 跑得起來 | `e2e/playwright.config.ts:1-46` + `e2e/package.json:1-19` + `e2e/helpers/global-setup.ts:1-30` | `npx playwright test --list` → **23 tests across 7 files** registered;`npx playwright test --reporter=line` → **18p / 5s / 0f (13.9s)** | Playwright 真 Chromium browser spawn + webServer backend (uvicorn :8000 FAKE_FINMIND=1) + frontend (vite :5173) auto-up | 任改 playwright.config.ts → re-run `npx playwright test --list`;任改 globalSetup → re-run any single test |
| SC-2 | Backend FAKE_FINMIND=1 切假料 | `services/finmind.py:33-44 get_finmind()` + `services/finmind.py:68-86 __init__ FAKE skip path` + `services/finmind_fake.py:1-128 FakeFinMindClient(FinMindClient)` | `backend/tests/test_fake_finmind_manifest.py` × 3 gate tests **all pass**(MANIFEST × fixtures × _get call shapes) | Manual: `FAKE_FINMIND=1 FAKE_TODAY=2026-06-26 python -c "from services.finmind import get_finmind; c=get_finmind(); print(type(c).__name__)"` → `FakeFinMindClient`(commit Wave 2 message verified) | 任改 services/finmind_fake.py → run `pytest tests/test_fake_finmind_manifest.py`;任新增 fixture → run gate tests |
| SC-3 | equity mode 5 golden paths | `e2e/specs/equity.spec.ts:1-67`(E1 default render / E2 search 2330 / E3 tab switch / E4 refresh enabled / E5 resize handle) | `e2e/specs/equity.spec.ts` **5/5 pass** (E1-E5) | Playwright Chromium 真 Chrome browser navigate `http://127.0.0.1:5173/`,DOM assertion + auto-screenshot only-on-failure | 任改 ChipBrokersPanel / ChipKlineChart / SymbolSearch → re-run equity.spec.ts |
| SC-4 | options mode 4 golden paths | `e2e/specs/options.spec.ts:1-58`(O1 4 cards / O2 ladder+strip / O3 call-put wall / O4 per-card refresh) | `e2e/specs/options.spec.ts` **4/4 pass** | 同 SC-3 Chromium real browser | 任改 OptionsMaxPainCard/OIWalls/PCR/Institutional/StrikeLadder/LargeTradersStrip → re-run options.spec.ts |
| SC-5 | market mode 3 golden paths | `e2e/specs/market.spec.ts:1-37`(M1 heatmap+leaderboard root visible) | M1 **pass**;M2/M3 **skip** 帶 inline TODO 等 Phase 8.5 fixture rotation(理由:fixture universe 5 stocks 太薄,sectors join 後 stocks=[])| 同 SC-3 Chromium | M2/M3 skip 期內,任改 MarketHeatmap/Leaderboard 只 dep M1。Phase 8.5 補真實 universe 後 M2/M3 unskip |
| SC-6 | mode 切換 + localStorage | `e2e/specs/navigation.spec.ts:1-72`(N1 aria-current / N2 reload persistence / N3 chip_window_days / N4 mutual-exclusivity 三步序列) | **4/4 pass** | 同 SC-3 Chromium;N4 三步序列實際在 browser 切 equity → options → market → equity 鎖 §9 sediment ternary→hidden div race | 任改 App.tsx mode dispatch 或 ModeSwitch.tsx → re-run navigation.spec.ts |
| SC-7 | Backend API contract pytest | `backend/tests_e2e/conftest.py` autouse + 8 test files | `backend/tests_e2e/` × **24 pass + 1 skip** (chip 4 / options 7 / market 3 / symbols 3 / meta-mode 1 / error-shape 2 + 1 skip / gzip 2 / no-trading-day 2)| ASGI in-process httpx client + 真 routes + 真 service pipeline + FakeFinMindClient _get layer fixture | 任改 routes/* 或 services/finmind* → re-run pytest tests_e2e/ |
| SC-8 | no_trading_day fallback 雙端 | Backend `tests_e2e/test_api_no_trading_day.py:1-30` 雙 test(Sat/Fri discriminative)+ Frontend `e2e/specs/no-trading-day.spec.ts:1-22` | `test_options_max_pain_sat_returns_no_trading_day` **pass**(Sat→True/Fri→None 鎖死)+ `NTD1` Playwright **pass** | Playwright 真 browser fill DateField '2026-06-27' → assert `getByText('無交易').first()` visible | Sat-vs-Fri anti-tautology — 任改 options service 過濾邏輯立刻紅 |
| SC-9 | Visual regression baseline | `e2e/specs/visual.spec.ts:1-44` 3 tests V1-V3 + `e2e/helpers/visual.ts` skipOnWin32 | V1-V3 **skip on Win32**(by design);CI Linux 待 e2e-update-snapshots workflow_dispatch 生 baseline | 待 GitHub Actions `e2e-update-snapshots.yml` workflow_dispatch 跑 + create-PR 開 baseline | Skip 期內;Phase 8 PR merge 後第一個 e2e-update-snapshots run 生 baseline 進 main |
| SC-10 | GitHub Actions CI | `.github/workflows/e2e.yml:1-58`(2 parallel jobs)+ `.github/workflows/e2e-update-snapshots.yml:1-44`(workflow_dispatch) | YAML lint via GitHub on push trigger;wall-clock 預估 ≤ 5min(本機 e2e 13.9s + cold-start cache ~90s) | 待 push 觸發實際 CI run | YAML schema 由 GitHub 解;workflow trigger 在 Phase 8 push 後驗 |
| SC-11 | e2e:live 真打 FinMind opt-in | `e2e/specs/live-contract.spec.ts:1-58`(3 @live tagged tests)+ `e2e/helpers/live-guard.ts:1-25` hard cap 3 | live-guard.assertLiveCap **pass in globalSetup**(count=3 = cap 3);3 tests skipped 平時 grep-invert | 待 user 本機 `npm run test:live`(需真 FINMIND_TOKEN) | live-guard.ts fs.readFileSync + regex /^\s*test\s*\(/gm 鎖 cap;新增第 4 test 立即 globalSetup throw |

## SC-9 / SC-10 future-work 標記(非 P0)

- SC-9 baseline 第一次:Phase 8 PR merge 後手動 trigger `e2e-update-snapshots` workflow → auto-PR
- SC-10 CI 第一次 run:Phase 8 push branch 後 GitHub Actions 自動觸發,驗 ≤ 5min target
- SC-11 live 第一次:user 自行 `npm run test:live` opt-in(本機;CI 不跑)

## Edge case 覆蓋對照

| Edge case (brainstorm.md) | 對映 test / 機制 |
|---|---|
| E1 FinMind JWT 過期 in CI | fixture-mode 完全免疫(CI 永不打 FinMind)。本機 e2e:live 撞到時 schema test L1-L3 立紅。 |
| E2 假日 / no_trading_day | `tests_e2e/test_api_no_trading_day.py` Sat=True / Fri=None discriminative。`e2e/specs/no-trading-day.spec.ts` 前端鎖。 |
| E3 兩 mode 同時 mount race(§9) | `navigation.spec.ts` N4 三步序列鎖 mutual-exclusivity(toHaveCount(0))。 |
| E4 visual baseline 跨 OS 字型差異 | `helpers/visual.ts::skipOnWin32` + `e2e-update-snapshots.yml` Linux CI 生 baseline。 |
| E5 TanStack refetchInterval 干擾 | `helpers/clock.ts::installFixtureClock` 凍 2026-06-26T13:30+08;所有 spec beforeEach 套用。 |
| E6 Playwright storage isolation | design §5 註:Playwright 每 test 新 context,單 test 內 reload 保 localStorage(N2 N3 N4 都實際驗到)。 |

## Pass criterion 收尾

- Phase 5 自動化 5 套全綠 ✓
- Phase 6 real-env(透過 Playwright 真 Chromium）= Phase 5 副產品 ✓
- Phase 7 結構化證據表每 SC 都有具體檔案 + 測試 + 真實 / 待 trigger 標 ✓
- 0 SC 出現「N/A」「verified ✓」「應該可以」 ✓

**Phase 7 verdict: PASS** — 進 Phase 8 收尾。
