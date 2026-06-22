# Bug Fixes + Feature Changes — Design & Investigation
## Date: 2026-06-22

---

## Part A — Bug Investigations (systematic-debugging Phase 1 output)

### Bug #1 — 分點 K 線 overlay 選了券商卻沒有資料 (broker-overlay shows no data)

- **Symptom (user-visible):** After selecting one or more chip brokers (分點) via the checkboxes in the right-side `ChipBrokersPanel`, the new "分點 (N)" K-line sub-chart row appears (with the correct N count) but contains NO bars at all — label reads `分點 (N) 0 張` and the bar strip is completely empty. Confirmed by `docs/screenshots/overview-f1-f2-f4.png` (2 brokers selected, sub-row empty). Notably, the bubble-view broker filter — which uses `BrokerSearch` + a local `trades` array — DOES work, because the bubble path never touches `broker_history`.

- **Reproduction steps:**
  1. Search for and load a stock symbol (e.g. `2330`) so the chip overview tab is populated.
  2. In the right-side `ChipBrokersPanel`, tick the checkbox next to one or two brokers in the 前 15 大買賣超 / 前 15 大交易量分點 lists.
  3. Observe the new 6th sub-chart row 分點 (N) appear at the bottom of the K-line column.
  4. Note the value label reads `0 張` and there are no colored bars across the 90-day window, even though the institutional sub-charts above are populated normally.
  5. Open DevTools → Network and confirm a `GET /api/chip/{symbol}/broker_history?ids=...` call fires; inspect the JSON — `brokers[<id>]` is `[]` for every selected id.

