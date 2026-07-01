# Phase 7 — Goal Verification Table

**Date**: 2026-07-01
**Re-read**: brainstorm.md re-parsed line-by-line (per verification-before-completion iron law)
**Fresh evidence**:
- pytest tests/test_market_breadth.py tests/test_finmind_realtime.py -q → `66 passed in 2.74s`
- pytest -q (full backend) → `366 passed, 1 skipped in ~21s`
- ruff check . → `All checks passed!`
- curl `/api/market/snapshot` → HTTP 200 + breadth field valid (see evidence/*.json)

## Structured evidence table

| SC-N | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據路徑 | regression 抽樣對象 |
|------|--------------|------------------------|------------------|-------------------|
| **SC-1** `compute_ad_line` 累計 | `backend/services/market_breadth.py:110` `compute_ad_line` | `test_compute_ad_line_accumulates` (1 pass) + observed in orchestrator test `test_compute_breadth_shape` net-zero fixture (ad_line_value==0.0 pass) | `evidence/SC-6_snapshot-happy-v2.json` — `ad_line_series` length=128, last value=-10805.0 (real market data, not zero) | test_snapshot_payload_adds_breadth (SC-6) — payload has breadth.ad_line_series intact after per-day fix |
| **SC-2** `compute_rana` + `compute_mcclellan` 19/39 EMA | `backend/services/market_breadth.py:120` `compute_rana` + `:151` `compute_mcclellan` + `:135` `_ema` | `test_rana_normal` (1), `test_rana_zero_denominator` (1), `test_mcclellan_warmup_returns_none` (1), `test_mcclellan_small_periods_hand_calc` (1, hand-calc α=2/3 & α=1/2 verified) → **4 pass** | `evidence/SC-6_snapshot-happy-v2.json` — `mcclellan_series` length=128, first non-None at 2026-02-10 (day 39, matches slow EMA warmup), last value=-0.0028 | `test_compute_breadth_warmup_insufficient_returns_none_signals` — TC_F4 orchestrator handoff |
| **SC-3** signal detectors (thrust/centerline/divergence) | `backend/services/market_breadth.py:172` `detect_thrust_dot` + `:188` `detect_centerline_cross` + `:202` `detect_divergence` | 10 tests in `TestSignalDetectors`: thrust ×4, centerline ×3, divergence ×3 → **10 pass** | `evidence/SC-6_snapshot-happy-v2.json` — thrust_dot=null, centerline_cross='below' (real signal from actual mcc time series crossing zero), divergence_dot=null | F3+F5 fixes have unit tests (strict comparators + date-align) covering the regression |
| **SC-4** `compute_breadth` orchestrator | `backend/services/market_breadth.py:463` `compute_breadth` + fetchers `:307` `_fetch_daily_prices_window` / `:384` `_fetch_taiex_series` + `_do_fetch_prices` @ `:330` (per-trading-day loop, Phase 6 fix) | `test_compute_breadth_shape` (numerical asserts: ad_line_value==0.0, mcclellan_oscillator==0.0, series length=59) + `test_compute_breadth_uses_injected_universe` (universe filter injection verified, taiex_unavailable known_gap emitted) + `test_compute_breadth_warmup_insufficient_returns_none_signals` (TC_F4) → **3 pass** | `evidence/SC-6_snapshot-happy-v2.json` — full BreadthResult shape returned by live endpoint; universe_size=1913 flowed from P1 filter | `test_snapshot_payload_adds_breadth` (SC-6 integration) — orchestrator wired end-to-end |
| **SC-5** edges (empty universe raises; TAIEX fail → divergence null) | `backend/services/market_breadth.py:472-473` `raise ValueError("universe_empty")` + `:403` `_do_fetch_taiex` fallback loop | `test_compute_breadth_empty_universe_raises` (1) + `test_compute_breadth_taiex_fetch_fail_divergence_null` (1) + F3 fallback coverage: `test_fetch_taiex_series_all_sid_fail_returns_empty` (empty 200) + `test_fetch_taiex_series_taiex_ok_no_fallback` (fast path) + `test_fetch_taiex_series_all_sid_raise_propagates` (F1 review fix — both raise → re-raise, no 24h cache pin) → **5 pass** | `evidence/SC-6_snapshot-happy-v2.json` — known_gaps=[] (TAIEX succeeded on live call); F6 stale-lock: `stale=false` even though breadth path exercises real errors | `test_snapshot_breadth_value_error_does_not_flip_stale` (TC_F1) — F6 stale-lock verified on both HTTPError and ValueError arms |
| **SC-6** finmind_realtime integration + F6 stale-lock | `backend/services/finmind_realtime.py:370` `_fetch_breadth` + `:549` orchestrator try/except + `:570` `"breadth": breadth` payload | `test_snapshot_payload_adds_breadth` (1) + `test_snapshot_breadth_fail_does_not_flip_stale` (HTTPError arm, 1) + `test_snapshot_breadth_value_error_does_not_flip_stale` (TC_F1 ValueError arm, 1) → **3 pass** | `evidence/SC-6_snapshot-happy-v2.json` (breadth field with 128-day series) + `evidence/SC-6_snapshot-cached.json` (24h cache hit, 11s vs cold 257s) | Full backend regression: 366 passed / 1 skipped — existing 4-panel leaderboards/sectors/universe_size/excluded_count all intact (backward-compat) |

## Failure type routing (per /feat Phase 7 taxonomy)

- **Type (1) Goal never covered by design** — N/A, all 6 SC map to design.md v3 sections
- **Type (2) Design covered but impl missing** — N/A, all impls present at cited line numbers
- **Type (3) Impl done but test missing** — resolved in review round 1 (TC_F1..F5 added)
- **Type (4) SC ambiguous in Phase 0** — N/A, brainstorm.md SC-1..6 unambiguous

## Meta-cycle count

Per state.json `sc_cycle_counts`:
- SC-3: total=1 (F3+F5 review fixes)
- SC-4: total=4 (design assumption invalidated by Phase 6 → phase_1 amend + phase_3 impl fix + phase_4 review + phase_6 fail). **Crossed the ≥3 cross-phase threshold** but each cycle addressed a distinct concern with definitive fix; no repeated stall on same subissue. Accepted as recorded (KG3 known gap + design v3 amend).
- SC-5: total=1 (F1 correctness review — re-raise on all-raise)
- SC-6: total=1 (Phase 4 review coverage)
- _unscoped: total=1 (Phase 4 code-review workflow round 1)

No SC exceeds the ≥2 same-phase threshold that would force Phase 0/1 rewrite.

## Verdict

**PASS** — SC-1..6 all backed by cited impl line + fresh test pass counts + real-env evidence. Table has zero `N/A`, `verified ✓`, `應該可以` per iron law. Advance to Phase 8.
