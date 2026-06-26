# M4-backend-routes — Implementation Spec

> Module of `/feat txo-chip-framework` (Phase 2 per-file spec).
> Cross-refs: design v4 (`docs/superpowers/specs/2026-06-25-txo-chip-framework-design.md`),
> brainstorm (`.claude/feat/txo-chip-framework/brainstorm.md`).

This module wires the 4 new `/api/options/{max_pain,oi_walls,pcr,institutional}`
endpoints into FastAPI, adds the route-layer lookback / PCR scope validation
matrix mandated by v4 N11 + N5, orchestrates `trading_calendar` BEFORE
fetching the shared TaiwanOptionDaily window (v4 I2 — avoids circular import),
and adds a global `Exception` handler in `main.py` to close the error-contract
hole (design v4 §5).

---

## 1. Constants & shared helpers (added to `backend/routes/options.py`)

Top of file (after existing imports), add:

```python
from datetime import date, timedelta

from services.finmind import CHIP_WINDOW_TD, get_finmind
from services.trading_calendar import get_trading_days
```

Module-level constants (immediately under `router = APIRouter()`):

```python
# Per design v4 §1 N11:
#   max_pain  : user-passed `lookback` is N settled contracts → reverse to
#               trading-day demand = lookback * 21 (monthly worst case).
#   oi_walls  : same monthly worst case.
#   pcr       : user-passed `lookback` already in trading days (default 250).
_MAX_PAIN_TD_PER_CONTRACT: int = 21
_OI_WALLS_TD_PER_CONTRACT: int = 21

# Default query-parameter values (single source of truth; design v4 §2.1).
_DEFAULT_MAX_PAIN_LOOKBACK: int = 20          # settled contracts
_DEFAULT_OI_WALLS_LOOKBACK: int = 20          # settled contracts
_DEFAULT_OI_WALLS_DELTA_WINDOW: int = 5       # trading days
_DEFAULT_PCR_LOOKBACK: int = 250              # trading days, N8
_DEFAULT_PCR_HIGH_PCT: float = 70.0
_DEFAULT_PCR_LOW_PCT: float = 30.0
_DEFAULT_INST_LOOKBACK: int = 60              # trading days
_DEFAULT_INST_CORR_WINDOW: int = 60           # trading days
```

New private helper (placed below `_require_contract`):

```python
def _validate_lookback_within_window(
    lookback: int,
    td_per_unit: int,
) -> None:
    """v4 N11 / R11 — guard route-level lookback against CHIP_WINDOW_TD.

    Raises HTTPException(400, detail.error="lookback_exceeds_canonical_window")
    when user-supplied lookback would exceed the canonical 250-trading-day
    window after expansion (monthly worst case for settled-contract counts).
    """
    if lookback <= 0:
        raise HTTPException(
            status_code=400,
            detail={"error": "lookback_exceeds_canonical_window"},
        )
    if lookback * td_per_unit > CHIP_WINDOW_TD:
        raise HTTPException(
            status_code=400,
            detail={"error": "lookback_exceeds_canonical_window"},
        )


def _validate_pcr_scope(scope: str, contract: str) -> None:
    """v3 §2.1 PCR validation matrix.

    - scope NOT in {per_contract, all_months} → 400 invalid_scope
    - scope=per_contract AND no contract → 400 contract_required_for_per_contract
    - scope=all_months   AND contract present → 400 contract_not_applicable_for_all_months
    Weekly per_contract path (N5) is NOT a 400 — handled inside parser /
    service layer by emitting a `data_quality_warnings` entry + `region=null`.
    """
    if scope not in ("per_contract", "all_months"):
        raise HTTPException(
            status_code=400, detail={"error": "invalid_scope"},
        )
    if scope == "per_contract" and not contract:
        raise HTTPException(
            status_code=400,
            detail={"error": "contract_required_for_per_contract"},
        )
    if scope == "all_months" and contract:
        raise HTTPException(
            status_code=400,
            detail={"error": "contract_not_applicable_for_all_months"},
        )
```

`_resolve_contract` / `_today_str` / `_is_stale_for_requested` / `_require_contract`
remain UNCHANGED — reused across the 4 new endpoints.

---

## 2. New endpoints (appended to `backend/routes/options.py`)

