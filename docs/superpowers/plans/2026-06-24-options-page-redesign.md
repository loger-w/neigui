# Options Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 50/50 panel layout with a top-strip 大戶 NET (with sparklines) + full-height Strike Ladder showing all volume>0 strikes Y-axis low-to-high with a 台指期 spot anchor line.

**Architecture:** Backend adds a 4-net series for the strip sparklines, returns all volume>0 strikes from `/api/options/strike_volume` (no top_n), and adds a new `/api/options/spot` endpoint sourced from FinMind `TaiwanFuturesDaily`. Frontend replaces `OptionsLargeTradersPanel`+`OptionsStrikeVolumePanel` with `OptionsLargeTradersStrip` (4 cards × sparkline) + `OptionsStrikeLadder` (Y-axis strike high-to-low, Call left bars, Put right bars, red anchor row at spot).

**Tech Stack:** Python 3 / FastAPI / httpx (backend) — React 19 / TypeScript / Vite / Vitest / Tailwind (frontend). FinMind Sponsor tier datasets `TaiwanOptionOpenInterestLargeTraders`, `TaiwanOptionDaily`, `TaiwanFuturesDaily`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-options-page-redesign-design.md`. Every requirement → a task in this plan.
- **Phase 0b first:** Task 0 must finish (curl TaiwanFuturesDaily TX) and discovered schema differences appended to spec before Tasks 3+ are implemented.
- **Breaking change ack:** Backend `/api/options/strike_volume` drops `top_n` query (silently ignored if a stale URL still sends it). Response `call` / `put` arrays grow from ≤10 to 30-50 items sorted by strike asc instead of volume desc. Frontend is the sole caller; no compat layer.
- **Cache:** New constant reuse, `_CACHE_VERSION_OPTIONS = 1` (unchanged). New cache files: `TX_{date}_spot.json`. Existing `{contract}_{date}_oi_lt.json` + `{contract}_{date}_strike_vol_top{n}.json` — the strike_vol cache key drops `_top{n}` suffix after Task 2.
- **Equity flow untouchable:** zero diff to `routes/chip.py`, `hooks/useChipData.ts`, `useChipBubble.ts`, `useBrokerHistory.ts`, `App.tsx`, `ChipBubbleView.tsx`, `ChipBrokersPanel.tsx`, `ChipKlineChart.tsx`. The redesign is options-only.
- **TDD:** every change starts with a failing test. No `--no-verify`, no `.skip`/`xfail`, no `try/except: pass`.
- **One commit per task** (or per sub-step where the task body explicitly splits commits).
- **Locale:** Traditional Chinese in comments where the surrounding code uses it; commit messages bilingual is fine.
- **Verification each task:** the agent runs the relevant verification step (`pytest`, `ruff`, `vitest`, `tsc`, `npm run build`) before committing if its diff touches that side.

---

## File Inventory

**Backend create:**
- (Phase 0 modifies spec only)
- No new files (parser + route + cache helpers extend existing `services/finmind.py`, `services/finmind_options.py`, `routes/options.py`)

**Backend modify:**
- `backend/services/finmind_options.py` — `parse_oi_large_traders` series 4 nets, `parse_strike_volume` drop top_n+sort by strike, add `parse_spot`
- `backend/services/finmind.py` — add `fetch_spot` + `_do_fetch_spot` to `FinMindClient`
- `backend/routes/options.py` — drop top_n from `strike_volume` route signature, add `get_spot` route
- `backend/tests/test_finmind_options.py` — extend tests
- `backend/tests/test_options_routes.py` — extend tests
- `docs/superpowers/specs/2026-06-24-options-page-redesign-design.md` — Phase 0b addendum

**Frontend create:**
- `frontend/src/hooks/useOptionsSpot.ts`
- `frontend/src/hooks/useOptionsSpot.test.ts`
- `frontend/src/lib/options-svg.tsx` (replaces `options-chart-svg.tsx`)
- `frontend/src/lib/options-svg.test.tsx` (replaces `options-chart-svg.test.tsx`)
- `frontend/src/components/OptionsLargeTradersStrip.tsx`
- `frontend/src/components/OptionsLargeTradersStrip.test.tsx`
- `frontend/src/components/OptionsStrikeLadder.tsx`
- `frontend/src/components/OptionsStrikeLadder.test.tsx`

**Frontend modify:**
- `frontend/src/lib/options-types.ts` — extend `series` shape, add `OptionsSpot` interface
- `frontend/src/lib/options-api.ts` — add `spot()` method, drop `topN` arg from `strikeVolume()`
- `frontend/src/hooks/useOptionsStrikeVolume.ts` — drop `topN` arg + topN dep
- `frontend/src/hooks/useOptionsStrikeVolume.test.ts` — drop topN-passing test
- `frontend/src/components/OptionsHeader.tsx` — add spot display section + new `spot` prop
- `frontend/src/components/OptionsHeader.test.tsx` — add spot-displayed test
- `frontend/src/components/OptionsPage.tsx` — replace 2-row grid with strip + ladder layout

**Frontend delete:**
- `frontend/src/components/OptionsLargeTradersPanel.tsx`
- `frontend/src/components/OptionsLargeTradersPanel.test.tsx`
- `frontend/src/components/OptionsStrikeVolumePanel.tsx`
- `frontend/src/components/OptionsStrikeVolumePanel.test.tsx`
- `frontend/src/lib/options-chart-svg.tsx`
- `frontend/src/lib/options-chart-svg.test.tsx`

---

## Task 0: Phase 0b — Validate `TaiwanFuturesDaily` TX Schema

**Files:**
- Modify: `docs/superpowers/specs/2026-06-24-options-page-redesign-design.md` (append addendum)

**Interfaces:**
- Consumes: FinMind token from `backend/.env`
- Produces: a "Phase 0b Schema Validation Result" section at the bottom of the spec stating the actual `data_id` literal + field names that the `parse_spot` parser in Task 3 will use

- [ ] **Step 1: Probe TaiwanFuturesDaily for both candidates**

```bash
cd /c/side-project/trash-cmoney
TOKEN=$(grep '^FINMIND_TOKEN=' backend/.env | sed 's/^FINMIND_TOKEN=//' | tr -d '"' | tr -d "'")
mkdir -p /tmp/phase0b

# Probe with data_id=TX (近月) and TXFCONT (連續月)
for ID in TX TXFCONT TXF; do
  curl -s "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesDaily&data_id=${ID}&start_date=2026-06-15&end_date=2026-06-23" \
    -H "Authorization: Bearer $TOKEN" \
    -o "/tmp/phase0b/${ID}.json"
  python -c "import json; d=json.load(open('/tmp/phase0b/${ID}.json')); print('${ID}:', 'msg=', d.get('msg'), 'count=', len(d.get('data', [])), 'sample=', json.dumps(d.get('data', [])[:1], ensure_ascii=False))"
done
```

Expected outcome: at least one of `TX` / `TXFCONT` / `TXF` returns `msg: success` with `count > 0` and a sample row containing daily OHLCV + settlement_price + open_interest fields.

- [ ] **Step 2: Record results in spec**

Open `docs/superpowers/specs/2026-06-24-options-page-redesign-design.md` and append at the end of the file:

```markdown
---

## Phase 0b Schema Validation Result — 2026-06-24

Verified against live FinMind responses on 2026-06-24.

### `TaiwanFuturesDaily` TX-family probe

| data_id | msg | row count | notes |
|---------|-----|-----------|-------|
| `TX`    | <observed> | <count> | <notes — is this the front-month future?> |
| `TXFCONT` | <observed> | <count> | <continuous-contract candidate> |
| `TXF`   | <observed> | <count> | <generic台指期 candidate> |

### Chosen `data_id` for `parse_spot`

**`<TX / TXFCONT / TXF>`** because <reason — most rows / clearest sample / matches Yahoo TAIEX FUT>.

### Field map for `parse_spot`

