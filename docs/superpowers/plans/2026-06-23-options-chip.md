# Options Chip Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level mode switch to the existing App, where the new "選擇權" mode renders a TXO-only page showing large-trader OI (top 5/10 prop + all traders + 20-day net trend) and the day's top-N call/put strike volume with OI change.

**Architecture:** A single `<ModeSwitch>` at the App root toggles between the existing equity flow (untouched) and a new `<OptionsPage>` container that owns contract+date state and composes `<OptionsLargeTradersPanel>` over `<OptionsStrikeVolumePanel>`. Backend adds two read-only endpoints under `/api/options/*` reusing the existing `FinMindClient` + on-disk JSON cache, with a separate `_CACHE_VERSION_OPTIONS` constant so options cache cannot pollute the equity cache.

**Tech Stack:** Python 3 / FastAPI / httpx (backend) — React 19 / TypeScript / Vite / Vitest / Tailwind (frontend) — FinMind Sponsor-tier datasets (`TaiwanOptionOpenInterestLargeTraders`, `TaiwanOptionDaily`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-23-options-chip-design.md`. Every requirement in the spec maps to a task in this plan; before any task can be implemented its referenced spec section is the contract.
- **Phase 0 first:** Task 0 must finish (curl validation against live FinMind) and any discovered schema delta must be backported into the spec **before** Tasks 1–6 are implemented. If a field name differs, fix the spec, then proceed.
- **Cache version isolation:** Options cache uses `_CACHE_VERSION_OPTIONS = 1` (new constant). Never touch the existing `_CACHE_VERSION = 3` in `services/finmind.py`.
- **Existing equity flow is untouchable:** the only diff allowed in existing files is `App.tsx` (mode state + conditional render) and `services/finmind.py` (add new fetch methods — do NOT modify existing methods, classes, or constants other than adding new ones). All other existing files (`routes/chip.py`, `hooks/useChipData.ts`, `lib/api.ts`, etc.) must have zero diff.
- **One commit per task** (`feat(options): …` or `test(options): …`), no churn commits. Conventional Commits, no `--no-verify`, no `--no-gpg-sign`.
- **TDD:** every new behaviour starts with a failing test. No `.skip` / `xfail` / `pytest -k 'not ...'`. No `try/except: pass`.
- **Verification five-step at end of each task:** the agent runs `cd frontend && npx tsc -b && npx vitest run` and `cd backend && python -m pytest -v && ruff check .` and `cd frontend && npm run build` before committing if the task's diff touched that side. Final task adds DevTools MCP real-environment proof.
- **Locale:** comments + commit messages in Traditional Chinese where they exist in the surrounding code; English is OK in code.
- **Don't touch unrelated in-progress work:** at plan creation the working tree had pending changes on `SymbolSearch.tsx`, `routes/symbols.py`, `lib/api.ts`, `useAllSymbols.ts`, `test_symbols_route.py`. The new branch starts from `main` HEAD (`f783272`), which does NOT include those; do **not** rebase them in.

---

## File Inventory

**Create — backend (5 files):**
- `backend/services/finmind_options.py` — pure functions `list_active_contracts()`, `parse_oi_large_traders()`, `parse_strike_volume()`, constant `_CACHE_VERSION_OPTIONS`
- `backend/routes/options.py` — two endpoints: `/api/options/oi_large_traders`, `/api/options/strike_volume`
- `backend/tests/test_finmind_options.py` — pure-function tests + FinMindClient method tests
- `backend/tests/test_options_routes.py` — route tests
- `backend/tests/fixtures/options/` — shared fixture JSON files for parity tests

**Create — frontend (15 files):**
- `frontend/src/lib/options-contract.ts` — TS port of `list_active_contracts`
- `frontend/src/lib/options-contract.test.ts`
- `frontend/src/lib/options-api.ts` — `api.optionsLargeTraders`, `api.optionsStrikeVolume`
- `frontend/src/lib/options-types.ts` — TS types for both responses
- `frontend/src/lib/options-chart-svg.tsx` — pure SVG `<LargeTradersBars>`, `<LargeTradersTrend>`
- `frontend/src/lib/options-chart-svg.test.tsx`
- `frontend/src/hooks/useOptionsLargeTraders.ts`
- `frontend/src/hooks/useOptionsLargeTraders.test.ts`
- `frontend/src/hooks/useOptionsStrikeVolume.ts`
- `frontend/src/hooks/useOptionsStrikeVolume.test.ts`
- `frontend/src/components/ModeSwitch.tsx`
- `frontend/src/components/ModeSwitch.test.tsx`
- `frontend/src/components/OptionsLargeTradersPanel.tsx`
- `frontend/src/components/OptionsLargeTradersPanel.test.tsx`
- `frontend/src/components/OptionsStrikeVolumePanel.tsx`
- `frontend/src/components/OptionsStrikeVolumePanel.test.tsx`
- `frontend/src/components/OptionsHeader.tsx`
- `frontend/src/components/OptionsHeader.test.tsx`
- `frontend/src/components/OptionsPage.tsx`

**Modify (3 files, additive only):**
- `backend/services/finmind.py` — add `fetch_oi_large_traders` / `_do_fetch_oi_large_traders` / `fetch_strike_volume` / `_do_fetch_strike_volume` methods to `FinMindClient` (append only; don't touch the rest)
- `backend/main.py` — `from routes.options import router as options_router; app.include_router(options_router)`
- `frontend/src/App.tsx` — add `mode` state + `<ModeSwitch>` + conditional render

---

## Task 0: FinMind Schema Validation Pre-Flight

**Files:**
- Modify (if schema mismatch): `docs/superpowers/specs/2026-06-23-options-chip-design.md` §2.1 / §2.7

**Interfaces:**
- Consumes: nothing (this is the very first task; FinMind token already in env)
- Produces: a written addendum at the bottom of the spec titled "Phase 0 Schema Validation Result — 2026-06-23" stating the exact field names that the parsers in Tasks 2 and 3 will use

- [ ] **Step 1: Confirm FinMind token is available**

```bash
cd backend
grep -q FINMIND_TOKEN .env && echo "token present" || echo "token MISSING"
```

Expected output: `token present`. If MISSING, ask user and STOP.

- [ ] **Step 2: Curl `TaiwanOptionOpenInterestLargeTraders` for the last 5 days**

```bash
TOKEN=$(grep FINMIND_TOKEN backend/.env | cut -d= -f2)
curl -s "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanOptionOpenInterestLargeTraders&start_date=2026-06-18&end_date=2026-06-23" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool > /tmp/oilt.json
head -100 /tmp/oilt.json
```

Expected: response has `"msg": "success"` and `data` is a list of dicts with at least these keys (per spec §2.2):
- `date`
- Some contract identifier (likely `name` or `option_id` or `contract`)
- 8 numeric fields representing top5/top10 × prop/all × long/short

Record the **exact** field names observed. If they differ from spec §2.1's assumed names (`top5_prop.long`, etc.), the parser in Task 2 maps them to the spec-defined output names — DO NOT change the response shape we expose; only change the parser's input field names.

- [ ] **Step 3: Curl `TaiwanOptionDaily` to identify contract / strike / volume / OI field names**

```bash
curl -s "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanOptionDaily&start_date=2026-06-20&end_date=2026-06-23" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool > /tmp/od.json
head -200 /tmp/od.json
```

Expected: rows for many (contract, strike, call_put) tuples. Identify and write down:
- contract identifier field name
- strike price field name
- call/put discriminator field name (e.g. `call_put`, `option_type`)
- volume field name (likely `volume` or `Trading_Volume`)
- open interest field name (likely `open_interest` or `OI`)

- [ ] **Step 4: Identify the weekly-option `data_id` literal**

The weekly TXO contracts may appear in `TaiwanOptionDaily` under different `data_id` values (e.g. `TX1`, `TX2`, `TXO` with a different contract_date format, etc.). Scan the response:

```bash
python -c "import json; d=json.load(open('/tmp/od.json')); ids=sorted({r.get('data_id','?') for r in d['data']}); print(ids[:20])"
python -c "import json; d=json.load(open('/tmp/oilt.json')); cs=sorted({r.get('contract_date','?') for r in d['data']}); print(cs[:20])"
```

Record the distinct `data_id` / `contract_date` patterns. Decide the exact mapping rule between "week 1..4 / month 0..2" and these literals — this rule is the body of `list_active_contracts()` in Task 1.

- [ ] **Step 5: Append Phase 0 validation result to the spec, commit**

Edit `docs/superpowers/specs/2026-06-23-options-chip-design.md`: at the bottom of the file, after section 7, add:

```markdown
---

## Phase 0 Schema Validation Result — 2026-06-23

Verified against live FinMind responses on YYYY-MM-DD HH:MM.

### `TaiwanOptionOpenInterestLargeTraders` actual fields used by parser
- date: `<observed>`
- contract: `<observed field name>`
- top5_prop_long_oi: `<observed field name>`
- top5_prop_short_oi: `<observed field name>`
- top10_prop_long_oi: `<observed field name>`
- top10_prop_short_oi: `<observed field name>`
- top5_all_long_oi: `<observed field name>`
- top5_all_short_oi: `<observed field name>`
- top10_all_long_oi: `<observed field name>`
- top10_all_short_oi: `<observed field name>`

### `TaiwanOptionDaily` actual fields used by parser
- contract / data_id: `<observed>`
- strike: `<observed>`
- call_put: `<observed>` (values: `<call value>`, `<put value>`)
- volume: `<observed>`
- open_interest: `<observed>`
- date: `<observed>`

### Weekly / monthly contract literals
- 週選 W1..W4 → data_id pattern: `<observed>`
- 月選 M0..M2 → data_id `TXO` + contract_date: `<YYYYMM observed>`
```

Fill in the `<observed>` placeholders with actual values from steps 2–4. If anything materially contradicts spec §2.1 (e.g. there is no per-strike OI in `TaiwanOptionDaily`, so `oi_change` must come from a different dataset), STOP and ask the user before continuing.

```bash
git add docs/superpowers/specs/2026-06-23-options-chip-design.md
git commit -m "docs(options): record Phase 0 FinMind schema validation result"
```

---

## Task 1: Contract Code Utility (`list_active_contracts`)

**Files:**
- Create: `backend/services/finmind_options.py`
- Test: `backend/tests/test_finmind_options.py`
- Create: `backend/tests/fixtures/options/contracts_2026-06-23.json` (shared FE+BE fixture)

**Interfaces:**
- Consumes: standard library `datetime`
- Produces:
  - `list_active_contracts(today: date) -> list[dict]` returning `[{kind, slot, code, contract_date, label, settlement}]`, exactly 7 items: weekly W1..W4 then monthly M0..M2
  - constant `_CACHE_VERSION_OPTIONS = 1`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_finmind_options.py`:

```python
"""Tests for services/finmind_options.py — pure functions."""

import json
from datetime import date
from pathlib import Path

import pytest

FIX = Path(__file__).parent / "fixtures" / "options"


def test_list_active_contracts_returns_seven_items_in_order():
    from services.finmind_options import list_active_contracts
    items = list_active_contracts(date(2026, 6, 23))
    assert len(items) == 7
    kinds = [i["kind"] for i in items]
    slots = [i["slot"] for i in items]
    assert kinds == ["weekly"] * 4 + ["monthly"] * 3
    assert slots == ["W1", "W2", "W3", "W4", "M0", "M1", "M2"]


def test_list_active_contracts_matches_fixture():
    from services.finmind_options import list_active_contracts
    fix = json.loads((FIX / "contracts_2026-06-23.json").read_text("utf-8"))
    items = list_active_contracts(date(2026, 6, 23))
    assert [
        {"slot": i["slot"], "kind": i["kind"], "code": i["code"],
         "contract_date": i["contract_date"], "settlement": i["settlement"]}
        for i in items
    ] == fix["expected"]


def test_list_active_contracts_excludes_settled_week():
    """When today == settlement Wednesday, that week's W1 must roll over."""
    from services.finmind_options import list_active_contracts
    settle_wed = date(2026, 6, 24)  # 週三
    items_day_of = list_active_contracts(settle_wed)
    items_day_after = list_active_contracts(date(2026, 6, 25))
    # W1 the day after settlement is one slot ahead vs. the day-of view
    assert items_day_of[0]["settlement"] != items_day_after[0]["settlement"]
```

Also create `backend/tests/fixtures/options/contracts_2026-06-23.json` (replace the W/M codes below with values consistent with the Phase 0 rule decided in Task 0 step 4 — example shown assumes 週三 結算 and `TX1`/`TX2`/`TX3`/`TX4` for weeklies, `TXO` + `YYYYMM` for monthlies, with monthly settlement on the third 週三):

```json
{
  "today": "2026-06-23",
  "expected": [
    {"slot": "W1", "kind": "weekly",  "code": "TX1", "contract_date": "202606W1", "settlement": "2026-06-24"},
    {"slot": "W2", "kind": "weekly",  "code": "TX2", "contract_date": "202607W1", "settlement": "2026-07-01"},
    {"slot": "W3", "kind": "weekly",  "code": "TX3", "contract_date": "202607W2", "settlement": "2026-07-08"},
    {"slot": "W4", "kind": "weekly",  "code": "TX4", "contract_date": "202607W3", "settlement": "2026-07-15"},
    {"slot": "M0", "kind": "monthly", "code": "TXO", "contract_date": "202606",   "settlement": "2026-06-17"},
    {"slot": "M1", "kind": "monthly", "code": "TXO", "contract_date": "202607",   "settlement": "2026-07-15"},
    {"slot": "M2", "kind": "monthly", "code": "TXO", "contract_date": "202609",   "settlement": "2026-09-16"}
  ]
}
```

**Important:** the implementer MUST adjust both the expected JSON and the rule in step 3 to match the literals recorded in the Task 0 §"Weekly / monthly contract literals" addendum. The structure above is the shape; the literal values come from Phase 0.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v
```

Expected: 3 failures with `ModuleNotFoundError: No module named 'services.finmind_options'`.

- [ ] **Step 3: Implement minimal `list_active_contracts`**

Create `backend/services/finmind_options.py`:

```python
"""Pure helpers for TXO options: contract enumeration + dataset parsing.

Sister to services/finmind.py; that module owns HTTP + cache + rate-limit,
this one owns the data-shape logic so it can be unit-tested without I/O.
"""

from __future__ import annotations

from datetime import date, timedelta

_CACHE_VERSION_OPTIONS = 1


def _third_wednesday(year: int, month: int) -> date:
    """Monthly TXO settlement = the third Wednesday of that month."""
    d = date(year, month, 1)
    # weekday(): Mon=0 .. Sun=6; Wed=2.
    first_wed = d + timedelta(days=(2 - d.weekday()) % 7)
    return first_wed + timedelta(days=14)


def _next_wednesday(d: date) -> date:
    """Smallest Wednesday strictly greater than d."""
    return d + timedelta(days=((2 - d.weekday()) % 7) or 7)


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


def list_active_contracts(today: date) -> list[dict]:
    """Return the seven contracts visible in the picker on `today`:
    weekly W1..W4 + monthly M0..M2. Weeks settled today are excluded.

    The literal values for code / contract_date follow the FinMind
    convention observed during Phase 0 schema validation.
    """
    # --- monthly slots (M0=current, M1=next, M2=quarter-cycle next-next-next) ---
    m0_settle = _third_wednesday(today.year, today.month)
    if today > m0_settle:  # current month already settled → roll forward
        m0_anchor = _add_months(date(today.year, today.month, 1), 1)
    else:
        m0_anchor = date(today.year, today.month, 1)
    m0 = m0_anchor
    m1 = _add_months(m0, 1)
    m2 = _add_months(m0, 3)
    monthlies = []
    for slot, anchor in [("M0", m0), ("M1", m1), ("M2", m2)]:
        sett = _third_wednesday(anchor.year, anchor.month)
        monthlies.append({
            "slot": slot, "kind": "monthly",
            "code": "TXO",
            "contract_date": f"{anchor.year:04d}{anchor.month:02d}",
            "label": f"{anchor.year}/{anchor.month:02d} 月選",
            "settlement": sett.isoformat(),
        })

    # --- weekly slots W1..W4: next 4 Wednesdays, skipping monthly-settle weeks ---
    monthly_setts = {m["settlement"] for m in monthlies}
    cursor = today
    weeklies: list[dict] = []
    for i in range(1, 5):
        nxt = _next_wednesday(cursor)
        while nxt.isoformat() in monthly_setts:
            nxt = _next_wednesday(nxt)
        # weekly contract_date convention from Phase 0:
        #   YYYYMM + "W" + ordinal-within-month
        ordinal = (nxt.day - 1) // 7 + 1
        weeklies.append({
            "slot": f"W{i}", "kind": "weekly",
            "code": f"TX{i}",
            "contract_date": f"{nxt.year:04d}{nxt.month:02d}W{ordinal}",
            "label": f"{nxt.month:02d}/{nxt.day:02d} 週選 W{i}",
            "settlement": nxt.isoformat(),
        })
        cursor = nxt

    return weeklies + monthlies
```

**Adjust** the `code` / `contract_date` literals if Phase 0 found different patterns. Also adjust the weekly-vs-monthly-week dedup rule if Phase 0 shows monthlies and weeklies coexist in the same 週.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v
```

Expected: 3 PASSED. If `test_list_active_contracts_matches_fixture` fails, the **fixture** is the source of truth — adjust the implementation to match.

- [ ] **Step 5: Ruff + commit**

```bash
cd backend
ruff check .
ruff check --fix .
git add backend/services/finmind_options.py backend/tests/test_finmind_options.py backend/tests/fixtures/options/contracts_2026-06-23.json
git commit -m "feat(options): add list_active_contracts pure function + fixture"
```

---

## Task 2: Parse `TaiwanOptionOpenInterestLargeTraders`

**Files:**
- Modify: `backend/services/finmind_options.py` (append `parse_oi_large_traders`)
- Modify: `backend/tests/test_finmind_options.py` (append)

**Interfaces:**
- Consumes: nothing (pure function over raw FinMind rows)
- Produces:
  - `parse_oi_large_traders(rows: list[dict], contract_date: str) -> dict` returning the shape from spec §2.1 `oi_large_traders` (`{current: {...}, series: [...]}`)

- [ ] **Step 1: Write failing test (append to test file)**

Add to `backend/tests/test_finmind_options.py`:

```python
# Field names below MUST match what Phase 0 recorded in the spec addendum.
OI_LT_ROW_TODAY = {
    "date": "2026-06-23",
    "contract_date": "202607",  # Phase-0 actual field name
    "top5_prop_long_oi":  12500, "top5_prop_short_oi":  8200,
    "top10_prop_long_oi": 18000, "top10_prop_short_oi": 11000,
    "top5_all_long_oi":   22000, "top5_all_short_oi":   17000,
    "top10_all_long_oi":  31000, "top10_all_short_oi":  24000,
}
OI_LT_ROW_PREV = {**OI_LT_ROW_TODAY, "date": "2026-06-20",
                  "top10_all_long_oi": 30000, "top10_all_short_oi": 23200,
                  "top10_prop_long_oi": 17800, "top10_prop_short_oi": 10800}


def test_parse_oi_large_traders_current_uses_last_row():
    from services.finmind_options import parse_oi_large_traders
    out = parse_oi_large_traders([OI_LT_ROW_PREV, OI_LT_ROW_TODAY], "202607")
    assert out["current"] == {
        "top5_prop":  {"long": 12500, "short":  8200, "net":  4300},
        "top10_prop": {"long": 18000, "short": 11000, "net":  7000},
        "top5_all":   {"long": 22000, "short": 17000, "net":  5000},
        "top10_all":  {"long": 31000, "short": 24000, "net":  7000},
    }


def test_parse_oi_large_traders_series_in_date_order():
    from services.finmind_options import parse_oi_large_traders
    out = parse_oi_large_traders([OI_LT_ROW_TODAY, OI_LT_ROW_PREV], "202607")
    assert [s["date"] for s in out["series"]] == ["2026-06-20", "2026-06-23"]
    assert out["series"][-1] == {
        "date": "2026-06-23",
        "top10_all_net":  31000 - 24000,
        "top10_prop_net": 18000 - 11000,
    }


def test_parse_oi_large_traders_filters_by_contract_date():
    from services.finmind_options import parse_oi_large_traders
    other = {**OI_LT_ROW_TODAY, "contract_date": "202608"}
    out = parse_oi_large_traders([OI_LT_ROW_TODAY, other], "202607")
    assert len(out["series"]) == 1
    assert out["series"][0]["date"] == "2026-06-23"


def test_parse_oi_large_traders_empty_returns_zero_current():
    from services.finmind_options import parse_oi_large_traders
    out = parse_oi_large_traders([], "202607")
    assert out["current"] == {
        "top5_prop":  {"long": 0, "short": 0, "net": 0},
        "top10_prop": {"long": 0, "short": 0, "net": 0},
        "top5_all":   {"long": 0, "short": 0, "net": 0},
        "top10_all":  {"long": 0, "short": 0, "net": 0},
    }
    assert out["series"] == []
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k parse_oi_large_traders
```

Expected: 4 failures with `ImportError: cannot import name 'parse_oi_large_traders'`.

- [ ] **Step 3: Implement (append to `services/finmind_options.py`)**

Substitute the field names below with the real ones from Phase 0:

```python
def parse_oi_large_traders(rows: list[dict], contract_date: str) -> dict:
    """Parse TaiwanOptionOpenInterestLargeTraders rows into the API shape.

    Field names below correspond to the literals recorded in spec
    'Phase 0 Schema Validation Result' for this dataset.
    """
    zero = {"long": 0, "short": 0, "net": 0}
    empty_current = {k: dict(zero) for k in
                     ("top5_prop", "top10_prop", "top5_all", "top10_all")}

    filtered = [r for r in rows if r.get("contract_date") == contract_date]
    filtered.sort(key=lambda r: r.get("date", ""))

    if not filtered:
        return {"current": empty_current, "series": []}

    last = filtered[-1]

    def grp(prefix: str) -> dict:
        lng = int(last.get(f"{prefix}_long_oi", 0))
        sht = int(last.get(f"{prefix}_short_oi", 0))
        return {"long": lng, "short": sht, "net": lng - sht}

    current = {
        "top5_prop":  grp("top5_prop"),
        "top10_prop": grp("top10_prop"),
        "top5_all":   grp("top5_all"),
        "top10_all":  grp("top10_all"),
    }

    series = [
        {
            "date": r["date"],
            "top10_all_net":  int(r.get("top10_all_long_oi", 0))  - int(r.get("top10_all_short_oi", 0)),
            "top10_prop_net": int(r.get("top10_prop_long_oi", 0)) - int(r.get("top10_prop_short_oi", 0)),
        }
        for r in filtered
    ]
    return {"current": current, "series": series}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v
```

Expected: 7 PASSED (3 from Task 1 + 4 new).

- [ ] **Step 5: Ruff + commit**

```bash
cd backend
ruff check . && ruff check --fix .
git add backend/services/finmind_options.py backend/tests/test_finmind_options.py
git commit -m "feat(options): parse OptionOpenInterestLargeTraders rows"
```

---

## Task 3: Parse `TaiwanOptionDaily` Strike Volume

**Files:**
- Modify: `backend/services/finmind_options.py` (append `parse_strike_volume`)
- Modify: `backend/tests/test_finmind_options.py` (append)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parse_strike_volume(rows: list[dict], contract_date: str, top_n: int) -> dict` returning `{call: [{strike, volume, oi, oi_change}], put: [...]}` (spec §2.1 strike_volume)

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_finmind_options.py`:

```python
# Phase-0 verified field names; adjust if validation showed different keys.
def _od_row(date_, ct, cp, strike, vol, oi):
    return {"date": date_, "contract_date": ct, "call_put": cp,
            "strike_price": strike, "volume": vol, "open_interest": oi}


def test_parse_strike_volume_picks_top_n_per_side():
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
    out = parse_strike_volume(rows, "202607", top_n=2)
    assert [c["strike"] for c in out["call"]] == [22000, 22100]
    assert [p["strike"] for p in out["put"]]  == [21500, 21000]
    assert out["call"][0]["volume"] == 18500
    assert out["call"][0]["oi"]     == 35200


def test_parse_strike_volume_computes_oi_change_against_prev_day():
    from services.finmind_options import parse_strike_volume
    rows = [
        # previous day
        _od_row("2026-06-20", "202607", "call", 22000, 14000, 33100),
        # today
        _od_row("2026-06-23", "202607", "call", 22000, 18500, 35200),
    ]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["call"][0]["oi_change"] == 35200 - 33100


def test_parse_strike_volume_first_day_oi_change_zero():
    from services.finmind_options import parse_strike_volume
    rows = [_od_row("2026-06-23", "202607", "call", 22000, 18500, 35200)]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["call"][0]["oi_change"] == 0


def test_parse_strike_volume_filters_by_contract_date():
    from services.finmind_options import parse_strike_volume
    rows = [
        _od_row("2026-06-23", "202607", "call", 22000, 99999, 35200),
        _od_row("2026-06-23", "202608", "call", 22000, 18500, 30000),
    ]
    out = parse_strike_volume(rows, "202607", top_n=1)
    assert out["call"][0]["volume"] == 99999


def test_parse_strike_volume_empty_returns_empty_lists():
    from services.finmind_options import parse_strike_volume
    out = parse_strike_volume([], "202607", top_n=10)
    assert out == {"call": [], "put": []}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k parse_strike_volume
```

Expected: 5 failures.

- [ ] **Step 3: Implement**

Append to `backend/services/finmind_options.py`:

```python
def parse_strike_volume(rows: list[dict], contract_date: str, top_n: int) -> dict:
    """Parse TaiwanOptionDaily rows into top-N strike volume per side.

    Picks the latest trading date present (today's date if today traded);
    computes oi_change versus the previous trading date.
    """
    matched = [r for r in rows if r.get("contract_date") == contract_date]
    if not matched:
        return {"call": [], "put": []}

    dates = sorted({r["date"] for r in matched})
    today = dates[-1]
    prev = dates[-2] if len(dates) >= 2 else None

    prev_oi: dict[tuple[str, int], int] = {}
    if prev is not None:
        for r in matched:
            if r["date"] == prev:
                key = (str(r["call_put"]).lower(), int(r["strike_price"]))
                prev_oi[key] = int(r.get("open_interest", 0))

    def side(cp_value: str) -> list[dict]:
        items = [r for r in matched
                 if r["date"] == today
                 and str(r["call_put"]).lower() == cp_value]
        items.sort(key=lambda r: int(r["volume"]), reverse=True)
        out: list[dict] = []
        for r in items[:top_n]:
            strike = int(r["strike_price"])
            oi = int(r.get("open_interest", 0))
            prev_v = prev_oi.get((cp_value, strike), 0) if prev else 0
            out.append({
                "strike": strike,
                "volume": int(r["volume"]),
                "oi": oi,
                "oi_change": oi - prev_v if prev else 0,
            })
        return out

    return {"call": side("call"), "put": side("put")}
```

If Phase 0 found different `call_put` literal values (e.g. `C` / `P` or `買權` / `賣權`), change the `cp_value` arguments and the `.lower()` normalization accordingly.

- [ ] **Step 4: Run to verify pass**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v
```

Expected: 12 PASSED.

- [ ] **Step 5: Ruff + commit**

```bash
cd backend
ruff check . && ruff check --fix .
git add backend/services/finmind_options.py backend/tests/test_finmind_options.py
git commit -m "feat(options): parse OptionDaily into top-N strike volume per side"
```

---

## Task 4: `FinMindClient.fetch_oi_large_traders`

**Files:**
- Modify: `backend/services/finmind.py` (append methods to class `FinMindClient`)
- Modify: `backend/tests/test_finmind_options.py` (append integration test against mocked httpx)

**Interfaces:**
- Consumes: `parse_oi_large_traders` (Task 2), `_CACHE_VERSION_OPTIONS` (Task 1), `chip_cache_dir()`, `atomic_write_json`, `read_json` (already in `utils/cache.py`)
- Produces: `async def fetch_oi_large_traders(self, contract: dict, date_str: str, refresh: bool = False) -> dict`
  - `contract` is a dict from `list_active_contracts` (`{code, contract_date, ...}`)
  - returns the spec §2.1 `oi_large_traders` shape

- [ ] **Step 1: Write failing integration test**

Append to `backend/tests/test_finmind_options.py`:

```python
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock


def _fm_resp(data, status=200):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = {"msg": "success", "status": 200, "data": data}
    r.raise_for_status = MagicMock()
    return r


def _mock_http(*responses):
    c = AsyncMock()
    c.get = AsyncMock(side_effect=list(responses))
    return c


@pytest.fixture(autouse=True)
def _reset_singleton(tmp_path, monkeypatch):
    monkeypatch.setenv("FINMIND_TOKEN", "test-token")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    import services.finmind as mod
    mod._client = None
    mod._fm_limiter = None


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_writes_cache_and_returns_shape():
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_resp([OI_LT_ROW_PREV, OI_LT_ROW_TODAY]))
    fm = FinMindClient()
    fm._http = mc
    contract = {"code": "TXO", "contract_date": "202607"}
    out = await fm.fetch_oi_large_traders(contract, "2026-06-23")
    assert out["contract"] == "TXO202607"
    assert out["date"] == "2026-06-23"
    assert out["current"]["top10_all"]["net"] == 31000 - 24000
    assert len(out["series"]) == 2
    # Cache file written
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / "TXO202607_2026-06-23_oi_lt.json").exists()