All 4 endpoints follow the same orchestration shape mandated by v4 I2:

```
route handler:
  1. validate contract / scope / lookback (raise HTTPException with detail.error)
  2. d = date or _today_str()
  3. end_date_obj = date.fromisoformat(d)
  4. trading_dates = await get_trading_days(end_date_obj, CHIP_WINDOW_TD)  # I2
  5. out = await get_finmind().fetch_<X>(..., trading_dates=trading_dates, ...)
  6. if _is_stale_for_requested(out, d): out = {**out, "no_trading_day": True}
  7. return out
```

The handlers raise nothing on httpx / ValueError — these are caught by the
global handlers in `main.py` (existing two + the new `Exception` handler added
in §4 below). Per design v4 §5 we keep route bodies "raise-only".

### 2.1 `GET /api/options/max_pain`

```python
@router.get("/api/options/max_pain")
async def get_max_pain(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    lookback: int = Query(default=_DEFAULT_MAX_PAIN_LOOKBACK),
) -> dict:
    c = _require_contract(contract)
    _validate_lookback_within_window(lookback, _MAX_PAIN_TD_PER_CONTRACT)
    d = date or _today_str()
    end_date_obj = _date.fromisoformat(d)
    trading_dates = await get_trading_days(end_date_obj, CHIP_WINDOW_TD)
    out = await get_finmind().fetch_max_pain(
        contract=c,
        end_date=end_date_obj,
        trading_dates=trading_dates,
        lookback=lookback,
        refresh=refresh,
    )
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out
```

(Note: `_date` is the imported `datetime.date`; we already alias it via
`from datetime import date` in the existing file. The query param shadowing
is the same pattern existing endpoints already use, so we add
`from datetime import date as _date` at top to disambiguate the
`fromisoformat` call inside the new handlers. The existing handlers continue
to use `_today_str()` which already does this internally.)

### 2.2 `GET /api/options/oi_walls`

```python
@router.get("/api/options/oi_walls")
async def get_oi_walls(
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    lookback: int = Query(default=_DEFAULT_OI_WALLS_LOOKBACK),
    delta_window: int = Query(default=_DEFAULT_OI_WALLS_DELTA_WINDOW),
) -> dict:
    c = _require_contract(contract)
    _validate_lookback_within_window(lookback, _OI_WALLS_TD_PER_CONTRACT)
    if delta_window <= 0 or delta_window > CHIP_WINDOW_TD:
        raise HTTPException(
            status_code=400,
            detail={"error": "lookback_exceeds_canonical_window"},
        )
    d = date or _today_str()
    end_date_obj = _date.fromisoformat(d)
    trading_dates = await get_trading_days(end_date_obj, CHIP_WINDOW_TD)
    out = await get_finmind().fetch_oi_walls(
        contract=c,
        end_date=end_date_obj,
        trading_dates=trading_dates,
        lookback=lookback,
        delta_window=delta_window,
        refresh=refresh,
    )
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out
```

### 2.3 `GET /api/options/pcr`

```python
@router.get("/api/options/pcr")
async def get_pcr(
    scope: str = Query(default="all_months"),
    contract: str = Query(default=""),
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    lookback: int = Query(default=_DEFAULT_PCR_LOOKBACK),
    high_pct: float = Query(default=_DEFAULT_PCR_HIGH_PCT),
    low_pct: float = Query(default=_DEFAULT_PCR_LOW_PCT),
) -> dict:
    # v3 PCR validation matrix (scope × contract):
    _validate_pcr_scope(scope, contract)

    # lookback is already in trading days for PCR; td_per_unit = 1.
    _validate_lookback_within_window(lookback, td_per_unit=1)

    # threshold sanity:
    if not (0.0 <= low_pct < high_pct <= 100.0):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_pcr_thresholds"},
        )

    # weekly-per_contract is NOT a 400 (N5): resolve contract only when
    # scope=per_contract; service layer emits payload warning + region=null.
    resolved_contract: dict | None = None
    if scope == "per_contract":
        resolved_contract = _require_contract(contract)

    d = date or _today_str()
    end_date_obj = _date.fromisoformat(d)
    trading_dates = await get_trading_days(end_date_obj, CHIP_WINDOW_TD)
    out = await get_finmind().fetch_pcr(
        scope=scope,
        contract=resolved_contract,
        end_date=end_date_obj,
        trading_dates=trading_dates,
        lookback=lookback,
        high_pct=high_pct,
        low_pct=low_pct,
        refresh=refresh,
    )
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out
```

