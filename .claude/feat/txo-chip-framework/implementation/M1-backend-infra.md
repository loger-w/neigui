# M1-backend-infra — Implementation Spec

> Module 1 of /feat `txo-chip-framework`. Phase 2 per-file spec.
> Source: design v4 (`docs/superpowers/specs/2026-06-25-txo-chip-framework-design.md`) + brainstorm (`.claude/feat/txo-chip-framework/brainstorm.md`).
> Implements foundational infrastructure ONLY. Parsers, FinMind fetch methods, routes, frontend → later modules.

## Scope

M1 delivers the foundation that every other module depends on:

1. **SC-0 schema probe** — verify 5 FinMind dataset shapes before parser implementation (R6, R9, R10)
2. **Unified `conftest.py`** — singleton reset + env + `NoOpBucket` (R8, T1, F22, F15)
3. **Trading calendar** — pure helper + I/O service (F16, I2, R9, R13)
4. **`utils.cache.delete_by_prefix`** — pattern-based invalidation primitive (N12, R12)
5. **Fixture skeleton dirs** — empty dirs (and `expected.json` placeholders) for later SC-1…SC-11 work (F15)

Out of scope for M1 (downstream modules will fill):
- `services/finmind.py::fetch_taiwan_option_daily_window` and `fetch_*` (M2)
- `services/finmind_options.py` parsers (M3)
- routes (M4), frontend (M5)
- conftest **token** constants (`CHIP_WINDOW_TD`, `NIGHT_SESSION_AVAILABLE_FROM`, `_CACHE_VERSION_OPTIONS_CHIP`) live in `services/finmind.py` (M2 owns; M1 only references them in fixture dir comments)

## SC coverage (file × SC matrix)

| File | SC-0 | SC-5 | SC-6 | SC-10 | SC-11 | Infra notes |
|---|---|---|---|---|---|---|
| `backend/tests/conftest.py` | ✓ (token env) | ✓ | ✓ | ✓ | ✓ | enables every other SC (R8) |
| `backend/tests/fixtures/options_chip/probe.py` | ✓ | — | — | — | — | one-shot probe; verifies 5 datasets (R6/R9/R10) |
| `backend/tests/fixtures/options_chip/<dir>/` | ✓ | partial | partial | — | — | dir skeleton only; payloads filled by M3 |
| `backend/utils/cache.py` | — | — | — | — | ✓ (cascade) | `delete_by_prefix` (N12); enables refresh tests in M2/M4 |
| `backend/utils/trading_calendar_helpers.py` | — | ✓ (T-1 lookup) | ✓ | — | ✓ | pure; F16 |
| `backend/services/trading_calendar.py` | ✓ (TaiwanFuturesDaily) | ✓ | ✓ | — | ✓ | I/O + 7-day cache; I2/R13 |
| `backend/tests/test_trading_calendar.py` | — | ✓ | ✓ | — | ✓ | pub-lag + CNY cluster (R9/F9-correctness) |

---

## File 1 — `backend/tests/conftest.py` (NEW)

### Purpose
Project-level pytest conftest. Centralizes:
- `FINMIND_TOKEN` env set (else `FinMindClient.__init__` raises).
- `CHIP_DATA_DIR` env redirected to `tmp_path` (avoid polluting `backend/data/cache/chip/`).
- Singleton reset for `services.finmind._client` and `services.finmind._fm_limiter` (rebuild on next `get_finmind()` / `get_finmind_rate_limiter()`).
- Opt-in `bypass_finmind_rate_limiter` fixture that swaps the rate limiter to a `NoOpBucket` for integration tests that exercise fan-outs.

Replaces module-local `_reset_singleton` autouse fixtures previously inside `test_finmind.py` / `test_finmind_options.py` (T1).

### Concrete content

```python
"""Project-level pytest conftest for backend tests.

T1+F22+F15+R8: centralises singleton reset + env vars + NoOp rate limiter.
Replaces module-local _reset_singleton autouse fixtures.
"""
from __future__ import annotations

import pytest


class NoOpBucket:
    """Test-only no-op token bucket; duck-types services.rate_limiter.TokenBucket.

    Used by ``bypass_finmind_rate_limiter`` fixture to skip throttling in
    integration tests that fan out many FinMind calls (e.g. 250-day window).
    """

    rate: float = float("inf")

    async def acquire_async(self, tokens: int = 1, timeout: float | None = None) -> bool:
        return True

    async def acquire(self, tokens: int = 1, timeout: float | None = None) -> bool:
        return True


@pytest.fixture(autouse=True)
def _reset_finmind_singleton_and_env(monkeypatch, tmp_path):
    """T1+F22+F15: unified env + singleton reset for every backend test.

    - Sets FINMIND_TOKEN so FinMindClient.__init__ does not raise.
    - Sets CHIP_DATA_DIR to tmp_path so cache writes are isolated per test.
    - Resets services.finmind._client and ._fm_limiter to None so the next
      get_finmind() / get_finmind_rate_limiter() rebuilds with the patched env.
    """
    monkeypatch.setenv("FINMIND_TOKEN", "test-token")
    monkeypatch.setenv("CHIP_DATA_DIR", str(tmp_path))
    import services.finmind as fm
    monkeypatch.setattr(fm, "_client", None)
    monkeypatch.setattr(fm, "_fm_limiter", None)


@pytest.fixture
def bypass_finmind_rate_limiter(monkeypatch):
    """Opt-in: swap rate limiter to NoOpBucket for fan-out integration tests.

    Patches services.finmind.get_finmind_rate_limiter so any code that
    constructs a new FinMindClient picks up the no-op limiter. Also re-resets
    _client so the substitution is observed on next get_finmind().

    R8: must run AFTER _reset_finmind_singleton_and_env (autouse) — which it
    does, because monkeypatch fixtures compose left-to-right by request order.
    """
    import services.finmind as fm
    monkeypatch.setattr(fm, "get_finmind_rate_limiter", lambda: NoOpBucket())
    monkeypatch.setattr(fm, "_client", None)
```

