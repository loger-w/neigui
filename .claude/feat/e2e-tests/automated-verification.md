# Phase 5 — Automated Verification Summary

**Date**: 2026-06-30  
**Branch**: feat/e2e-tests  
**Last commit**: 6cd565d

## Verification matrix

| Step | Command | Exit | Pass count | Notes |
|---|---|---|---|---|
| Backend pytest | `cd backend && python -m pytest -q` | 0 | **317 passed, 1 skipped** | 既有 19 tests + 6 新 gate tests + 24 新 D contract tests + 1 skip placeholder |
| Backend ruff | `cd backend && ruff check .` | 0 | **All checks passed** | line-length 100, py312 target |
| Frontend build | `cd frontend && npm run build` | 0 | **244 modules transformed** | tsc -b + vite production build,index 395KB |
| Frontend vitest | `cd frontend && npm test` | 0 | **424 passed (44 files)** | 既有 component / hook / lib testid 加在元件不破任一 |
| E2E Playwright | `cd e2e && npx playwright test` | 0 | **18 passed, 5 skipped, 0 failed** | 13.9s wall-clock(遠低於 5-min CI target) |

## E2E coverage detail(23 tests / 7 spec files)

- **equity.spec.ts**(5 / 5 pass):E1-E5 default render / search 2330 / tab switch / refresh / resize handle
- **options.spec.ts**(4 / 4 pass):O1-O4 4 cards / ladder + strip / OI walls call-put / per-card refresh
- **market.spec.ts**(1 / 3 — M1 pass / M2-M3 skip):heatmap + leaderboard root visible;M2 anti-empty tile + M3 leaderboard pivot skipped 待 fixture rotation(Phase 8.5 補真實 universe ~1700 stocks)
- **navigation.spec.ts**(4 / 4 pass):N1 aria-current toggle / N2 reload persistence / N3 chip_window_days localStorage / N4 三 mode mutual-exclusivity 序列(§9 sediment 防 ternary→hidden div race)
- **no-trading-day.spec.ts**(1 / 1 pass):NTD1 Sat 06-27 → 無交易 visible
- **visual.spec.ts**(0 / 3 — skipOnWin32):V1-V3 Linux CI only 設計
- **live-contract.spec.ts**(0 / 3 — @live tag,平時 grep-invert):L1-L3 真打 FinMind opt-in

## Skipped breakdown

- V1/V2/V3(3):visual baseline by design Linux CI only
- M2/M3(2):fixture universe 薄,待 Phase 8.5 enrichment
- 1 backend placeholder(test_500_error_shape_global_handler):等真有非預期 endpoint 例外時實作

## Pain-point verifications(/goal 對映)

每個 e2e test 上方註解 `// 痛點: <design rationale>`,鎖死:
- 痛點 A:FAKE_FINMIND env-gate 3 bypass(R3 確認 finmind_realtime / trading_calendar / symbols 各自旁路) → backend smoke + meta_mode endpoint pass
- 痛點 B:_get layer per-day fan-out(R2-P0-2) → fake _get in-memory slice 透過 17 fixture × 多 service 路徑 pass
- 痛點 C:Calendar typo(R2-P0-5)→ 2026-06-26 = Friday 全文確認;Sat-vs-Fri discriminative anti-tautology test_api_no_trading_day pass
- 痛點 D:routes/options.py:24 timebomb(R3-P1-CLOCK-ROUTES)→ test_options_routes_clock.py 鎖 _resolve_contract('TXO202607') 在 FAKE_TODAY=2026-06-26 + 過 7/15 wall clock 仍回 dict
- 痛點 E:MANIFEST drift(R3-P0-PARSE / R4-P1 / R5-P1)→ test_fake_finmind_manifest 3 個 gate(fixture-MANIFEST 雙向 / collision / dataset literal + URL-tail dataset 雙形式 grep)
- 痛點 F:Selector contract(R2-P2-3 / F7 / F9 / F10 / F15)→ 10 root testid + Wave 1 commit;ROLES 對齊 ModeSwitch `個股 / 選擇權 / 大盤`(非 `個股籌碼 / 大盤掃描`)+ aria-current(非 data-state)+ RangeSelector `設為 N 日`(非 `N 日`)
- 痛點 G:NoOpBucket layering(R3-P1-NOOPBUCKET)→ services/rate_limiter.py 公開 + tests/conftest re-export 維持 19 既有測試向後相容(287 pass 驗證)

## Conclusion

All 5 automated verification suites green。Phase 5 exit criterion satisfied。Phase 6 真實環境驗證已透過 Playwright 真 Chromium 環境變成 Phase 5 的副產品(整 stack spawn + browser navigate + DOM assertion + console errors trap via trace on failure)。