### 2.4 `GET /api/options/institutional`

Institutional is NOT per-contract and does NOT share the 250-day option daily
window (separate dataset). It still orchestrates `get_trading_days` once so
the service can map `lookback` to actual trading days (v4 I2 keeps the
orchestration uniform):

```python
@router.get("/api/options/institutional")
async def get_institutional(
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
    lookback: int = Query(default=_DEFAULT_INST_LOOKBACK),
    corr_window: int = Query(default=_DEFAULT_INST_CORR_WINDOW),
) -> dict:
    if lookback <= 0 or lookback > CHIP_WINDOW_TD:
        raise HTTPException(
            status_code=400,
            detail={"error": "lookback_exceeds_canonical_window"},
        )
    if corr_window <= 0 or corr_window > lookback:
        raise HTTPException(
            status_code=400,
            detail={"error": "lookback_exceeds_canonical_window"},
        )
    d = date or _today_str()
    end_date_obj = _date.fromisoformat(d)
    trading_dates = await get_trading_days(end_date_obj, lookback)
    out = await get_finmind().fetch_institutional(
        end_date=end_date_obj,
        trading_dates=trading_dates,
        lookback=lookback,
        corr_window=corr_window,
        refresh=refresh,
    )
    if _is_stale_for_requested(out, d):
        out = {**out, "no_trading_day": True}
    return out
```

---

## 3. Date / contract input hardening

The 4 handlers accept `date: str` to match the legacy convention
(`fetch_strike_volume` etc.). Empty string → `_today_str()`; anything else
must be parseable by `_date.fromisoformat`. A bad date format will raise
`ValueError`, which is caught by the existing `value_error_handler` in
`main.py` and surfaces as `503 {detail: {error: <message>}}`. That matches
v4 §5 wording; **no extra try/except** in route bodies.

---

## 4. `backend/main.py` — add `Exception` handler

Append BELOW the existing two handlers (lines 67-73):

```python
@app.exception_handler(Exception)
async def _internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """v4 §5 — close the error-contract hole.

    Any unhandled exception escaping a route returns the canonical
    `{detail: {error: "internal_error"}}` envelope with 500. We log with
    `logger.exception` so the stacktrace lands in stdout for ops.

    Specific handlers (httpx.HTTPError, ValueError) above WIN — Starlette
    dispatches by exception type, most-specific first.
    """
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=500, content={"detail": {"error": "internal_error"}}
    )
```

No other change to `main.py`. The handler ordering (httpx → ValueError →
Exception) matches Starlette's exception-handler dispatch (specific types
win over `Exception`).

---

## 5. Test extensions — `backend/tests/test_options_routes.py`

### Imports / fixtures

Extend the module-level `mock_fm` fixture to also stub the 4 new service
methods. Use the existing `AsyncMock` + `patch("routes.options.get_finmind")`
pattern. ALSO patch `routes.options.get_trading_days` with a small fixed
`list[date]` (≥ 250 entries to satisfy lookback checks) so route tests do
not hit the trading-calendar service.

```python
@pytest.fixture
def mock_trading_calendar(monkeypatch):
    """Inject a deterministic trading-day list (length 250) into the route."""
    from datetime import date, timedelta
    base = date(2026, 6, 25)
    fake_days = [base - timedelta(days=i) for i in range(250)][::-1]
    async def _fake(end_date, n):
        return fake_days[-n:]
    monkeypatch.setattr("routes.options.get_trading_days", _fake)
    return fake_days
```

### 5.1 Happy-path tests (one per endpoint)

Reuse the helper that resolves a real contract via `list_active_contracts`.