### Migration step (must happen during M1 implementation, before any new test runs)

Delete the following module-local fixtures (they will conflict with the new autouse conftest):
- `backend/tests/test_finmind.py` — any `_reset_singleton` / per-module `monkeypatch.setenv("FINMIND_TOKEN", ...)` autouse
- `backend/tests/test_finmind_options.py` — same
- `backend/tests/test_broker_history.py::client` fixture — the `monkeypatch.setenv("FINMIND_TOKEN", "test")` line is now redundant (autouse handles it); leave the `monkeypatch.setattr(...)` lines that patch specific methods. Verify all existing tests still pass after deletion.

### Dependencies
- `services.finmind._client`, `_fm_limiter` symbols (existing, lines 25 + 39)

---

## File 2 — `backend/tests/fixtures/options_chip/probe.py` (NEW)

### Purpose
One-shot SC-0 schema probe. Reads `.env FINMIND_TOKEN`, hits 5 datasets, sanitizes responses, writes one JSON per dataset under `backend/tests/fixtures/options_chip/probe/`. Not run in CI; only when fixture refresh is needed.

### Concrete content

```python
"""SC-0 schema probe: snapshot real FinMind responses for the 5 datasets
used by txo-chip-framework. Run manually to (re)populate fixtures.

Usage:
    cd backend
    python -m tests.fixtures.options_chip.probe

Writes one JSON per dataset under tests/fixtures/options_chip/probe/.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

PROBE_DIR = Path(__file__).resolve().parent / "probe"
FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data"

# Metadata keys FinMind returns that are not part of the row schema.
# Sanitized out before persisting (F16).
_SANITIZE_KEYS = ("__user", "__tier", "user_id", "api_key")


def _sanitize_row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k not in _SANITIZE_KEYS}


async def _fetch(
    client: httpx.AsyncClient,
    dataset: str,
    params: dict[str, str],
    token: str,
) -> list[dict[str, Any]]:
    full = {"dataset": dataset, "token": token, **params}
    r = await client.get(FINMIND_BASE, params=full, timeout=30.0)
    r.raise_for_status()
    payload = r.json()
    rows = payload.get("data", [])
    return [_sanitize_row(row) for row in rows]


async def main() -> None:
    load_dotenv()
    token = os.getenv("FINMIND_TOKEN", "").strip()
    if not token:
        raise SystemExit("FINMIND_TOKEN is required")
    PROBE_DIR.mkdir(parents=True, exist_ok=True)

    today = date.today()
    # 1 month of TaiwanFuturesDaily for trading_calendar + publication-latency check (F16, N6).
    fut_start = (today - timedelta(days=30)).isoformat()
    # pick a recent trading day for daily-level probes
    inst_date = (today - timedelta(days=3)).isoformat()
    opt_date = inst_date
    # 5 most recent settlements
    settle_start = (today - timedelta(days=180)).isoformat()

    targets: list[tuple[str, dict[str, str], str]] = [
        ("TaiwanOptionDaily",
         {"data_id": "TXO", "start_date": opt_date, "end_date": opt_date},
         "taiwan_option_daily.json"),
        ("TaiwanOptionInstitutionalInvestors",
         {"data_id": "TXO", "start_date": inst_date, "end_date": inst_date},
         "taiwan_option_institutional_investors.json"),
        ("TaiwanOptionInstitutionalInvestorsAfterHours",
         {"data_id": "TXO", "start_date": inst_date, "end_date": inst_date},
         "taiwan_option_institutional_investors_after_hours.json"),
        ("TaiwanOptionFinalSettlementPrice",
         {"data_id": "TXO", "start_date": settle_start, "end_date": today.isoformat()},
         "taiwan_option_final_settlement_price.json"),
        ("TaiwanFuturesDaily",
         {"data_id": "TX", "start_date": fut_start, "end_date": today.isoformat()},
         "taiwan_futures_daily.json"),
    ]

    async with httpx.AsyncClient() as client:
        for dataset, params, fname in targets:
            print(f"probing {dataset} → {fname}")
            rows = await _fetch(client, dataset, params, token)
            out = {
                "dataset": dataset,
                "params": params,
                "row_count": len(rows),
                "sample_keys": sorted(rows[0].keys()) if rows else [],
                "rows": rows[:50],  # cap fixture size (F15: ≤ 50KB target)
            }
            (PROBE_DIR / fname).write_text(
                json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    # Provenance manifest — used by SC-0 drift test (see __init__.py below).
    manifest = {
        "generated_at": today.isoformat(),
        "datasets": [t[0] for t in targets],
        "files": [t[2] for t in targets],
    }
    (PROBE_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    asyncio.run(main())
```