@pytest.mark.asyncio
async def test_fetch_oi_large_traders_returns_cached_on_second_call():
    from services.finmind import FinMindClient
    mc = _mock_http(_fm_resp([OI_LT_ROW_TODAY]))
    fm = FinMindClient()
    fm._http = mc
    contract = {"code": "TXO", "contract_date": "202607"}
    first = await fm.fetch_oi_large_traders(contract, "2025-01-01")  # past date → permanent
    second = await fm.fetch_oi_large_traders(contract, "2025-01-01")
    assert first == second
    assert mc.get.await_count == 1  # second call hit cache
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k fetch_oi_large_traders
```

Expected: 2 failures with `AttributeError: 'FinMindClient' object has no attribute 'fetch_oi_large_traders'`.

- [ ] **Step 3: Implement — append to `services/finmind.py` AFTER existing methods, BEFORE the closing of class `FinMindClient`**

Find the line `# -- major net series (top-15 broker net per day) ----------------------` (around `finmind.py:387`). Insert the new methods **before** that block, after `fetch_broker_history` ends (around line 385). The exact location: between the `_do_fetch_broker_history` method and the `# -- major net series` divider comment.

```python
    # -- options: large traders OI ----------------------------------------

    async def fetch_oi_large_traders(
        self, contract: dict, date_str: str, refresh: bool = False,
    ) -> dict:
        """Fetch TaiwanOptionOpenInterestLargeTraders for the given contract,
        return both today's snapshot + 20 trading-day net series.

        `contract` is a dict from
        services.finmind_options.list_active_contracts (uses `code` and
        `contract_date` keys); see spec §2.3.
        """
        from services.finmind_options import _CACHE_VERSION_OPTIONS

        contract_id = f"{contract['code']}{contract['contract_date']}"
        cache_key = f"{contract_id}_{date_str}_oi_lt"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached

        return await self._run_once(
            f"oi_lt_{cache_key}",
            lambda: self._do_fetch_oi_large_traders(contract, date_str, cache_key),
        )

    async def _do_fetch_oi_large_traders(
        self, contract: dict, date_str: str, cache_key: str,
    ) -> dict:
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS, parse_oi_large_traders,
        )

        end = date.fromisoformat(date_str)
        start = end - timedelta(days=35)
        raw = await self._get(
            f"{_FINMIND_BASE}/data",
            {"dataset": "TaiwanOptionOpenInterestLargeTraders",
             "start_date": start.isoformat(), "end_date": end.isoformat()},
        )
        parsed = parse_oi_large_traders(raw, contract["contract_date"])
        # Truncate series to last 20 entries to honour spec §2.1.
        parsed["series"] = parsed["series"][-20:]
        result = {
            "contract": f"{contract['code']}{contract['contract_date']}",
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            **parsed,
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS)
        return result

    # -- options cache version helpers (separate _CACHE_VERSION_OPTIONS) ---

    def _read_cache_v(self, key: str, version: int) -> dict | None:
        p = self._cache_path(key)
        if not p.exists():
            return None
        data = read_json(p, default=None)
        if data is None or data.get("_cache_version") != version:
            return None
        out = dict(data)
        out.pop("_cache_version", None)
        return out

    def _write_cache_v(self, key: str, payload: dict, version: int) -> None:
        cached = {**payload, "_cache_version": version}
        atomic_write_json(self._cache_path(key), cached)
```

