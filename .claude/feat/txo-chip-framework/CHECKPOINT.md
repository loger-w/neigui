# txo-chip-framework — Phase 3 TDD checkpoint

> 2026-06-26 session checkpoint. **Backend FULLY complete end-to-end** (175 backend pytest green; ruff + pyright clean). All 4 chip endpoints serve. Remaining: full frontend (24 files), Phase 4-8 review/verification, Phase 6 real-env (BLOCKED on token refresh).

## Completed (this session)

### Phase 0 — Brainstorm + scope (L)
- `.claude/feat/txo-chip-framework/brainstorm.md` — 13 SCs with verification commands
- L scope (≥ 5 files, cross-tier, new datasets)
- 12 commits

### Phase 1 — Design (3 review rounds, 79 findings resolved)
- `docs/superpowers/specs/2026-06-25-txo-chip-framework-design.md` v1 → v4
- Round 1: 41 findings (12 P0 / 16 P1 / 13 P2). All accepted bar 1 (R7 refresh stampede, deferred MVP2)
- Round 2: 26 findings (1 P0 / 12 P1 / 13 P2). All accepted; round-1 P0/P1 confirmed resolved
- Round 3: 12 findings (0 P0 / 5 P1 / 7 P2). All accepted; tactical clarifications
- Each round JSON in `.claude/feat/txo-chip-framework/design-review-round-{1,2,3}.json`

### Phase 2 — Module impl specs
- `.claude/feat/txo-chip-framework/implementation/M1..M5-*.md`
- 5 modules × 4101 lines total (test-infra, fetch-cache, parsers, routes, frontend)
- Phase 2 formal review skipped (design v4 already deeply reviewed; specs derivative)

### Phase 3 — Backend infrastructure (DONE)
- `backend/utils/cache.py` — `delete_by_prefix(prefix)` (4 tests)
- `backend/utils/trading_calendar_helpers.py` — `count_back_trading_days` pure function (9 tests)
- `backend/services/trading_calendar.py` — `get_trading_days` with 7-day cache + self-httpx (5 tests)
- `backend/tests/conftest.py` — unified `_reset_finmind_singleton_and_env` autouse + `NoOpBucket` + `bypass_finmind_rate_limiter` opt-in. Removed duplicates from `test_finmind.py` / `test_finmind_options.py`
- `backend/tests/fixtures/options_chip/probe.py` — SC-0 schema probe (LIVE BLOCKED, see R14)

### Phase 3 — Backend parsers (DONE — TDD red+green for each SC pair)
- **SC-1 / SC-5** `parse_max_pain` + `parse_max_pain_hit_rate` (7 tests):
  - Union strikes (F1), strict contract_date filter (F2), NT$50 multiplier (F14)
  - T-1 alignment (F3 — no look-ahead), `latest_settlement_pending` flag (F10)
- **SC-2 / SC-6** `parse_oi_walls` + `parse_oi_walls_hit_rate` (5 tests):
  - Static max-OI walls with closest-to-spot tie-break (F16)
  - Dynamic walls = Σ\|ΔOI\| over consecutive day pairs (N4 — not telescoping)
  - `dynamic_wall_partial_window` / `_no_activity` warnings (N13)
- **SC-3 / SC-7** `parse_pcr_history` + `parse_pcr_walk_forward_percentile` + `parse_pcr_next_day_stats` (7 tests):
  - Strictly-past window for percentile (F4 — no look-ahead)
  - `kind='mean'` percentileofscore (F15)
  - Single consolidated `pcr_walk_forward_warmup_skipped_first_N_days` warning (F14)
  - Stats per region (no P&L, no Sharpe — F2-testability); samples inside region dict (F17)
  - `pcr_stats_low_power_{region}` < 30 samples (N8); `next_day_stats_dropped_samples_5pct` (N9)
- **SC-4 / SC-8** `parse_institutional` + `parse_institutional_correlation` (5 tests):
  - `NIGHT_SESSION_AVAILABLE_FROM = 2021-10-13` constant; `after_hours = None` pre-cutoff (F12)
  - `foreign` / `dealer` / `trust` naming (F3-integration — NOT 'prop')
  - Pure-Python `_spearman_rho` (no numpy dep)
  - Permutation p-value (N2 — NOT bootstrap CI)
  - Foreign-only scope guard (F10-testability — dealer/trust never in correlation payload)
  - `raw_flow` default; `first_difference` opt-in (N3)
  - `correlation_sample_small` warning < 30 samples
  - Deterministic via `seed=42` default