### Provenance
- Reads `FINMIND_TOKEN` from `.env` (existing project convention).
- Writes to `backend/tests/fixtures/options_chip/probe/<dataset>.json` + `manifest.json`.
- All later fixtures (max_pain/oi_walls/pcr/inst/settlement/tx_close) MUST reuse field names from these probe JSONs (F19; enforced by `test_probe_fixtures_match_parser_field_names` in M3).

### Dependencies
- `httpx`, `python-dotenv` (existing project deps).
- No imports from `services.*` (intentionally — keeps probe usable even when source tree is broken).

---

## File 3 — Fixture skeleton directories (NEW)

Create empty directories with a placeholder `.gitkeep` (no payload yet; M3 fills them). Spec lists them so the path layout is locked.

| Path | Purpose | Filled by |
|---|---|---|
| `backend/tests/fixtures/options_chip/probe/` | SC-0 probe outputs | `probe.py` (manual run) |
| `backend/tests/fixtures/options_chip/max_pain/` | SC-1, SC-5 inputs + `expected.json` | M3 parser tests |
| `backend/tests/fixtures/options_chip/oi_walls/` | SC-2, SC-6 inputs + `expected.json` | M3 |
| `backend/tests/fixtures/options_chip/pcr/` | SC-3, SC-7 inputs + `expected.json` | M3 |
| `backend/tests/fixtures/options_chip/inst/` | SC-4, SC-8 inputs + `expected.json` | M3 |
| `backend/tests/fixtures/options_chip/settlement/` | TaiwanOptionFinalSettlementPrice slices for SC-5/SC-6 | M3 |
| `backend/tests/fixtures/options_chip/tx_close/` | TX_close returns for SC-7/SC-8 next-day stats / correlation | M3 |
| `backend/tests/fixtures/options_chip/tx_trading_days/` | TaiwanFuturesDaily slice for `test_trading_calendar.py` | M1 (this module) |

Also add `backend/tests/fixtures/__init__.py` and `backend/tests/fixtures/options_chip/__init__.py` (empty) so pytest treats them as packages and probe.py is importable via `python -m tests.fixtures.options_chip.probe`.

### `tx_trading_days/` initial content (M1 fills this one)
Two hand-curated JSON fixtures (small, ≤ 5KB each):

- `cny_holiday_cluster.json` — TX trading days bracketing CNY 2025 (`2025-01-23..2025-02-10`), with the CNY closure gap (2025-01-25..2025-02-02 missing). Used by `test_count_back_trading_days_handles_holiday_clusters_cny`.
- `publication_lag.json` — TX trading days where `end_date` query is 2026-06-26 (Friday) but the latest available trading day in dataset is 2026-06-25 (Thursday) — simulating publication lag. Used by `test_count_back_trading_days_handles_publication_lag`.

Schema (each file):
```json
{
  "description": "...",
  "end_date_queried": "YYYY-MM-DD",
  "available_dates": ["YYYY-MM-DD", ...],
  "n": 5,
  "expected": ["YYYY-MM-DD", ...]
}
```

---

## File 4 — `backend/utils/cache.py` (MODIFY)

### Purpose
Add `delete_by_prefix(prefix: str) -> int` (N12) — the primitive that enables refresh-cascade invalidation across lookback / threshold variants in M2.

### Section to touch
Append at end of file (after `read_json`, current line 43). No other lines changed.

### Concrete addition

```python
def delete_by_prefix(prefix: str) -> int:
    """Delete every cache file under chip_cache_dir() whose stem starts with ``prefix``.

    Pattern-based invalidation primitive (design v4 N12, R12). Used by
    ``services.finmind._invalidate_dependent_parse_caches`` (M2) to invalidate
    all lookback / threshold variants of a given (contract, end_date) tuple in
    one shot. For example, prefix ``"pcr_classified_all_months_all_2026-06-25_"``
    matches ``..._lb250_h70_l30.json`` and ``..._lb250_h80_l20.json`` etc.

    Args:
        prefix: stem prefix (no directory, no ``.json`` suffix). Empty string
            is treated as "match nothing" and returns 0 — guards against
            accidental nuke of the entire cache.

    Returns:
        Number of files deleted.
    """
    if not prefix:
        return 0
    d = chip_cache_dir()
    count = 0
    for entry in d.iterdir():
        if entry.is_file() and entry.suffix == ".json" and entry.stem.startswith(prefix):
            try:
                entry.unlink()
                count += 1
            except OSError:
                # Best-effort: skip files we cannot delete (e.g., locked on Windows).
                pass
    return count
```

