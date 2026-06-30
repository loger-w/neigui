# Implementation Plan — E2E Testing Framework

> Condensed Phase 2 — 單一 grid 取代 25 個 per-file MD,L 級 review 跳過(/goal 直接開發到完成)。
> Source of truth = `.claude/feat/e2e-tests/design.md` v6。
> 每 batch 內部 dep-order;batch 之間可 parallel(B/E 獨立於 A 完成,D/F 依 A+B+E)。

## Batch A — Backend Infrastructure (dep-ordered,序列)

| # | File | 動作 | TDD 紅測試名 | Rationale (痛點) |
|---|---|---|---|---|
| A1 | `backend/services/rate_limiter.py` | 新增 `NoOpBucket` 公開 class | `test_rate_limiter::test_noop_bucket_acquire_always_true` | duck-types TokenBucket;之前 tests/conftest.py 私有 → fake-mode 反向 import = layering 違規(R3-P1-NOOPBUCKET) |
| A2 | `backend/tests/conftest.py` | 改 `from services.rate_limiter import NoOpBucket` re-export | 既有 brokers_window 整合測通過 = regression OK | 維持 19 個既有測試 import 點不破 |
| A3 | `backend/services/clock.py` | 新檔:`today() / now()` 讀 `FAKE_TODAY` env(只 FAKE_FINMIND=1 才查) | `test_clock::test_today_uses_fake_today_when_finmind_fake_set` + `test_clock::test_today_falls_back_when_no_env` | 凍 backend 時鐘,fixture 永不漂移(R2-P0-3);防 2026-07-15 後 TXO202607 timebomb(R3-P1-CLOCK-ROUTES) |
| A4 | `backend/services/finmind.py` `__init__` | FAKE_FINMIND=1 → skip httpx + token + 用 NoOpBucket;else 既有路徑 | `test_finmind::test_init_skips_httpx_in_fake_mode` + 既有測試保留 | 讓 FakeFinMindClient 繼承不炸(R2-P0-1) |
| A5 | `backend/services/finmind.py` 15 處 `date.today()` swap | grep -n + sed-like edit;每處改 `from services.clock import today; today()` | `test_finmind_clock_swap::test_all_today_calls_use_clock_module` (regex audit) | fixture stability(R2-P0-3) |
| A6 | `backend/services/finmind_realtime.py` 1 處 swap | 同 A5 pattern | same audit test 涵蓋 | same |
| A7 | `backend/services/trading_calendar.py` | env-gate `_fetch_raw_dates_from_finmind` 讀 `TaiwanFuturesDaily_TX_calendar.json`;1 處 clock swap | `test_trading_calendar::test_fake_mode_reads_fixture_file` | F1 第 2 bypass + clock |
| A8 | `backend/routes/symbols.py` | `load_symbols` lifespan env-gate 讀 `TaiwanStockInfo.json` | `test_symbols_route::test_fake_mode_loads_from_fixture` | F1 第 3 bypass |
| A9 | `backend/routes/chip.py` line 110 + `backend/routes/options.py` line 24/32 | clock swap × 3 | `test_options_routes_clock::test_resolve_contract_uses_clock_module` (timebomb 鎖) | R3-P1-CLOCK-ROUTES 2026-07-15 timebomb |
| A10 | `backend/main.py` | (1) lifespan 前置 FAKE_FINMIND 嚴格驗證 (2) 加 `GET /api/_meta/mode` route | `test_main::test_lifespan_raises_on_invalid_fake_env` + `test_main::test_meta_mode_endpoint_shape` | fail-loud(R2-P2-1)+ globalSetup probe target(F6) |

## Batch B — Fake-FinMind & Fixtures (依 A4,B 內部 dep-ordered)