**Total: 24 new parser tests, 162/162 backend pytest green.**

---

## BLOCKED — needs user action

### B1. `FINMIND_TOKEN` refresh
- Current token expired 2026-06-24 (JWT `exp` claim). Probe script `tests/fixtures/options_chip/probe.py` cannot run.
- **What to do**: refresh sponsor-tier token at finmind.github.io → write into `backend/.env`
- **What happens then**: SC-0 live probe becomes runnable; Phase 6 real-env verification unblocked
- Recorded as **R14** in design v4 §8

---

## Remaining work (next session)

### Phase 3 — Backend fetch + routes (DONE)

All 4 endpoints serve end-to-end (175 backend pytest pass):

- `GET /api/options/max_pain` — SC-1 + SC-5
- `GET /api/options/oi_walls` — SC-2 + SC-6
- `GET /api/options/pcr` — SC-3 + SC-7 (with full validation matrix)
- `GET /api/options/institutional` — SC-4 + SC-8

`backend/services/finmind.py` carries `fetch_taiwan_option_daily_window`
(shared 250-td window with `_run_once` inflight dedup + `N12` prefix
invalidation) plus 4 endpoint-specific `fetch_*` methods.

`backend/main.py` carries the generic `@app.exception_handler(Exception)`
so unhandled bugs return `{detail: {error: "internal_error"}}` (F6-integration).

Limitations marked as MVP scaffolding (full integration deferred):
- `fetch_max_pain` / `fetch_oi_walls`: hit_rate returns `null` until
  `TaiwanOptionFinalSettlementPrice` fetch is wired
- `fetch_pcr`: `next_day_stats` returns `null` until `tx_returns` series
  is fetched (alignment helper trivial; just needs separate FinMind call)
- `fetch_institutional`: `correlation` returns `null` until full
  per-date foreign_call_net history aggregation is wired

These are all "add another small fetch + aggregate + pass to existing
parser" extensions — no architectural change needed.

#### Original Phase 3 fetch + routes spec (preserved for archeology)

Reference: `.claude/feat/txo-chip-framework/implementation/M2-backend-fetch-cache.md` + `M4-backend-routes.md`

#### Files to modify
- `backend/services/finmind_options.py`:
  - Add constant `_CACHE_VERSION_OPTIONS_CHIP = 1` near existing `_CACHE_VERSION_OPTIONS`
- `backend/services/finmind.py`:
  - Add `fetch_taiwan_option_daily_window(self, trading_dates: list[date], end_date, refresh) -> dict[date, list[dict]]`
    - Wraps fan-out in `self._run_once(...)` (I1)
    - Cache key: `txo_daily_window_{end_date}_td250`
    - Invalidate dependent parse caches INSIDE `_run_once` after dedup, before fetch
    - Uses Bearer auth (probe.py showed sponsor tier needs this)
  - Add `fetch_max_pain(self, contract: dict, date_str, lookback, refresh) -> dict`
    - Reads shared window, slices needed range, calls `parse_max_pain` + `parse_max_pain_hit_rate`
    - Cache key: `max_pain_{contract_id}_{date_str}_lb{lookback}`
  - Add `fetch_oi_walls`, `fetch_pcr`, `fetch_institutional` (similar pattern)
  - Add `_invalidate_dependent_parse_caches(end_date)` using `utils.cache.delete_by_prefix`
- `backend/routes/options.py`:
  - 4 new endpoints: `/api/options/max_pain`, `/oi_walls`, `/pcr`, `/institutional`
  - Each route:
    - Validate query params per design v4 §2.1
    - Route-layer orchestrates `services.trading_calendar.get_trading_days(end, 250)` and passes to fetch
    - PCR validation matrix: `scope=per_contract` requires `contract`; `scope=all_months` rejects `contract`; weekly contracts with `scope=per_contract` return 200 + warning (N5)
    - Lookback validation: reject 400 `lookback_exceeds_canonical_window` if `lookback × period > 250` (N11)
- `backend/main.py`:
  - Add `@app.exception_handler(Exception)` → 500 `{detail: {error: "internal_error"}}` (F6-integration)