```python
def test_max_pain_happy_path(mock_fm, mock_trading_calendar):
    """SC-1 + SC-5: 200 + payload echoed through."""
    # mock_fm.fetch_max_pain returns a minimal payload with as_of_date == today
    ...

def test_oi_walls_happy_path(mock_fm, mock_trading_calendar):
    """SC-2 + SC-6."""
    ...

def test_pcr_all_months_happy_path(mock_fm, mock_trading_calendar):
    """SC-3 + SC-7 — default scope all_months, no contract."""
    ...

def test_pcr_per_contract_monthly_happy_path(mock_fm, mock_trading_calendar):
    """SC-3 — scope=per_contract + monthly contract resolves successfully."""
    ...

def test_institutional_happy_path(mock_fm, mock_trading_calendar):
    """SC-4 + SC-8 — no contract param, default 60-day lookback."""
    ...
```

### 5.2 400 lookback / scope tests (SC-3, SC-10)

```python
def test_max_pain_lookback_exceeds_canonical_window_400(mock_fm):
    """v4 N11 / R11: 20 contracts × 21 td = 420 > 250 with lookback=20 monthly
    worst case. We pick lookback=15 → 315 td > 250 → 400."""
    # use lookback such that lookback * 21 > 250
    resp = TestClient(app).get(
        f"/api/options/max_pain?contract={code}&lookback=15",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "lookback_exceeds_canonical_window"

def test_oi_walls_lookback_exceeds_canonical_window_400(mock_fm):
    ...

def test_pcr_lookback_exceeds_canonical_window_400(mock_fm):
    """lookback > 250 (CHIP_WINDOW_TD) → 400."""
    resp = TestClient(app).get(
        "/api/options/pcr?scope=all_months&lookback=251",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "lookback_exceeds_canonical_window"

def test_institutional_lookback_exceeds_canonical_window_400(mock_fm):
    resp = TestClient(app).get("/api/options/institutional?lookback=300")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "lookback_exceeds_canonical_window"

def test_pcr_route_missing_contract_for_per_contract_scope_400(mock_fm):
    """Brainstorm SC-3 — verbatim test name."""
    resp = TestClient(app).get("/api/options/pcr?scope=per_contract")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "contract_required_for_per_contract"

def test_pcr_route_contract_not_applicable_for_all_months_400(mock_fm):
    """Brainstorm SC-3 — verbatim."""
    resp = TestClient(app).get(
        f"/api/options/pcr?scope=all_months&contract={code}",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "contract_not_applicable_for_all_months"

def test_pcr_route_scope_per_contract_with_invalid_contract_400(mock_fm):
    """Brainstorm SC-3 — verbatim. Invalid contract id under per_contract."""
    resp = TestClient(app).get(
        "/api/options/pcr?scope=per_contract&contract=BOGUS999999",
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "invalid_contract"

def test_pcr_route_per_contract_weekly_returns_warning_not_400(
    mock_fm, mock_trading_calendar
):
    """v3 N5 — weekly per_contract is NOT 400; warning emitted in payload."""
    # mock fetch_pcr to return data_quality_warnings containing the catalog
    # entry and region=None; assert 200 + warning string present
    ...
```

### 5.3 502 / no-trading-day / insufficient-data tests (SC-10)

```python
def test_max_pain_502_propagates_via_global_handler(monkeypatch, mock_trading_calendar):
    """httpx.HTTPError raised in service → 502 finmind_error from main.py."""
    import httpx
    svc = AsyncMock()
    svc.fetch_max_pain = AsyncMock(
        side_effect=httpx.HTTPError("boom")
    )
    monkeypatch.setattr("routes.options.get_finmind", lambda: svc)
    resp = TestClient(app).get(f"/api/options/max_pain?contract={code}")
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"] == "finmind_error"

def test_oi_walls_502_propagates(monkeypatch, mock_trading_calendar):
    ...

def test_pcr_502_propagates(monkeypatch, mock_trading_calendar):
    ...

def test_institutional_502_propagates(monkeypatch, mock_trading_calendar):
    ...

def test_max_pain_no_trading_day_when_as_of_mismatch(mock_fm, mock_trading_calendar):
    """as_of_date != requested date → no_trading_day=true added (spec §2.5)."""
    mock_fm.fetch_max_pain.return_value = {
        **mock_fm.fetch_max_pain.return_value,
        "as_of_date": "2026-06-20",  # different from today
    }
    resp = TestClient(app).get(
        f"/api/options/max_pain?contract={code}&date={_today()}",
    )
    assert resp.json()["no_trading_day"] is True

def test_oi_walls_no_trading_day(mock_fm, mock_trading_calendar):
    ...

def test_pcr_no_trading_day(mock_fm, mock_trading_calendar):
    ...

def test_institutional_no_trading_day(mock_fm, mock_trading_calendar):
    ...

def test_max_pain_insufficient_data_passthrough(mock_fm, mock_trading_calendar):
    """insufficient_data flag from parser is forwarded; 200 (not 4xx)."""
    mock_fm.fetch_max_pain.return_value["insufficient_data"] = {
        "reason": "history_lt_5", "required_days": 5,
    }
    resp = TestClient(app).get(f"/api/options/max_pain?contract={code}")
    assert resp.status_code == 200
    assert resp.json()["insufficient_data"]["reason"] == "history_lt_5"
```