| # | File | 動作 | TDD 紅測試名 | Rationale |
|---|---|---|---|---|
| B1 | `backend/tests_e2e/__init__.py` | 空檔 | n/a | 讓 pytest 找到 package |
| B2 | `backend/tests_e2e/fixtures/MANIFEST.json` | 17 條 explicit mapping(設計 v6 已給完整 JSON) | `test_fake_finmind_manifest::test_manifest_includes_every_fixture` | drop heuristic(R3-P0-PARSE)+ skip_store 解 collision(R4-P1) |
| B3 | `backend/tests_e2e/fixtures/*.json` × 17 | minimal shape-correct payload(寫滿足 service parse 的 minimum row) | `test_fake_finmind_manifest::test_manifest_keys_match_real_get_call_shapes` (含 R5-P1 URL-tail union) | fixture stability |
| B4 | `backend/services/finmind_fake.py` | FakeFinMindClient(FinMindClient) + preload MANIFEST + skip_store + collision raise + in-memory slice | `test_fake_finmind::test_window_query_slices_by_date` + `test_fake_finmind::test_skip_store_no_collision` + `test_fake_finmind::test_path_tail_fallback` | _get layer per-day fan-out 對映(R2-P0-2)+ collision 防護(R4-P1) |

## Batch C — Gate Tests (Phase 3 紅先行,gates Batch D)

| # | File | 動作 | Rationale |
|---|---|---|---|
| C1 | `backend/tests/test_fake_finmind_manifest.py` | 設計 v6 已給完整實作(3 個 test 函式) | 防 MANIFEST drift + collision + dataset typo |
| C2 | `backend/tests/test_options_routes_clock.py` | `_resolve_contract('TXO202607')` 在 FAKE_TODAY=2026-06-26 + wall clock 過 7/15 仍回 dict | timebomb 鎖(R3-P1-CLOCK-ROUTES) |

## Batch D — Backend API Contract pytest (依 A+B+C)

| # | File | 動作 | TDD 紅 |
|---|---|---|---|
| D1 | `backend/tests_e2e/conftest.py` | autouse FAKE_FINMIND=1 + FAKE_TODAY=2026-06-26 + CHIP_DATA_DIR=tmp_path + ASGI client fixture | n/a (fixture itself) |
| D2 | `test_api_chip.py` | happy + 400 contract(`ids_required` / `too_many_ids`) | F11 — chip 沒 404,鎖既有 400 |
| D3 | `test_api_options.py` | 5 endpoint × happy + 真實 error code(`contract_required` / `invalid_contract` / 各 PCR error) | F11 |
| D4 | `test_api_market.py` | single `/api/market/snapshot` happy + payload shape(sectors / leaderboards / stale / as_of) | F17 |
| D5 | `test_api_symbols.py` | `/api/symbols?search=2` + `/api/symbols/all` | F4 |
| D6 | `test_api_meta_mode.py` | `/api/_meta/mode` 回 `{fake, fake_today, fixtures_dir}` | F6 probe target |
| D7 | `test_api_error_shape.py` | 至少 1 個 endpoint × {200, 400, 404, 502, 503} 全鎖 `{detail: {error: <code>}}` schema | API 契約 |
| D8 | `test_api_gzip.py` | response > 1000 bytes `Content-Encoding: gzip` | F7 contract |
| D9 | `test_api_no_trading_day.py` | `/api/options/max_pain?contract=TXO202607&date=2026-06-27` → `no_trading_day: true, as_of_date: 2026-06-26` | SC-8 + R3-P0-URL-SHAPE |

## Batch E — Frontend Testid Adds (與 A/B 完全獨立,可平行)

| # | Component | 動作 |
|---|---|---|
| E1 | `ChipBrokersPanel.tsx` | root `<div>` 加 `data-testid="chip-brokers-panel"` |
| E2 | `ChipKlineChart.tsx` | root 加 `data-testid="chip-kline-chart"` |
| E3 | `OptionsMaxPainCard.tsx` | root 加 `data-testid="options-max-pain-card"` |
| E4 | `OptionsOIWallsCard.tsx` | root 加 `data-testid="options-oi-walls-card"` |
| E5 | `OptionsPCRCard.tsx` | root 加 `data-testid="options-pcr-card"` |
| E6 | `OptionsInstitutionalCard.tsx` | root 加 `data-testid="options-institutional-card"` |
| E7 | `OptionsLargeTradersStrip.tsx` | root 加 `data-testid="options-large-traders-strip"` |
| E8 | `OptionsStrikeLadder.tsx` | root 加 `data-testid="options-strike-ladder"` |
| E9 | `MarketHeatmap.tsx` | root 加 `data-testid="market-heatmap"` |
| E10 | `MarketLeaderboard.tsx` | root 加 `data-testid="market-leaderboard"` |