### Why this signature
- Returns `int` (count) — enables tests to assert "exactly N variants were deleted" (e.g., M2's `test_refresh_invalidates_dependent_pcr_keys_across_threshold_variants`).
- Guards against empty prefix — design v4 §9 §N12 says prefix invalidation must be **scoped** (max_pain key includes contract + end_date), never global.
- Skips non-`.json` files and survives locked-file errors (Windows file-handle quirks during concurrent test runs).

### Tests for `delete_by_prefix` (added to `backend/tests/test_chip_routes.py` or new `tests/test_cache.py` — pick the latter for clarity)

Add `backend/tests/test_cache.py` (NEW small file):

```python
"""Tests for utils.cache.delete_by_prefix (design v4 N12)."""
from __future__ import annotations

from pathlib import Path

from utils.cache import atomic_write_json, chip_cache_dir, delete_by_prefix


def test_delete_by_prefix_removes_matching_files(tmp_path, monkeypatch):
    # _reset_finmind_singleton_and_env already sets CHIP_DATA_DIR=tmp_path
    d = chip_cache_dir()
    atomic_write_json(d / "pcr_classified_all_months_all_2026-06-25_lb250_h70_l30.json", {"x": 1})
    atomic_write_json(d / "pcr_classified_all_months_all_2026-06-25_lb250_h80_l20.json", {"x": 2})
    atomic_write_json(d / "pcr_classified_all_months_all_2026-06-24_lb250_h70_l30.json", {"x": 3})
    atomic_write_json(d / "max_pain_TXO202607_2026-06-25_lb20.json", {"x": 4})

    n = delete_by_prefix("pcr_classified_all_months_all_2026-06-25_")
    assert n == 2
    assert not (d / "pcr_classified_all_months_all_2026-06-25_lb250_h70_l30.json").exists()
    assert not (d / "pcr_classified_all_months_all_2026-06-25_lb250_h80_l20.json").exists()
    assert (d / "pcr_classified_all_months_all_2026-06-24_lb250_h70_l30.json").exists()
    assert (d / "max_pain_TXO202607_2026-06-25_lb20.json").exists()


def test_delete_by_prefix_empty_returns_zero(tmp_path):
    n = delete_by_prefix("")
    assert n == 0


def test_delete_by_prefix_no_match_returns_zero(tmp_path):
    d = chip_cache_dir()
    atomic_write_json(d / "max_pain_TXO202607_2026-06-25_lb20.json", {"x": 1})
    n = delete_by_prefix("nonexistent_prefix_")
    assert n == 0
```

### Dependencies
- Internal: `chip_cache_dir()` (line 17 — unchanged).
- No new third-party imports.

---

## File 5 — `backend/utils/trading_calendar_helpers.py` (NEW)

### Purpose
Pure helper extracted so `services/trading_calendar.py` (I/O) is testable separately from the data-fetch path. F16 layering.

### Concrete content

```python
"""Pure helpers for trading-day arithmetic (design v4 §2.2, F16)."""
from __future__ import annotations

from datetime import date


def count_back_trading_days(
    available_dates: list[date],
    end_date: date,
    n: int,
) -> list[date]:
    """Return the ``n`` most recent available trading days ≤ ``end_date``.

    Pure function: caller (``services.trading_calendar``) supplies the
    pre-fetched sorted-ascending list of TX trading days from
    TaiwanFuturesDaily; this helper only does the windowing.

    Behaviour (R9 publication-lag tolerance):
      - If ``end_date`` is a trading day in ``available_dates`` →
        slice ending at that date (inclusive).
      - If ``end_date`` is NOT in ``available_dates`` (e.g. weekend, holiday,
        or publication lag where TaiwanFuturesDaily has not yet posted today's
        bar) → fall back to the most recent date in ``available_dates``
        that is ``< end_date``.
      - If fewer than ``n`` dates are available → return whatever is there
        (caller decides whether to set ``insufficient_data``).

    Args:
        available_dates: TX trading days sorted ascending (no duplicates).
            Must be ``date`` objects (caller does ``date.fromisoformat``).
        end_date: anchor.
        n: number of trading days to return.

    Returns:
        List of ``date`` objects sorted ascending, length ≤ n. Empty list if
        ``available_dates`` is empty or contains no date ≤ ``end_date``.

    Raises:
        ValueError: if n < 1.
    """
    if n < 1:
        raise ValueError(f"n must be >= 1, got {n}")
    if not available_dates:
        return []
    # bisect_right gives us the index of the first date strictly > end_date;
    # everything left of it is ≤ end_date and therefore eligible.
    import bisect
    idx = bisect.bisect_right(available_dates, end_date)
    if idx == 0:
        return []
    window = available_dates[max(0, idx - n):idx]
    return list(window)
```

### Notes
- Returns a fresh `list` (copy) so callers cannot mutate the cached `available_dates`.
- Uses `bisect_right` rather than linear scan → O(log n + n) where n is window size; fine for 250-element windows but consistent with project's "no premature pessimization" stance.

### Dependencies
- stdlib only (`datetime.date`, `bisect`).

---

## File 6 — `backend/services/trading_calendar.py` (NEW)

### Purpose
I/O + cache layer for the TX trading-day list. **Self-contained httpx call** — does NOT import `services.finmind.FinMindClient` (I2/R13: avoid `services.finmind ↔ services.trading_calendar` circular import). Shares the FinMind rate limiter via `services.rate_limiter` singleton accessor.

### Concrete content

```python
"""TX trading-calendar service (design v4 §2.2, I2/R13).

I/O + 7-day cache. Does NOT depend on services.finmind.FinMindClient — uses
httpx directly with the shared rate limiter to avoid a circular import
(services/finmind imports this module to orchestrate fan-outs).
"""
from __future__ import annotations

import logging
import os
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

from services.rate_limiter import TokenBucket
from utils.cache import atomic_write_json, chip_cache_dir, read_json
from utils.trading_calendar_helpers import count_back_trading_days

logger = logging.getLogger(__name__)

# Re-uses _CACHE_VERSION_OPTIONS_CHIP (defined in services/finmind.py by M2).
# M1 hard-codes the value here to avoid creating a circular import with
# services.finmind. Both modules MUST agree; any bump in finmind.py must be
# mirrored here (caught by M2's test_cache_version_options_chip_matches).
_CACHE_VERSION_OPTIONS_CHIP: int = 1

_TRADING_CAL_TTL_SEC: int = 7 * 24 * 3600  # 7 days
_TRADING_CAL_CACHE_KEY: str = "tx_trading_days_cache"
_FINMIND_BASE: str = "https://api.finmindtrade.com/api/v4/data"

# Local singleton limiter handle. We import lazily to keep this module
# importable even when services.finmind is mid-loading.
_local_limiter: TokenBucket | None = None


def _get_limiter() -> TokenBucket:
    """Return the shared FinMind rate limiter.

    Lazy-imported from services.finmind to dodge circular import. If
    services.finmind has not been imported yet, we build a fresh limiter
    here at the same rate; services.finmind's singleton accessor will
    pick this up via monkeypatch in tests.
    """
    global _local_limiter
    # Always defer to services.finmind's singleton so production code shares one bucket.
    try:
        from services.finmind import get_finmind_rate_limiter
        return get_finmind_rate_limiter()
    except ImportError:
        if _local_limiter is None:
            rate = float(os.getenv("FINMIND_RATE_LIMIT_PER_SEC", "5"))
            _local_limiter = TokenBucket(rate=rate)
        return _local_limiter


def _cache_path() -> Path:
    return chip_cache_dir() / f"{_TRADING_CAL_CACHE_KEY}.json"


def _read_cache() -> dict | None:
    """Read trading-day cache. Returns None on miss / version mismatch / TTL expiry."""
    raw = read_json(_cache_path())
    if not isinstance(raw, dict):
        return None
    if raw.get("_cache_version") != _CACHE_VERSION_OPTIONS_CHIP:
        return None
    fetched_at = raw.get("fetched_at", 0)
    if (time.time() - float(fetched_at)) > _TRADING_CAL_TTL_SEC:
        return None
    return raw


def _write_cache(dates: list[date]) -> None:
    payload = {
        "_cache_version": _CACHE_VERSION_OPTIONS_CHIP,
        "fetched_at": time.time(),
        "dates": [d.isoformat() for d in dates],
    }
    atomic_write_json(_cache_path(), payload)


async def get_trading_days(end_date: date, n: int) -> list[date]:
    """Return up to ``n`` most recent TX trading days ≤ ``end_date``.

    Cache: 7-day TTL (calendar changes very slowly; even a stale-by-6-days
    cache is correct for every query whose ``end_date`` is older than the
    cache's last entry).

    Publication-lag tolerance (R9): if ``end_date`` is not yet in
    TaiwanFuturesDaily (e.g. queried on a Friday evening before EOD upload),
    falls back to the most recent published trading day strictly before
    ``end_date``. Caller (route layer) does NOT need to know.

    Returns empty list if FinMind has no data covering the queried range.
    """
    dates = await _read_or_fetch_tx_trading_dates()
    return count_back_trading_days(dates, end_date, n)


async def _read_or_fetch_tx_trading_dates() -> list[date]:
    """Read cached TX trading days, or fetch a fresh 400-day slice from FinMind.

    Fetches a generous 400-day backstop so a single fetch covers the
    longest downstream window (CHIP_WINDOW_TD = 250 trading days ≈ 365
    calendar days plus safety margin for holidays).
    """
    cached = _read_cache()
    if cached is not None:
        return [date.fromisoformat(d) for d in cached["dates"]]

    token = os.getenv("FINMIND_TOKEN", "").strip()
    if not token:
        raise RuntimeError("FINMIND_TOKEN env var is required for trading_calendar fetch")

    limiter = _get_limiter()
    await limiter.acquire_async()

    today = date.today()
    start = today - timedelta(days=400)
    params = {
        "dataset": "TaiwanFuturesDaily",
        "data_id": "TX",
        "start_date": start.isoformat(),
        "end_date": today.isoformat(),
        "token": token,
    }
    async with httpx.AsyncClient(timeout=30.0) as cli:
        resp = await cli.get(_FINMIND_BASE, params=params)
        resp.raise_for_status()
        payload = resp.json()

    rows = payload.get("data", [])
    dates: list[date] = sorted({date.fromisoformat(row["date"]) for row in rows if "date" in row})
    _write_cache(dates)
    logger.info("trading_calendar: fetched %d TX trading days", len(dates))
    return dates
```

### Why httpx directly (I2/R13)
The natural place to call FinMind is `FinMindClient` (`services/finmind.py`). But M2's `services/finmind.py::fetch_taiwan_option_daily_window` needs to call `services.trading_calendar.get_trading_days` to fan out 250 days correctly. If `trading_calendar` re-imports `FinMindClient`, we get a circular import. By keeping `trading_calendar.py` httpx-only, we break the cycle. The cost is one duplicated 6-line `httpx.AsyncClient` snippet — acceptable per design v4 §9 R13.

### Cache version coupling
`_CACHE_VERSION_OPTIONS_CHIP` is hard-coded `1` in both `services/trading_calendar.py` (M1) and `services/finmind.py` (M2). M2 will add a test (`test_cache_version_options_chip_matches`) that asserts the two integers match — bumping one without the other is the failure mode that test guards against.

### Dependencies
- `services.rate_limiter.TokenBucket` (existing)
- `utils.cache.atomic_write_json`, `chip_cache_dir`, `read_json` (existing)
- `utils.trading_calendar_helpers.count_back_trading_days` (File 5 above)
- `httpx` (existing project dep)

---

## File 7 — `backend/tests/test_trading_calendar.py` (NEW)

### Purpose
Unit tests for `utils.trading_calendar_helpers.count_back_trading_days` (pure) AND `services.trading_calendar.get_trading_days` (I/O + cache). Covers R9 (publication lag), F9-correctness (CNY holiday cluster), cache TTL behaviour.

### Test function names (verbatim from brainstorm SC-5/SC-6/SC-11 + design v4 §6.1)

**Pure helper tests:**
1. `test_count_back_trading_days_basic_returns_n_most_recent`
2. `test_count_back_trading_days_handles_publication_lag` — (R9, brainstorm SC-5)
3. `test_count_back_trading_days_handles_holiday_clusters_cny` — (F9-correctness)
4. `test_count_back_trading_days_returns_empty_when_no_dates_le_end`
5. `test_count_back_trading_days_returns_partial_when_insufficient_history`
6. `test_count_back_trading_days_raises_on_n_lt_1`
7. `test_count_back_trading_days_does_not_mutate_input`

**I/O service tests** (use `bypass_finmind_rate_limiter` + mock httpx via `monkeypatch.setattr` on `httpx.AsyncClient`):
8. `test_get_trading_days_uses_cache_when_within_ttl`
9. `test_get_trading_days_refetches_when_cache_expired`
10. `test_get_trading_days_refetches_when_cache_version_mismatch`
11. `test_get_trading_days_raises_when_finmind_token_missing`
12. `test_get_trading_days_writes_cache_with_version_and_fetched_at`
13. `test_get_trading_days_returns_publication_lagged_fallback` — (R9 end-to-end)

### Concrete test file skeleton

```python
"""Tests for utils.trading_calendar_helpers + services.trading_calendar.

Design v4 §2.2 / §6.1 / R9 / F9-correctness / F16 / I2.
"""
from __future__ import annotations

import json
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

from utils.trading_calendar_helpers import count_back_trading_days


# ---------- Pure helper ----------

def _load_fixture(name: str) -> dict:
    p = Path(__file__).parent / "fixtures" / "options_chip" / "tx_trading_days" / name
    return json.loads(p.read_text(encoding="utf-8"))


def test_count_back_trading_days_basic_returns_n_most_recent():
    dates = [date(2026, 6, 22), date(2026, 6, 23), date(2026, 6, 24), date(2026, 6, 25)]
    result = count_back_trading_days(dates, date(2026, 6, 25), 3)
    assert result == [date(2026, 6, 23), date(2026, 6, 24), date(2026, 6, 25)]


def test_count_back_trading_days_handles_publication_lag():
    """R9: queried end_date is later than the latest available trading day."""
    fx = _load_fixture("publication_lag.json")
    available = [date.fromisoformat(d) for d in fx["available_dates"]]
    expected = [date.fromisoformat(d) for d in fx["expected"]]
    result = count_back_trading_days(
        available, date.fromisoformat(fx["end_date_queried"]), fx["n"]
    )
    assert result == expected


def test_count_back_trading_days_handles_holiday_clusters_cny():
    """F9-correctness: CNY 2025 has ~9-day gap. n=5 starting from 2025-02-10
    must reach back past the gap."""
    fx = _load_fixture("cny_holiday_cluster.json")
    available = [date.fromisoformat(d) for d in fx["available_dates"]]
    expected = [date.fromisoformat(d) for d in fx["expected"]]
    result = count_back_trading_days(
        available, date.fromisoformat(fx["end_date_queried"]), fx["n"]
    )
    assert result == expected


def test_count_back_trading_days_returns_empty_when_no_dates_le_end():
    dates = [date(2026, 6, 25), date(2026, 6, 26)]
    assert count_back_trading_days(dates, date(2026, 6, 20), 5) == []


def test_count_back_trading_days_returns_partial_when_insufficient_history():
    dates = [date(2026, 6, 24), date(2026, 6, 25)]
    result = count_back_trading_days(dates, date(2026, 6, 25), 5)
    assert result == [date(2026, 6, 24), date(2026, 6, 25)]


def test_count_back_trading_days_raises_on_n_lt_1():
    with pytest.raises(ValueError):
        count_back_trading_days([date(2026, 6, 25)], date(2026, 6, 25), 0)


def test_count_back_trading_days_does_not_mutate_input():
    dates = [date(2026, 6, 24), date(2026, 6, 25)]
    snapshot = list(dates)
    _ = count_back_trading_days(dates, date(2026, 6, 25), 5)
    assert dates == snapshot


# ---------- I/O service ----------

class _FakeResponse:
    def __init__(self, payload: dict, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError("err", request=None, response=None)

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, payload: dict, *args, **kwargs) -> None:
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        return _FakeResponse(self._payload)


def _make_payload(dates: list[date]) -> dict:
    return {"data": [{"date": d.isoformat(), "Close": 100.0} for d in dates]}


@pytest.fixture
def fake_httpx(monkeypatch):
    """Patches httpx.AsyncClient inside services.trading_calendar."""
    state = {"payload": _make_payload([date(2026, 6, 24), date(2026, 6, 25)])}

    def _factory(*args, **kwargs):
        return _FakeAsyncClient(state["payload"], *args, **kwargs)

    import services.trading_calendar as tc
    monkeypatch.setattr(tc, "httpx", type("M", (), {"AsyncClient": _factory}))
    return state


async def test_get_trading_days_uses_cache_when_within_ttl(
    bypass_finmind_rate_limiter, fake_httpx, monkeypatch
):
    from services.trading_calendar import get_trading_days
    # First call → fetches
    result1 = await get_trading_days(date(2026, 6, 25), 2)
    # Mutate payload; second call should hit cache, not new payload
    fake_httpx["payload"] = _make_payload([])
    result2 = await get_trading_days(date(2026, 6, 25), 2)
    assert result1 == result2
    assert len(result2) == 2


async def test_get_trading_days_refetches_when_cache_expired(
    bypass_finmind_rate_limiter, fake_httpx, monkeypatch
):
    import services.trading_calendar as tc
    _ = await tc.get_trading_days(date(2026, 6, 25), 2)
    # Force TTL expiry by overriding the read_cache function
    monkeypatch.setattr(tc, "_read_cache", lambda: None)
    fake_httpx["payload"] = _make_payload([date(2026, 6, 26)])
    result = await tc.get_trading_days(date(2026, 6, 26), 1)
    assert result == [date(2026, 6, 26)]


async def test_get_trading_days_refetches_when_cache_version_mismatch(
    bypass_finmind_rate_limiter, fake_httpx, monkeypatch, tmp_path
):
    from utils.cache import atomic_write_json, chip_cache_dir
    # Pre-seed cache with old version
    atomic_write_json(
        chip_cache_dir() / "tx_trading_days_cache.json",
        {"_cache_version": 0, "fetched_at": time.time(),
         "dates": ["2020-01-01"]},
    )
    from services.trading_calendar import get_trading_days
    result = await get_trading_days(date(2026, 6, 25), 2)
    # Old cache discarded, fresh fetch returned fake_httpx payload
    assert date(2026, 6, 25) in result


async def test_get_trading_days_raises_when_finmind_token_missing(
    bypass_finmind_rate_limiter, fake_httpx, monkeypatch
):
    monkeypatch.delenv("FINMIND_TOKEN", raising=False)
    from services.trading_calendar import get_trading_days
    with pytest.raises(RuntimeError, match="FINMIND_TOKEN"):
        await get_trading_days(date(2026, 6, 25), 2)


async def test_get_trading_days_writes_cache_with_version_and_fetched_at(
    bypass_finmind_rate_limiter, fake_httpx
):
    from services.trading_calendar import get_trading_days
    from utils.cache import chip_cache_dir
    _ = await get_trading_days(date(2026, 6, 25), 2)
    cache = json.loads((chip_cache_dir() / "tx_trading_days_cache.json").read_text())
    assert cache["_cache_version"] == 1
    assert "fetched_at" in cache
    assert isinstance(cache["fetched_at"], (int, float))
    assert cache["dates"] == ["2026-06-24", "2026-06-25"]


async def test_get_trading_days_returns_publication_lagged_fallback(
    bypass_finmind_rate_limiter, fake_httpx
):
    """R9: query 2026-06-26 (Friday EOD) but TaiwanFuturesDaily only has up to
    2026-06-25 yet. Service must transparently return 2026-06-25 window."""
    # fake_httpx already returns up to 2026-06-25
    from services.trading_calendar import get_trading_days
    result = await get_trading_days(date(2026, 6, 26), 2)
    assert result == [date(2026, 6, 24), date(2026, 6, 25)]
```

### Dependencies
- `backend/tests/conftest.py` (File 1) — provides `bypass_finmind_rate_limiter`, `FINMIND_TOKEN` env, isolated cache dir.
- Fixtures in `backend/tests/fixtures/options_chip/tx_trading_days/` (File 3 sub-step).
- `utils.trading_calendar_helpers` (File 5).
- `services.trading_calendar` (File 6).
- `utils.cache` (File 4 modified).

---

## Cross-reference: SC verification map

| SC | File | Verification |
|---|---|---|
| **SC-0** schema probe | `backend/tests/fixtures/options_chip/probe.py` + `probe/` dir | manual `python -m tests.fixtures.options_chip.probe` run produces 5 JSON files + `manifest.json`; M3 adds `test_probe_fixtures_match_parser_field_names` |
| **SC-5/SC-6** T-1 hit rate (foundation) | `backend/services/trading_calendar.py` + `helpers.py` | `test_count_back_trading_days_handles_publication_lag` + `test_get_trading_days_returns_publication_lagged_fallback` ensures T-1 lookup works at week boundaries |
| **SC-10** (foundation for failure-isolation) | `backend/tests/conftest.py` | `bypass_finmind_rate_limiter` fixture enables fan-out tests in M2/M4 without hitting real FinMind |
| **SC-11** warnings (cascade enablement) | `backend/utils/cache.py::delete_by_prefix` | enables M2's `test_refresh_invalidates_dependent_pcr_keys_across_threshold_variants` (N12) |

## v4 finding traceability

| v4 finding | Implementation choice |
|---|---|
| **N12** (delete_by_prefix contract) | `backend/utils/cache.py::delete_by_prefix(prefix: str) -> int` with empty-prefix guard + `.json`-only filter |
| **I2** (no circular import) | `services/trading_calendar.py` uses `httpx` directly; lazy-imports `services.finmind.get_finmind_rate_limiter` via try/except |
| **R9** (publication lag) | `count_back_trading_days` uses `bisect_right` so missing `end_date` silently falls back to most recent ≤ end_date |
| **R13** (trading_calendar layering) | `services/trading_calendar.py` does NOT import `FinMindClient` |
| **T1+F22+F15** (unified conftest) | `backend/tests/conftest.py` autouse `_reset_finmind_singleton_and_env` replaces module-local fixtures; explicit migration step listed |
| **R8** (NoOpBucket pattern) | `NoOpBucket` defined in conftest; opt-in `bypass_finmind_rate_limiter` patches both `get_finmind_rate_limiter` AND resets `_client` |
| **F16** (trading_calendar pure helper split) | `utils/trading_calendar_helpers.py` (pure) + `services/trading_calendar.py` (I/O + cache) |
| **F19** (probe scope expanded) | `probe.py` hits all 5 datasets + writes `manifest.json` for drift static check |
| **F15** (fixture size budget) | probe stores `rows[:50]` only; `tx_trading_days/` fixtures hand-curated ≤ 5KB |

## Implementation order within M1

1. `backend/utils/cache.py::delete_by_prefix` + `backend/tests/test_cache.py` (smallest, independent)
2. `backend/utils/trading_calendar_helpers.py` (pure)
3. `backend/tests/fixtures/options_chip/tx_trading_days/{cny_holiday_cluster,publication_lag}.json` (test fixtures)
4. `backend/tests/conftest.py` + migrate `test_finmind.py` / `test_finmind_options.py` / `test_broker_history.py` (verify existing tests still green — gate before proceeding)
5. `backend/services/trading_calendar.py`
6. `backend/tests/test_trading_calendar.py` (full)
7. `backend/tests/fixtures/options_chip/probe.py` + dir scaffolding (probe.py committed; do NOT run in CI; manual run when fixture refresh needed)

Each step is its own commit (CLAUDE.md §B):
- step 1 → 🟢 `feat(cache): add delete_by_prefix for prefix-scoped invalidation`
- step 2 → 🟢 `feat(trading-calendar): add pure count_back_trading_days helper`
- step 3 → 🟢 `test(trading-calendar): add CNY holiday + pub-lag fixtures`
- step 4 → 🔵 `refactor(tests): unify singleton reset + env into project conftest`
- step 5 → 🟢 `feat(trading-calendar): add I/O + 7-day cache service`
- step 6 → 🟢 `test(trading-calendar): cover pub-lag fallback + cache TTL`
- step 7 → 🟢 `feat(tests): add SC-0 schema probe for 5 FinMind datasets`

## Completion gate for M1

- `cd backend && python -m pytest -q` — all green (including `test_finmind.py` / `test_finmind_options.py` / `test_broker_history.py` after fixture migration)
- `cd backend && ruff check .` — clean
- `pyright --project backend` (basic) — clean
- Manual SC-0 probe run completes successfully against real FinMind (R10 confirmation: capture `feature_transformation` decision for M3 — institutional dataset's `call_net` semantic is daily flow vs cumulative position → record verdict in `manifest.json`)