- `date` → `date`
- spot (today's close) → `<observed field, e.g. close>`
- prev_close → second-to-last row's `<observed field>`
- volume / open_interest → `<observed names>` (for future extension; not required by this redesign)

### Spec deltas needed

- (none — implementation can proceed with parse_spot as planned)
- OR <bullet list of differences between spec assumption and reality>
```

Fill `<observed>` placeholders with actual values from Step 1. If the chosen `data_id` differs from `TX` (the spec's default assumption in §2.4), also patch §2.4 of the spec body to match.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-24-options-page-redesign-design.md
git commit -m "docs(options): record Phase 0b TaiwanFuturesDaily schema validation"
```

---

## Task 1: parse_oi_large_traders — series 4 nets

**Files:**
- Modify: `backend/services/finmind_options.py` (function `parse_oi_large_traders`, return value `series` items)
- Modify: `backend/tests/test_finmind_options.py` (extend tests)

**Interfaces:**
- Consumes: existing `_aggregate_call_put_pair` helper
- Produces: `series[i]` gains `top5_prop_net` and `top5_all_net` keys (in addition to existing `top10_prop_net` and `top10_all_net`). All existing keys + types unchanged.

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_finmind_options.py` (after the existing `test_parse_oi_large_traders_series_in_date_order` block):

```python
def test_parse_oi_large_traders_series_includes_four_nets_per_day():
    """Each series entry must carry top5 + top10 × prop + all (4 nets)."""
    from services.finmind_options import parse_oi_large_traders
    rows = [
        _oi_row("2026-06-23", "call",
                buy_top5_trader_open_interest=100,    sell_top5_trader_open_interest=40,
                buy_top10_trader_open_interest=200,   sell_top10_trader_open_interest=120,
                buy_top5_specific_open_interest=80,   sell_top5_specific_open_interest=30,
                buy_top10_specific_open_interest=140, sell_top10_specific_open_interest=60),
        _oi_row("2026-06-23", "put",
                buy_top5_trader_open_interest=40,     sell_top5_trader_open_interest=70,
                buy_top10_trader_open_interest=90,    sell_top10_trader_open_interest=160,
                buy_top5_specific_open_interest=20,   sell_top5_specific_open_interest=55,
                buy_top10_specific_open_interest=45,  sell_top10_specific_open_interest=110),
    ]
    out = parse_oi_large_traders(rows, contract_type="202607")
    assert len(out["series"]) == 1
    entry = out["series"][0]
    # delta-equivalent net:  long(call.buy+put.sell) - short(call.sell+put.buy)
    assert entry["top5_all_net"]   == (100 + 70) - (40  + 40)   #  80
    assert entry["top10_all_net"]  == (200 + 160) - (120 + 90)  # 150
    assert entry["top5_prop_net"]  == (80 + 55) - (30 + 20)     #  85
    assert entry["top10_prop_net"] == (140 + 110) - (60 + 45)   # 145
    assert entry["date"] == "2026-06-23"
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k test_parse_oi_large_traders_series_includes_four_nets_per_day
```

Expected: 1 failure with `KeyError: 'top5_all_net'` (or similar).

- [ ] **Step 3: Implement**

Open `backend/services/finmind_options.py`. Find this block inside `parse_oi_large_traders` (the `series` construction at the end):

```python
    series = []
    for d in dates_sorted:
        agg = _aggregate_call_put_pair(
            by_date[d].get("call"), by_date[d].get("put"),
        )
        series.append({
            "date": d,
            "top10_all_net":  agg["top10_all"]["net"],
            "top10_prop_net": agg["top10_prop"]["net"],
        })
```

Replace it with:

```python
    series = []
    for d in dates_sorted:
        agg = _aggregate_call_put_pair(
            by_date[d].get("call"), by_date[d].get("put"),
        )
        series.append({
            "date": d,
            "top5_all_net":   agg["top5_all"]["net"],
            "top10_all_net":  agg["top10_all"]["net"],
            "top5_prop_net":  agg["top5_prop"]["net"],
            "top10_prop_net": agg["top10_prop"]["net"],
        })
```

- [ ] **Step 4: Verify pass + no regression**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v
```

Expected: all PASSED including the new test (one new + all existing).

- [ ] **Step 5: Ruff + commit**

```bash
cd backend
ruff check . && ruff check --fix .
git add backend/services/finmind_options.py backend/tests/test_finmind_options.py
git commit -m "feat(options): expand OI series to 4 nets per day for strip sparklines"
```

---

## Task 2: parse_strike_volume — drop top_n, return all strikes asc

**Files:**
- Modify: `backend/services/finmind_options.py` (function `parse_strike_volume` signature + body)
- Modify: `backend/tests/test_finmind_options.py` (rewrite affected tests)

**Interfaces:**
- Consumes: existing strike row aggregation logic
- Produces: `parse_strike_volume(rows: list[dict], contract_date: str, option_id: str = "TXO") -> dict` — `top_n` parameter REMOVED. Return shape: `{call: [...all volume>0 strikes, asc], put: [...], as_of_date: str|None}`.

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_finmind_options.py`:

```python
def test_parse_strike_volume_returns_all_volume_strikes_sorted_by_strike_asc():
    """Redesign drops top_n — return every volume>0 strike, sorted by strike asc."""
    from services.finmind_options import parse_strike_volume
    today = "2026-06-23"
    rows = [
        _od_row(today, "202607", "call", 53500, 1200, 8410),
        _od_row(today, "202607", "call", 50000,  165, 1240),
        _od_row(today, "202607", "call", 52000,  240, 2680),
        _od_row(today, "202607", "call", 51000,    0, 1380),  # zero — drop
        _od_row(today, "202607", "put",  51500,  209, 5180),
        _od_row(today, "202607", "put",  50000,  364, 8120),
    ]
    out = parse_strike_volume(rows, "202607")  # NOTE: no top_n
    # All call strikes with volume > 0, sorted ascending
    assert [c["strike"] for c in out["call"]] == [50000, 52000, 53500]
    assert [p["strike"] for p in out["put"]]  == [50000, 51500]
    assert out["as_of_date"] == today
```

- [ ] **Step 2: Update existing top_n tests to drop the parameter**

The existing tests pass `top_n=N`. Update them so they don't pass that arg anymore:

Find these tests and patch the `parse_strike_volume(..., top_n=N)` calls to drop the `top_n` keyword:

- `test_parse_strike_volume_picks_top_n_per_side` — RENAME to `test_parse_strike_volume_keeps_all_volume_rows_sorted_asc` and rewrite assertions:

  Replace the body with:

  ```python
  def test_parse_strike_volume_keeps_all_volume_rows_sorted_asc():
      from services.finmind_options import parse_strike_volume
      today = "2026-06-23"
      rows = [
          _od_row(today, "202607", "call", 22000, 18500, 35200),
          _od_row(today, "202607", "call", 22100, 12100, 30000),
          _od_row(today, "202607", "call", 21900,  9400, 22000),
          _od_row(today, "202607", "call", 21800,  3000, 12000),
          _od_row(today, "202607", "put",  21500, 14200, 28100),
          _od_row(today, "202607", "put",  21000,  9800, 18000),
      ]
      out = parse_strike_volume(rows, "202607")
      assert [c["strike"] for c in out["call"]] == [21800, 21900, 22000, 22100]
      assert [p["strike"] for p in out["put"]]  == [21000, 21500]
      assert out["call"][2]["volume"] == 18500  # strike 22000 → vol 18500
  ```

- `test_parse_strike_volume_sums_trading_sessions` — drop `top_n=1`, change last lookup to `[0]`:

  ```python
  def test_parse_strike_volume_sums_trading_sessions():
      from services.finmind_options import parse_strike_volume
      rows = [
          _od_row("2026-06-23", "202607", "call", 22000, 12000, 35200, session="position"),
          _od_row("2026-06-23", "202607", "call", 22000,  6500, 35400, session="after_market"),
      ]
      out = parse_strike_volume(rows, "202607")
      assert out["call"][0]["volume"] == 12000 + 6500
      assert out["call"][0]["oi"] == 35400
  ```

- `test_parse_strike_volume_computes_oi_change_against_prev_day` — drop `top_n=1`:

  ```python
  def test_parse_strike_volume_computes_oi_change_against_prev_day():
      from services.finmind_options import parse_strike_volume
      rows = [
          _od_row("2026-06-20", "202607", "call", 22000, 14000, 33100),
          _od_row("2026-06-23", "202607", "call", 22000, 18500, 35200),
      ]
      out = parse_strike_volume(rows, "202607")
      assert out["call"][0]["oi_change"] == 35200 - 33100
  ```

- `test_parse_strike_volume_first_day_oi_change_zero` — drop `top_n=1`:

  ```python
  def test_parse_strike_volume_first_day_oi_change_zero():
      from services.finmind_options import parse_strike_volume
      rows = [_od_row("2026-06-23", "202607", "call", 22000, 18500, 35200)]
      out = parse_strike_volume(rows, "202607")
      assert out["call"][0]["oi_change"] == 0
  ```

- `test_parse_strike_volume_filters_by_contract_date` — drop `top_n=1`:

  ```python
  def test_parse_strike_volume_filters_by_contract_date():
      from services.finmind_options import parse_strike_volume
      rows = [
          _od_row("2026-06-23", "202607", "call", 22000, 99999, 35200),
          _od_row("2026-06-23", "202608", "call", 22000, 18500, 30000),
      ]
      out = parse_strike_volume(rows, "202607")
      assert out["call"][0]["volume"] == 99999
  ```

- `test_parse_strike_volume_filters_by_option_id` — drop `top_n=1`, `option_id="TXO"` arg stays:

  ```python
  def test_parse_strike_volume_filters_by_option_id():
      from services.finmind_options import parse_strike_volume
      rows = [
          _od_row("2026-06-23", "202607", "call", 22000, 99_999, 30000, option_id="TEO"),
          _od_row("2026-06-23", "202607", "call", 22000,    100, 35200, option_id="TXO"),
      ]
      out = parse_strike_volume(rows, "202607", option_id="TXO")
      assert out["call"][0]["volume"] == 100
  ```

- `test_parse_strike_volume_drops_zero_volume_rows` — drop `top_n=10`:

  ```python
  def test_parse_strike_volume_drops_zero_volume_rows():
      from services.finmind_options import parse_strike_volume
      rows = [
          _od_row("2026-06-23", "202607", "call", 22000,  10, 5),
          _od_row("2026-06-23", "202607", "call", 22100,   0, 7),
          _od_row("2026-06-23", "202607", "call", 22200,   0, 9),
      ]
      out = parse_strike_volume(rows, "202607")
      assert len(out["call"]) == 1
      assert out["call"][0]["strike"] == 22000
  ```

- `test_parse_strike_volume_empty_returns_empty_lists` — drop `top_n=10`:

  ```python
  def test_parse_strike_volume_empty_returns_empty_lists():
      from services.finmind_options import parse_strike_volume
      out = parse_strike_volume([], "202607")
      assert out == {"call": [], "put": [], "as_of_date": None}
  ```

- `test_parse_strike_volume_exposes_as_of_date` — drop `top_n=1`:

  ```python
  def test_parse_strike_volume_exposes_as_of_date():
      from services.finmind_options import parse_strike_volume
      rows = [_od_row("2026-06-19", "202607", "call", 22000, 18500, 35200)]
      out = parse_strike_volume(rows, "202607")
      assert out["as_of_date"] == "2026-06-19"
  ```

- `test_parse_strike_volume_empty_as_of_date_is_none` — drop `top_n=10`:

  ```python
  def test_parse_strike_volume_empty_as_of_date_is_none():
      from services.finmind_options import parse_strike_volume
      out = parse_strike_volume([], "202607")
      assert out["as_of_date"] is None
  ```

- [ ] **Step 3: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k parse_strike_volume
```

Expected: many failures (the new test + the updated ones — all because parser still requires `top_n`).

- [ ] **Step 4: Implement parser change**

Open `backend/services/finmind_options.py`. Replace the entire `parse_strike_volume` function with:

```python
def parse_strike_volume(
    rows: list[dict], contract_date: str,
    option_id: str = "TXO",
) -> dict:
    """Parse TaiwanOptionDaily rows into per-strike volume + OI change.

    Redesign 2026-06-24: returns ALL volume>0 strikes sorted by strike asc
    (no longer top-N by volume). Frontend's Strike Ladder is the consumer.

    Phase-0 rules unchanged:
    - Filter on option_id (default TXO) AND contract_date.
    - Sum volume across trading_session ∈ {position, after_market}; take MAX
      of OI across sessions.
    - Drop strikes with summed volume == 0 (typically illiquid OTM).
    - oi_change = today aggregated OI − prev-trading-day aggregated OI for
      that strike; 0 if no prev row exists.
    """
    matched = [
        r for r in rows
        if r.get("option_id") == option_id
        and r.get("contract_date") == contract_date
    ]
    if not matched:
        return {"call": [], "put": [], "as_of_date": None}

    agg: dict[tuple[str, str, float], dict] = {}
    for r in matched:
        cp = str(r.get("call_put", "")).lower()
        if cp not in ("call", "put"):
            continue
        try:
            strike = float(r["strike_price"])
        except (KeyError, TypeError, ValueError):
            continue
        key = (r["date"], cp, strike)
        vol = int(r.get("volume", 0) or 0)
        oi = int(r.get("open_interest", 0) or 0)
        bucket = agg.setdefault(key, {"volume": 0, "oi": 0})
        bucket["volume"] += vol
        if oi > bucket["oi"]:
            bucket["oi"] = oi

    if not agg:
        return {"call": [], "put": [], "as_of_date": None}

    dates = sorted({k[0] for k in agg})
    today = dates[-1]
    prev = dates[-2] if len(dates) >= 2 else None

    def side(cp_value: str) -> list[dict]:
        items = [(strike, v) for (d, cp, strike), v in agg.items()
                 if d == today and cp == cp_value and v["volume"] > 0]
        items.sort(key=lambda t: t[0])  # strike asc (redesign)
        out: list[dict] = []
        for strike, v in items:
            prev_v = agg.get((prev, cp_value, strike), {"oi": 0}) if prev else {"oi": 0}
            out.append({
                "strike": int(strike) if strike == int(strike) else strike,
                "volume": v["volume"],
                "oi": v["oi"],
                "oi_change": (v["oi"] - prev_v["oi"]) if prev else 0,
            })
        return out

    return {"call": side("call"), "put": side("put"), "as_of_date": today}
```

- [ ] **Step 5: Route — drop top_n declaration**

Open `backend/routes/options.py`. Find `get_strike_volume`:

```python
@router.get("/api/options/strike_volume")
async def get_strike_volume(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    top_n: int = Query(default=10),
    refresh: bool = Query(default=False),
) -> dict:
    if not contract:
        raise HTTPException(status_code=400, detail={"error": "contract_required"})
    if top_n < 1 or top_n > 20:
        raise HTTPException(status_code=400, detail={"error": "top_n_out_of_range"})
    c = _resolve_contract(contract)
    if c is None:
        raise HTTPException(status_code=400, detail={"error": "invalid_contract"})
    d = date or _today_str()
    try:
        out = await get_finmind().fetch_strike_volume(c, d, top_n, refresh)
    ...
```

Replace the signature + body up to the `try:` line with:

```python
@router.get("/api/options/strike_volume")
async def get_strike_volume(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    if not contract:
        raise HTTPException(status_code=400, detail={"error": "contract_required"})
    c = _resolve_contract(contract)
    if c is None:
        raise HTTPException(status_code=400, detail={"error": "invalid_contract"})
    d = date or _today_str()
    try:
        out = await get_finmind().fetch_strike_volume(c, d, refresh)
```

(Drops `top_n` query, drops the `top_n_out_of_range` check, and removes `top_n` arg from `fetch_strike_volume` call.)

- [ ] **Step 6: Update FinMindClient.fetch_strike_volume signature**

Open `backend/services/finmind.py`. Find `fetch_strike_volume` and `_do_fetch_strike_volume`. The current `fetch_strike_volume` takes `top_n: int = 10`. Replace both methods with:

```python
    async def fetch_strike_volume(
        self, contract: dict, date_str: str, refresh: bool = False,
    ) -> dict:
        from services.finmind_options import _CACHE_VERSION_OPTIONS
        contract_id = f"{contract['option_id']}{contract['contract_date']}"
        cache_key = f"{contract_id}_{date_str}_strike_vol"  # dropped _top{n} suffix
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached
        return await self._run_once(
            f"strike_vol_{cache_key}",
            lambda: self._do_fetch_strike_volume(contract, date_str, cache_key),
        )

    async def _do_fetch_strike_volume(
        self, contract: dict, date_str: str, cache_key: str,
    ) -> dict:
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS, parse_strike_volume,
        )
        end = date.fromisoformat(date_str)
        start = end - timedelta(days=7)
        raw = await self._get(
            f"{_FINMIND_BASE}/data",
            {"dataset": "TaiwanOptionDaily",
             "data_id": contract["option_id"],
             "start_date": start.isoformat(), "end_date": end.isoformat()},
        )
        parsed = parse_strike_volume(
            raw, contract["contract_date"],
            option_id=contract["option_id"],
        )
        result = {
            "contract": f"{contract['option_id']}{contract['contract_date']}",
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            **parsed,
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS)
        return result
```

- [ ] **Step 7: Update existing fetch_strike_volume tests**

Open `backend/tests/test_finmind_options.py`. Find `test_fetch_strike_volume_writes_cache_and_returns_shape` and update it to drop `top_n=2` from the call + update cache filename assertion + update the expected strike order assertion (now strike asc, not volume desc):

```python
@pytest.mark.asyncio
async def test_fetch_strike_volume_writes_cache_and_returns_shape():
    from services.finmind import FinMindClient
    today = "2026-06-23"
    rows = [
        _od_row("2026-06-20", "202607", "call", 22000, 14000, 33100),
        _od_row(today, "202607", "call", 22000, 18500, 35200),
        _od_row(today, "202607", "call", 22100, 12100, 30000),
        _od_row(today, "202607", "put",  21500, 14200, 28100),
    ]
    mc = _mock_http(_fm_resp(rows))
    fm = FinMindClient()
    fm._http = mc
    contract = {"option_id": "TXO", "contract_date": "202607", "contract_type": "202607"}
    out = await fm.fetch_strike_volume(contract, today)
    assert out["contract"] == "TXO202607"
    assert out["date"] == today
    # strike asc (no top_n)
    assert [c["strike"] for c in out["call"]] == [22000, 22100]
    assert out["call"][0]["oi_change"] == 35200 - 33100
    assert [p["strike"] for p in out["put"]] == [21500]
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / "TXO202607_2026-06-23_strike_vol.json").exists()
```

- [ ] **Step 8: Update route tests**

Open `backend/tests/test_options_routes.py`. Two changes:

(a) Delete `test_strike_vol_top_n_out_of_range_400` — the error code no longer exists. Replace with a "silently ignore" test:

```python
def test_strike_vol_silently_ignores_legacy_top_n_param(mock_fm):
    """Stale URL with ?top_n=N from v1 callers should not 400; param is just
    ignored (FastAPI default behavior for undeclared query params)."""
    code = _today_code_via_helper()
    resp = TestClient(app).get(
        f"/api/options/strike_volume?contract={code}&top_n=99",
    )
    assert resp.status_code == 200
```

(b) Update `test_strike_vol_happy_path`'s mock_fm fixture: the route now calls `fetch_strike_volume(c, d, refresh)` without `top_n`. The mock fixture in `mock_fm` doesn't need to change shape (it's an AsyncMock that accepts any args). No code edit needed for the mock itself. Just verify the test still passes after Step 9.

- [ ] **Step 9: Run all tests**

```bash
cd backend
python -m pytest -v
```

Expected: all PASSED. Test count: existing 91 - 1 (deleted top_n test) - 1 (renamed picks_top_n_per_side) + 1 (new sorted asc) + 1 (silently_ignores) = 91 again, or one off; the key signal is **zero failures**.

- [ ] **Step 10: Ruff + commit**

```bash
cd backend
ruff check . && ruff check --fix .
git add backend/services/finmind_options.py backend/services/finmind.py backend/routes/options.py backend/tests/test_finmind_options.py backend/tests/test_options_routes.py
git commit -m "feat(options): strike_volume returns all volume>0 strikes asc, drop top_n"
```

---

## Task 3: parse_spot + FinMindClient.fetch_spot + /api/options/spot route

**Files:**
- Modify: `backend/services/finmind_options.py` (append `parse_spot`)
- Modify: `backend/services/finmind.py` (append `fetch_spot`, `_do_fetch_spot`)
- Modify: `backend/routes/options.py` (append `get_spot`)
- Modify: `backend/tests/test_finmind_options.py` (append parse + fetch tests)
- Modify: `backend/tests/test_options_routes.py` (append spot route tests)

**Interfaces:**
- Consumes: Phase 0b-recorded data_id literal (default `TX`; override if Task 0 found different)
- Produces:
  - `parse_spot(rows: list[dict]) -> dict` returning `{spot: float|None, prev_close: float|None, change: float|None, change_pct: float|None, as_of_date: str|None}`
  - `FinMindClient.fetch_spot(self, date_str: str, refresh: bool = False) -> dict` returning `{date, fetched_at, as_of_date, spot, prev_close, change, change_pct}`
  - `GET /api/options/spot?date=&refresh=` returning the fetch_spot result + `no_trading_day: true` flag when as_of_date != requested

- [ ] **Step 1: Write parse_spot test**

Append to `backend/tests/test_finmind_options.py`:

```python
def _tx_row(date_, close, *, volume=10000):
    """TaiwanFuturesDaily TX row — Phase 0b confirmed field names."""
    return {"date": date_, "data_id": "TX",
            "open": close - 30, "max": close + 50, "min": close - 80,
            "close": close, "volume": volume, "settlement_price": close}


def test_parse_spot_picks_latest_close_and_computes_change():
    from services.finmind_options import parse_spot
    rows = [
        _tx_row("2026-06-19", 53300.0),
        _tx_row("2026-06-22", 53420.0),
    ]
    out = parse_spot(rows)
    assert out["spot"] == 53420.0
    assert out["prev_close"] == 53300.0
    assert out["change"] == pytest.approx(120.0)
    assert out["change_pct"] == pytest.approx(120.0 / 53300.0 * 100, rel=1e-4)
    assert out["as_of_date"] == "2026-06-22"


def test_parse_spot_single_row_change_is_zero():
    from services.finmind_options import parse_spot
    out = parse_spot([_tx_row("2026-06-22", 53420.0)])
    assert out["spot"] == 53420.0
    assert out["prev_close"] is None
    assert out["change"] == 0.0
    assert out["change_pct"] == 0.0
    assert out["as_of_date"] == "2026-06-22"


def test_parse_spot_empty_returns_none_fields():
    from services.finmind_options import parse_spot
    out = parse_spot([])
    assert out == {
        "spot": None, "prev_close": None,
        "change": None, "change_pct": None,
        "as_of_date": None,
    }
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k parse_spot
```

Expected: 3 failures with `ImportError: cannot import name 'parse_spot'`.

- [ ] **Step 3: Implement parse_spot**

Append to `backend/services/finmind_options.py`:

```python
def parse_spot(rows: list[dict]) -> dict:
    """Parse TaiwanFuturesDaily rows into spot price + day-over-day change.

    Takes the latest available date in the response as `spot`, the
    second-latest as `prev_close`. Returns None-fields when input is empty.
    """
    if not rows:
        return {
            "spot": None, "prev_close": None,
            "change": None, "change_pct": None,
            "as_of_date": None,
        }

    sorted_rows = sorted(rows, key=lambda r: r.get("date", ""))
    today = sorted_rows[-1]
    prev = sorted_rows[-2] if len(sorted_rows) >= 2 else None

    try:
        spot = float(today.get("close", 0))
    except (TypeError, ValueError):
        spot = 0.0
    prev_close = None
    if prev is not None:
        try:
            prev_close = float(prev.get("close", 0))
        except (TypeError, ValueError):
            prev_close = None

    change = (spot - prev_close) if prev_close is not None else 0.0
    change_pct = (change / prev_close * 100) if prev_close else 0.0

    return {
        "spot": spot,
        "prev_close": prev_close,
        "change": change,
        "change_pct": change_pct,
        "as_of_date": today.get("date"),
    }
```

- [ ] **Step 4: Verify pass**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k parse_spot
```

Expected: 3 PASSED.

- [ ] **Step 5: Write FinMindClient.fetch_spot test**

Append to `backend/tests/test_finmind_options.py`:

```python
_SPOT_DATA_ID = "TX"  # Phase 0b confirmed — change if probe found different


@pytest.mark.asyncio
async def test_fetch_spot_writes_cache_and_returns_shape():
    from services.finmind import FinMindClient
    rows = [
        _tx_row("2026-06-19", 53300.0),
        _tx_row("2026-06-22", 53420.0),
    ]
    mc = _mock_http(_fm_resp(rows))
    fm = FinMindClient()
    fm._http = mc
    out = await fm.fetch_spot("2026-06-22")
    assert out["date"] == "2026-06-22"
    assert out["spot"] == 53420.0
    assert out["prev_close"] == 53300.0
    assert out["change"] == pytest.approx(120.0)
    assert out["as_of_date"] == "2026-06-22"
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / f"{_SPOT_DATA_ID}_2026-06-22_spot.json").exists()


@pytest.mark.asyncio
async def test_fetch_spot_returns_cached_on_second_call():
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_resp([_tx_row("2025-01-02", 50000.0)]))
    fm = FinMindClient()
    fm._http = mc
    first = await fm.fetch_spot("2025-01-02")
    second = await fm.fetch_spot("2025-01-02")
    assert first == second
    assert mc.get.await_count == 1  # cache hit, no second HTTP call