The helpers `_read_cache_v` / `_write_cache_v` are new and parameterise the cache version (the existing `_read_cache` / `_write_cache` keep their hard-coded `_CACHE_VERSION = 3`).

- [ ] **Step 4: Run to verify pass**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v
```

Expected: 14 PASSED.

- [ ] **Step 5: Ruff + commit**

```bash
cd backend
ruff check . && ruff check --fix .
git add backend/services/finmind.py backend/tests/test_finmind_options.py
git commit -m "feat(options): FinMindClient.fetch_oi_large_traders + isolated cache helpers"
```

---

## Task 5: `FinMindClient.fetch_strike_volume`

**Files:**
- Modify: `backend/services/finmind.py` (append method)
- Modify: `backend/tests/test_finmind_options.py` (append)

**Interfaces:**
- Consumes: `parse_strike_volume` (Task 3), `_CACHE_VERSION_OPTIONS`, `_read_cache_v` / `_write_cache_v` (Task 4)
- Produces: `async def fetch_strike_volume(self, contract: dict, date_str: str, top_n: int = 10, refresh: bool = False) -> dict`

- [ ] **Step 1: Write failing test**

Append:

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
    contract = {"code": "TXO", "contract_date": "202607"}
    out = await fm.fetch_strike_volume(contract, today, top_n=2)
    assert out["contract"] == "TXO202607"
    assert out["date"] == today
    assert [c["strike"] for c in out["call"]] == [22000, 22100]
    assert out["call"][0]["oi_change"] == 35200 - 33100
    assert [p["strike"] for p in out["put"]] == [21500]
    from utils.cache import chip_cache_dir
    assert (chip_cache_dir() / "TXO202607_2026-06-23_strike_vol.json").exists()
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v -k fetch_strike_volume
```