### 5.4 Internal-error handler test (main.py §4)

```python
def test_internal_error_handler_returns_500_with_canonical_envelope(
    monkeypatch, mock_trading_calendar
):
    """v4 §5: bare Exception in service → 500 internal_error."""
    svc = AsyncMock()
    svc.fetch_max_pain = AsyncMock(
        side_effect=RuntimeError("unexpected"),
    )
    monkeypatch.setattr("routes.options.get_finmind", lambda: svc)
    resp = TestClient(app).get(f"/api/options/max_pain?contract={code}")
    assert resp.status_code == 500
    assert resp.json()["detail"]["error"] == "internal_error"
```

### 5.5 Trading-calendar orchestration test (v4 I2)

```python
def test_routes_call_trading_calendar_before_fetch(mock_fm, monkeypatch):
    """v4 I2: route MUST call get_trading_days first, then pass list[date]
    to fetch_max_pain. We capture the order via a sentinel."""
    calls: list[str] = []
    async def _fake_cal(end_date, n):
        calls.append("calendar")
        return [date(2026, 6, 25)]
    monkeypatch.setattr("routes.options.get_trading_days", _fake_cal)

    async def _fake_max_pain(**kwargs):
        calls.append("fetch")
        # also verify trading_dates kw passed:
        assert "trading_dates" in kwargs
        assert kwargs["trading_dates"] == [date(2026, 6, 25)]
        return {"as_of_date": _today(), "contract": "TXO202607",
                "date": _today(), "fetched_at": "x"}
    mock_fm.fetch_max_pain = AsyncMock(side_effect=_fake_max_pain)

    TestClient(app).get(f"/api/options/max_pain?contract={code}")
    assert calls == ["calendar", "fetch"]
```

### 5.6 Test name index (verbatim where brainstorm pins them)

| Test fn name (this module) | SC | Notes |
|---|---|---|
| `test_max_pain_happy_path` | SC-1, SC-5 | new |
| `test_oi_walls_happy_path` | SC-2, SC-6 | new |
| `test_pcr_all_months_happy_path` | SC-3, SC-7 | new |
| `test_pcr_per_contract_monthly_happy_path` | SC-3 | new |
| `test_institutional_happy_path` | SC-4, SC-8 | new |
| `test_max_pain_lookback_exceeds_canonical_window_400` | SC-1 (v4 N11) | new |
| `test_oi_walls_lookback_exceeds_canonical_window_400` | SC-2 (v4 N11) | new |
| `test_pcr_lookback_exceeds_canonical_window_400` | SC-3 (v4 N11) | new |
| `test_institutional_lookback_exceeds_canonical_window_400` | SC-4 (v4 N11) | new |
| `test_pcr_route_missing_contract_for_per_contract_scope_400` | SC-3 | brainstorm verbatim |
| `test_pcr_route_contract_not_applicable_for_all_months_400` | SC-3 | brainstorm verbatim |
| `test_pcr_route_scope_per_contract_with_invalid_contract_400` | SC-3 | brainstorm verbatim |
| `test_pcr_route_per_contract_weekly_returns_warning_not_400` | SC-3, SC-11 (N5) | brainstorm verbatim |
| `test_max_pain_502_propagates_via_global_handler` | SC-10 | new |
| `test_oi_walls_502_propagates` | SC-10 | new |
| `test_pcr_502_propagates` | SC-10 | new |
| `test_institutional_502_propagates` | SC-10 | new |
| `test_max_pain_no_trading_day_when_as_of_mismatch` | SC-10 | new |
| `test_oi_walls_no_trading_day` | SC-10 | new |
| `test_pcr_no_trading_day` | SC-10 | new |
| `test_institutional_no_trading_day` | SC-10 | new |
| `test_max_pain_insufficient_data_passthrough` | SC-10, SC-11 | new |
| `test_internal_error_handler_returns_500_with_canonical_envelope` | SC-10 (v4 §5) | new |
| `test_routes_call_trading_calendar_before_fetch` | v4 I2 | new (orchestration order) |