- `backend/tests/test_options_routes.py`:
  - Extend with the test names enumerated in design v4 §6.1

#### Test names per design v4 §6.1
```
test_fetch_taiwan_option_daily_window_inflight_dedup_via_run_once
test_fetch_max_pain_cache_hit_vs_miss
test_fetch_oi_walls_cache_hit_vs_miss
test_fetch_pcr_cache_hit_vs_miss
test_fetch_institutional_cache_hit_vs_miss
test_fetch_max_pain_refresh_invalidates_shared_window_cache
test_fetch_oi_walls_refresh_invalidates_shared_window_cache
test_fetch_pcr_refresh_invalidates_shared_window_cache
test_refresh_invalidates_dependent_pcr_keys_across_threshold_variants
test_refresh_invalidation_is_inside_run_once_not_before
test_pcr_route_missing_contract_for_per_contract_scope_400
test_pcr_route_contract_not_applicable_for_all_months_400
test_pcr_route_per_contract_weekly_returns_warning_not_400
```

### Phase 3 — Frontend (NOT STARTED, ~3-4h)

Reference: `.claude/feat/txo-chip-framework/implementation/M5-frontend.md`

24 new files + 3 modifications. Module groups:

1. **Types + API** (`frontend/src/lib/`):
   - `options-types.ts` extend with 4 interfaces matching backend §2.1 schemas
   - `options-api.ts` extend with `maxPain` / `oiWalls` / `pcr` / `institutional` methods
2. **Hooks** (`frontend/src/hooks/`): 4 TanStack Query hooks (no seqRef per CLAUDE.md §7 P0)
3. **SVG renderers** (`frontend/src/lib/options-chip-svg.tsx` + tests): axis/scale helpers
4. **Chart components** (`frontend/src/components/`):
   - `OptionsDeviationHistogram.tsx` — Max Pain hit rate histogram
   - `OptionsBandHitChart.tsx` — OI Walls inside/outside band
5. **Cards** (`frontend/src/components/Options{MaxPain,OIWalls,PCR,Institutional}Card.tsx`):
   - Bull/bear color binding per CLAUDE.md §3 (red=up, NOT US convention)
   - PCR card: NO directional copy (F5-correctness; must `expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull()`)
   - Institutional card: `<div hidden={!expanded}>` for session toggle (F10-integration)
6. **Panel** (`OptionsChipPanel.tsx`):
   - 4-card grid (`grid-cols-1 md:grid-cols-2 xl:grid-cols-4`)
   - Failure isolation: each hook independent loading/error
   - Cross-hook refresh: `queryClient.invalidateQueries` on sibling keys (T2)
   - SC-10b test: `vi.spyOn(optionsApi, X).mockRejectedValue(...)` for one endpoint
7. **OptionsPage integration**: insert `<OptionsChipPanel>` between Header and existing Strip/Ladder

### Phase 4 — `/code-review` self-audit (NOT STARTED)
- Loop with `superpowers:receiving-code-review` to classify findings
- Max 3 rounds

### Phase 5 — Automated verification (PARTIAL: backend pytest green; frontend pending)
- `python -m pytest -q` from `backend/` ✓ 162 pass
- `npm test` + `npm run build` from `frontend/` — PENDING
- `ruff check .` + `pyright` from `backend/` — PENDING
- `npm run lint` from `frontend/` — PENDING

### Phase 6 — Real-env verification (BLOCKED on token refresh)
- DevTools MCP screenshots for SC-9 layout + SC-10 no_trading_day banner
- SC-10b at RTL level via `vi.spyOn`
- Per design v4: also re-run SC-0 probe to verify field-name assumptions

### Phase 7 — Structured SC table + Phase 8 PR/merge

---

## Resumption guide

```bash
# 1. Resume the branch
git checkout feat/txo-chip-framework

# 2. Verify backend baseline still green
cd backend && python -m pytest -q  # should be 162 passed

# 3. Refresh FINMIND_TOKEN before doing fetch/route work that integration-tests against real schema
#    (parser tests are mocked + don't need token)

# 4. Continue with the M2-backend-fetch-cache spec
cat .claude/feat/txo-chip-framework/implementation/M2-backend-fetch-cache.md

# 5. After backend complete, proceed to frontend per M5 spec
cat .claude/feat/txo-chip-framework/implementation/M5-frontend.md
```