每改一個 component 確認既有 vitest 仍綠(已用內部子 testid,不衝突)。

## Batch F — E2E Harness (依 A+B+D+E)

| # | File | 動作 |
|---|---|---|
| F1 | `e2e/package.json` | scripts + devDeps(@playwright/test, cross-env, typescript) |
| F2 | `e2e/tsconfig.json` | strict + Playwright types |
| F3 | `e2e/.gitignore` | test-results/ playwright-report/ node_modules/ .cache/ |
| F4 | `e2e/playwright.config.ts` | fakeMode env switch + webServer × 2(backend + frontend)+ globalSetup + Chromium-only |
| F5 | `e2e/playwright.live.config.ts` | extend + `--grep '@live'` |
| F6 | `e2e/helpers/global-setup.ts` | live-guard.assertLiveCap + probe `/api/_meta/mode` |
| F7 | `e2e/helpers/start-server.ts` | webServer wrapper(若 config 內 webServer 已足夠則 minimal) |
| F8 | `e2e/helpers/clock.ts` | `installFixtureClock(page)` → `page.clock.install({time: '2026-06-26T13:30:00+08:00'})` |
| F9 | `e2e/helpers/visual.ts` | `skipOnWin32()` + threshold const |
| F10 | `e2e/helpers/live-guard.ts` | fs.readFileSync + regex `/^\s*test\s*\(/gm`,cap 3 |
| F11 | `e2e/helpers/selectors.ts` | TESTIDS + ROLES 對齊 §6 + footer enforcement statement |
| F12 | `e2e/specs/equity.spec.ts` | SC-3 E1-E5 |
| F13 | `e2e/specs/options.spec.ts` | SC-4 O1-O4 |
| F14 | `e2e/specs/market.spec.ts` | SC-5 M1-M3 |
| F15 | `e2e/specs/navigation.spec.ts` | SC-6 N1-N4(N4 三步序列) |
| F16 | `e2e/specs/no-trading-day.spec.ts` | SC-8 NTD1(addInitScript + DateField.fill) |
| F17 | `e2e/specs/visual.spec.ts` | SC-9 V1-V3 + skipOnWin32 |
| F18 | `e2e/specs/live-contract.spec.ts` | SC-11 L1-L3 with `// LIVE TESTS HARD CAP: 3` |
| F19 | `frontend/package.json` | scripts `e2e` / `e2e:live` / `e2e:ui` / `e2e:update-snapshots`(cross-env) |
| F20 | `.gitignore` (root) | add e2e/{test-results,playwright-report,node_modules,.cache}/ |

## Batch G — CI

| # | File | 動作 |
|---|---|---|
| G1 | `.github/workflows/e2e.yml` | backend-api-contract + frontend-e2e parallel jobs;cache pip / npm / ms-playwright |
| G2 | `.github/workflows/e2e-update-snapshots.yml` | workflow_dispatch + peter-evans/create-pull-request |

## Commit 紀律(對齊鐵則 B)

- 每 batch 內每個 file change 一個 commit(三 commit pattern per file)
- 🟢 test `[red]` → 🟢 feat `[green]` → 🔵 refactor `[refactor]`(只有需要時)
- 元件 testid add = 一個 commit per file(無紅綠,純 enabling change),tag `[green]` 對應 selectors.ts 那 file 的 [red]
- Spec file 一個 commit per file(spec.ts 本身就是 test,不分 red/green)
- 跨 batch dep 完成才開下一個

## Phase 7 痛點對映(/goal 重點)

寫 spec 時每個 `test('XXX')` 上方必加 `// 痛點:<從 design.md 對應 R-finding 或 SC 邊界>` 註解。Phase 7 結構化證據表的 regression 抽樣對象欄走這個 comment。