All tests use the project-level `backend/tests/conftest.py` fixtures
(`_reset_finmind_singleton_and_env` autouse, plus the local
`mock_trading_calendar` defined above).

---

## 6. Dependencies on other modules

| Symbol | Provided by module |
|---|---|
| `CHIP_WINDOW_TD: int = 250` | M2-services-finmind (`services/finmind.py`) |
| `get_finmind()` | existing (`services/finmind.py`) |
| `fetch_max_pain` / `fetch_oi_walls` / `fetch_pcr` / `fetch_institutional` (async, kw-only signature shown in §2) | M2-services-finmind |
| `get_trading_days(end_date: date, n: int) -> list[date]` | M1-trading-calendar (`services/trading_calendar.py`) |
| Global `httpx.HTTPError` / `ValueError` handlers | existing (`main.py`) |

Tests additionally depend on:
- `list_active_contracts` (existing `services/finmind_options.py`) for resolving a real contract id without hitting FinMind.
- `backend/tests/conftest.py` autouse `_reset_finmind_singleton_and_env`.

---

## 7. SC coverage matrix

| File | SC-0 | SC-1 | SC-2 | SC-3 | SC-4 | SC-5 | SC-6 | SC-7 | SC-8 | SC-9 | SC-10 | SC-10b | SC-11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `backend/routes/options.py` (extend) | – | route | route | route + N5 warning passthrough | route | passthrough | passthrough | passthrough | passthrough | – | 502/4xx/no_trading_day | – | warnings passthrough |
| `backend/main.py` (extend) | – | – | – | – | – | – | – | – | – | – | 500 internal_error | – | – |
| `backend/tests/test_options_routes.py` (extend) | – | happy + lookback 400 | happy + lookback 400 | happy ×2 + 3×scope 400 + lookback 400 + weekly warning 200 | happy + lookback 400 | happy | happy | happy | happy | – | 502 ×4, no_trading_day ×4, insufficient_data, internal_error 500 | – | weekly warning |

(SC-9 / SC-10b are frontend-only; SC-0 is the probe step in M0.)

---

## 8. Implementation notes / pitfalls

- **Param name collision**: existing endpoints already do `date: str = Query(...)`
  even though `from datetime import date` is at module top. Inside the
  handler, we need `datetime.date.fromisoformat(d)` — add
  `from datetime import date as _date` to the imports and use `_date.fromisoformat`.
- **Raise-only routes**: every error path is `HTTPException` or "let it
  bubble". No `try/except` in route bodies (CLAUDE.md rule + v4 §5).
- **Lookback ≤ 0 also 400**: catches negative / zero via the same error code.
  This is intentional (one error code per class; frontend just renders the
  same warning).
- **PCR threshold validation**: design v4 §2.1 says `high_pct=70 / low_pct=30`
  defaults but doesn't pin error code for bad thresholds. We use a new
  `invalid_pcr_thresholds` code — frontend can show generic "參數錯誤" if
  it doesn't recognise it.
- **Institutional `corr_window > lookback`**: rejected with the same
  `lookback_exceeds_canonical_window` code (it's logically the same class of
  "user demanded more than the canonical window can deliver"). Avoids
  proliferating error codes.
- **Stale-mock pattern**: `_is_stale_for_requested` is reused unchanged —
  the existing helper already encodes spec §2.5 semantics.

---

## 9. Out-of-scope reminders (won't touch in M4)

- Parsers / cache invalidation / `delete_by_prefix` → M2 / M3.
- TanStack Query / hooks / cards → M5-M7 frontend.
- DevTools MCP screenshots (SC-9) → after frontend lands.