- **Hypotheses considered:**

  | # | Hypothesis | Verdict | Why |
  |---|-----------|---------|-----|
  | H1 | The `broker_id` namespace from `taiwan_stock_trading_daily_report` (feeds `top_brokers` user selects from) is incompatible with the `securities_trader_id` namespace from `taiwan_stock_trading_daily_report_secid_agg` (feeds broker_history map). Frontend sends id e.g. `9268` (凱基台北) that never exists as a key in the SecIdAgg-derived dict; backend `_filter_broker_history` returns `{"9268": []}`; hook stores `[]`; chart aggregates to zeros; no bars. | **confirmed root cause** | `_parse_top_brokers` reads from `/taiwan_stock_trading_daily_report` (finmind.py:139-167, :555-600). `_do_fetch_broker_history` reads from `/taiwan_stock_trading_daily_report_secid_agg` (finmind.py:326-349). Production cache `backend/data/cache/chip/2330_2026-06-22.json` line 35 shows `broker_id` values like `9800`, `8440`, `9268` (4-digit numeric, no suffix). The design spec at `docs/specs/2026-06-22-chip-overview-enhancements-design.md:96-102` assumed SecIdAgg `securities_trader_id` is `9201A` (4-digit + letter suffix) and explicitly told the implementer to curl-verify or abort — verification was skipped. `ls backend/data/cache/chip/` shows ZERO `*broker_history*.json` files despite heavy 2330 dev exercise. `_filter_broker_history` (finmind.py:500-508) uses `all_brokers.get(bid, [])` — silent fallback to `[]`. `useBrokerHistory.ts:64-65` stores `result.brokers[id] ?? []`. `ChipKlineChart.tsx:44-53` collapses `[]` into `derived.candles.map(() => 0)`. `chip-broker-agg-svg.tsx:57-69` skips `<rect>` when `instBarHeight === 0`. Screenshot matches exactly. |
  | H2 | Network call never fires (effect-dep bug, or bubble-view selection not propagating). | refuted | `useBrokerHistory.ts:34` keys on `stableKey(brokerIds)` and `:84-86` correctly re-runs on changes. `App.tsx:73-89` `handleToggleBroker` is correctly wired through `ChipBrokersPanel.tsx:270/287/310`. `BrokerSearch` in `ChipBubbleView` only sets local state by design (bubble uses NAME filter on local trades). |
  | H3 | `_run_once` dedup key `broker_history_{symbol}` caches the first caller's already-filtered subset, polluting other callers. | refuted | `finmind.py:320-324` captures the FULL payload from `_run_once` then applies `_filter_broker_history` AFTER (with comment documenting this exact concern; fixed in commits `6ebd6c2` → `65b75ed`/`1360cd9`). |
  | H4 | Date-format mismatch between candle `date` and broker history `date`, breaking the `dateNet.get(c.date)` join. | refuted | Both flow through FinMind v4 API which returns ISO `YYYY-MM-DD`. `finmind.py:253-263` candles use `r['date']` verbatim; `:475/489` broker history uses `r.get('date', '')` verbatim. A format mismatch would also break `major_net` join (it doesn't). |
  | H5 | `seqRef` in `useBrokerHistory` drops the response as stale. | refuted | `useBrokerHistory.ts:58` bumps `seq` before fetch; `:63` checks at resolve. In steady-state checkbox toggle there is one in-flight fetch — `seq === seqRef.current` at resolve, response IS written. Dedicated test at `useBrokerHistory.test.ts:116-159` exercises this. |

- **Root cause:** The `broker_id` namespace used by the user-selection flow (`top_brokers`, sourced from `taiwan_stock_trading_daily_report`) is incompatible with the `securities_trader_id` namespace used by the chart-overlay flow (`broker_history`, sourced from `taiwan_stock_trading_daily_report_secid_agg`). When the user ticks a broker checkbox, the frontend forwards an id (e.g. `9268`) that does NOT exist as a key in the SecIdAgg-derived dict; `_filter_broker_history` silently returns `{"9268": []}`; downstream code deterministically renders an empty strip.

- **Evidence (file:line):**
  - `backend/services/finmind.py:154-156`, `:199-200`, `:564` — `top_brokers` + bubble both read `broker_id` from `/taiwan_stock_trading_daily_report`'s `securities_trader_id` field.
  - `backend/services/finmind.py:298-299`, `:331-341`, `:472` — `_do_fetch_broker_history` reads from `/taiwan_stock_trading_daily_report_secid_agg`, then `_parse_broker_history` groups by `securities_trader_id`.
  - `backend/services/finmind.py:500-508` — `_filter_broker_history` silently substitutes `[]` for missing ids — no warning logged.
  - `backend/data/cache/chip/2330_2026-06-22.json:35-67` — production `broker_id` values: `9800`, `8440`, `9268` (4-digit numeric, no suffix).
  - `docs/specs/2026-06-22-chip-overview-enhancements-design.md:92-103` — spec assumes SecIdAgg returns `9201A`; explicit `abort instruction` was ignored.
  - `frontend/src/hooks/useBrokerHistory.ts:64-65` — propagates empty array into Map.
  - `frontend/src/components/ChipKlineChart.tsx:44-53` — nested loop over empty arrays → all-zero `brokerAggSeries`.
  - `frontend/src/lib/chip-broker-agg-svg.tsx:57-60` — `if (h === 0) return null` skips every bar.
  - `docs/screenshots/overview-f1-f2-f4.png` — live evidence.
  - `ls backend/data/cache/chip/` — ZERO `*broker_history*.json` files exist despite heavy use.

- **Why this is root, not symptom:** Empty bars ← all-zero `brokerAggSeries` ← `brokerSeries.values()` yielding empty arrays ← `useBrokerHistory` storing `result.brokers[id] = []` ← `_filter_broker_history`'s `all_brokers.get(bid, [])` returning `[]` ← the requested `bid` is not a key in the dict ← the dict was built from a DIFFERENT FinMind endpoint than the one that produced the `broker_id` the user selected. There is no further upstream cause inside this codebase. Everything downstream is a deterministic painting of the empty payload.

- **Minimal fix plan (DO NOT FIX YET — investigation only):** In order of preference:
  1. **PREFERRED — name-based join (smallest viable diff):** change `selectedBrokerIds` semantics from `broker_id` to broker NAME (matching the bubble view at `ChipBubbleView.tsx:79`), and group `_parse_broker_history` (`finmind.py:472`) by `securities_trader` (name) instead of `securities_trader_id`. `ChipBrokersPanel.tsx:270/287/310` `onToggleBroker(b.broker_id, b.name)` → `onToggleBroker(b.name, b.name)`; `App.tsx:73-89` stores names; `useBrokerHistory` unchanged. Sidesteps the id-namespace question entirely.
  2. **ALTERNATIVE — fix at source:** make `_do_fetch_broker_history` reuse the same dataset as `top_brokers`: either (a) per-day iteration of `/taiwan_stock_trading_daily_report` across the 90-day window (ID-correct but heavy), or (b) build a small id-translation map from one or two probe days. Both require curl-verifying the two datasets first.
  3. **DEFENSIVE (regardless of path):** in `_filter_broker_history` (finmind.py:500-508), when `ids` contain values absent from `all_brokers`, log a warning AND propagate misses as `{requested_id_missing: [...]}` so silent failures cannot recur.

- **Regression test plan:**
  - **(A) Backend integration test** in `backend/tests/test_broker_history.py`: mock `_safe_get_secid_agg` to return rows with ids DIFFERENT from those requested (e.g. SecIdAgg returns `9201A`, `9201B` but route is asked for `9268`); assert the route does NOT silently return `{"9268": []}` — instead logs a warning (and under fix option 2, returns 502/503 with a clear error). Under fix option 1, request by NAME `凱基台北` and assert a non-empty list because grouping is by name.
  - **(B) Frontend integration test** in `frontend/src/hooks/useBrokerHistory.test.ts`: when API returns `{brokers: {A: []}}` for requested id `A`, assert hook surfaces `error` (or `unmatchedIds` flag) rather than silently writing `[]`.
  - **(C) End-to-end smoke / DevTools-MCP screenshot** following `docs/screenshots/overview-f1-f2-f4.png` pattern: load `2330`, select 元大 + 凱基台北, assert `container.querySelectorAll('svg rect')` inside `BrokerAggBarSvg` DOM contains at least one rect.

- **Blast radius — other call sites:**
  - `backend/services/finmind.py` (`_safe_get_secid_agg` :293-303, `fetch_broker_history`/`_do_fetch_broker_history` :307-349, `_parse_broker_history` :463-497, `_filter_broker_history` :500-508, `_parse_top_brokers` :555-600).
  - `backend/routes/chip.py:71-91` — `GET /api/chip/{symbol}/broker_history` accepts `ids` but never validates them against the SecIdAgg dict.
  - `frontend/src/hooks/useBrokerHistory.ts:64-65` — does not distinguish "returned `[]`" from "id not found".
  - `frontend/src/components/ChipKlineChart.tsx:44-53`, line 88, lines 176-197 — silently collapses empty arrays to zero; gates row visibility on count not data.
  - `frontend/src/components/ChipBrokersPanel.tsx:270/287/310` — under fix option 1, `onToggle` switches from `b.broker_id` to `b.name`.
  - `frontend/src/App.tsx:28-33`, :73-89, :40 — state keyed by `broker_id` today.
  - `frontend/src/lib/chip-data.ts:32-40`, :175-187 — `TopBroker.broker_id` type and `BrokerDaily` / `ChipBrokerHistory` shape need an ADR-level note if key semantics change.
  - `frontend/src/lib/chip-broker-agg-svg.tsx:32-95` — innocent renderer (visible symptom location).
  - `docs/specs/2026-06-22-chip-overview-enhancements-design.md §2.3` — unverified assumption; needs updating after fix.
  - `backend/tests/test_broker_history.py`, `backend/tests/test_chip_broker_history_route.py` — existing tests presuppose matching ids; need "mismatched ids" fixtures.

- **Adversarial-verify verdict (holds_up + concerns):** **HOLDS UP.** Concerns:
  - UNVERIFIED PREMISE: The "two-namespace" framing assumes SecIdAgg returns rows with populated `securities_trader_id` in a different namespace. Equally consistent: SecIdAgg names the id field differently (e.g. `broker_id`) or omits it, in which case `_parse_broker_history` skips every row via the blank-id check and produces identical `{}` downstream. `major_net` series being non-zero is NOT counter-evidence (`_compute_major_net_agg` at finmind.py:450-458 only reads `buy`/`sell`).
  - MISSING DIAGNOSTIC: `finmind.py:331-339` does not log `len(rows)` or a sample row. Before locking in a fix, one diagnostic log (or curl) would distinguish "wrong namespace" vs "wrong field name" vs "blank id field".
  - SILENT-FAILURE SURFACE: `_filter_broker_history`'s missing-id `[]` substitution without logging is independently a defect — patch it alongside the data-source fix.
  - NO STATE-MACHINE ESCAPE: `App.tsx → useBrokerHistory → /broker_history → fetch_broker_history` is the only path. Bubble path is unaffected.
  - FIX ROBUSTNESS: Both proposed options eliminate the symptom regardless of which upstream sub-cause is true, because both align the lookup key with what `top_brokers` produced. Name-based fix (option 1) is safest minimal diff — it sidesteps the question entirely (`top_brokers` always has a populated `securities_trader`).

---

### Bug #2 — 瀏覽器重新整理 (F5) 不會更新籌碼資料

- **Symptom (user-visible):** Browser refresh (F5 / Ctrl+R) does not update chip data; users must click the in-app "重新整理" button to see new data.

- **Reproduction steps:**
  1. Load the app; select a symbol (e.g. `2330`).
  2. Wait for chip data to render. Note `fetched_at` in `backend/data/cache/chip/2330_history.json`.
  3. Wait several minutes so upstream FinMind may have newer data.
  4. Press F5 / Ctrl+R in browser.
  5. Observe: K-line, broker history (and within 30 min, summary) still show the SAME data; `fetched_at` is unchanged because backend returned its on-disk JSON without re-querying FinMind.
  6. Click in-app "重新整理" — request carries `?refresh=true`, backend bypasses disk cache and re-fetches FinMind; `fetched_at` advances.

- **Hypotheses considered:**

  | # | Hypothesis | Verdict | Why |
  |---|-----------|---------|-----|
  | H1 | Backend disk cache for `/chip/{symbol}/history` and `/chip/{symbol}/broker_history` has NO time-based staleness — only `last_date >= today`. Once today's first fetch writes the file, every subsequent GET (without `?refresh=true`) returns it for the rest of the day. F5 omits `?refresh=true`; in-app button sends it. | **confirmed root cause** | `finmind.py:217-222` fetch_chip_history early-returns whenever `last >= today`, no `_is_stale`. Same pattern at `:311-314` for `fetch_broker_history`. Contrast `fetch_chip_summary` at `:128-132` + `:101-111` which uses 30-min TTL. Frontend `App.tsx:96 → useChipData.ts:43 → api.ts:73/79/84/93 → chip.py route forwards refresh=True`. F5 sends `refresh=false` (default) so the cache short-circuits. |
  | H2 | HTTP cache headers (Cache-Control/ETag/Last-Modified) cause the browser to serve from its own cache on F5. | refuted | Grep `Cache-Control\|cache_control\|max-age` across `backend/` returns 0 matches. FastAPI default sets no header — browser must revalidate. Request DOES hit backend on F5. |
  | H3 | Service worker / localStorage caches API responses client-side. | refuted | Grep `serviceWorker\|registerSW\|workbox\|localStorage\|sessionStorage` over `frontend/src` = 0 matches. `frontend/public/**` empty. Only client cache is in-memory `Map` in `api.ts:5`, wiped on full reload. |
  | H4 | `useChipData` auto-sync-date effect (App.tsx:42-49) re-snaps date on remount and `seqRef` drops the in-flight result. | refuted | seqRef only bumps on (a) starting a fetch (b) symbol-change effect at `:28`. New fetch DOES go out — but backend returns stale disk cache. seqRef race would show EMPTY data, not stale data. |
  | H5 | `fetch_chip_summary`'s 30-min `_is_stale` window IS the bug. | partial contributor | Summary DOES re-check via `_is_stale(30)` for today, so summary auto-refreshes after 30 min on F5. But `/history` and `/broker_history` have NO such window — they're stale ALL DAY until `refresh=true`. The history/broker_history gap is dominant. |

- **Root cause:** Backend disk cache for `/api/chip/{symbol}/history` (`finmind.py` `fetch_chip_history` :213-227) and `/api/chip/{symbol}/broker_history` (:307-324) is served whenever `last_date >= today` with NO time-based staleness check. The frontend only sends `?refresh=true` when the in-app "重新整理" button is clicked; F5 issues plain GETs that hit the gate and receive the same stale JSON the entire trading day.

- **Evidence (file:line):**
  - `backend/services/finmind.py:217-222` — `fetch_chip_history` returns cache whenever `last_date >= today`; no `_is_stale`.
  - `backend/services/finmind.py:311-314` — `fetch_broker_history`: identical pattern.
  - `backend/services/finmind.py:128-132` + `:101-111` — `fetch_chip_summary` uses `_is_stale` with 30-min TTL (contrast).
  - `frontend/src/lib/api.ts:21-33` — `refresh=true` clears in-memory cache AND propagates to URL.
  - `frontend/src/lib/api.ts:73,79,84,93` — `refresh` param only forwarded when explicitly set.
  - `frontend/src/hooks/useChipData.ts:43` — `refresh() → load(true)`.
  - `frontend/src/App.tsx:96-100` — in-app button calls `refreshChip` + `brokerHistoryHook.refresh` + `bubbleHook.refresh` (all `refresh=true`).
  - `useChipData.ts:40`, `useChipBubble.ts:34`, `useBrokerHistory.ts:85` — F5 mount calls `load()`/`fetchMissing(false)` → `refresh=false`.

- **Why this is root, not symptom:** Behavioral difference between F5 and the in-app button is ONLY the `refresh` flag. On F5: in-memory frontend cache wiped (network request DOES go out), no HTTP cache headers (browser does NOT short-circuit), no service worker. Request reaches FastAPI, calls `fetch_chip_history(symbol, refresh=False)`. The `if not refresh` branch reads disk cache; only gate is `last_date >= today` (no time staleness) — same JSON written hours ago is returned verbatim. Remove the gate and the symptom disappears.

- **Minimal fix plan:** Smallest diff in `backend/services/finmind.py`:
  1. `:217-222` — add time-based staleness mirroring `fetch_chip_summary`. Specifically use `if cached['last_date'] < today_iso or not self._is_stale(cached, max_age_minutes=N): return cached`. Choose N for trading freshness (15-30 min during TW market hours).
  2. `:311-314` — same change for `fetch_broker_history`.
  3. Optionally bump `_CACHE_VERSION` (`finmind.py:19`) to invalidate older payloads.
  - No frontend change required (`api.ts:5` in-memory cache already wipes on F5).
  - **Worse alternative:** sessionStorage flag to auto-send `refresh=true` on first mount — hammers FinMind and fights rate limiter. Reject.

- **Regression test plan:**
  - Backend test in `backend/tests/test_finmind.py`: seed fake on-disk cache file for `<symbol>_history` whose `fetched_at` is older than chosen TTL → call `fetch_chip_history(symbol, refresh=False)` → assert underlying `_get` IS invoked AND returned `fetched_at` advances.
  - Mirror test in `backend/tests/test_broker_history.py` for `fetch_broker_history`.
  - Negative test: recent `fetched_at` → assert `_get` is NOT invoked and original payload returned.
  - If `datetime.now` is awkward, inject `now()` callable into `FinMindClient` or use `freezegun`.
  - Manual smoke: load `2330`, note `fetched_at`, wait > TTL, press F5, confirm `fetched_at` advances without clicking refresh.

- **Blast radius — other call sites:**
  - `backend/services/finmind.py`
  - `backend/routes/chip.py`
  - `backend/tests/test_finmind.py`
  - `backend/tests/test_broker_history.py`
  - `frontend/src/lib/api.ts`
  - `frontend/src/hooks/useChipData.ts`
  - `frontend/src/hooks/useChipBubble.ts`
  - `frontend/src/hooks/useBrokerHistory.ts`
  - `frontend/src/App.tsx`

- **Adversarial-verify verdict (holds_up + concerns):** **HOLDS UP.** Concerns:
  - The "flat 15 min" first-pass would still re-fetch every F5 on weekends/holidays/overnight and burn the rate limiter. Mirror `fetch_chip_summary` exactly: only apply `_is_stale` when `cached['last_date'] == today`. The correct gate is `cached['last_date'] < today_iso or not self._is_stale(cached)` — skip staleness entirely if cache is pre-today.
  - Bug scope is narrower than "chip data does not update on F5": summary already has a 30-min `_is_stale` so it WILL refresh on F5 after 30 min. The dominant gap is `fetch_chip_history` + `fetch_broker_history` (NO TTL). Worth confirming with the user which panels they observed — if they say "summary doesn't update within 30 min", that's a separate, slower concern (TTL is working, just slow).
  - `fetch_chip_bubble` (`:171-184`) DOES use `_is_stale` correctly — unaffected.
  - `_do_fetch_history` writes `last_date = end = date.today().isoformat()` unconditionally (`:284`), so ANY successful fetch today produces a cache that satisfies `last_date >= today.isoformat()` — once 09:01 succeeds the cache is "permanently fresh" until next-day rollover. Matches the reported symptom exactly.

---

### Bug #3 — 滑鼠移到 K 線上日期變成最新的 (OHLCV header date snaps to latest on mouseleave)

- **Symptom (user-visible):** After the user picks a date (via the date input or by clicking a candle), the date shown in the K-line chart's OHLCV info row (top-left of `chip-kline-svg.tsx`) does not reflect the picked date. Whenever the user moves the mouse over the K-line and back out, the displayed date "snaps to the latest" candle, giving the impression that hovering changes the selected date.

- **Reproduction steps:**
  1. Open the chip-overview tab with a symbol whose history has many candles (e.g. last 90 days).
  2. Wait for history to load — OHLCV info row top-left shows the LATEST candle's date.
  3. Pick an older date `X` via the `<input type=date>` (App.tsx:132-137) — date input shows `X`, gold selected-day cursor appears at `X` on the K-line, but the OHLCV info row at the top STILL shows the LATEST candle date (NOT `X`).
  4. Move mouse into K-line area — OHLCV date now follows the candle under the cursor.
  5. Move mouse out — `hoverIndex` resets to `null` and OHLCV date again shows the LATEST candle date, NOT picked date `X`.
  6. User perceives this as "hovering over the K-line caused the date to become the latest, not the picked date".

- **Hypotheses considered:**

  | # | Hypothesis | Verdict | Why |
  |---|-----------|---------|-----|
  | a | K-line overlay `onMouseMove` mistakenly calls `onClickIndex` / `onPickDate`, mutating parent date on hover. | refuted | `chip-kline-svg.tsx:159-169` `handleMouseMove` only calls `onHoverIndex(idx)`. Overlay rect at `:339-348` wires only `handleMouseMove`/`handleMouseLeave`/`handleClick`. `onClickIndex` fires only via `handleClick`, never via mousemove. |
  | b | `App.tsx` auto-sync resets `userPickedDate.current` on hover and sets date to last candle. | refuted | `userPickedDate.current` written ONLY at: `:34` init, `:67` `handlePickDate`, `:108` `handlePick` (symbol change), `:135` date-input onChange. None fire on hover. Auto-sync `:42-49` early-returns when `userPickedDate.current === true`. |
  | c | `infoIdx = hoverIndex ?? n-1` (no `selectedIndex` in the fallback). On mouse-leave, `hoverIndex = null`, displayed date snaps to latest candle. | **confirmed root cause** | `chip-kline-svg.tsx:147` `const infoIdx = hoverIndex != null && hoverIndex >= 0 && hoverIndex < n ? hoverIndex : n - 1;` Line `:150` `const infoCandle = candles[infoIdx];` Line `:294` renders `infoCandle.date`. `selectedIndex` is consumed only by the gold cursor (`:318-337`), NEVER by the info row. Same pattern in `chip-inst-bar-svg.tsx:74-77` (InstBarSvg `valIdx`), `:197-198` (MarginLineSvg), `chip-broker-agg-svg.tsx:43-44`. |
  | d | Date input re-reads stale source; picking is overwritten on hover-triggered re-render. | refuted | `App.tsx:134` `value={date}` bound to React state; only `setDate` calls mutate (`onChange` :135, `handlePickDate` :68, auto-sync :47, symbol change :108). None hover-triggered. Date input correctly retains picked date — confusion is purely about the OHLCV info row. |
  | e | Auto-sync mis-classifies picked date as 'newer than last candle' and forces last. | refuted | `App.tsx:46` `if (lastCandleDate < date) setDate(lastCandleDate);` — only fires when chosen date is in the future. For PAST date (bug scenario), `lastCandleDate < date` is false, so `setDate` is NOT called. |

- **Root cause:** The K-line OHLCV info row computes its display index from hover state only, with a hard fallback to the latest candle: `infoIdx = hoverIndex != null ? hoverIndex : n - 1` (`chip-kline-svg.tsx:147-150`). It NEVER consults `selectedIndex`. Whenever the mouse is not hovering, the info row shows the LAST candle's date — even if a different date was picked. User sees the date "snap to latest" every time the mouse leaves the chart. The same fallback pattern exists in every sub-chart label (`chip-inst-bar-svg.tsx:74-77` and `:197-198`, `chip-broker-agg-svg.tsx:43-44`).

- **Evidence (file:line):**
  - `frontend/src/lib/chip-kline-svg.tsx:147-150` — `infoIdx = hoverIndex ?? n-1`.
  - `frontend/src/lib/chip-kline-svg.tsx:289-307` — info-row `<text>` renders `{infoCandle.date.replace(/-/g, "/")}` and OHLCV fields, all keyed off `infoIdx`.
  - `frontend/src/lib/chip-kline-svg.tsx:318-337` — `selectedIndex` only used to draw gold cursor + date tag.
  - `frontend/src/lib/chip-inst-bar-svg.tsx:74-77` — `valIdx = hoverIndex ?? data.length - 1`.
  - `frontend/src/lib/chip-inst-bar-svg.tsx:197-198` — MarginLineSvg same pattern.
  - `frontend/src/lib/chip-broker-agg-svg.tsx:43-44` — BrokerAggBarSvg same pattern.

- **Why this is root, not symptom:** Symptom is "displayed date doesn't match picked date after mouse motion." Hypotheses (a), (b), (d), (e) would all be downstream effects of parent state mutation — exhaustive grep confirms NO mouse handler writes to `App.tsx` `date` state or `userPickedDate.current`. Parent state IS intact: date input still shows picked date and gold `selectedIndex` cursor still sits on picked candle. The ONLY thing visually changing is the OHLCV info-row text, and a direct read shows the cause: `hoverIndex ?? n-1`, never `selectedIndex`. Fix the fallback and the symptom disappears with no behavior change to clicking, hovering, or auto-sync.

- **Minimal fix plan:**
  - `chip-kline-svg.tsx:147` — change to a 3-tier fallback:
    ```ts
    const infoIdx = (hoverIndex != null && hoverIndex >= 0 && hoverIndex < n)
      ? hoverIndex
      : (selectedIndex != null && selectedIndex >= 0 && selectedIndex < n)
        ? selectedIndex
        : n - 1;
    ```
  - Apply the analogous 3-tier fallback in `chip-inst-bar-svg.tsx:74-77` (InstBarSvg `valIdx`), `chip-inst-bar-svg.tsx:197-198` (MarginLineSvg `valIdx`), and `chip-broker-agg-svg.tsx:43-44` (BrokerAggBarSvg `valIdx`).
  - `App.tsx` already passes `selectedIndex` to all four SVGs via `ChipKlineChart.tsx:111, 127, 136, 145, 154, 172, 188` — no new props.
  - Smallest possible diff: four one-line ternary changes.

- **Regression test plan:** Extend `frontend/src/lib/chip-svg-render.test.tsx` (next to KlineChartSvg suite :84-130):
  - Render `KlineChartSvg` with `candles`, `selectedIndex=3`, `hoverIndex=undefined` → assert OHLCV header `<text>` contains date of `candles[3]` (e.g. `"2026/06/13"`), NOT `candles[9]`.
  - Sibling test: `hoverIndex=5` + `selectedIndex=3` → `hoverIndex` still wins.
  - Analogous tests for `InstBarSvg` / `MarginLineSvg` / `BrokerAggBarSvg`: `hoverIndex=null` + `selectedIndex=2` → label equals `data[2]`, not `data[length-1]`.
  - These tests fail before the fix, pass after.

- **Blast radius — other call sites:**
  - `frontend/src/lib/chip-kline-svg.tsx` (info row fallback `:147-150`/`:289-307`).
  - `frontend/src/lib/chip-inst-bar-svg.tsx` (InstBarSvg `:74-77`, MarginLineSvg `:197-198`).
  - `frontend/src/lib/chip-broker-agg-svg.tsx` (BrokerAggBarSvg `:43-44`).
  - `frontend/src/components/ChipKlineChart.tsx` (passes `selectedIndex` — verify pass-through, no change needed).
  - `frontend/src/App.tsx` — investigation confirmed no change needed.
  - `frontend/src/lib/chip-svg-render.test.tsx` — extend with selectedIndex-fallback regression tests.

- **Adversarial-verify verdict (holds_up + concerns):** **HOLDS UP.** All four cited code locations match the hypothesis verbatim. Concerns:
  - `selectedIndex` propagation verified: `ChipKlineChart.tsx:79-83` derives from `selectedDate` via `candles.findIndex`, passed to all four SVGs — no new wiring needed.
  - No upstream cause: `handleMouseMove`/`handleMouseLeave` (`:159-173`) invoke ONLY `onHoverIndex`; never `onClickIndex`/`onPickDate`/`setDate`. `App.tsx` state intact across hover.
  - Auto-sync (`:42-49`) gated by `userPickedDate.current` and only fires when `lastCandleDate < date` — cannot cause symptom.
  - Fix preserves `change`/`changePct` math at `chip-kline-svg.tsx:151-156` (uses `infoIdx-1` for `prevClose`; deltas remain correct under selectedIndex flow).
  - When both `hoverIndex` and `selectedIndex` are null (initial mount), `n-1` fallback still applies — preserves intended "latest candle" initial display.
  - No other call sites display OHLCV/value text in these SVGs that could re-introduce the symptom — `grep` for `infoIdx|valIdx` surfaces exactly the four cited locations.

---

## Part B — Feature Change Spec (brainstorming + diff-level spec)

### Overall success criteria
- All 9 features (F1–F9) implemented with TDD-style commits (🔵 refactor → 🔴 behavior → 🟢 new).
- `npm --prefix frontend run test` and `npm --prefix frontend run build` (tsc -b + vite build) green at the end of each commit.
- `tsc --noEmit` clean — no new TypeScript errors.
- Chrome DevTools MCP smoke verification (visual screenshots saved under `reports/` or `docs/screenshots/`) confirms each visible feature renders as designed at 1440×900.
- No regression in existing test suites: BrokerSearch, chip-svg, chip-svg-render, chip-data, api, useBrokerHistory.

### Cannot-break whitelist (existing behaviors that MUST survive across ALL clusters)
- `App.tsx handlePickDate` / `userPickedDate.current` semantics — manual date pick sets `true`, symbol change resets, auto-sync gated.
- `seqRef` stale-response protection in all data hooks.
- `refresh()` button forces refetch of ALL data sources with `refresh=true`.
- Symbol change clears summary + history + `selectedBrokerIds` + `selectedBrokerNames`.
- Empty-state placeholders ("請搜尋股票代號…") render when summary/history are null pre-symbol-pick.
- Bubble-tab + `useChipBubble` independent of overview hooks.
- Backend `/api/chip`, `/api/chip/history`, `/api/chip/broker_history`, `/api/chip/bubble` contracts unchanged.
- `CHIP.ma5` theme token retained (used by KLine MA5 line and ChipBrokersPanel ratio color).
- `BrokerSearch` dropdown's yellow text-highlight + active-row left border (separate UI affordance, NOT the bubble "highlight box").

### Out-of-scope (across this round)
- Migrating to React Query / SWR / TanStack.
- Adding service worker / sessionStorage caches.
- Adding shadcn Button / Tabs / Input migration (other than the new Checkbox + DateField).
- Backend schema/contract changes (other than Bug #1 and Bug #2 fixes).
- Virtualization of broker lists.
- New e2e/Playwright framework setup.
- Restyling unrelated components (ChipKlineChart sub-chart layout, BrokerSearch internals, tab bar).

---

### Cluster A — Bubble chart (F1 + F2)

**Features:** F1 — Remove yellow (`#f0b429` / `CHIP.ma5`) bubble highlight when filtering by a single broker. F2 — When a specific broker is searched, bypass the global "今日無顯著成交量" empty-state and still render that broker's bubbles + right-side price bar / entry-exit trade lists.

- **Success criteria:**
  - Selected-broker bubbles render with normal `buyStroke`/`sellStroke` (CHIP.bull/CHIP.bear) at `strokeWidth=1`, identical to unfiltered view.
  - When `selectedBroker` is set AND global aggregate would have produced "No significant volume", the chart renders the broker's bubbles instead (even on low-volume days), with axis derived from broker's own price+volume.
  - When `selectedBroker` truly has zero trades, the per-broker hint `{selectedBroker} 今日無顯著成交量` continues to display (chip-bubble-svg.tsx:416-426 preserved).
  - When `selectedBroker` is null, global "No significant volume" still renders on low-volume days.
  - Right-hand `PriceBarSvg` + buy/sell `TradeList` continue to render for selected broker on low-volume days.
  - Tooltip, click-to-deselect, axis ticks, butterfly layout, price/volume labels unchanged for default view.
  - `HIGHLIGHT` / `highlightMatch` text-highlight inside `BrokerSearch` dropdown UNTOUCHED.
  - `CHIP.ma5` NOT deleted from theme.

- **Cannot-break:**
  - Default (no broker selected) butterfly layout, axis, close-price dashed line, hover tooltip, click-empty-area-deselect, click-bubble-select.
  - Global "No significant volume" still appears when no broker AND `layoutTrades` all ≤ `VOLUME_THRESHOLD`.
  - Per-broker `{name} 今日無顯著成交量` hint.
  - BrokerSearch dropdown yellow text highlight + active-row left border + focus-ring (`border-[#f0b429]`).
  - ChipBubbleView header chip "已篩選 1 個分點" yellow accent and "今日共 N 個分點" purple accent.
  - ChipBrokersPanel red/yellow/green ratio color coding (`#f0b429` as 0.5–0.7 threshold).
  - KLine MA5 yellow line.
  - "No trade data" early return at `chip-bubble-svg.tsx:165` when `layoutTrades` is literally empty.
  - Axis padding / `pricePad` / `niceStep` / `bubbleRadius` pure-function behaviour for default view.

- **Out-of-scope:**
  - Renaming / removing `CHIP.ma5`.
  - Removing dropdown yellow text highlight.
  - Removing "已篩選 1 個分點" header accent.
  - Lowering global `VOLUME_THRESHOLD`.
  - Changing `layoutTrades` top-100 cap (`:95-100`).
  - Tests for ChipBrokersPanel / ChipKlineChart / KLine MA5.
  - Refactoring `ChipBubbleView` `priceAggs` fallback.

- **File changes:**

  | File | 🔴/🟢/🔵 | Description | Lines |
  |------|--------|-------------|-------|
  | `frontend/src/lib/chip-bubble-svg.tsx` | 🔴 | F1 — drop yellow ma5 stroke + 2px strokeWidth on selected-broker bubbles; use normal buy/sell stroke at width 1. Remove/no-op `isSel` branches on lines 283, 290, 301 and `isSel` derived conditional strokeWidth at 399-408. | 280-310, 397-412 |
  | `frontend/src/lib/chip-bubble-svg.tsx` | 🔴 | F2 — modify "No significant volume" early return (`:194-213`) so it does NOT fire when `selectedBroker` is set AND that broker has any trades in `trades`. Derive axis/volume from selected broker; bypass `VOLUME_THRESHOLD` in single-broker branch. Move `visibleTrades`/`priceExtras`/`volExtras` (`:215-238`) ABOVE the empty-volume early return, or replicate broker-filter logic before it. Preserve per-broker hint at `:416-426`. | 186-238, 280-307, 416-426 |
  | `frontend/src/lib/chip-bubble-svg.test.tsx` | 🟢 | NEW test file — Vitest + @testing-library/react jsdom tests for `BubbleChartSvg`. | new |

- **Existing tests impact (must-stay-green):**
  - `frontend/src/components/BrokerSearch.test.tsx` — must remain green (BrokerSearch untouched).
  - `frontend/src/lib/chip-svg-render.test.tsx` — must remain green (KLine paths).
  - `frontend/src/lib/chip-svg.test.ts` — must remain green (pure SVG helpers).
  - `frontend/src/lib/chip-data.test.ts` — must remain green (no chip-data.ts change).
  - `frontend/src/lib/api.test.ts` — must remain green.
  - `frontend/src/hooks/useBrokerHistory.test.ts` — must remain green.

- **New tests to write:**
  - `chip-bubble-svg.test.tsx`: (a) low-volume day, no selectedBroker → "No significant volume" present. (b) low-volume day + selectedBroker with trades → at least one `<circle>` for that broker, no empty-state text. (c) normal day + selectedBroker → no circle has stroke `#f0b429` (CHIP.ma5) or strokeWidth=2. (d) selectedBroker not present in trades → `{name} 今日無顯著成交量` hint shown. (e) default unfiltered smoke.

- **Backward compat risks:**
  - Re-ordering `visibleTrades` before empty-volume check must recompute `volumes`/`prices` for broker-selected branch; otherwise axis degenerates. Mitigation: in broker-selected mode always use `allPrices = [...prices, ...priceExtras]` and `allVolumes = [...volumes, ...volExtras]`, with guard `if (allVolumes.length === 0 && !selectedBroker) → early return`.
  - Lowering threshold in single-broker branch may render many tiny bubbles for high-frequency brokers — `MIN_R=3` already small, acceptable.
  - Removing yellow stroke removes visual "this is the searched broker" cue — header chip "已篩選 1 個分點" + the fact that only one broker's bubbles render still communicate filter state.
  - No e2e screenshot test asserts yellow stroke in bubble chart (`grep frontend/src/**/*.test.*` clean).

- **Commit-split proposal:**
  1. 🔵 — none (no pure refactor needed).
  2. 🔴 commit 1 — F1: drop `isSel` yellow stroke + 2px strokeWidth. Add `chip-bubble-svg.test.tsx` with stroke + default-view smoke.
  3. 🔴 commit 2 — F2: hoist `visibleTrades` above early return, derive axis from selected broker, bypass `VOLUME_THRESHOLD` in single-broker branch. Extend tests with low-volume + selectedBroker scenarios and per-broker empty-state preservation.
  4. 🟢 — none (F2 is behaviour-fix, F1 is behaviour removal).

---

### Cluster B — Scoped loading for date-pick refresh (F3)

**Feature:** F3 — Date-pick (candle click) refresh is scoped to chip-overview right panel only. K-line stays visible; right panel shows localized loading indicator.

- **Success criteria:**
  - Clicking a candle does NOT unmount/blank/placeholder the K-line SVG. Re-renders only the highlighted candle.
  - Clicking a candle does NOT refetch `/api/chip/history`. Only `/api/chip` (summary) is refetched for the new date.
  - While summary refetches, `ChipBrokersPanel` shows localized loading affordance (small "載入中…" caption next to symbol/date header OR subtle opacity dim) while previous summary remains rendered — no blank placeholder.
  - Header "重新整理" button still reflects combined busy state (summary OR history OR bubble loading); disabled while any loading.
  - Symbol change still clears both summary and history; symbol vs date behave differently.
  - `useChipData` returns `{ summary, history, loading, summaryLoading, historyLoading, error, refresh }` for back-compat AND fine-grained loading.
  - Tab switch + bubble-tab loading unaffected.

- **Cannot-break:**
  - Symbol change resets summary + history to null; placeholders show.
  - Symbol change clears `selectedBrokerIds` / `selectedBrokerNames`.
  - Auto-pick effect (App.tsx:42) fires exactly once on first history load per symbol, gated by `userPickedDate.current`.
  - `userPickedDate.current = true` on real candle click (`handlePickDate` :63).
  - `seqRef` per-fetch stale-response protection preserved.
  - `refresh()` from button forces BOTH summary and history with `refresh=true`.
  - `ChipKlineChart` still shows "請搜尋股票代號以載入K線圖" empty state when history is null.
  - `ChipBrokersPanel` still shows "請搜尋股票代號" empty state when summary is null.
  - Existing panel visual layout (header / 三大法人 / 融資融券 / 主力 / mode tabs / chips region / list) structurally unchanged — loading indicator is ADDITIVE.
  - Error propagation banner still fires for either fetch failure.
  - Header `載入中…` / `重新整理` label correct for full-refresh.
  - `dayTotalLots` memo unaffected.
  - `brokerHistoryHook` independent.

- **Out-of-scope:**
  - Generic `<Skeleton />` shimmer rewrite.
  - Migration to React Query / SWR.
  - Cross-date summary caching.
  - Backend contract changes.
  - Touching `bubbleHook`.
  - Per-section error banner.
  - Refactoring `ChipKlineChart` layout / sub-chart math.
  - Debouncing rapid candle clicks (`seqRef` handles).

- **File changes:**

  | File | 🔴/🟢/🔵 | Description | Lines |
  |------|--------|-------------|-------|
  | `frontend/src/hooks/useChipData.ts` | 🔴 | Split single `load()` into (1) summary fetch keyed on `[symbol, date]` with own `summaryLoading`+`seqRef`; (2) history fetch keyed on `[symbol]` with own `historyLoading`+`seqRef`. Symbol change resets BOTH; date change does NOT touch history; DO NOT null summary on date change either (keep previous visible). Return `{ summary, history, loading, summaryLoading, historyLoading, error, refresh }` where `loading = summaryLoading \|\| historyLoading`. `refresh()` triggers both with `refresh=true`. | 1-45 |
  | `frontend/src/App.tsx` | 🔴 | Destructure `summaryLoading` from `useChipData`. Pass to `ChipBrokersPanel`. `isLoading` for header button keeps combined `loading \|\| bubbleHook.loading`. `ChipKlineChart` receives NO loading prop. Symbol change behavior unchanged. | 36-46, 96-101, 181-202 |
  | `frontend/src/components/ChipBrokersPanel.tsx` | 🟢 | Add optional `loading?: boolean` prop. When `loading && summary`, render `載入中…` caption next to date header (~line 126) AND `aria-busy` on outer div with optional `opacity-70` dim on data sections. `if (!summary)` placeholder unchanged. No structural change. | 1-15, 91-128, 121 |
  | `frontend/src/components/ChipKlineChart.tsx` | 🔵 | No functional change. Add brief comment documenting it must never gate render on loading; only re-render on history/selectedDate/selectedBrokerIds/brokerSeries changes. | 63-72 |
  | `frontend/src/hooks/useChipData.test.ts` | 🟢 | NEW test file. | new |
  | `frontend/src/components/ChipBrokersPanel.test.tsx` | 🟢 | NEW test file (panel currently has no tests). | new |

- **Existing tests impact (must-stay-green):**
  - `useBrokerHistory.test.ts`, `api.test.ts`, `chip-data.test.ts`, `chip-svg.test.ts`, `chip-svg-render.test.tsx`, `BrokerSearch.test.tsx` — all unrelated, must remain green.

- **New tests to write:**
  - `useChipData.test.ts`: (a) initial mount fires both endpoints; (b) date-only change fires ONLY `api.chip`, NOT `api.chipHistory`; (c) symbol change fires both; (d) `summaryLoading` toggles around `api.chip`; (e) history non-null across date change; (f) rapid date-flip A→B→A keeps only latest response; (g) `refresh()` forces both.
  - `ChipBrokersPanel.test.tsx`: (a) null-summary empty state regardless of loading; (b) loading=true + summary present → content + indicator + `aria-busy`; (c) loading=false → no indicator.

- **Backward compat risks:**
  - `loading` semantics narrow: now false during brief window where neither fetch in flight even right after a date click. Mitigation: keep `loading = OR` so header button stays busy.
  - Removing `setSummary(null)/setHistory(null)` on date change is a visible UX change — was empty-flash, now smooth. Intended.
  - `loading` prop on `ChipBrokersPanel` is optional + additive; only caller is `App.tsx`, updated in same commit.

- **Commit-split proposal:**
  1. 🔵 — Add brief comment to `ChipKlineChart` documenting "no loading gate"; zero behavior diff.
  2. 🔴 — Split `useChipData` into independent fetches with separate loading flags; stop refetching history on date change; stop nulling on date change. Add `summaryLoading` to return; keep `loading` as OR for back-compat. Update `App.tsx` to wire `summaryLoading` through (panel ignores prop until next commit).
  3. 🟢 — Add `loading` prop to `ChipBrokersPanel` with localized indicator. Add `useChipData.test.ts` + `ChipBrokersPanel.test.tsx`.

---

### Cluster C — ChipBrokersPanel relayout (F4 + F5 + F7)

**Features:** F4 — delete right-side symbol+date header and 三大法人 block. F5 — split top-15 buyers / top-15 sellers into two independently scrollable lists, each ~half height (net mode only). F7 — move 主力買賣超 row to display ABOVE the 融資融券 section.

- **Success criteria:**
  - F4: symbol+date header block (`:123-128`) removed; 三大法人 block (`:130-152`) removed — no `三大法人`/`外資`/`投信`/`自營商` text in this panel.
  - F7: DOM order is `主力買賣超` → `融資融券` → mode tabs → broker list.
  - F5 (net mode): buyer list (買超 + top 15) in its OWN `overflow-y-auto` container; seller list (賣超 + top 15) in its OWN `overflow-y-auto` container; verifiable by ≥2 distinct scrollable elements.
  - F5: two halves split flex height ~50/50 (`flex-1 min-h-0` siblings).
  - F5: each half keeps its own sticky 6-column header row (#, 分點, 淨買賣, 買張, 賣張).
  - F5: volume mode (前 15 大交易量分點) keeps single-scroll list.
  - Broker checkboxes still toggle `selectedBrokerIds` via `onToggleBroker` in both halves.
  - Empty-state ("請搜尋股票代號") preserved.
  - `npm --prefix frontend run typecheck` passes.
  - `npm --prefix frontend run test` passes (no existing test targets this panel).

- **Cannot-break:**
  - Broker checkbox toggling `onToggleBroker(broker_id, name)` from both halves.
  - `onClearAllBrokers` (全部清除) button when N>1.
  - Selected-chips region (`:215-244`) — pills, × remove, 全部清除.
  - Mode tab switch (`:188-212`); volume-mode list and columns unchanged.
  - `buyers.slice(0,15)` / `sellers.slice(0,15)` data + ranks + `BrokerRow` + `splitBrokers` unchanged.
  - `majorNet` calculation (`:103-108`) numerically identical — only DOM position changes (F7).
  - 融資融券 content (融資增減/融券增減/券資比/融資餘額/融券餘額) unchanged.
  - `BrokerRow` (`:45-89`) + `brokerBadge`/`fmtRate`/`rateClass` untouched.
  - `App.tsx` prop contract unchanged.
  - `ChipKlineChart` + `chip-inst-bar-svg` still own 三大法人 visualization elsewhere.
  - Outer `h-full flex flex-col overflow-hidden` (`:122`) preserved.

- **Out-of-scope:**
  - Refactoring `BrokerRow` into its own file.
  - Column widths / font sizes.
  - Touching volume-mode layout / dual-scroll for volume mode.
  - Resize handles between halves.
  - Persisting scroll position across mode toggles.
  - Restyling 融資融券 / 主力買賣超 beyond position.
  - Removing `FOREIGN_KEYWORDS` / `GOV_KEYWORDS`.
  - `splitBrokers` / `topByVolume` / `fmtVol` in `chip-data.ts`.
  - Virtualization (15 rows × 2).
  - `App.tsx` layout / parent grid.

- **File changes:**

  | File | 🔴/🟢/🔵 | Description | Lines |
  |------|--------|-------------|-------|
  | `frontend/src/components/ChipBrokersPanel.tsx` | 🔴 | F4: delete symbol+date header block + 三大法人 block. | 123-152 |
  | `frontend/src/components/ChipBrokersPanel.tsx` | 🔴 | F7: relocate 主力買賣超 row (currently `:180-186`) to render IMMEDIATELY ABOVE 融資融券 section (currently starts `:154`). New top-of-panel order: 主力買賣超 → 融資融券 → mode tabs → selected chips → list area. | 154-186 |
  | `frontend/src/components/ChipBrokersPanel.tsx` | 🔴 | F5: restructure net-mode branch (`:248-292`) so 買超 and 賣超 each in OWN sibling div with `flex-1 min-h-0 overflow-y-auto scroll-editorial`, wrapped in parent flex-column replacing the single `flex-1 overflow-y-auto`. Each half repeats own sticky 6-col header. Volume-mode (`:293-313`) unchanged. | 246-315 |

- **Existing tests impact (must-stay-green):**
  - `chip-data.test.ts`, `chip-svg.test.ts`, `chip-svg-render.test.tsx`, `api.test.ts`, `BrokerSearch.test.tsx`, `useBrokerHistory.test.ts` — all unrelated.

- **New tests to write (optional, recommended):**
  - `ChipBrokersPanel.test.tsx`: (a) 三大法人/外資/投信/自營商 text absent; (b) summary.symbol header absent; (c) DOM index of 主力買賣超 < DOM index of 融資融券; (d) ≥2 `overflow-y-auto` elements in net-mode list region; (e) clicking buyer checkbox + seller checkbox both invoke `onToggleBroker(broker_id, name)`; (f) volume-mode renders `當沖率` column header.

- **Backward compat risks:**
  - Future snapshot test would break — none exist (Grep confirmed).
  - Selectors relying on symbol+date text inside this panel would break — none found.
  - Two scroll containers means total visible rows drops — requested behavior (F5).
  - Sticky `top-0` inside each half is per-scroll-parent — no conflict.
  - Moving 主力 above 融資融券 changes vertical reading order — acceptable per F7.

- **Commit-split proposal:**
  1. 🔵 — none (BrokerRow already isolated).
  2. 🔴 `feat(ChipBrokersPanel)`: remove right-side symbol/date header + 三大法人 block; relocate 主力買賣超 above 融資融券; split top-15 buyers/sellers into two independently scrollable half-height lists in net mode (F4+F5+F7).
  3. 🟢 (optional) `test(ChipBrokersPanel)`: add render tests for new layout invariants.

---

### Cluster D — K-line price crosshair + header collapse (F6 + F8)

**Features:** F6 — K-line hover shows horizontal price crosshair + right-axis price tick label so user can read price at cursor Y. F8 — chip-analysis header collapses 籌碼分析 title + SymbolSearch + symbol/name + date input + refresh button onto a single horizontal row.

- **Success criteria:**
  - When hovering K-line area, a dashed horizontal line spans `x=padL` to `x=(width-padR)` at cursor Y, in addition to existing dashed vertical line.
  - Small filled price-label chip rendered on right axis at hover Y showing inverse `klineScaleY` price, formatted by existing `fmtPrice()`.
  - Horizontal crosshair only renders while cursor in chart (price) area `[padT, volTop]`; NOT over volume sub-area.
  - Hovering still updates `hoverIndex` and propagates to sub-charts; sub-charts continue to show ONLY vertical hover line (no horizontal added).
  - Mouse leave resets both `hoverIndex` AND `hoverY` to null.
  - Header row in `App.tsx` renders 籌碼分析 `<h1>`, `SymbolSearch` (220px), optional symbol+name span, date input, refresh button on a SINGLE flex row with consistent center alignment.
  - Tab bar (籌碼總覽 / 泡泡圖) remains on its own line directly below.
  - All existing tests pass without modification; `tsc --noEmit` clean.

- **Cannot-break:**
  - Existing vertical dashed crosshair at `xOf(hoverIndex)`.
  - `hoverIndex` prop contract from KlineChartSvg upward; sub-chart X-axis sync.
  - Gold `selectedIndex` cursor + date tag (`data-testid=sel-cursor`).
  - `onClickIndex` callback: overlay click still fires `handleClickIndex → onPickDate`.
  - OHLCV info row uses `infoIdx = hoverIndex ?? lastIndex` fallback (note: Bug #3 fix also touches this — apply 3-tier fallback there).
  - Right-side price grid labels (`fmtPrice` at `width-padR+4`).
  - Refresh button disabled state (`isLoading || !symbol`).
  - Date input controlled value + `userPickedDate.current = true` side effect.
  - `SymbolSearch.onPick` → `handlePick` chain still resets `selectedBrokerIds`.
  - Tab switching + lazy `ChipBubbleView` untouched.
  - Header chrome heights should not visibly shift main content area by more than ~10px.

- **Out-of-scope:**
  - OHLC floating tooltip at cursor position.
  - Horizontal crosshair on sub-charts (bar/line — horizontal-Y has no meaningful price).
  - Snapping hover Y to nearest grid line.
  - Hover crosshair in volume sub-area.
  - Refactoring `useContainerSize` / Suspense.
  - Restyling `SymbolSearch` internals.
  - Reordering tab bar.
  - Touching `ChipBubbleView`, `ChipBrokersPanel`, `useChipData`, `useChipBubble`.
  - Keyboard arrow navigation for hover.
  - Persisting hoverY across remounts.
  - Replacing inline hex colors with Tailwind tokens.

- **File changes:**

  | File | 🔴/🟢/🔵 | Description | Lines |
  |------|--------|-------------|-------|
  | `frontend/src/lib/chip-kline-svg.tsx` | 🟢 | Add horizontal crosshair: (1) extend `KlineChartProps` with `hoverY?: number \| null` and `onHoverY?: (y: number \| null) => void`. (2) Extend `handleMouseMove` to compute `mouseY` and call `onHoverY(mouseY)` when in `[padT, volTop]`, else `onHoverY(null)`. (3) `handleMouseLeave` also calls `onHoverY?.(null)`. (4) After existing vertical-line block (`~:279-287`), render `<line x1={padL} y1={hoverY} x2={width-padR} y2={hoverY} stroke={t.inkDim} strokeDasharray='4 3'/>` when `hoverY != null` AND in `[padT, volTop]`. (5) Render filled price-label chip on right axis at `(width-padR, hoverY)`: small `<rect>` (fill `t.bg`, stroke `t.inkDim`) + text `fmtPrice(invScale(hoverY))` where `invScale` inverts `klineScaleY`: `price = pMax - ((hoverY - padT) / chartH) * (pMax - pMin)`. (6) Add `data-testid='hover-hline'` and `'hover-price-label'`. | 58-75, 158-173, after 287 |
  | `frontend/src/components/ChipKlineChart.tsx` | 🟢 | Add `const [hoverY, setHoverY] = useState<number \| null>(null);` Pass `hoverY={hoverY}` and `onHoverY={setHoverY}` to `<KlineChartSvg/>`. Do NOT pass `hoverY` to sub-charts. | 23, 103-114 |
  | `frontend/src/App.tsx` | 🔴 | Collapse two header rows into ONE flex row. Remove wrapper `<div className='flex items-center justify-between mb-3'>` holding only `<h1>`. Move `<h1>籌碼分析</h1>` as first child of existing controls row (`.flex.items-center.gap-3` at `:122`). Use `items-center`; `<h1>` keeps `text-2xl text-ink font-semibold` + `mr-2`. Symbol+name span: use inner flex with `items-baseline` if needed; outer row remains `items-center`. Tab bar (`mt-3`) stays. Outer `pt-5 pb-3` unchanged. | 118-146 |

- **Existing tests impact (must-stay-green):**
  - `chip-svg-render.test.tsx` — new `hoverY`/`onHoverY` are optional; existing tests never set them; new nodes only render when `hoverY != null`.
  - `chip-svg.test.ts` — `klineScaleY` math unchanged (only added inline inverse for price label).
  - `chip-data.test.ts`, `api.test.ts`, `BrokerSearch.test.tsx`, `useBrokerHistory.test.ts` — unrelated.

- **New tests to write:**
  - `chip-svg-render.test.tsx`:
    1. `describe('KlineChartSvg hoverY horizontal crosshair')`: renders `[data-testid=hover-hline]` when `hoverY` in `[padT, volTop]`.
    2. does NOT render `[data-testid=hover-hline]` when `hoverY` is null.
    3. renders `[data-testid=hover-price-label]` with text matching `fmtPrice(invertedPrice)`.
    4. `onHoverY(null)` on overlay mouseLeave.
    5. `onHoverY(number)` on overlay mouseMove inside chart area.
    6. `it('does NOT render hover-hline when hoverY is in volume area')`.
  - (Optional) `chip-svg.test.ts` `describe('klineScaleY round-trip')`: scale(price) → inverse → original within 1e-9.

- **Backward compat risks:**
  - `onHoverY` is new optional callback — wire in same PR or feature silently no-ops.
  - Header flex collapse changes chrome height by ~28px; no layout test depends on this.
  - mouseY math must use `e.clientY - rect.top` consistent with mouseX (already works); SVG viewBox matches width/height (no scale mismatch).
  - `items-baseline` vs `items-center` mixing: pick `items-center` for outer; keep symbol+name inner flex `items-baseline`.

- **Commit-split proposal:**
  1. 🔴 `fix(header)`: collapse 籌碼分析 title + symbol search + date + refresh onto single horizontal row (F8).
  2. 🟢 `feat(kline)`: add horizontal price crosshair + right-axis price label on K-line hover (F6) — `KlineChartSvg` gains optional `hoverY`/`onHoverY`; `ChipKlineChart` wires local state; sub-charts unchanged.

---

### Cluster E — Date picker + checkbox style polish (F9)

**Feature:** F9 — date picker + checkbox style polish, matching project theme (`bg-deep`/`line`/`ink`/`accent`/`ma5`).

- **Success criteria:**
  - Header date input renders with `bg-bg-deep`, `border-line`, hover/focus border in `accent`, `tabular-nums`, custom `::-webkit-calendar-picker-indicator` filter.
  - Date input shows visible `focus-visible` ring (`ring-2 ring-accent/40 ring-offset-2 ring-offset-bg`) that does NOT appear on mouse click.
  - Every `<input type="checkbox">` in `ChipBrokersPanel.BrokerRow` renders via new `Checkbox` component: 14×14, 1px `border-line` default, `border-line-strong` hover, `bg-[#b794f4]` with white check glyph when checked, focus-visible ring matching date input.
  - Checkbox keeps native semantics: receives focus, toggles on Space, fires `onChange` correctly — verified by a11y test.
  - `DateField` forwards `onChange` so `App.tsx` handler still receives event with `target.value = YYYY-MM-DD`; no change to `handlePickDate` / `userPickedDate` logic.
  - `npm run build` (tsc -b + vite build) green; `npm test` green including new unit tests.
  - Visual smoke via Chrome DevTools MCP at 1440×900: header date input + ChipBrokersPanel rows render without layout shift; selected-row purple highlight visible; checkmark legible on purple fill.

- **Cannot-break:**
  - `App.tsx` date input still emits `onChange` with `YYYY-MM-DD` string (`handlePickDate` contract).
  - `userPickedDate` ref: typing sets `true`; selecting last-candle date in K-line resets to `false`.
  - `ChipBrokersPanel` BrokerRow checkbox: toggling fires `onToggleBroker(id, name)` once per click; selected styling `bg-[#b794f4]/[0.06]` still applied.
  - `aria-label` on each checkbox (`勾選 ${broker.name}`) preserved.
  - `BrokerSearch.test.tsx` (text input + dropdown) remains green.
  - `chip-svg` / `chip-data` / `api` tests remain green.
  - Tailwind v4 `@theme` tokens in `index.css` unchanged.
  - No new runtime dependency added; radix-ui NOT pulled in for Checkbox.

- **Out-of-scope:**
  - Migrate header/refresh/tab buttons to shadcn Button.
  - Wire shadcn design-token CSS variables into `index.css`. Unused shadcn scaffolds in `src/components/ui/{input,button,skeleton,tabs}.tsx` remain as-is.
  - Remove / refactor unused shadcn scaffolds (separate cleanup PR).
  - Custom popover/calendar replacing native `<input type="date">`.
  - Restyle `BrokerSearch` text input.
  - Change purple accent color `#b794f4`.

- **File changes:**

  | File | 🔴/🟢/🔵 | Description | Lines |
  |------|--------|-------------|-------|
  | `frontend/src/components/ui/checkbox.tsx` | 🟢 | NEW. Tiny project-theme `Checkbox`: native `<input type=checkbox>` wrapped in `<label>` with styled sibling box. Uses `cn()` from `@/lib/utils`. Exposes `Checkbox({checked, onCheckedChange \| onChange, aria-label, className, ...})`. Box: 14×14, `rounded-sm`, `border border-line`, `hover:border-line-strong`, `checked:bg-[#b794f4] checked:border-[#b794f4]`, `focus-visible:ring-2 ring-accent/40 ring-offset-2 ring-offset-bg`. Check glyph: inline SVG via `peer-checked`. | new ~50 lines |
  | `frontend/src/components/ui/date-field.tsx` | 🟢 | NEW. `DateField` wraps `<input type="date">` with project styling. Forwards `value`, `onChange`, `min`, `max`, `disabled`, `className`. `h-8 bg-bg-deep border border-line text-ink px-2.5 text-sm tabular-nums rounded-sm outline-none hover:border-line-strong focus:border-accent focus-visible:ring-2 ring-accent/40 ring-offset-2 ring-offset-bg`. Includes `::-webkit-calendar-picker-indicator` customization via className that targets a rule in `index.css`. | new ~30 lines |
  | `frontend/src/index.css` | 🟢 | Append selector `.date-field-input::-webkit-calendar-picker-indicator { filter: invert(0.65) sepia(0.2); cursor: pointer; opacity: 0.7 } .date-field-input::-webkit-calendar-picker-indicator:hover { opacity: 1 }`. No changes to `@theme`. | append after scrollbar block (21-30) |
  | `frontend/src/App.tsx` | 🔴 | Replace raw `<input type="date">` (`:132-137`) with `<DateField value={date} onChange={...}/>`. `onChange` semantics unchanged: `setDate(e.target.value)` + `userPickedDate.current = true`. Add import. | 1-10, 132-137 |
  | `frontend/src/components/ChipBrokersPanel.tsx` | 🔴 | Inside `BrokerRow` (`:54-60`), replace raw `<input type="checkbox">` with `<Checkbox checked={selected} onCheckedChange={onToggle} aria-label={...}/>`. Add import. Row outer styling unchanged. | 1-3, 54-60 |
  | `frontend/src/components/ui/checkbox.test.tsx` | 🟢 | NEW. Vitest + RTL. (1) renders unchecked by default; (2) click toggles + onCheckedChange; (3) Space when focused; (4) `aria-label` via getByLabelText; (5) disabled prevents toggle. | new ~80 lines |
  | `frontend/src/components/ui/date-field.test.tsx` | 🟢 | NEW. (1) renders `type=date`; (2) onChange forwards event.target.value; (3) value prop reflects in DOM; (4) aria-label honored; (5) disabled prevents change. | new ~60 lines |

- **Existing tests impact (must-stay-green):**
  - `BrokerSearch.test.tsx` — BrokerSearch untouched.
  - `chip-data.test.ts`, `chip-svg.test.ts`, `chip-svg-render.test.tsx`, `api.test.ts` — untouched.

- **New tests to write:**
  - `checkbox.test.tsx` — cases above.
  - `date-field.test.tsx` — cases above.
  - (Optional) light App-level integration assertion via `getByDisplayValue(date string)` if similar pattern exists; otherwise skip.

- **Backward compat risks:**
  - Native `<input type="date">` appearance varies; `::-webkit-calendar-picker-indicator` filter is Chrome/Edge only; Firefox/Safari fall back to default glyph — acceptable.
  - Tailwind v4 `checked:` variant on custom Checkbox may need `peer` + `peer-checked:` pattern (visually hidden input but focusable: `sr-only` or `opacity-0 absolute`).
  - `ring-offset-bg` relies on `--color-bg` (defined `index.css:5`) — safe.
  - First grid column is 22px wide — Checkbox renders 14×14 box inside 22×22 hit area, identical footprint.

- **Commit-split proposal:**
  1. 🟢 Add `src/components/ui/checkbox.tsx` + `checkbox.test.tsx` (new component, no caller wired — tests pass standalone).
  2. 🟢 Add `src/components/ui/date-field.tsx` + `date-field.test.tsx` + `index.css` `::-webkit-calendar-picker-indicator` block (new component, no caller wired).
  3. 🔴 Wire `DateField` into `App.tsx` (replace raw input) AND `Checkbox` into `ChipBrokersPanel` `BrokerRow` (replace raw input) — single commit so visual change lands atomically. Run `npm test` + manual DevTools smoke before commit.

---

## Part C — Open Questions for User

1. **Bug #1 fix strategy:** Prefer the name-based join (smallest diff, sidesteps id-namespace question) OR the source-fix (re-using `taiwan_stock_trading_daily_report` per-day)? Recommendation: name-based — but the spec at `docs/specs/2026-06-22-chip-overview-enhancements-design.md` should be updated either way, and one curl diagnostic on SecIdAgg is still recommended to confirm what the actual upstream payload looks like before locking in the fix shape.
2. **Bug #2 TTL value:** What TTL is acceptable for `fetch_chip_history` and `fetch_broker_history` during trading hours? 15 min (suggested), 5 min (aggressive), 30 min (mirror summary)? And: only apply staleness when `cached.last_date == today` (matching summary semantics) — confirm OK?
3. **Bug #2 scope confirmation:** Symptom report says "browser refresh doesn't update chip data" — does the user also include the summary panel (which already has a 30-min TTL) in the complaint, or only K-line + broker history? If only the latter, scope shrinks to two functions.
4. **Cluster B (F3):** Should `summary` ALSO remain visible across date changes (recommended for smoother UX) OR briefly null-out to make the loading state more obvious? Spec assumes "keep previous visible + localized indicator".
5. **Cluster B (F3) loading indicator visual:** "載入中…" text caption next to date header, OR opacity dim + spinner, OR both? Spec assumes caption + `aria-busy` + optional subtle opacity-70 dim.
6. **Cluster C (F5) sticky header:** Confirm OK that each scrollable half re-renders its own sticky 6-column header (one header per half = two total). Alternative is a single shared header above both halves — less informative when scrolling lower half.
7. **Cluster D (F6) price-label format:** Should the hover price label use `fmtPrice` (which matches grid ticks) or include extra decimals? Spec assumes `fmtPrice` for consistency.
8. **Cluster E (F9) scope of polish:** Confirm only date input + broker checkboxes are in scope (not header buttons, tabs, BrokerSearch text input).

---

## Part D — Implementation Order (proposed)

1. **Bug fixes first (smallest, highest priority):**
   1. **Bug #3** (cheapest — four one-line ternary changes in three SVG files + regression tests in `chip-svg-render.test.tsx`).
   2. **Bug #1** (preferred: name-based join — semantically meaningful but contained; also add defensive logging in `_filter_broker_history`). Update spec at `docs/specs/2026-06-22-chip-overview-enhancements-design.md §2.3`. Backend + frontend coordinated changes.
   3. **Bug #2** (mirror `fetch_chip_summary`'s `_is_stale` pattern in `fetch_chip_history` and `fetch_broker_history`; add backend tests with monkeypatched `now()` or `freezegun`).
2. **Feature 🔵 refactors:**
   1. Cluster B 🔵 — `ChipKlineChart` "no loading gate" intent comment.
3. **Feature 🔴 behavior changes:**
   1. Cluster A 🔴 commit 1 — F1 drop yellow stroke + 2px (+ tests).
   2. Cluster A 🔴 commit 2 — F2 hoist `visibleTrades` above empty-volume gate (+ tests).
   3. Cluster B 🔴 — split `useChipData` into independent fetches; wire `summaryLoading` through `App.tsx`.
   4. Cluster C 🔴 — F4+F5+F7 atomic ChipBrokersPanel relayout.
   5. Cluster D 🔴 — F8 header collapse to single row.
   6. Cluster E 🔴 (after the two 🟢 component additions land) — wire `DateField` into `App.tsx` AND `Checkbox` into `ChipBrokersPanel` atomically.
4. **Feature 🟢 new features:**
   1. Cluster B 🟢 — `ChipBrokersPanel` `loading` prop + indicator + `useChipData.test.ts` + `ChipBrokersPanel.test.tsx`.
   2. Cluster C 🟢 (optional) — `ChipBrokersPanel.test.tsx` layout invariants.
   3. Cluster D 🟢 — F6 horizontal price crosshair + right-axis price label in `KlineChartSvg` + `ChipKlineChart` state wiring + tests.
   4. Cluster E 🟢 (these land BEFORE Cluster E 🔴 above) — `Checkbox` component + tests; `DateField` component + tests + `index.css` rule.