Expected: 1 failure.

- [ ] **Step 3: Implement (append after `_do_fetch_oi_large_traders` in `finmind.py`)**

```python
    # -- options: strike volume + OI change ------------------------------

    async def fetch_strike_volume(
        self, contract: dict, date_str: str,
        top_n: int = 10, refresh: bool = False,
    ) -> dict:
        from services.finmind_options import _CACHE_VERSION_OPTIONS
        contract_id = f"{contract['code']}{contract['contract_date']}"
        cache_key = f"{contract_id}_{date_str}_strike_vol_top{top_n}"
        if not refresh:
            cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS)
            if cached is not None:
                if not self._is_today(date_str) or not self._is_stale(cached):
                    return cached
        return await self._run_once(
            f"strike_vol_{cache_key}",
            lambda: self._do_fetch_strike_volume(contract, date_str, top_n, cache_key),
        )

    async def _do_fetch_strike_volume(
        self, contract: dict, date_str: str, top_n: int, cache_key: str,
    ) -> dict:
        from services.finmind_options import (
            _CACHE_VERSION_OPTIONS, parse_strike_volume,
        )
        end = date.fromisoformat(date_str)
        start = end - timedelta(days=7)
        raw = await self._get(
            f"{_FINMIND_BASE}/data",
            {"dataset": "TaiwanOptionDaily",
             "start_date": start.isoformat(), "end_date": end.isoformat()},
        )
        parsed = parse_strike_volume(raw, contract["contract_date"], top_n)
        result = {
            "contract": f"{contract['code']}{contract['contract_date']}",
            "date": date_str,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
            **parsed,
        }
        self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS)
        return result
```

- [ ] **Step 4: Run to verify pass**

```bash
cd backend
python -m pytest tests/test_finmind_options.py -v
```

Expected: 15 PASSED.

- [ ] **Step 5: Ruff + commit**

```bash
cd backend
ruff check . && ruff check --fix .
git add backend/services/finmind.py backend/tests/test_finmind_options.py
git commit -m "feat(options): FinMindClient.fetch_strike_volume"
```

---

## Task 6: Routes — `/api/options/oi_large_traders` and `/api/options/strike_volume`

**Files:**
- Create: `backend/routes/options.py`
- Modify: `backend/main.py` (one line + one import)
- Create: `backend/tests/test_options_routes.py`

**Interfaces:**
- Consumes: `get_finmind()` (existing), `list_active_contracts` (Task 1)
- Produces: HTTP endpoints per spec §2.1, error codes per spec §2.5

- [ ] **Step 1: Write failing route tests**

Create `backend/tests/test_options_routes.py`:

```python
"""Tests for routes/options.py — options API endpoints."""
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def mock_fm():
    svc = AsyncMock()
    svc.fetch_oi_large_traders = AsyncMock(return_value={
        "contract": "TXO202607", "date": "2026-06-23", "fetched_at": "x",
        "current": {"top5_prop": {"long": 1, "short": 1, "net": 0}} ,
        "series": [],
    })
    svc.fetch_strike_volume = AsyncMock(return_value={
        "contract": "TXO202607", "date": "2026-06-23", "fetched_at": "x",
        "call": [], "put": [],
    })
    with patch("routes.options.get_finmind", return_value=svc):
        yield svc


def _today():
    return date.today().isoformat()


def test_oi_lt_requires_contract():
    resp = TestClient(app).get("/api/options/oi_large_traders")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "contract_required"


def test_oi_lt_invalid_contract_400():
    resp = TestClient(app).get(
        "/api/options/oi_large_traders?contract=BOGUS999999",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "invalid_contract"


def test_oi_lt_happy_path(mock_fm):
    # Use a contract code that list_active_contracts will produce today.
    from services.finmind_options import list_active_contracts
    contract = list_active_contracts(date.today())[0]
    code = f"{contract['code']}{contract['contract_date']}"
    resp = TestClient(app).get(f"/api/options/oi_large_traders?contract={code}")
    assert resp.status_code == 200
    assert resp.json()["contract"] == "TXO202607"
    mock_fm.fetch_oi_large_traders.assert_awaited_once()


def test_strike_vol_top_n_out_of_range_400():
    from services.finmind_options import list_active_contracts
    code = f"{list_active_contracts(date.today())[0]['code']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(
        f"/api/options/strike_volume?contract={code}&top_n=99",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "top_n_out_of_range"


def test_strike_vol_happy_path(mock_fm):
    from services.finmind_options import list_active_contracts
    code = f"{list_active_contracts(date.today())[0]['code']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(f"/api/options/strike_volume?contract={code}")
    assert resp.status_code == 200
    assert resp.json()["call"] == []
    mock_fm.fetch_strike_volume.assert_awaited_once()


def test_oi_lt_no_trading_day_returns_200_with_flag(mock_fm):
    """When FinMind returns no rows for today, route returns 200 + flag."""
    mock_fm.fetch_oi_large_traders.return_value = {
        "contract": "TXO202607", "date": _today(), "fetched_at": "x",
        "current": {
            "top5_prop": {"long": 0, "short": 0, "net": 0},
            "top10_prop": {"long": 0, "short": 0, "net": 0},
            "top5_all":  {"long": 0, "short": 0, "net": 0},
            "top10_all": {"long": 0, "short": 0, "net": 0},
        },
        "series": [],
    }
    from services.finmind_options import list_active_contracts
    code = f"{list_active_contracts(date.today())[0]['code']}{list_active_contracts(date.today())[0]['contract_date']}"
    resp = TestClient(app).get(f"/api/options/oi_large_traders?contract={code}")
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("no_trading_day") is True
```

- [ ] **Step 2: Run to verify failure**

```bash
cd backend
python -m pytest tests/test_options_routes.py -v
```

Expected: 6 failures (route module missing).

- [ ] **Step 3: Implement — create `backend/routes/options.py`**

```python
"""Options chip API routes."""
from __future__ import annotations

import logging
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Query

from services.finmind import get_finmind
from services.finmind_options import list_active_contracts

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_contract(contract: str) -> dict | None:
    """Match the flat ID `<code><contract_date>` (e.g. `TXO202607`) against
    the seven slots produced by list_active_contracts."""
    if not contract:
        return None
    today = date.today()
    for c in list_active_contracts(today):
        if f"{c['code']}{c['contract_date']}" == contract:
            return c
    return None


def _today_str() -> str:
    return date.today().isoformat()


def _is_zero_oi(payload: dict) -> bool:
    cur = payload.get("current", {})
    for grp in ("top5_prop", "top10_prop", "top5_all", "top10_all"):
        v = cur.get(grp, {})
        if v.get("long") or v.get("short"):
            return False
    return not payload.get("series")


@router.get("/api/options/oi_large_traders")
async def get_oi_large_traders(
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
        out = await get_finmind().fetch_oi_large_traders(c, d, refresh)
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind options OI error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected options OI error")
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
    if d == _today_str() and _is_zero_oi(out):
        out = {**out, "no_trading_day": True}
    return out


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
    except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.warning("FinMind options strike-vol error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "finmind_error"})
    except ValueError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})
    except Exception:
        logger.exception("Unexpected options strike-vol error")
        raise HTTPException(status_code=502, detail={"error": "unexpected_error"})
    if d == _today_str() and not out.get("call") and not out.get("put"):
        out = {**out, "no_trading_day": True}
    return out
```

- [ ] **Step 4: Wire router into `backend/main.py`**

Open `backend/main.py`. Two edits:

After the existing line `from routes.symbols import router as symbols_router`, add:

```python
from routes.options import router as options_router
```

After the existing line `app.include_router(symbols_router)`, add:

```python
app.include_router(options_router)
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd backend
python -m pytest tests/test_options_routes.py tests/test_finmind_options.py -v
```