```

- [ ] **Step 6: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k fetch_spot
```

Expected: 2 failures with `AttributeError: 'FinMindClient' object has no attribute 'fetch_spot'`.

- [ ] **Step 7: Implement FinMindClient.fetch_spot**

Open `backend/services/finmind.py`. Find the `_do_fetch_strike_volume` method (the last options-related method before the helper class methods). Append AFTER `_do_fetch_strike_volume` and BEFORE `_read_cache_v`:

```python
    # -- options: 台指期 spot price ----------------------------------------

    async def fetch_spot(self, date_str: str, refresh: bool = False) -> dict:
        from services.finmind_options import _CACHE_VERSION_OPTIONS
        data_id = "TX"  # Phase 0b: change to TXFCONT/TXF if probe found different
        cache_key = f"{data_id}_{date_str}_spot"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached
        return await self._run_once(
            f"spot_{cache_key}",
            lambda: self._do_fetch_spot(date_str, data_id, cache_key),
        )

    async def _do_fetch_spot(
        self, date_str: str, data_id: str, cache_key: str,
    ) -> dict:
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS, parse_spot,
        )
        end = date.fromisoformat(date_str)
        start = end - timedelta(days=7)
        raw = await self._get(
            f"{_FINMIND_BASE}/data",
            {"dataset": "TaiwanFuturesDaily",
             "data_id": data_id,
             "start_date": start.isoformat(), "end_date": end.isoformat()},
        )
        parsed = parse_spot(raw)
        result = {
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            **parsed,
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS)
        return result
```