Expected: all green (6 new route tests + 15 from before = 21 total in these files).

- [ ] **Step 6: Ruff + verify whole backend suite + commit**

```bash
cd backend
ruff check . && ruff check --fix .
python -m pytest -v
```

Expected: all backend tests pass (existing + new).

```bash
git add backend/routes/options.py backend/main.py backend/tests/test_options_routes.py
git commit -m "feat(options): /api/options/oi_large_traders + strike_volume routes"
```

---

## Task 7: Frontend `options-contract.ts` (TS port, parity with backend)

**Files:**
- Create: `frontend/src/lib/options-contract.ts`
- Create: `frontend/src/lib/options-contract.test.ts`

**Interfaces:**
- Consumes: backend fixture file `backend/tests/fixtures/options/contracts_2026-06-23.json` (vitest imports it directly via relative path)
- Produces: `export function listActiveContracts(today: Date): Contract[]` returning `Contract = {slot, kind, code, contractDate, label, settlement}` — note camelCase `contractDate` for TS idiom (backend uses snake_case `contract_date`)

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/options-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listActiveContracts } from "./options-contract";
import fix from "../../../backend/tests/fixtures/options/contracts_2026-06-23.json";

describe("listActiveContracts", () => {
  it("matches the backend fixture for 2026-06-23", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    const projected = items.map((i) => ({
      slot: i.slot,
      kind: i.kind,
      code: i.code,
      contract_date: i.contractDate,
      settlement: i.settlement,
    }));
    expect(projected).toEqual(fix.expected);
  });

  it("returns seven items in fixed order W1..W4, M0..M2", () => {
    const items = listActiveContracts(new Date("2026-06-23T00:00:00"));
    expect(items.map((i) => i.slot)).toEqual(
      ["W1", "W2", "W3", "W4", "M0", "M1", "M2"],
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/lib/options-contract.test.ts
```

Expected: file not found / module not found error.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/options-contract.ts`:

```ts
export type ContractKind = "weekly" | "monthly";

export interface Contract {
  slot: string;
  kind: ContractKind;
  code: string;
  contractDate: string;
  label: string;
  settlement: string;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function thirdWednesday(year: number, monthIdx0: number): Date {
  const first = new Date(year, monthIdx0, 1);
  const day = first.getDay(); // Sun=0..Sat=6
  const offset = (3 - day + 7) % 7; // Wed=3
  const firstWed = new Date(year, monthIdx0, 1 + offset);
  return new Date(year, monthIdx0, firstWed.getDate() + 14);
}

function nextWednesday(d: Date): Date {
  const day = d.getDay();
  const offset = ((3 - day + 7) % 7) || 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function listActiveContracts(today: Date): Contract[] {
  const m0Settle = thirdWednesday(today.getFullYear(), today.getMonth());
  const m0Anchor =
    today > m0Settle
      ? addMonths(new Date(today.getFullYear(), today.getMonth(), 1), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1);
  const m1Anchor = addMonths(m0Anchor, 1);
  const m2Anchor = addMonths(m0Anchor, 3);

  const monthlies: Contract[] = [
    { slot: "M0", anchor: m0Anchor },
    { slot: "M1", anchor: m1Anchor },
    { slot: "M2", anchor: m2Anchor },
  ].map(({ slot, anchor }) => {
    const sett = thirdWednesday(anchor.getFullYear(), anchor.getMonth());
    const yyyymm =
      `${anchor.getFullYear()}` +
      `${String(anchor.getMonth() + 1).padStart(2, "0")}`;
    return {
      slot,
      kind: "monthly" as const,
      code: "TXO",
      contractDate: yyyymm,
      label: `${anchor.getFullYear()}/${String(anchor.getMonth() + 1).padStart(2, "0")} 月選`,
      settlement: toISODate(sett),
    };
  });

  const monthlySetts = new Set(monthlies.map((m) => m.settlement));
  let cursor = today;
  const weeklies: Contract[] = [];
  for (let i = 1; i <= 4; i += 1) {
    let nxt = nextWednesday(cursor);
    while (monthlySetts.has(toISODate(nxt))) nxt = nextWednesday(nxt);
    const ordinal = Math.floor((nxt.getDate() - 1) / 7) + 1;
    const yyyymm =
      `${nxt.getFullYear()}` +
      `${String(nxt.getMonth() + 1).padStart(2, "0")}`;
    weeklies.push({
      slot: `W${i}`,
      kind: "weekly",
      code: `TX${i}`,
      contractDate: `${yyyymm}W${ordinal}`,
      label: `${String(nxt.getMonth() + 1).padStart(2, "0")}/${String(nxt.getDate()).padStart(2, "0")} 週選 W${i}`,
      settlement: toISODate(nxt),
    });
    cursor = nxt;
  }

  return [...weeklies, ...monthlies];
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/lib/options-contract.test.ts
```

Expected: 2 PASSED.

- [ ] **Step 5: Tsc check + commit**

```bash
cd frontend
npx tsc -b
```

Expected: 0 errors.

```bash
git add frontend/src/lib/options-contract.ts frontend/src/lib/options-contract.test.ts
git commit -m "feat(options): FE listActiveContracts (parity with backend fixture)"
```

---

## Task 8: Frontend `options-api.ts` + `options-types.ts`

**Files:**
- Create: `frontend/src/lib/options-types.ts`
- Create: `frontend/src/lib/options-api.ts`

**Interfaces:**
- Consumes: existing `get<T>()` helper in `lib/api.ts` — re-exported? **It is not exported.** We must add `optionsApi.*` methods inside `lib/options-api.ts` that call `fetch` themselves (duplicating the small client), OR export the helper. Pick the latter to stay DRY:
  - Modify `frontend/src/lib/api.ts` to additionally `export { get as __apiGet }` at module bottom
- Produces:
  - `OptionsLargeTraders`, `OptionsStrikeVolume` types in `options-types.ts`
  - `optionsApi.largeTraders(contract, date?, refresh?)` and `optionsApi.strikeVolume(contract, date?, top_n?, refresh?)`

- [ ] **Step 1: Create types file**

Create `frontend/src/lib/options-types.ts`:

```ts
export interface OILTGroup { long: number; short: number; net: number }

export interface OptionsLargeTraders {
  contract: string;
  date: string;
  fetched_at: string;
  current: {
    top5_prop:  OILTGroup;
    top10_prop: OILTGroup;
    top5_all:   OILTGroup;
    top10_all:  OILTGroup;
  };
  series: Array<{ date: string; top10_all_net: number; top10_prop_net: number }>;
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
  call: StrikeRow[];
  put:  StrikeRow[];
  no_trading_day?: boolean;
}
```

- [ ] **Step 2: Export `get` from `lib/api.ts`**

Open `frontend/src/lib/api.ts`. At the very end of the file (after the existing `export const api = {...};` block), append:

```ts
export { get as __apiGet };
```

(Underscored to mark it as internal-but-shared. No behavior change.)

- [ ] **Step 3: Create `options-api.ts`**

Create `frontend/src/lib/options-api.ts`:

```ts
import { __apiGet } from "./api";
import type { OptionsLargeTraders, OptionsStrikeVolume } from "./options-types";

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
    topN?: number,
    refresh?: boolean,
  ): Promise<OptionsStrikeVolume> {
    const params: Record<string, string> = { contract };
    if (date) params.date = date;
    if (topN != null) params.top_n = String(topN);
    if (refresh) params.refresh = "true";
    return __apiGet(`${BASE}/strike_volume`, params);
  },
};
```

- [ ] **Step 4: TSC check + commit**

```bash
cd frontend
npx tsc -b
```

Expected: 0 errors.

```bash
git add frontend/src/lib/options-types.ts frontend/src/lib/options-api.ts frontend/src/lib/api.ts
git commit -m "feat(options): FE options-api + shared types"
```

(No test file in this task — `__apiGet` is exercised by the hook tests in Tasks 9 and 10.)

---

## Task 9: `useOptionsLargeTraders` hook

**Files:**
- Create: `frontend/src/hooks/useOptionsLargeTraders.ts`
- Create: `frontend/src/hooks/useOptionsLargeTraders.test.ts`

**Interfaces:**
- Consumes: `optionsApi.largeTraders` (Task 8), `OptionsLargeTraders` type
- Produces: `useOptionsLargeTraders(contract: string, date: string) -> { data, loading, error, refresh, noTradingDay }`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/useOptionsLargeTraders.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsLargeTraders } from "./useOptionsLargeTraders";

const mockData = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  current: {
    top5_prop:  { long: 1, short: 1, net: 0 },
    top10_prop: { long: 1, short: 1, net: 0 },
    top5_all:   { long: 1, short: 1, net: 0 },
    top10_all:  { long: 1, short: 1, net: 0 },
  },
  series: [],
} as const;

beforeEach(() => vi.restoreAllMocks());

describe("useOptionsLargeTraders", () => {
  it("fires the api on mount and exposes the data", async () => {
    const spy = vi.spyOn(optionsApi, "largeTraders").mockResolvedValue(mockData);
    const { result } = renderHook(() =>
      useOptionsLargeTraders("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith("TXO202607", "2026-06-23", undefined);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "largeTraders").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useOptionsLargeTraders("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("does nothing when contract is empty", async () => {
    const spy = vi.spyOn(optionsApi, "largeTraders").mockResolvedValue(mockData);
    renderHook(() => useOptionsLargeTraders("", "2026-06-23"));
    // No await — should never be called.
    expect(spy).not.toHaveBeenCalled();
  });

  it("exposes noTradingDay flag from payload", async () => {
    vi.spyOn(optionsApi, "largeTraders").mockResolvedValue({
      ...mockData, no_trading_day: true,
    });
    const { result } = renderHook(() =>
      useOptionsLargeTraders("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.noTradingDay).toBe(true));
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/hooks/useOptionsLargeTraders.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/hooks/useOptionsLargeTraders.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { optionsApi } from "../lib/options-api";
import type { OptionsLargeTraders } from "../lib/options-types";

export function useOptionsLargeTraders(contract: string, date: string) {
  const [data, setData] = useState<OptionsLargeTraders | null>(null);
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
        const d = await optionsApi.largeTraders(contract, date, refresh);
        if (seq !== seqRef.current) return;
        setData(d);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入大戶資料失敗");
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

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/hooks/useOptionsLargeTraders.test.ts
```

Expected: 4 PASSED.

- [ ] **Step 5: TSC + commit**

```bash
cd frontend
npx tsc -b
git add frontend/src/hooks/useOptionsLargeTraders.ts frontend/src/hooks/useOptionsLargeTraders.test.ts
git commit -m "feat(options): useOptionsLargeTraders hook"
```

---

## Task 10: `useOptionsStrikeVolume` hook

**Files:**
- Create: `frontend/src/hooks/useOptionsStrikeVolume.ts`
- Create: `frontend/src/hooks/useOptionsStrikeVolume.test.ts`

**Interfaces:**
- Consumes: `optionsApi.strikeVolume`
- Produces: `useOptionsStrikeVolume(contract, date, topN=10) -> { data, loading, error, refresh, noTradingDay }`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/useOptionsStrikeVolume.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { optionsApi } from "../lib/options-api";
import { useOptionsStrikeVolume } from "./useOptionsStrikeVolume";

const mockData = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [], put: [],
};

beforeEach(() => vi.restoreAllMocks());

describe("useOptionsStrikeVolume", () => {
  it("fires the api on mount with top_n=10 by default", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    const { result } = renderHook(() =>
      useOptionsStrikeVolume("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.data).toEqual(mockData));
    expect(spy).toHaveBeenCalledWith("TXO202607", "2026-06-23", 10, undefined);
  });

  it("passes a custom topN", async () => {
    const spy = vi.spyOn(optionsApi, "strikeVolume").mockResolvedValue(mockData);
    renderHook(() => useOptionsStrikeVolume("TXO202607", "2026-06-23", 5));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][2]).toBe(5);
  });

  it("sets error on rejection", async () => {
    vi.spyOn(optionsApi, "strikeVolume").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useOptionsStrikeVolume("TXO202607", "2026-06-23"),
    );
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/hooks/useOptionsStrikeVolume.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/hooks/useOptionsStrikeVolume.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { optionsApi } from "../lib/options-api";
import type { OptionsStrikeVolume } from "../lib/options-types";

export function useOptionsStrikeVolume(
  contract: string,
  date: string,
  topN: number = 10,
) {
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
        const d = await optionsApi.strikeVolume(contract, date, topN, refresh);
        if (seq !== seqRef.current) return;
        setData(d);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "載入熱門履約價失敗");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [contract, date, topN],
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

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/hooks/useOptionsStrikeVolume.test.ts
```

Expected: 3 PASSED.

- [ ] **Step 5: TSC + commit**

```bash
cd frontend
npx tsc -b
git add frontend/src/hooks/useOptionsStrikeVolume.ts frontend/src/hooks/useOptionsStrikeVolume.test.ts
git commit -m "feat(options): useOptionsStrikeVolume hook"
```

---

## Task 11: `<ModeSwitch>` component

**Files:**
- Create: `frontend/src/components/ModeSwitch.tsx`
- Create: `frontend/src/components/ModeSwitch.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `<ModeSwitch value={mode} onChange={(m) => void} />` with two buttons 〔個股〕〔選擇權〕, active button styled per existing tab convention (`text-accent border-b-2 border-accent font-medium`)

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/ModeSwitch.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModeSwitch } from "./ModeSwitch";

describe("ModeSwitch", () => {
  it("renders both modes", () => {
    render(<ModeSwitch value="equity" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "個股" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "選擇權" })).toBeTruthy();
  });

  it("marks the active mode with aria-current=page", () => {
    render(<ModeSwitch value="options" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "選擇權" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("button", { name: "個股" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("calls onChange when the other mode is clicked", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "選擇權" }));
    expect(spy).toHaveBeenCalledWith("options");
  });

  it("does not call onChange when clicking the active mode", () => {
    const spy = vi.fn();
    render(<ModeSwitch value="equity" onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "個股" }));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/components/ModeSwitch.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/ModeSwitch.tsx`:

```tsx
import type { ReactElement } from "react";

export type Mode = "equity" | "options";

interface Props {
  value: Mode;
  onChange: (m: Mode) => void;
}

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "equity",  label: "個股"  },
  { key: "options", label: "選擇權" },
];

export function ModeSwitch({ value, onChange }: Props): ReactElement {
  return (
    <div className="shrink-0 flex border-b border-line bg-bg" role="tablist">
      {MODES.map(({ key, label }) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-current={active ? "page" : undefined}
            onClick={() => { if (!active) onChange(key); }}
            className={
              `px-5 py-2 text-sm transition-colors cursor-pointer ` +
              (active
                ? "text-accent border-b-2 border-accent font-medium"
                : "text-ink-dim hover:text-ink")
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/components/ModeSwitch.test.tsx
```

Expected: 4 PASSED.

- [ ] **Step 5: TSC + commit**

```bash
cd frontend
npx tsc -b
git add frontend/src/components/ModeSwitch.tsx frontend/src/components/ModeSwitch.test.tsx
git commit -m "feat(options): ModeSwitch component"
```

---

## Task 12: `options-chart-svg.tsx` — `<LargeTradersBars>` + `<LargeTradersTrend>`

**Files:**
- Create: `frontend/src/lib/options-chart-svg.tsx`
- Create: `frontend/src/lib/options-chart-svg.test.tsx`

**Interfaces:**
- Consumes: `OptionsLargeTraders` types from `options-types.ts`
- Produces:
  - `<LargeTradersBars current={…} width={number} height={number} />` — 4 grouped horizontal bars (long+short pairs) for top5_prop / top10_prop / top5_all / top10_all
  - `<LargeTradersTrend series={…} width={number} height={number} />` — line chart, two polylines (top10_prop_net solid, top10_all_net dashed)

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/options-chart-svg.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LargeTradersBars, LargeTradersTrend } from "./options-chart-svg";
import type { OptionsLargeTraders } from "./options-types";

const sampleCurrent: OptionsLargeTraders["current"] = {
  top5_prop:  { long: 12500, short:  8200, net:  4300 },
  top10_prop: { long: 18000, short: 11000, net:  7000 },
  top5_all:   { long: 22000, short: 17000, net:  5000 },
  top10_all:  { long: 31000, short: 24000, net:  7000 },
};

describe("LargeTradersBars", () => {
  it("renders 8 bars (one long + one short per of 4 groups)", () => {
    const { container } = render(
      <LargeTradersBars current={sampleCurrent} width={400} height={200} />,
    );
    const bars = container.querySelectorAll("[data-testid='lt-bar']");
    expect(bars.length).toBe(8);
  });

  it("renders 4 group labels", () => {
    const { container } = render(
      <LargeTradersBars current={sampleCurrent} width={400} height={200} />,
    );
    const labels = container.querySelectorAll("[data-testid='lt-label']");
    expect(labels.length).toBe(4);
  });
});

describe("LargeTradersTrend", () => {
  it("renders two polylines when series has points", () => {
    const series = [
      { date: "2026-06-20", top10_all_net: 6800, top10_prop_net: 5400 },
      { date: "2026-06-23", top10_all_net: 7000, top10_prop_net: 5500 },
    ];
    const { container } = render(
      <LargeTradersTrend series={series} width={400} height={150} />,
    );
    const lines = container.querySelectorAll("polyline");
    expect(lines.length).toBe(2);
  });

  it("renders empty state SVG with no polylines when series empty", () => {
    const { container } = render(
      <LargeTradersTrend series={[]} width={400} height={150} />,
    );
    expect(container.querySelectorAll("polyline").length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/lib/options-chart-svg.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/options-chart-svg.tsx`:

```tsx
import type { ReactElement } from "react";
import type { OptionsLargeTraders } from "./options-types";

const GROUPS: Array<{ key: keyof OptionsLargeTraders["current"]; label: string }> = [
  { key: "top5_prop",  label: "前 5 特定法人" },
  { key: "top10_prop", label: "前 10 特定法人" },
  { key: "top5_all",   label: "前 5 全交易人" },
  { key: "top10_all",  label: "前 10 全交易人" },
];

interface BarsProps {
  current: OptionsLargeTraders["current"];
  width: number;
  height: number;
}

export function LargeTradersBars({ current, width, height }: BarsProps): ReactElement {
  const max = Math.max(
    1,
    ...GROUPS.flatMap((g) => [current[g.key].long, current[g.key].short]),
  );
  const labelW = 90;
  const barAreaW = width - labelW - 8;
  const rowH = height / GROUPS.length;
  const barH = rowH * 0.35;

  return (
    <svg width={width} height={height} role="img" aria-label="大戶 OI bars">
      {GROUPS.map((g, i) => {
        const y = i * rowH + (rowH - 2 * barH - 2) / 2;
        const longW = (current[g.key].long  / max) * barAreaW;
        const shortW = (current[g.key].short / max) * barAreaW;
        return (
          <g key={g.key}>
            <text
              data-testid="lt-label"
              x={labelW - 6} y={i * rowH + rowH / 2}
              fontSize="11" textAnchor="end"
              alignmentBaseline="middle"
              className="fill-ink-muted"
            >
              {g.label}
            </text>
            <rect
              data-testid="lt-bar"
              x={labelW} y={y} width={longW} height={barH}
              className="fill-[var(--color-up,#dc2626)]"
            />
            <rect
              data-testid="lt-bar"
              x={labelW} y={y + barH + 2} width={shortW} height={barH}
              className="fill-[var(--color-down,#16a34a)]"
            />
            <text
              x={labelW + Math.max(longW, shortW) + 4}
              y={i * rowH + rowH / 2}
              fontSize="10"
              alignmentBaseline="middle"
              className="fill-ink"
            >
              {current[g.key].net.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface TrendProps {
  series: OptionsLargeTraders["series"];
  width: number;
  height: number;
}

export function LargeTradersTrend({ series, width, height }: TrendProps): ReactElement {
  if (series.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label="20 天淨額趨勢">
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="11"
              className="fill-ink-dim">無資料</text>
      </svg>
    );
  }
  const padX = 8;
  const padY = 8;
  const w = width - 2 * padX;
  const h = height - 2 * padY;
  const allNets = series.flatMap((s) => [s.top10_all_net, s.top10_prop_net]);
  const ymin = Math.min(0, ...allNets);
  const ymax = Math.max(0, ...allNets);
  const span = ymax - ymin || 1;

  const xOf = (i: number) =>
    padX + (series.length === 1 ? w / 2 : (i / (series.length - 1)) * w);
  const yOf = (v: number) =>
    padY + h - ((v - ymin) / span) * h;

  const pAll = series.map((s, i) => `${xOf(i)},${yOf(s.top10_all_net)}`).join(" ");
  const pProp = series.map((s, i) => `${xOf(i)},${yOf(s.top10_prop_net)}`).join(" ");
  const zeroY = yOf(0);

  return (
    <svg width={width} height={height} role="img" aria-label="20 天淨額趨勢">
      <line x1={padX} x2={padX + w} y1={zeroY} y2={zeroY}
            stroke="currentColor" strokeOpacity="0.2" />
      <polyline points={pAll} fill="none" strokeWidth={1}
                strokeDasharray="3 3"
                className="stroke-accent" />
      <polyline points={pProp} fill="none" strokeWidth={1.5}
                className="stroke-accent" />
    </svg>
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/lib/options-chart-svg.test.tsx
```

Expected: 4 PASSED.

- [ ] **Step 5: TSC + commit**

```bash
cd frontend
npx tsc -b
git add frontend/src/lib/options-chart-svg.tsx frontend/src/lib/options-chart-svg.test.tsx
git commit -m "feat(options): SVG primitives — LargeTradersBars + LargeTradersTrend"
```

---

## Task 13: `<OptionsLargeTradersPanel>` component

**Files:**
- Create: `frontend/src/components/OptionsLargeTradersPanel.tsx`
- Create: `frontend/src/components/OptionsLargeTradersPanel.test.tsx`

**Interfaces:**
- Consumes: `OptionsLargeTraders` type + `LargeTradersBars` + `LargeTradersTrend` + `useContainerSize` (existing hook)
- Produces: `<OptionsLargeTradersPanel data={…} loading={boolean} error={string|null} />`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/OptionsLargeTradersPanel.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OptionsLargeTradersPanel } from "./OptionsLargeTradersPanel";

const mk = () => ({
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  current: {
    top5_prop:  { long: 100, short: 50, net: 50 },
    top10_prop: { long: 200, short: 100, net: 100 },
    top5_all:   { long: 300, short: 200, net: 100 },
    top10_all:  { long: 400, short: 300, net: 100 },
  },
  series: [
    { date: "2026-06-20", top10_all_net: 80, top10_prop_net: 60 },
    { date: "2026-06-23", top10_all_net: 100, top10_prop_net: 80 },
  ],
});

describe("OptionsLargeTradersPanel", () => {
  it("shows section heading", () => {
    render(<OptionsLargeTradersPanel data={mk()} loading={false} error={null} />);
    expect(screen.getByText("大戶部位")).toBeTruthy();
  });

  it("shows error banner when error present", () => {
    render(<OptionsLargeTradersPanel data={null} loading={false} error="boom" />);
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("shows loading state when loading and no data", () => {
    render(<OptionsLargeTradersPanel data={null} loading={true} error={null} />);
    expect(screen.getByTestId("options-lt-loading")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/components/OptionsLargeTradersPanel.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/OptionsLargeTradersPanel.tsx`:

```tsx
import { useRef, type ReactElement } from "react";
import { LargeTradersBars, LargeTradersTrend } from "../lib/options-chart-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import type { OptionsLargeTraders } from "../lib/options-types";

interface Props {
  data: OptionsLargeTraders | null;
  loading: boolean;
  error: string | null;
}

export function OptionsLargeTradersPanel({ data, loading, error }: Props): ReactElement {
  const barsRef = useRef<HTMLDivElement>(null);
  const trendRef = useRef<HTMLDivElement>(null);
  const barsSize = useContainerSize(barsRef);
  const trendSize = useContainerSize(trendRef);

  return (
    <section className="h-full flex flex-col overflow-hidden border-b border-line">
      <header className="shrink-0 px-4 py-2 text-sm text-ink-muted">
        大戶部位
      </header>
      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}
      {loading && !data && (
        <div
          data-testid="options-lt-loading"
          className="flex-1 flex items-center justify-center text-ink-dim text-sm"
        >
          載入中…
        </div>
      )}
      {data && (
        <div className="flex-1 grid grid-rows-[3fr_2fr] overflow-hidden">
          <div ref={barsRef} className="overflow-hidden">
            {barsSize.width > 0 && (
              <LargeTradersBars
                current={data.current}
                width={barsSize.width}
                height={barsSize.height}
              />
            )}
          </div>
          <div ref={trendRef} className="overflow-hidden border-t border-line">
            {trendSize.width > 0 && (
              <LargeTradersTrend
                series={data.series}
                width={trendSize.width}
                height={trendSize.height}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/components/OptionsLargeTradersPanel.test.tsx
```

Expected: 3 PASSED.

- [ ] **Step 5: TSC + commit**

```bash
cd frontend
npx tsc -b
git add frontend/src/components/OptionsLargeTradersPanel.tsx frontend/src/components/OptionsLargeTradersPanel.test.tsx
git commit -m "feat(options): OptionsLargeTradersPanel"
```

---

## Task 14: `<OptionsStrikeVolumePanel>` component

**Files:**
- Create: `frontend/src/components/OptionsStrikeVolumePanel.tsx`
- Create: `frontend/src/components/OptionsStrikeVolumePanel.test.tsx`

**Interfaces:**
- Consumes: `OptionsStrikeVolume` type
- Produces: `<OptionsStrikeVolumePanel data={…} loading={boolean} error={string|null} />` — two-column table (Call left, Put right), each up to 10 rows

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/OptionsStrikeVolumePanel.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OptionsStrikeVolumePanel } from "./OptionsStrikeVolumePanel";

const data = {
  contract: "TXO202607", date: "2026-06-23", fetched_at: "x",
  call: [
    { strike: 22000, volume: 18500, oi: 35200, oi_change: 2100 },
    { strike: 22100, volume: 12100, oi: 30000, oi_change: -1400 },
  ],
  put: [
    { strike: 21500, volume: 14200, oi: 28100, oi_change: 1800 },
  ],
};

describe("OptionsStrikeVolumePanel", () => {
  it("renders the call/put columns with correct row counts", () => {
    render(<OptionsStrikeVolumePanel data={data} loading={false} error={null} />);
    expect(screen.getAllByTestId("call-row").length).toBe(2);
    expect(screen.getAllByTestId("put-row").length).toBe(1);
  });

  it("renders strike, volume, oi_change values", () => {
    render(<OptionsStrikeVolumePanel data={data} loading={false} error={null} />);
    expect(screen.getByText("22,000")).toBeTruthy();
    expect(screen.getByText("18,500")).toBeTruthy();
    expect(screen.getByText("+2,100")).toBeTruthy();
    expect(screen.getByText("−1,400")).toBeTruthy();
  });

  it("shows empty state when no data", () => {
    render(<OptionsStrikeVolumePanel data={null} loading={false} error={null} />);
    expect(screen.getByText("尚無資料")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/components/OptionsStrikeVolumePanel.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/OptionsStrikeVolumePanel.tsx`:

```tsx
import type { ReactElement } from "react";
import type { OptionsStrikeVolume, StrikeRow } from "../lib/options-types";

interface Props {
  data: OptionsStrikeVolume | null;
  loading: boolean;
  error: string | null;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtSigned(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : `−${Math.abs(n).toLocaleString()}`;
}

function Row({ row, side }: { row: StrikeRow; side: "call" | "put" }): ReactElement {
  const cls =
    row.oi_change > 0
      ? "text-[var(--color-up,#dc2626)]"
      : row.oi_change < 0
      ? "text-[var(--color-down,#16a34a)]"
      : "text-ink-muted";
  return (
    <tr data-testid={`${side}-row`} className="border-b border-line/50">
      <td className="px-3 py-1.5 text-right font-medium">{fmt(row.strike)}</td>
      <td className="px-3 py-1.5 text-right">{fmt(row.volume)}</td>
      <td className={`px-3 py-1.5 text-right ${cls}`}>{fmtSigned(row.oi_change)}</td>
    </tr>
  );
}

export function OptionsStrikeVolumePanel({ data, loading, error }: Props): ReactElement {
  return (
    <section className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 px-4 py-2 text-sm text-ink-muted">
        熱門履約價
      </header>
      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}
      {loading && !data && (
        <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
          載入中…
        </div>
      )}
      {!loading && !error && !data && (
        <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
          尚無資料
        </div>
      )}
      {data && (
        <div className="flex-1 grid grid-cols-2 gap-px bg-line overflow-auto">
          <div className="bg-bg">
            <table className="w-full text-sm">
              <thead className="text-ink-dim text-xs">
                <tr>
                  <th className="px-3 py-1 text-right">Strike</th>
                  <th className="px-3 py-1 text-right">Volume</th>
                  <th className="px-3 py-1 text-right">OI ±</th>
                </tr>
              </thead>
              <tbody>
                {data.call.map((r) => (
                  <Row key={`call-${r.strike}`} row={r} side="call" />
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-bg">
            <table className="w-full text-sm">
              <thead className="text-ink-dim text-xs">
                <tr>
                  <th className="px-3 py-1 text-right">Strike</th>
                  <th className="px-3 py-1 text-right">Volume</th>
                  <th className="px-3 py-1 text-right">OI ±</th>
                </tr>
              </thead>
              <tbody>
                {data.put.map((r) => (
                  <Row key={`put-${r.strike}`} row={r} side="put" />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/components/OptionsStrikeVolumePanel.test.tsx
```

Expected: 3 PASSED.

- [ ] **Step 5: TSC + commit**

```bash
cd frontend
npx tsc -b
git add frontend/src/components/OptionsStrikeVolumePanel.tsx frontend/src/components/OptionsStrikeVolumePanel.test.tsx
git commit -m "feat(options): OptionsStrikeVolumePanel"
```

---

## Task 15: `<OptionsHeader>` component

**Files:**
- Create: `frontend/src/components/OptionsHeader.tsx`
- Create: `frontend/src/components/OptionsHeader.test.tsx`

**Interfaces:**
- Consumes: `listActiveContracts` (Task 7), existing `<DateField>`
- Produces: `<OptionsHeader contractId, onContractChange, date, onDateChange, loading, onRefresh />` — dropdown shows the 7 active contracts (label = i.label)

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/OptionsHeader.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OptionsHeader } from "./OptionsHeader";

describe("OptionsHeader", () => {
  it("renders 7 contract options in the dropdown", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
      />,
    );
    const select = screen.getByLabelText("選擇合約") as HTMLSelectElement;
    expect(select.options.length).toBe(7);
  });

  it("fires onContractChange when a different option is picked", () => {
    const spy = vi.fn();
    render(
      <OptionsHeader
        contractId=""
        onContractChange={spy}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={false}
        onRefresh={() => {}}
      />,
    );
    const select = screen.getByLabelText("選擇合約") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[1].value } });
    expect(spy).toHaveBeenCalledWith(select.options[1].value);
  });

  it("disables the refresh button while loading", () => {
    render(
      <OptionsHeader
        contractId=""
        onContractChange={() => {}}
        date="2026-06-23"
        onDateChange={() => {}}
        loading={true}
        onRefresh={() => {}}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /重新整理/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
npx vitest run src/components/OptionsHeader.test.tsx
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/OptionsHeader.tsx`:

```tsx
import { useMemo, type ReactElement } from "react";
import { DateField } from "./ui/date-field";
import { listActiveContracts } from "../lib/options-contract";

interface Props {
  contractId: string;
  onContractChange: (id: string) => void;
  date: string;
  onDateChange: (d: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function OptionsHeader({
  contractId, onContractChange, date, onDateChange, loading, onRefresh,
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
            const id = `${c.code}${c.contractDate}`;
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
    </header>
  );
}
```

- [ ] **Step 4: Run to verify pass**

```bash
cd frontend
npx vitest run src/components/OptionsHeader.test.tsx
```

Expected: 3 PASSED.

- [ ] **Step 5: TSC + commit**

```bash
cd frontend
npx tsc -b
git add frontend/src/components/OptionsHeader.tsx frontend/src/components/OptionsHeader.test.tsx
git commit -m "feat(options): OptionsHeader (contract dropdown + date + refresh)"
```

---

## Task 16: `<OptionsPage>` + `App.tsx` integration

**Files:**
- Create: `frontend/src/components/OptionsPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: every prior frontend task
- Produces: working end-to-end view; toggling mode persists to localStorage; equity flow remains 100% unchanged

- [ ] **Step 1: Implement `OptionsPage.tsx`**

Create `frontend/src/components/OptionsPage.tsx`:

```tsx
import { useEffect, useState, type ReactElement } from "react";
import { OptionsHeader } from "./OptionsHeader";
import { OptionsLargeTradersPanel } from "./OptionsLargeTradersPanel";
import { OptionsStrikeVolumePanel } from "./OptionsStrikeVolumePanel";
import { useOptionsLargeTraders } from "../hooks/useOptionsLargeTraders";
import { useOptionsStrikeVolume } from "../hooks/useOptionsStrikeVolume";
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
  // persisted kind preference
  const kind = localStorage.getItem("opt:kind");
  const pick = list.find((c) =>
    kind === "monthly" ? c.slot === "M0" : c.slot === "W1",
  ) ?? list[0];
  return `${pick.code}${pick.contractDate}`;
}

export function OptionsPage(): ReactElement {
  const [contractId, setContractId] = useState<string>(defaultContractId);
  const [date, setDate] = useState<string>(todayStr);

  useEffect(() => {
    const found = listActiveContracts(new Date())
      .find((c) => `${c.code}${c.contractDate}` === contractId);
    if (found) localStorage.setItem("opt:kind", found.kind);
  }, [contractId]);

  const lt = useOptionsLargeTraders(contractId, date);
  const sv = useOptionsStrikeVolume(contractId, date);
  const loading = lt.loading || sv.loading;
  const refresh = () => { lt.refresh(); sv.refresh(); };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <OptionsHeader
        contractId={contractId}
        onContractChange={setContractId}
        date={date}
        onDateChange={setDate}
        loading={loading}
        onRefresh={refresh}
      />
      {(lt.noTradingDay || sv.noTradingDay) && (
        <div className="shrink-0 px-6 py-2 text-sm text-ink-dim bg-ink/[0.04] border-b border-line">
          {date} 無交易
        </div>
      )}
      <div className="flex-1 grid grid-rows-2 overflow-hidden">
        <OptionsLargeTradersPanel
          data={lt.data}
          loading={lt.loading}
          error={lt.error}
        />
        <OptionsStrikeVolumePanel
          data={sv.data}
          loading={sv.loading}
          error={sv.error}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `App.tsx` — minimal additive diff**

Open `frontend/src/App.tsx`. Two edits:

(a) At the top of the file, after the existing `lazy` import line, add:

```ts
import { ModeSwitch, type Mode } from "./components/ModeSwitch";

const OptionsPage = lazy(() =>
  import("./components/OptionsPage").then((m) => ({ default: m.OptionsPage })),
);
```

(b) Inside `App()`, before the existing `const [symbol, setSymbol] = useState("");` line, add:

```ts
const [mode, setMode] = useState<Mode>(() =>
  (localStorage.getItem("mode") as Mode) || "equity"
);
useEffect(() => { localStorage.setItem("mode", mode); }, [mode]);
```

(c) Replace the final returned JSX. Find the outermost return:

```tsx
return (
  <div className="h-full flex flex-col overflow-hidden">
    <header className="shrink-0 px-6 pt-5 pb-3 border-b border-line">
```

Wrap it so that the entire existing tree becomes the equity branch:

```tsx
return (
  <div className="h-full flex flex-col overflow-hidden">
    <ModeSwitch value={mode} onChange={setMode} />
    {mode === "equity" ? (
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="shrink-0 px-6 pt-5 pb-3 border-b border-line">
          {/* …entire existing equity header + body, unchanged… */}
        </header>
        {/* …rest of existing JSX, unchanged… */}
      </div>
    ) : (
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
            載入選擇權頁面...
          </div>
        }
      >
        <OptionsPage />
      </Suspense>
    )}
  </div>
);
```

The existing equity JSX is copied verbatim into the equity branch — do not edit any of its lines, only wrap it. The outer `<div className="h-full flex flex-col overflow-hidden">` is preserved and now hosts the `<ModeSwitch>` above the conditional branch.

- [ ] **Step 3: Verify everything together**

```bash
cd frontend
npx tsc -b
npx vitest run
```

Expected: `tsc` 0 errors; all vitest tests pass (including any existing App.test if present).

```bash
cd ../backend
python -m pytest -v
ruff check .
```

Expected: all green.

```bash
cd ../frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OptionsPage.tsx frontend/src/App.tsx
git commit -m "feat(options): OptionsPage + App mode-switch integration"
```

---

## Task 17: Real-Environment Verification (DevTools MCP)

**Files:**
- Create: `docs/superpowers/specs/2026-06-23-options-chip-verification/` (directory for screenshots)

**Interfaces:**
- Consumes: working full app
- Produces: screenshot evidence + commit

- [ ] **Step 1: Start backend + frontend dev servers**

In two separate terminals (or run in the background):

```bash
cd backend && uvicorn main:app --reload
```

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: Drive the app with Chrome DevTools MCP**

Use `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` tools to exercise these flows and take a screenshot after each, saving to `docs/superpowers/specs/2026-06-23-options-chip-verification/<NN>-<description>.png`:

1. `01-equity-default-load.png` — open `http://localhost:5173`, confirm equity mode renders unchanged
2. `02-mode-switch-to-options.png` — click 〔選擇權〕, confirm OptionsPage renders with default W1 contract
3. `03-contract-monthly-m0.png` — change dropdown to a monthly contract, confirm both panels reload
4. `04-date-prior-trading-day.png` — change date to the prior trading day, confirm both panels reload
5. `05-no-trading-day-banner.png` — set date to a Saturday, confirm grey banner "[date] 無交易" appears
6. `06-refresh-button-loading.png` — click 重新整理, confirm spinner shows in header
7. `07-mode-switch-back-equity.png` — click 〔個股〕, confirm equity flow is fully intact (symbol search, k-line, broker panel)
8. `08-localstorage-persist.png` — refresh the page (F5), confirm mode is restored
9. `09-console-clean.png` — open the Console tab, take snapshot; the screenshot must show 0 errors and 0 red warnings throughout the session

If any step shows a regression in the equity flow, STOP and investigate — the constraint "existing equity flow is untouchable" was violated.

- [ ] **Step 3: Commit screenshots**

```bash
git add docs/superpowers/specs/2026-06-23-options-chip-verification/
git commit -m "chore(options): DevTools MCP verification screenshots for options page"
```

---

## Self-Review

**Spec coverage check:**
- §1.1 O1 ModeSwitch → Task 11 ✓
- §1.1 O2 OptionsPage + OptionsHeader → Tasks 15 + 16 ✓
- §1.1 O3 Large traders OI view → Tasks 1–6 (backend), 9, 12, 13 (frontend) ✓
- §1.1 O4 Strike volume view → Tasks 1, 3, 5, 6 (backend), 10, 14 (frontend) ✓
- §2.1 endpoints → Task 6 ✓
- §2.2 dataset mapping → Tasks 4, 5 ✓
- §2.3 contract codes → Tasks 1 (BE) + 7 (FE parity) ✓
- §2.4 cache + version isolation → Task 4 (introduces `_read_cache_v` / `_write_cache_v`) ✓
- §2.5 error codes → Task 6 ✓
- §2.6 code organisation → Tasks 1, 4, 5, 6 ✓
- §2.7 Phase 0 schema validation → Task 0 ✓
- §3.1 App.tsx mode state → Task 16 ✓
- §3.2 OptionsPage layout → Task 16 ✓
- §3.3 ContractDropdown + localStorage kind persistence → Tasks 15 (header) + 16 (page) ✓
- §3.4 two hooks → Tasks 9, 10 ✓
- §3.5 LargeTradersBars visual → Task 12 ✓
- §3.6 LargeTradersTrend → Task 12 ✓
- §3.7 StrikeVolumeTable → Task 14 ✓
- §3.8 theme tokens → all FE tasks use existing tokens ✓
- §3.9 loading / error / no_trading_day states → all panels + page ✓
- §4.1 backend tests B1–B14 → coverage maps to tasks 1–6 ✓
- §4.2 frontend tests F1–F8 → coverage maps to tasks 7, 9, 10, 11, 13–15 ✓
- §4.3 verification five-step + real-env → Task 17 ✓
- §5 phasing → split is Tasks 0 / 1–13 / 14 / 17, all in one branch ✓
- §6 risks → Task 0 mitigates the schema risk; cache isolation guards version risk ✓

**Placeholder scan:** no `TBD` / `TODO` / "implement later" remain. Every code step has the actual code to write. The literal contract codes in Tasks 1 and 7 are example placeholders and the task body explicitly tells the implementer to substitute Phase-0-discovered values — this is intentional, not a placeholder, because the real values are known unknowns at plan-write time.

**Type consistency check:**
- BE returns `contract` string formed as `code + contract_date` everywhere ✓
- FE `Contract.contractDate` is camelCase, BE `contract_date` is snake_case — parity fixture (`tests/fixtures/options/contracts_2026-06-23.json`) uses `contract_date` and Task 7's projection step deliberately re-maps it; matches Task 1 fixture ✓
- `OILTGroup` shape `{long, short, net}` consistent across BE `parse_oi_large_traders` and FE types ✓
- `StrikeRow` `{strike, volume, oi, oi_change}` consistent across BE `parse_strike_volume`, FE types, FE panel ✓
- Hook return shapes (`{ data, loading, error, refresh, noTradingDay }`) consistent between Tasks 9 and 10 ✓
- `ModeSwitch` API (`value: Mode`, `onChange: (m: Mode) => void`) consistent between Task 11 component, Task 16 App.tsx usage ✓