If Phase 0b chose `TXFCONT` or `TXF` instead of `TX`, edit the `data_id = "TX"` line accordingly AND update `_SPOT_DATA_ID` in the test file.

- [ ] **Step 8: Verify fetch_spot tests pass**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k fetch_spot
```

Expected: 2 PASSED.

- [ ] **Step 9: Write spot route tests**

Append to `backend/tests/test_options_routes.py` (after the existing tests):

```python
@pytest.fixture
def mock_fm_with_spot():
    """Mocks default to as_of_date == today (no banner)."""
    today = date.today().isoformat()
    svc = AsyncMock()
    svc.fetch_spot = AsyncMock(return_value={
        "date": today, "fetched_at": "x", "as_of_date": today,
        "spot": 53420.0, "prev_close": 53300.0,
        "change": 120.0, "change_pct": 0.2251,
    })
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def test_spot_happy_path(mock_fm_with_spot):
    resp = TestClient(app).get("/api/options/spot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["spot"] == 53420.0
    assert body["change"] == 120.0
    assert body.get("no_trading_day") is None
    mock_fm_with_spot.fetch_spot.assert_awaited_once()


def test_spot_no_trading_day_when_as_of_differs(mock_fm_with_spot):
    """Saturday request; FinMind returns Friday data."""
    saturday = "2026-06-20"
    friday = "2026-06-19"
    mock_fm_with_spot.fetch_spot.return_value = {
        "date": saturday, "fetched_at": "x", "as_of_date": friday,
        "spot": 53300.0, "prev_close": 53180.0,
        "change": 120.0, "change_pct": 0.2257,
    }
    resp = TestClient(app).get(f"/api/options/spot?date={saturday}")
    assert resp.status_code == 200
    assert resp.json().get("no_trading_day") is True


def test_spot_finmind_error_502(mock_fm_with_spot):
    import httpx
    mock_fm_with_spot.fetch_spot.side_effect = httpx.ConnectError("boom")
    resp = TestClient(app).get("/api/options/spot")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_error"
```

- [ ] **Step 10: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_options_routes.py -v -k spot
```

Expected: 3 failures (404 because the route doesn't exist yet, OR `AttributeError: 'AsyncMock' object has no attribute 'fetch_spot'` — but our mock has it, so failures will be on the route side).

- [ ] **Step 11: Add spot route**

Open `backend/routes/options.py`. After the existing `get_strike_volume` function (at the end of the file), append:

```python
@router.get("/api/options/spot")
async def get_spot(
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today_str()
    try:
        out = await get_finmind().fetch_spot(d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind spot error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected spot error")
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out
```

- [ ] **Step 12: Verify all backend tests**

```bash
cd backend
python -m pytest -v
ruff check .
```

Expected: all PASSED, ruff 0 issues.

- [ ] **Step 13: Commit**

```bash
git add backend/services/finmind_options.py backend/services/finmind.py backend/routes/options.py backend/tests/test_finmind_options.py backend/tests/test_options_routes.py
git commit -m "feat(options): /api/options/spot + parse_spot + FinMindClient.fetch_spot"
```

---

## Task 4: Frontend types + api.spot + drop topN

**Files:**
- Modify: `frontend/src/lib/options-types.ts`
- Modify: `frontend/src/lib/options-api.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `OptionsLargeTraders.series[i]` gains `top5_all_net` + `top5_prop_net` (existing fields kept)
  - `OptionsSpot` interface
  - `optionsApi.strikeVolume(contract, date?, refresh?)` — `topN` arg REMOVED
  - `optionsApi.spot(date?, refresh?)` — NEW

- [ ] **Step 1: Update options-types.ts**

Open `frontend/src/lib/options-types.ts`. Replace the file content with:

```ts
export interface OILTGroup { long: number; short: number; net: number }

export interface OptionsLargeTraders {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  current: {
    top5_prop:  OILTGroup;
    top10_prop: OILTGroup;
    top5_all:   OILTGroup;
    top10_all:  OILTGroup;
  };
  series: Array<{
    date: string;
    top5_all_net:   number;
    top10_all_net:  number;
    top5_prop_net:  number;
    top10_prop_net: number;
  }>;
  no_trading_day?: boolean;
}

export interface StrikeRow {
  strike: number;
  volume: number;
  oi: number;
  oi_change: number;
}

export interface OptionsStrikeVolume {
  contract: string;
  date: string;
  fetched_at: string;
  as_of_date?: string | null;
  call: StrikeRow[];
  put:  StrikeRow[];
  no_trading_day?: boolean;
}

export interface OptionsSpot {
  date: string;
  fetched_at: string;
  as_of_date: string | null;
  spot: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  no_trading_day?: boolean;
}
```

- [ ] **Step 2: Update options-api.ts**

Open `frontend/src/lib/options-api.ts`. Replace the file content with:

```ts
import { __apiGet } from "./api";
import type {
  OptionsLargeTraders, OptionsStrikeVolume, OptionsSpot,
} from "./options-types";

const BASE = "/api/options";

export const optionsApi = {
  largeTraders(
    contract: string,
    date?: string,
    refresh?: boolean,
  ): Promise<OptionsLargeTraders> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/oi_large_traders`, params);
  },

  strikeVolume(
    contract: string,
    date?: string,
    refresh?: boolean,
  ): Promise<OptionsStrikeVolume> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/strike_volume`, params);
  },

  spot(date?: string, refresh?: boolean): Promise<OptionsSpot> {
    const params: Record<string, string> = {};
    if (date) params.date = date;
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/spot`, params);
  },
};
```

- [ ] **Step 3: TSC + commit**

```bash
cd frontend
npx tsc -b
```

Expected: tsc reports errors at `useOptionsStrikeVolume.ts` (still passes topN) — that's the next task. For now ignore that specific file's complaint and verify NO error in options-types.ts / options-api.ts themselves.

```bash
git add frontend/src/lib/options-types.ts frontend/src/lib/options-api.ts
git commit -m "feat(options): extend types + add optionsApi.spot, drop strikeVolume topN"
```

(Commit even with tsc complaints — Task 5 fixes them and re-runs the full check.)

---

## Task 5: useOptionsStrikeVolume — drop topN

**Files:**
- Modify: `frontend/src/hooks/useOptionsStrikeVolume.ts`
- Modify: `frontend/src/hooks/useOptionsStrikeVolume.test.ts`

**Interfaces:**
- Consumes: `optionsApi.strikeVolume(contract, date, refresh)` (no topN)
- Produces: `useOptionsStrikeVolume(contract: string, date: string) -> { data, loading, error, refresh, noTradingDay }`

- [ ] **Step 1: Update hook signature**

Open `frontend/src/hooks/useOptionsStrikeVolume.ts`. Replace its content with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { optionsApi } from "../lib/options-api";
import type { OptionsStrikeVolume } from "../lib/options-types";

export function useOptionsStrikeVolume(contract: string, date: string) {
  const [data, setData] = useState<OptionsStrikeVolume | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    async (refresh?: boolean) => {
      if (!contract) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const d = await optionsApi.strikeVolume(contract, date, refresh);
        if (seq !== seqRef.current) return;
        setData(d);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入熱門履約價失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [contract, date],
  );

  useEffect(() => { load(); }, [load]);

  return {
    data,
    loading,
    error,
    refresh: () => load(true),
    noTradingDay: data?.no_trading_day === true,
  };
}
```

- [ ] **Step 2: Update existing tests**

Open `frontend/src/hooks/useOptionsStrikeVolume.test.ts`. Replace the entire file with:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsStrikeVolume } from "./useOptionsStrikeVolume";

const mockData = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [], put: [],
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useOptionsStrikeVolume", () => {
  it("fires the api on mount without topN", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    const { result } = renderHook(() =>
      useOptionsStrikeVolume("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith("TXO202607", "2026-06-23", undefined);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "strikeVolume").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useOptionsStrikeVolume("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("refresh action calls api with refresh=true", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    const { result } = renderHook(() =>
      useOptionsStrikeVolume("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    result.current.refresh();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[2]).toBe(true));
  });
});
```

- [ ] **Step 3: Run tests + tsc**

```bash
cd frontend
npx vitest run src/hooks/useOptionsStrikeVolume.test.ts
npx tsc -b
```

Expected: vitest 3 PASSED, tsc 0 errors in this file.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useOptionsStrikeVolume.ts frontend/src/hooks/useOptionsStrikeVolume.test.ts
git commit -m "refactor(options): useOptionsStrikeVolume drops topN argument"
```

---

## Task 6: useOptionsSpot hook

**Files:**
- Create: `frontend/src/hooks/useOptionsSpot.ts`
- Create: `frontend/src/hooks/useOptionsSpot.test.ts`

**Interfaces:**
- Consumes: `optionsApi.spot`, `OptionsSpot` type
- Produces: `useOptionsSpot(date: string) -> { data, loading, error, refresh, noTradingDay }`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/useOptionsSpot.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsSpot } from "./useOptionsSpot";

const mockSpot = {
  date: "2026-06-23", fetched_at: "x", as_of_date: "2026-06-23",
  spot: 53420, prev_close: 53300, change: 120, change_pct: 0.225,
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("useOptionsSpot", () => {
  it("fires api on mount and exposes data", async () => {
    const spy = vi.spyOn(optionsApi, "spot").mockResolvedValue(mockSpot);
    const { result } = renderHook(() => useOptionsSpot("2026-06-23"));
    await waitFor(() => expect(result.current.data).toEqual(mockSpot));
    expect(spy).toHaveBeenCalledWith("2026-06-23", undefined);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "spot").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useOptionsSpot("2026-06-23"));
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("exposes noTradingDay flag", async () => {
    vi.spyOn(optionsApi, "spot").mockResolvedValue({ ...mockSpot, no_trading_day: true });
    const { result } = renderHook(() => useOptionsSpot("2026-06-20"));
    await waitFor(() => expect(result.current.noTradingDay).toBe(true));
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/hooks/useOptionsSpot.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/hooks/useOptionsSpot.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { optionsApi } from "../lib/options-api";
import type { OptionsSpot } from "../lib/options-types";

export function useOptionsSpot(date: string) {
  const [data, setData] = useState<OptionsSpot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(
    async (refresh?: boolean) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const d = await optionsApi.spot(date, refresh);
        if (seq !== seqRef.current) return;
        setData(d);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入現價失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => { load(); }, [load]);

  return {
    data,
    loading,
    error,
    refresh: () => load(true),
    noTradingDay: data?.no_trading_day === true,
  };
}
```

- [ ] **Step 4: Verify pass + tsc**

```bash
cd frontend
npx vitest run src/hooks/useOptionsSpot.test.ts
npx tsc -b
```

Expected: 3 PASSED, tsc 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useOptionsSpot.ts frontend/src/hooks/useOptionsSpot.test.ts
git commit -m "feat(options): useOptionsSpot hook"
```

---

## Task 7: options-svg.tsx — MiniBar, Sparkline, StrikeLadder

**Files:**
- Create: `frontend/src/lib/options-svg.tsx`
- Create: `frontend/src/lib/options-svg.test.tsx`
- Delete: `frontend/src/lib/options-chart-svg.tsx`
- Delete: `frontend/src/lib/options-chart-svg.test.tsx`

**Interfaces:**
- Consumes: `OptionsLargeTraders`, `OptionsStrikeVolume`, `StrikeRow` types
- Produces:
  - `<MiniBar value={number} maxAbs={number} width={number} height={number} />` — horizontal bar of width `|value|/maxAbs * width`, color red for positive value green for negative
  - `<Sparkline series={number[]} width={number} height={number} />` — line + filled area + last-point dot, color from last value sign
  - `<StrikeLadder data={OptionsStrikeVolume} spot={number|null} maxBarPct={number} />` — full ladder with optional spot anchor row

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/options-svg.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MiniBar, Sparkline, StrikeLadder } from "./options-svg";
import type { OptionsStrikeVolume } from "./options-types";

afterEach(() => cleanup());

describe("MiniBar", () => {
  it("positive value renders red bar of correct width", () => {
    const { container } = render(<MiniBar value={50} maxAbs={100} width={200} height={6} />);
    const rect = container.querySelector("[data-testid='minibar-fill']") as SVGRectElement;
    expect(rect).toBeTruthy();
    expect(rect.getAttribute("width")).toBe("100");  // 50/100 * 200
    expect(rect.getAttribute("data-sign")).toBe("pos");
  });

  it("negative value renders green bar", () => {
    const { container } = render(<MiniBar value={-30} maxAbs={100} width={200} height={6} />);
    const rect = container.querySelector("[data-testid='minibar-fill']") as SVGRectElement;
    expect(rect.getAttribute("data-sign")).toBe("neg");
    expect(rect.getAttribute("width")).toBe("60");
  });

  it("zero value renders empty bar", () => {
    const { container } = render(<MiniBar value={0} maxAbs={100} width={200} height={6} />);
    const rect = container.querySelector("[data-testid='minibar-fill']");
    expect(rect?.getAttribute("width")).toBe("0");
  });
});

describe("Sparkline", () => {
  it("renders one polyline + one polygon (area) + one circle (last dot)", () => {
    const { container } = render(<Sparkline series={[1, 3, 2, 4, 3, 5]} width={90} height={30} />);
    expect(container.querySelectorAll("polyline").length).toBe(1);
    expect(container.querySelectorAll("polygon").length).toBe(1);
    expect(container.querySelectorAll("circle").length).toBe(1);
  });

  it("empty series renders an svg with no polyline", () => {
    const { container } = render(<Sparkline series={[]} width={90} height={30} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll("polyline").length).toBe(0);
  });
});

describe("StrikeLadder", () => {
  const data: OptionsStrikeVolume = {
    contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
    call: [
      { strike: 53000, volume: 520, oi: 4100, oi_change:  310 },
      { strike: 53500, volume: 1200, oi: 8410, oi_change: 680 },
      { strike: 54000, volume:  980, oi: 7820, oi_change: 320 },
    ],
    put: [
      { strike: 53000, volume:   96, oi: 2410, oi_change:  -22 },
      { strike: 52500, volume:  145, oi: 3520, oi_change:  -88 },
    ],
  };

  it("renders rows for the union of call/put strikes, sorted high→low", () => {
    const { container } = render(<StrikeLadder data={data} spot={53420} />);
    const rows = container.querySelectorAll("[data-testid='ladder-row']");
    expect(rows.length).toBe(5);  // 54000, 53500, 53000, 52500 + 1 spot row
    const strikeLabels = Array.from(rows).map(r =>
      r.querySelector("[data-testid='ladder-strike']")?.textContent
    );
    // first row should be the highest strike (54,000)
    expect(strikeLabels[0]).toBe("54,000");
  });

  it("inserts a spot anchor row when spot is between strikes", () => {
    const { container } = render(<StrikeLadder data={data} spot={53420} />);
    const spotRow = container.querySelector("[data-testid='ladder-spot']");
    expect(spotRow).toBeTruthy();
    expect(spotRow?.textContent).toContain("53,420");
  });

  it("omits spot row when spot is null", () => {
    const { container } = render(<StrikeLadder data={data} spot={null} />);
    expect(container.querySelector("[data-testid='ladder-spot']")).toBeNull();
  });

  it("renders empty state when both sides are empty", () => {
    const empty: OptionsStrikeVolume = { ...data, call: [], put: [] };
    const { container } = render(<StrikeLadder data={empty} spot={53420} />);
    expect(container.querySelector("[data-testid='ladder-empty']")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/lib/options-svg.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement options-svg.tsx**

Create `frontend/src/lib/options-svg.tsx`:

```tsx
import type { ReactElement } from "react";
import type { OptionsStrikeVolume } from "./options-types";

// ---------------------------------------------------------------------------
// MiniBar — horizontal pos/neg progress bar
// ---------------------------------------------------------------------------

interface MiniBarProps {
  value: number;
  maxAbs: number;
  width: number;
  height: number;
}

export function MiniBar({ value, maxAbs, width, height }: MiniBarProps): ReactElement {
  const ratio = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  const w = ratio * width;
  const sign = value >= 0 ? "pos" : "neg";
  const fill = value >= 0
    ? "var(--color-up, #dc2626)"
    : "var(--color-down, #16a34a)";
  return (
    <svg width={width} height={height} role="img" aria-hidden="true">
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        className="fill-[var(--color-line,#262626)] opacity-50"
      />
      <rect
        data-testid="minibar-fill"
        data-sign={sign}
        x={0}
        y={0}
        width={w}
        height={height}
        fill={fill}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — small filled line chart with last-point dot
// ---------------------------------------------------------------------------

interface SparklineProps {
  series: number[];
  width: number;
  height: number;
}

export function Sparkline({ series, width, height }: SparklineProps): ReactElement {
  if (series.length === 0) {
    return <svg width={width} height={height} role="img" aria-hidden="true" />;
  }
  const lo = Math.min(0, ...series);
  const hi = Math.max(0, ...series);
  const span = hi - lo || 1;
  const x = (i: number) =>
    1 + (series.length === 1 ? width / 2 : (i / (series.length - 1)) * (width - 2));
  const y = (v: number) => 1 + (height - 2) - ((v - lo) / span) * (height - 2);

  const points = series.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = series[series.length - 1];
  const sign = last >= 0 ? "pos" : "neg";
  const color = last >= 0
    ? "var(--color-up, #dc2626)"
    : "var(--color-down, #16a34a)";
  const areaPoints = `${x(0)},${y(0)} ${points} ${x(series.length - 1)},${y(0)}`;

  return (
    <svg width={width} height={height} role="img" aria-label="20D 趨勢"
         data-sign={sign}>
      <line x1={0} x2={width} y1={y(0)} y2={y(0)}
            stroke="currentColor" strokeOpacity="0.2"
            strokeDasharray="2 2" />
      <polygon points={areaPoints} fill={color} fillOpacity="0.15" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.25} />
      <circle cx={x(series.length - 1)} cy={y(last)} r={2} fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StrikeLadder — vertical strike axis high→low; Call bars right-anchored on
// the left half, Put bars left-anchored on the right half; optional spot
// anchor row inserted between the two strikes that straddle `spot`.
// ---------------------------------------------------------------------------

interface StrikeLadderProps {
  data: OptionsStrikeVolume;
  spot: number | null;
}

function fmtSigned(n: number): string {
  if (!n) return "0";
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${a.toLocaleString()}`;
  return n > 0 ? `+${s}` : `−${s}`;
}

export function StrikeLadder({ data, spot }: StrikeLadderProps): ReactElement {
  // Build a union of strikes from both call and put, then sort high→low.
  const allStrikes = new Set<number>([
    ...data.call.map((r) => r.strike),
    ...data.put.map((r) => r.strike),
  ]);
  const strikesDesc = Array.from(allStrikes).sort((a, b) => b - a);

  if (strikesDesc.length === 0) {
    return (
      <div
        data-testid="ladder-empty"
        className="h-full flex items-center justify-center text-ink-dim text-sm"
      >
        無成交量資料
      </div>
    );
  }

  const callByStrike = new Map(data.call.map((r) => [r.strike, r]));
  const putByStrike  = new Map(data.put.map((r) => [r.strike, r]));

  const maxVol = Math.max(
    1,
    ...data.call.map((r) => r.volume),
    ...data.put.map((r) => r.volume),
  );

  // Compute spot insertion point: insert anchor row when cursor strike drops
  // below `spot` (since we iterate desc).
  const rows: Array<{ kind: "strike"; strike: number } | { kind: "spot" }> = [];
  let spotInserted = false;
  for (const k of strikesDesc) {
    if (
      !spotInserted && spot != null && k < spot &&
      // ensure spot is actually within the strike range (above lowest strike)
      spot < strikesDesc[0] + 1
    ) {
      rows.push({ kind: "spot" });
      spotInserted = true;
    }
    rows.push({ kind: "strike", strike: k });
  }
  // Edge case: spot above the highest strike → insert at very top
  if (!spotInserted && spot != null && spot >= strikesDesc[0]) {
    rows.unshift({ kind: "spot" });
  }

  return (
    <div className="h-full overflow-y-auto font-variant-numeric tabular-nums">
      <table className="w-full">
        <colgroup>
          <col style={{ width: "calc(50% - 60px)" }} />
          <col style={{ width: "120px" }} />
          <col style={{ width: "calc(50% - 60px)" }} />
        </colgroup>
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="text-[10px] text-ink-dim uppercase tracking-wide border-b border-line">
            <th className="px-3 py-1 text-right">Call vol / OI±</th>
            <th className="px-3 py-1 text-center">Strike</th>
            <th className="px-3 py-1 text-left">vol / OI± Put</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === "spot") {
              return (
                <tr
                  key="spot-row"
                  data-testid="ladder-spot"
                  className="border-y border-accent bg-accent/[0.04]"
                  style={{ height: "26px" }}
                >
                  <td />
                  <td className="text-center text-accent font-semibold">
                    {(spot as number).toLocaleString()} ← 現價
                  </td>
                  <td />
                </tr>
              );
            }
            const c = callByStrike.get(row.strike);
            const p = putByStrike.get(row.strike);
            const cw = c ? (c.volume / maxVol) * 100 : 0;
            const pw = p ? (p.volume / maxVol) * 100 : 0;
            return (
              <tr
                key={`s-${row.strike}`}
                data-testid="ladder-row"
                className="border-b border-line/40"
                style={{ height: "22px" }}
              >
                <td className="relative pr-3 text-right">
                  {c ? (
                    <>
                      <span
                        className="absolute inset-y-1 right-0 bg-[var(--color-up,#dc2626)] opacity-60"
                        style={{ width: `${cw}%` }}
                      />
                      <span className="relative text-[11px] text-ink z-10">
                        {c.volume.toLocaleString()}
                        <span
                          className={`ml-1 text-[10px] px-1 rounded ${
                            c.oi_change >= 0
                              ? "bg-[var(--color-up,#dc2626)]/25 text-red-300"
                              : "bg-[var(--color-down,#16a34a)]/25 text-green-300"
                          }`}
                        >
                          {fmtSigned(c.oi_change)}
                        </span>
                      </span>
                    </>
                  ) : null}
                </td>
                <td
                  data-testid="ladder-strike"
                  className="text-center text-[13px] text-ink"
                >
                  {row.strike.toLocaleString()}
                </td>
                <td className="relative pl-3 text-left">
                  {p ? (
                    <>
                      <span
                        className="absolute inset-y-1 left-0 bg-[var(--color-down,#16a34a)] opacity-60"
                        style={{ width: `${pw}%` }}
                      />
                      <span className="relative text-[11px] text-ink z-10">
                        {p.volume.toLocaleString()}
                        <span
                          className={`ml-1 text-[10px] px-1 rounded ${
                            p.oi_change >= 0
                              ? "bg-[var(--color-up,#dc2626)]/25 text-red-300"
                              : "bg-[var(--color-down,#16a34a)]/25 text-green-300"
                          }`}
                        >
                          {fmtSigned(p.oi_change)}
                        </span>
                      </span>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Delete old files**

```bash
cd C:/side-project/trash-cmoney
rm frontend/src/lib/options-chart-svg.tsx
rm frontend/src/lib/options-chart-svg.test.tsx
```

- [ ] **Step 5: Verify pass + tsc**

```bash
cd frontend
npx vitest run src/lib/options-svg.test.tsx
npx tsc -b
```

Expected: vitest 8 PASSED, tsc may report errors in `OptionsLargeTradersPanel.tsx` because it still imports the deleted `LargeTradersBars` / `LargeTradersTrend` — those will be cleaned up in Task 11.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/options-svg.tsx frontend/src/lib/options-svg.test.tsx
git rm frontend/src/lib/options-chart-svg.tsx frontend/src/lib/options-chart-svg.test.tsx
git commit -m "feat(options): options-svg primitives — MiniBar + Sparkline + StrikeLadder"
```

---

## Task 8: OptionsLargeTradersStrip component

**Files:**
- Create: `frontend/src/components/OptionsLargeTradersStrip.tsx`
- Create: `frontend/src/components/OptionsLargeTradersStrip.test.tsx`

**Interfaces:**
- Consumes: `OptionsLargeTraders` type, `MiniBar`, `Sparkline`
- Produces: `<OptionsLargeTradersStrip data={…|null} loading={boolean} error={string|null} weeklyAggregateBanner={boolean} />` — 4-card horizontal strip

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/OptionsLargeTradersStrip.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsLargeTradersStrip } from "./OptionsLargeTradersStrip";
import type { OptionsLargeTraders } from "../lib/options-types";

afterEach(() => cleanup());

const mk = (): OptionsLargeTraders => ({
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  current: {
    top5_prop:  { long: 100, short: 50,  net:  50 },
    top10_prop: { long: 200, short: 100, net: 100 },
    top5_all:   { long: 300, short: 200, net: 100 },
    top10_all:  { long: 400, short: 300, net: 100 },
  },
  series: [
    { date: "2026-06-20", top5_all_net: 80, top10_all_net: 90, top5_prop_net: 60, top10_prop_net: 70 },
    { date: "2026-06-23", top5_all_net: 100, top10_all_net: 100, top5_prop_net: 50, top10_prop_net: 100 },
  ],
});

describe("OptionsLargeTradersStrip", () => {
  it("renders 4 cards with NET numbers", () => {
    render(<OptionsLargeTradersStrip data={mk()} loading={false} error={null} />);
    const cards = screen.getAllByTestId("strip-card");
    expect(cards.length).toBe(4);
  });

  it("each card contains a sparkline svg", () => {
    const { container } = render(
      <OptionsLargeTradersStrip data={mk()} loading={false} error={null} />,
    );
    const sparks = container.querySelectorAll("[data-testid='strip-spark']");
    expect(sparks.length).toBe(4);
  });

  it("shows weekly aggregate banner when prop=true", () => {
    render(
      <OptionsLargeTradersStrip data={mk()} loading={false} error={null}
        weeklyAggregateBanner />,
    );
    expect(screen.getByTestId("strip-weekly-banner")).toBeTruthy();
  });

  it("hides weekly banner when prop omitted", () => {
    render(<OptionsLargeTradersStrip data={mk()} loading={false} error={null} />);
    expect(screen.queryByTestId("strip-weekly-banner")).toBeNull();
  });

  it("shows error banner when error present", () => {
    render(<OptionsLargeTradersStrip data={null} loading={false} error="boom" />);
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("shows skeleton when loading and no data", () => {
    render(<OptionsLargeTradersStrip data={null} loading error={null} />);
    expect(screen.getByTestId("strip-skeleton")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/components/OptionsLargeTradersStrip.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/OptionsLargeTradersStrip.tsx`:

```tsx
import type { ReactElement } from "react";
import { MiniBar, Sparkline } from "../lib/options-svg";
import type { OptionsLargeTraders } from "../lib/options-types";

interface Props {
  data: OptionsLargeTraders | null;
  loading: boolean;
  error: string | null;
  weeklyAggregateBanner?: boolean;
}

type GroupKey = "top5_prop" | "top10_prop" | "top5_all" | "top10_all";
type SeriesKey = "top5_prop_net" | "top10_prop_net" | "top5_all_net" | "top10_all_net";

const GROUPS: Array<{ groupKey: GroupKey; seriesKey: SeriesKey; label: string }> = [
  { groupKey: "top5_prop",  seriesKey: "top5_prop_net",  label: "前 5 特定法人 NET"  },
  { groupKey: "top10_prop", seriesKey: "top10_prop_net", label: "前 10 特定法人 NET" },
  { groupKey: "top5_all",   seriesKey: "top5_all_net",   label: "前 5 全交易人 NET"  },
  { groupKey: "top10_all",  seriesKey: "top10_all_net",  label: "前 10 全交易人 NET" },
];

function fmtSigned(n: number): string {
  if (!n) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : `−${Math.abs(n).toLocaleString()}`;
}

export function OptionsLargeTradersStrip({
  data, loading, error, weeklyAggregateBanner,
}: Props): ReactElement {
  if (error) {
    return (
      <section className="shrink-0 px-6 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
        {error}
      </section>
    );
  }
  if (loading && !data) {
    return (
      <section
        data-testid="strip-skeleton"
        className="shrink-0 px-4 py-3 grid grid-cols-4 gap-4 border-b border-line"
      >
        {GROUPS.map((g) => (
          <div key={g.groupKey} className="flex flex-col gap-1">
            <div className="h-2 w-32 bg-line animate-pulse" />
            <div className="h-4 w-20 bg-line animate-pulse" />
            <div className="h-1 w-full bg-line/50" />
          </div>
        ))}
      </section>
    );
  }
  if (!data) {
    return <section className="shrink-0 h-[68px] border-b border-line" />;
  }

  const maxAbs = Math.max(
    1,
    ...GROUPS.map((g) => Math.abs(data.current[g.groupKey].net)),
  );

  return (
    <>
      {weeklyAggregateBanner && (
        <div
          data-testid="strip-weekly-banner"
          className="shrink-0 px-6 py-1 text-xs text-ink-dim bg-ink/[0.03] border-b border-line"
        >
          📌 大戶 OI 為近週週選 aggregate(FinMind <code>contract_type=&apos;week&apos;</code>),W1..W4 顯示同一份資料。熱門履約價依各週合約獨立。
        </div>
      )}
      <section className="shrink-0 px-4 py-2.5 grid grid-cols-4 gap-4 border-b border-line bg-bg">
        {GROUPS.map((g) => {
          const cur = data.current[g.groupKey];
          const series = data.series.map((s) => s[g.seriesKey]);
          const startVal = series[0] ?? 0;
          const endVal = series[series.length - 1] ?? cur.net;
          const trend20 = endVal - startVal;
          return (
            <div
              key={g.groupKey}
              data-testid="strip-card"
              className="grid grid-cols-[1fr_90px] gap-3 items-center"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[10px] text-ink-dim uppercase tracking-wide truncate">
                  {g.label}
                </span>
                <span
                  className={`text-[16px] font-semibold leading-none ${
                    cur.net >= 0 ? "text-[var(--color-up,#dc2626)]" : "text-[var(--color-down,#16a34a)]"
                  }`}
                >
                  {fmtSigned(cur.net)}
                </span>
                <div className="mt-1">
                  <MiniBar value={cur.net} maxAbs={maxAbs} width={140} height={3} />
                </div>
              </div>
              <div className="flex flex-col gap-px border-l border-line pl-3"
                   data-testid="strip-spark">
                <span className="text-[9px] text-ink-dim uppercase tracking-wide leading-none">
                  20D · {fmtSigned(trend20)}
                </span>
                <Sparkline series={series} width={90} height={30} />
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
```

- [ ] **Step 4: Verify pass + tsc**

```bash
cd frontend
npx vitest run src/components/OptionsLargeTradersStrip.test.tsx
npx tsc -b
```

Expected: 6 PASSED. tsc may still complain about old panel files (cleaned up in Task 11).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/OptionsLargeTradersStrip.tsx frontend/src/components/OptionsLargeTradersStrip.test.tsx
git commit -m "feat(options): OptionsLargeTradersStrip (4 cards × sparkline)"
```

---

## Task 9: OptionsStrikeLadder component

**Files:**
- Create: `frontend/src/components/OptionsStrikeLadder.tsx`
- Create: `frontend/src/components/OptionsStrikeLadder.test.tsx`

**Interfaces:**
- Consumes: `OptionsStrikeVolume`, `OptionsSpot` types, `StrikeLadder` SVG component from `options-svg.tsx`
- Produces: `<OptionsStrikeLadder data={…|null} spot={…|null} loading={boolean} error={string|null} />` — full-height panel hosting the ladder

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/OptionsStrikeLadder.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OptionsStrikeLadder } from "./OptionsStrikeLadder";
import type { OptionsStrikeVolume, OptionsSpot } from "../lib/options-types";

afterEach(() => cleanup());

const data: OptionsStrikeVolume = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [
    { strike: 53000, volume: 520, oi: 4100, oi_change: 310 },
    { strike: 53500, volume: 1200, oi: 8410, oi_change: 680 },
  ],
  put: [
    { strike: 52500, volume: 145, oi: 3520, oi_change: -88 },
    { strike: 53000, volume:  96, oi: 2410, oi_change: -22 },
  ],
};

const spot: OptionsSpot = {
  date: "2026-06-23", fetched_at: "x", as_of_date: "2026-06-23",
  spot: 53420, prev_close: 53300, change: 120, change_pct: 0.225,
};

describe("OptionsStrikeLadder", () => {
  it("renders the ladder when data + spot present", () => {
    render(<OptionsStrikeLadder data={data} spot={spot} loading={false} error={null} />);
    expect(screen.getByTestId("ladder-spot")).toBeTruthy();
  });

  it("renders error banner when error", () => {
    render(<OptionsStrikeLadder data={null} spot={null} loading={false} error="boom" />);
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("renders loading state when loading and no data", () => {
    render(<OptionsStrikeLadder data={null} spot={null} loading error={null} />);
    expect(screen.getByTestId("ladder-loading")).toBeTruthy();
  });

  it("works without spot (renders ladder, omits anchor row)", () => {
    render(<OptionsStrikeLadder data={data} spot={null} loading={false} error={null} />);
    expect(screen.queryByTestId("ladder-spot")).toBeNull();
    expect(screen.getAllByTestId("ladder-row").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/components/OptionsStrikeLadder.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/OptionsStrikeLadder.tsx`:

```tsx
import type { ReactElement } from "react";
import { StrikeLadder } from "../lib/options-svg";
import type { OptionsStrikeVolume, OptionsSpot } from "../lib/options-types";

interface Props {
  data: OptionsStrikeVolume | null;
  spot: OptionsSpot | null;
  loading: boolean;
  error: string | null;
}

export function OptionsStrikeLadder({
  data, spot, loading, error,
}: Props): ReactElement {
  return (
    <section className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 px-4 py-2 text-xs text-ink-dim uppercase tracking-wide border-b border-line flex items-center gap-2">
        <span>成交量分布 · Strike Ladder</span>
        {data && (
          <span className="text-[10px] text-ink-dim normal-case tracking-normal">
            {(data.call.length + data.put.length)} 個有量
          </span>
        )}
      </header>
      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}
      {loading && !data && (
        <div
          data-testid="ladder-loading"
          className="flex-1 flex items-center justify-center text-ink-dim text-sm"
        >
          載入中…
        </div>
      )}
      {data && (
        <div className="flex-1 overflow-hidden">
          <StrikeLadder data={data} spot={spot?.spot ?? null} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Verify pass + tsc**

```bash
cd frontend
npx vitest run src/components/OptionsStrikeLadder.test.tsx
npx tsc -b
```

Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/OptionsStrikeLadder.tsx frontend/src/components/OptionsStrikeLadder.test.tsx
git commit -m "feat(options): OptionsStrikeLadder panel"
```

---

## Task 10: OptionsHeader — add spot display

**Files:**
- Modify: `frontend/src/components/OptionsHeader.tsx` (add `spot` prop + display section)
- Modify: `frontend/src/components/OptionsHeader.test.tsx` (extend tests)

**Interfaces:**
- Consumes: `OptionsSpot` type
- Produces: `<OptionsHeader ... spot={OptionsSpot|null} />` — new optional `spot` prop. When present, header shows "台指期 53,420 +120 (+0.22%)" on the right side.

- [ ] **Step 1: Write failing test (append to existing test file)**

Open `frontend/src/components/OptionsHeader.test.tsx`. Append a new describe block:

```tsx
import type { OptionsSpot } from "../lib/options-types";

const mkSpot = (overrides?: Partial<OptionsSpot>): OptionsSpot => ({
  date: "2026-06-23", fetched_at: "x", as_of_date: "2026-06-23",
  spot: 53420, prev_close: 53300, change: 120, change_pct: 0.225,
  ...overrides,
});

describe("OptionsHeader spot display", () => {
  it("shows spot price + change when spot prop present", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
        spot={mkSpot()}
      />,
    );
    expect(screen.getByText(/53,420/)).toBeTruthy();
    expect(screen.getByText(/\+120/)).toBeTruthy();
  });

  it("omits spot section when spot is null", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
        spot={null}
      />,
    );
    expect(screen.queryByText(/台指期/)).toBeNull();
  });

  it("renders negative change in green", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
        spot={mkSpot({ change: -50, change_pct: -0.094 })}
      />,
    );
    const chg = screen.getByText(/−50/);
    // The wrapping <span> should carry the down-color class
    expect(chg.className).toContain("color-down");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/components/OptionsHeader.test.tsx -t "spot display"
```

Expected: failures (the new `spot` prop is not declared / not rendered).

- [ ] **Step 3: Implement**

Open `frontend/src/components/OptionsHeader.tsx`. Replace the file content with:

```tsx
import { useMemo, type ReactElement } from "react";
import { DateField } from "./ui/date-field";
import { listActiveContracts } from "../lib/options-contract";
import type { OptionsSpot } from "../lib/options-types";

interface Props {
  contractId: string;
  onContractChange: (id: string) => void;
  date: string;
  onDateChange: (d: string) => void;
  loading: boolean;
  onRefresh: () => void;
  spot?: OptionsSpot | null;
}

function fmtSpot(spot: OptionsSpot): { val: string; chg: string; chgPct: string } {
  const val = spot.spot != null ? spot.spot.toLocaleString() : "—";
  const chgN = spot.change ?? 0;
  const chg = chgN === 0 ? "0"
    : chgN > 0 ? `+${chgN.toLocaleString()}`
    : `−${Math.abs(chgN).toLocaleString()}`;
  const pctN = spot.change_pct ?? 0;
  const chgPct = pctN === 0 ? "(0.00%)"
    : pctN > 0 ? `(+${pctN.toFixed(2)}%)`
    : `(−${Math.abs(pctN).toFixed(2)}%)`;
  return { val, chg, chgPct };
}

export function OptionsHeader({
  contractId, onContractChange, date, onDateChange, loading, onRefresh, spot,
}: Props): ReactElement {
  const contracts = useMemo(() => listActiveContracts(new Date()), []);
  return (
    <header className="shrink-0 px-6 py-3 border-b border-line flex items-center gap-3">
      <h1 className="text-2xl text-ink font-semibold mr-2">選擇權籌碼</h1>
      <label className="text-sm text-ink-muted flex items-center gap-1.5">
        合約
        <select
          aria-label="選擇合約"
          value={contractId}
          onChange={(e) => onContractChange(e.target.value)}
          className="border border-line text-sm text-ink px-2 py-1 bg-bg cursor-pointer"
        >
          {contracts.map((c) => {
            const id = `${c.optionId}${c.contractDate}`;
            return (
              <option key={id} value={id}>
                {c.label}
              </option>
            );
          })}
        </select>
      </label>
      <DateField
        value={date}
        aria-label="選擇日期"
        onChange={(e) => onDateChange(e.target.value)}
      />
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        aria-busy={loading || undefined}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
      >
        {loading && (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
               className="size-3.5 animate-spin text-accent motion-reduce:animate-none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        重新整理
      </button>
      {spot && spot.spot != null && (() => {
        const f = fmtSpot(spot);
        const chgColor = (spot.change ?? 0) >= 0
          ? "text-[var(--color-up,#dc2626)]"
          : "text-[var(--color-down,#16a34a)]";
        return (
          <div className="ml-auto flex items-baseline gap-1.5">
            <span className="text-[10px] text-ink-dim uppercase tracking-wide">台指期</span>
            <span className="text-[18px] font-semibold text-ink font-variant-numeric tabular-nums">
              {f.val}
            </span>
            <span className={`text-[13px] font-variant-numeric tabular-nums ${chgColor}`}>
              {f.chg}
            </span>
            <span className={`text-[11px] font-variant-numeric tabular-nums ${chgColor}`}>
              {f.chgPct}
            </span>
          </div>
        );
      })()}
    </header>
  );
}
```

- [ ] **Step 4: Verify pass + tsc**

```bash
cd frontend
npx vitest run src/components/OptionsHeader.test.tsx
npx tsc -b
```

Expected: all PASSED. tsc may still complain about OptionsPage not passing the new spot prop — fixed in Task 11.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/OptionsHeader.tsx frontend/src/components/OptionsHeader.test.tsx
git commit -m "feat(options): OptionsHeader displays 台指期 spot price + change"
```

---

## Task 11: OptionsPage restructure + cleanup old components

**Files:**
- Modify: `frontend/src/components/OptionsPage.tsx`
- Delete: `frontend/src/components/OptionsLargeTradersPanel.tsx`
- Delete: `frontend/src/components/OptionsLargeTradersPanel.test.tsx`
- Delete: `frontend/src/components/OptionsStrikeVolumePanel.tsx`
- Delete: `frontend/src/components/OptionsStrikeVolumePanel.test.tsx`

**Interfaces:**
- Consumes: every new/updated piece from Tasks 4-10
- Produces: working end-to-end redesigned page; existing equity flow remains 100% intact

- [ ] **Step 1: Rewrite OptionsPage**

Open `frontend/src/components/OptionsPage.tsx`. Replace its content with:

```tsx
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { OptionsHeader } from "./OptionsHeader";
import { OptionsLargeTradersStrip } from "./OptionsLargeTradersStrip";
import { OptionsStrikeLadder } from "./OptionsStrikeLadder";
import { useOptionsLargeTraders } from "../hooks/useOptionsLargeTraders";
import { useOptionsStrikeVolume } from "../hooks/useOptionsStrikeVolume";
import { useOptionsSpot } from "../hooks/useOptionsSpot";
import { listActiveContracts } from "../lib/options-contract";

function todayStr(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function defaultContractId(): string {
  const list = listActiveContracts(new Date());
  const kind = localStorage.getItem("opt:kind");
  const pick = list.find((c) =>
    kind === "monthly" ? c.slot === "M0" : c.slot === "W1",
  ) ?? list[0];
  return `${pick.optionId}${pick.contractDate}`;
}

export function OptionsPage(): ReactElement {
  const [contractId, setContractId] = useState<string>(defaultContractId);
  const [date, setDate] = useState<string>(todayStr);

  const currentContract = useMemo(
    () => listActiveContracts(new Date())
      .find((c) => `${c.optionId}${c.contractDate}` === contractId),
    [contractId],
  );

  useEffect(() => {
    if (currentContract) localStorage.setItem("opt:kind", currentContract.kind);
  }, [currentContract]);

  const lt   = useOptionsLargeTraders(contractId, date);
  const sv   = useOptionsStrikeVolume(contractId, date);
  const spot = useOptionsSpot(date);

  const loading = lt.loading || sv.loading || spot.loading;
  const refresh = () => { lt.refresh(); sv.refresh(); spot.refresh(); };

  const isWeekly = currentContract?.kind === "weekly";
  const anyNoTradingDay =
    lt.noTradingDay || sv.noTradingDay || spot.noTradingDay;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <OptionsHeader
        contractId={contractId}
        onContractChange={setContractId}
        date={date}
        onDateChange={setDate}
        loading={loading}
        onRefresh={refresh}
        spot={spot.data}
      />
      {anyNoTradingDay && (
        <div className="shrink-0 px-6 py-2 text-sm text-ink-dim bg-ink/[0.04] border-b border-line">
          {date} 無交易
        </div>
      )}
      <OptionsLargeTradersStrip
        data={lt.data}
        loading={lt.loading}
        error={lt.error}
        weeklyAggregateBanner={isWeekly}
      />
      <OptionsStrikeLadder
        data={sv.data}
        spot={spot.data}
        loading={sv.loading}
        error={sv.error}
      />
    </div>
  );
}
```

- [ ] **Step 2: Delete old panel files**

```bash
cd C:/side-project/trash-cmoney
rm frontend/src/components/OptionsLargeTradersPanel.tsx
rm frontend/src/components/OptionsLargeTradersPanel.test.tsx
rm frontend/src/components/OptionsStrikeVolumePanel.tsx
rm frontend/src/components/OptionsStrikeVolumePanel.test.tsx
```

- [ ] **Step 3: Run everything**

```bash
cd frontend
npx tsc -b
npx vitest run
npm run build
```

Expected:
- tsc: 0 errors
- vitest: all PASSED (existing equity tests + all new options tests; OptionsLargeTradersPanel and OptionsStrikeVolumePanel test counts removed)
- build: succeeds

```bash
cd ../backend
python -m pytest -v
ruff check .
```

Expected: all PASSED, ruff clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OptionsPage.tsx
git rm frontend/src/components/OptionsLargeTradersPanel.tsx \
       frontend/src/components/OptionsLargeTradersPanel.test.tsx \
       frontend/src/components/OptionsStrikeVolumePanel.tsx \
       frontend/src/components/OptionsStrikeVolumePanel.test.tsx
git commit -m "feat(options): wire redesigned page — Strip + Ladder + spot anchor"
```

---

## Task 12: DevTools MCP real-environment verification

**Files:**
- Create: `docs/superpowers/specs/2026-06-24-options-page-redesign-verification/` (7 PNG screenshots)

**Interfaces:**
- Consumes: a running dev environment (backend on 8000, frontend on 5173)
- Produces: 7 screenshots demonstrating the redesigned UI passes spec §4.3

- [ ] **Step 1: Ensure dev servers are running**

Confirm with:
```bash
netstat -ano | grep -E ':(8000|5173)\s+.*LISTENING'
```

Both must be listening. If backend is not running:
```bash
cd backend
nohup python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload > /tmp/backend.log 2>&1 &
echo $! > /tmp/backend.pid
sleep 4
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/symbols?search=23
```

Frontend should already be on 5173 (user's session); do NOT start a second one.

- [ ] **Step 2: Drive the app with Chrome DevTools MCP**

Use `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` tools. For each scenario: navigate / click / fill, wait for render, capture screenshot to disk, capture console messages.

Capture these 7 PNGs into `docs/superpowers/specs/2026-06-24-options-page-redesign-verification/`:

1. `01-redesign-default-load.png` — open http://localhost:5173 in options mode, default W1 + today. Expected: Header shows 台指期 spot price on the right; weeklyAggregateBanner below header; Strip with 4 cards + sparklines; full-height StrikeLadder below.

2. `02-monthly-m0-switch.png` — change dropdown to M0 月選. Expected: weekly banner disappears; ladder reloads with monthly contract data; strip 4 cards reload.

3. `03-prior-trading-day.png` — change date to a known trading day (e.g. 2026-06-22). Expected: header spot price reflects that day; ladder rebuilds; current values change.

4. `04-saturday-no-trading-day.png` — change date to 2026-06-20 (Saturday). Expected: grey `2026-06-20 無交易` banner appears; panels still render fallback data.

5. `05-strip-sparklines.png` — close-up where the 4 strip sparklines are visible (default trading-day view). Capture full strip + a few rows of ladder.

6. `06-ladder-spot-anchor.png` — close-up of the StrikeLadder around the spot row (the red highlighted row with "← 現價" text).

7. `07-equity-mode-untouched.png` — click 〔個股〕 tab. Expected: existing equity page renders byte-identical to pre-redesign (SymbolSearch + date + tabs + K-line area + broker panel).

- [ ] **Step 3: Visually verify each PNG using the Read tool**

For each saved PNG, use the Read tool to view the image. Confirm the spec'd elements are visible. If any screenshot shows a regression (e.g. equity page broken in #7, banner missing in #4, sparklines blank in #5), STOP and report — do NOT commit incomplete verification evidence.

- [ ] **Step 4: Commit screenshots**

```bash
cd C:/side-project/trash-cmoney
git add docs/superpowers/specs/2026-06-24-options-page-redesign-verification/
git commit -m "chore(options): DevTools MCP verification screenshots for redesign"
```

---

## Self-Review

**Spec coverage:**
- §1.1 decisions table ↔ Tasks 1-11 cover each row ✓
- §2.2 series 4 nets ↔ Task 1 ✓
- §2.3 strike_volume all-strikes-asc ↔ Task 2 ✓
- §2.4 new /api/options/spot ↔ Task 3 ✓
- §2.5 error codes unchanged (no new task needed) ✓
- §3.1 new component tree ↔ Tasks 6-11 ✓
- §3.2 OptionsHeader spot section ↔ Task 10 ✓
- §3.3 OptionsLargeTradersStrip ↔ Task 8 ✓
- §3.4 OptionsStrikeLadder ↔ Task 9 (component) + Task 7 (StrikeLadder primitive) ✓
- §3.5 OptionsPage layout ↔ Task 11 ✓
- §3.7 loading/error/noTradingDay states ↔ Tasks 8/9/10/11 all cover ✓
- §4 tests ↔ each task ships its TDD ✓
- §5 Phasing P0-P3 ↔ Task 0 / Tasks 1-3 / Tasks 4-11 / Task 12 ✓

**Placeholder scan:** Task 0's spec addendum has `<observed>` placeholders that the implementer fills with curl output — these are intentional handoff variables, not plan failures. No other "TBD" / "TODO" / vague-fix-it remain. All code blocks contain the actual code to write.

**Type consistency:**
- `OptionsLargeTraders.series[i]` shape consistent across Task 4 (types) → Task 1 (backend emitter) → Task 8 (FE consumer) ✓
- `OptionsSpot` shape consistent across Task 3 (parser) → Task 4 (FE type) → Task 6 (hook) → Task 10 (header) → Task 11 (page) ✓
- `StrikeRow` unchanged from v1 — Task 7 ladder + Task 9 panel both consume same shape ✓
- `MiniBar` / `Sparkline` / `StrikeLadder` props consistent between Task 7 (definition) → Task 8 (MiniBar+Sparkline use) and Task 9 (StrikeLadder use) ✓
- Hook return shapes (`{ data, loading, error, refresh, noTradingDay }`) consistent between `useOptionsLargeTraders` (existing) / `useOptionsStrikeVolume` (Task 5) / `useOptionsSpot` (Task 6) ✓
