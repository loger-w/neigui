# M2 — Backend fetch + cache (`services/finmind.py` extension)

> Phase 2 per-file implementation spec for `txo-chip-framework`. Source: design v4 §2.2 / §3 / §6.1; brainstorm SC-1..SC-11 / SC-0 (M1 covers).
> Scope: shared 250-td canonical window fetch on `FinMindClient` + 4 per-card fetchers + `delete_by_prefix` cache invalidation + tests.

---

## 1. Module overview

This module wires the inner core of the chip pipeline:

- **`fetch_taiwan_option_daily_window`** — single shared FinMind `TaiwanOptionDaily` fan-out, fixed `N = CHIP_WINDOW_TD = 250` trading days. Route layer injects `trading_dates: list[date]` (I2 — avoids circular import with `services/trading_calendar.py`).
- **`fetch_max_pain` / `fetch_oi_walls` / `fetch_pcr` / `fetch_institutional`** — per-card fetch methods. The first three slice the shared 250-td window; `fetch_institutional` has its own dataset path (`TaiwanOptionInstitutionalInvestors` + `…AfterHours`), no shared window dependency.
- **Inflight dedup (I1)**: every method is wrapped in `_run_once(...)`; *invalidation* of dependent parse-caches happens **inside** the dedup'd coroutine, after the lock is taken, only when cache miss/`refresh=True`. Concurrent refreshes share one invalidate-then-fetch task — no thrash.
- **Prefix-based cache invalidation (N12)**: when the shared window is re-fetched, dependent `max_pain_*` / `oi_walls_*` / `pcr_series_*` / `pcr_classified_*` cache files for that `end_date` are deleted by *prefix*, so all `lookback`/`delta_window`/`high`/`low` variants drop together.
- **Cache versioning (F21)**: all new keys use `_CACHE_VERSION_OPTIONS_CHIP = 1`. Existing `_CACHE_VERSION_OPTIONS` keys (oi_lt / strike_vol / spot) are untouched.

Parser implementations themselves (`parse_max_pain`, `parse_oi_walls`, `parse_pcr_history`, `parse_pcr_walk_forward_percentile`, `parse_pcr_next_day_stats`, `parse_institutional`, `parse_institutional_correlation`) are out of scope for M2 — they live in `services/finmind_options.py` (module **M3**). M2 calls them by import.

---

## 2. Files to modify

### 2.1 `backend/services/finmind.py` (EXTEND)

#### 2.1.1 Module-level constants (add near top, just below `_CACHE_VERSION = 3`)

```python
# Canonical TaiwanOptionDaily window shared by Max Pain / OI Walls / PCR card fetchers.
# Design v4 §1 invariant N11: max(all_downstream_lookback_td_demands) <= CHIP_WINDOW_TD.
CHIP_WINDOW_TD: int = 250

# Settle-data lookup cap for fetch_max_pain / fetch_oi_walls hit-rate evaluation:
# brainstorm SC-5/SC-6 fix history to last 20 settled contracts.
HIT_RATE_MAX_CONTRACTS: int = 20
```

Note: `_CACHE_VERSION_OPTIONS_CHIP = 1` is owned by `services/finmind_options.py` (M3). M2 imports it lazily inside method bodies (same pattern as the existing `fetch_oi_large_traders`/`fetch_strike_volume`/`fetch_spot` methods at lines 414, 491, 538), not at module-level — keeps the file decoupled and matches the existing convention.

#### 2.1.2 New `FinMindClient` methods — append after `fetch_spot` (after line 572)

All new methods follow the existing `fetch_X → _run_once(...) → _do_fetch_X` pattern (lines 124–137, 171–183, 213–249, 404–427, 481–504, 537–549). Type hints exhaustive per CLAUDE.md §2.

##### `fetch_taiwan_option_daily_window`

```python
async def fetch_taiwan_option_daily_window(
    self,
    trading_dates: list[date],
    end_date: date,
    refresh: bool = False,
) -> dict[str, list[dict]]:
    """Shared 250-td TaiwanOptionDaily fan-out.

    Design v4 §1 / §2.2 / I1 / I2 / F17 / N12:
      - trading_dates injected by route layer (avoids services/finmind <->
        trading_calendar circular import). Route already ran
        get_trading_days(end_date, CHIP_WINDOW_TD).
      - len(trading_dates) <= CHIP_WINDOW_TD; usually exactly 250 (route
        truncates / pads, this layer does NOT recompute).
      - Wrapped in _run_once so concurrent cold-start requests fan out once.
      - Invalidation of dependent parse-caches happens INSIDE _do_fetch_window
        (after dedup lock, before fan-out) when cache miss / refresh=True.
        cache hit + refresh=False = NO write, NO invalidation (avoids thrash).
      - Return shape: {iso_date: [raw_rows_for_that_day, ...]} keyed by ISO
        date string (cache JSON cannot store date objects; downstream parsers
        accept either).

    NB: `data_id` is NOT pinned — TaiwanOptionDaily fan-out is across the
    whole option universe per day; per-contract slicing happens in parsers.
    """
    cache_key: str = f"txo_daily_window_{end_date.isoformat()}_td{CHIP_WINDOW_TD}"
    return await self._run_once(
        f"window_{cache_key}",
        lambda: self._do_fetch_window(cache_key, trading_dates, end_date, refresh),
    )
```

##### `_do_fetch_window`

```python
async def _do_fetch_window(
    self,
    cache_key: str,
    trading_dates: list[date],
    end_date: date,
    refresh: bool,
) -> dict[str, list[dict]]:
    """I1: cache-check + invalidation are both INSIDE _run_once coroutine.

    Order matters:
      1. read shared-window cache; if hit and not refresh -> early-return
         (NO downstream invalidation; payload still valid).
      2. on miss/refresh:
           a. invalidate downstream parse caches (max_pain_*, oi_walls_*,
              pcr_series_*, pcr_classified_* for this end_date) via
              utils.cache.delete_by_prefix — covers all lookback / dw /
              high / low variants in one sweep (N12).
           b. fan out one FinMind call per trading_date (token bucket
              serialises across the whole client; safe to use
              asyncio.gather).
           c. write the shared-window cache.
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

    if not refresh:
        cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
        if cached is not None:
            return cached["data"]

    await self._invalidate_dependent_parse_caches(end_date, contract=None)

    async def _fetch_one(d: date) -> tuple[str, list[dict]]:
        try:
            rows = await self._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanOptionDaily",
                    "start_date": d.isoformat(),
                    "end_date": d.isoformat(),
                },
            )
            return d.isoformat(), rows
        except httpx.HTTPError as exc:
            logger.warning(
                "TaiwanOptionDaily fetch failed for %s: %s", d.isoformat(), exc,
            )
            return d.isoformat(), []

    batches = await asyncio.gather(*[_fetch_one(d) for d in trading_dates])
    by_date: dict[str, list[dict]] = {iso: rows for iso, rows in batches}

    payload: dict = {
        "end_date": end_date.isoformat(),
        "td": CHIP_WINDOW_TD,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "data": by_date,
    }
    self._write_cache_v(cache_key, payload, _CACHE_VERSION_OPTIONS_CHIP)
    return by_date
```

##### `_invalidate_dependent_parse_caches`

```python
async def _invalidate_dependent_parse_caches(
    self,
    end_date: date,
    contract: str | None,
) -> None:
    """Design v4 §2.2 / N12.

    Prefix list (all keys created by fetch_max_pain / fetch_oi_walls /
    fetch_pcr) when contract is set, else market-wide (PCR scope=all_months
    + institutional). delete_by_prefix returns the count for logging.

    When contract is None we sweep ALL contracts for this end_date — the
    correct behavior when the shared window itself is invalidated.

    Run inside _do_fetch_window AFTER dedup lock + BEFORE fan-out (I1):
    only refetchers reach this branch, parallel refreshes share the same
    invalidate-then-fetch task.
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP  # noqa: F401
    from utils.cache import chip_cache_dir, delete_by_prefix

    end_iso = end_date.isoformat()
    if contract is None:
        # Shared-window refresh — sweep all variants for this end_date.
        prefixes: list[str] = [
            f"max_pain_",
            f"oi_walls_",
            f"pcr_series_",
            f"pcr_classified_",
        ]
        # narrow each to the end_date segment to avoid nuking other days
        # (each parse-cache key is "<kind>_..._<end_iso>_<variant>").
        cache_root = chip_cache_dir()
        total = 0
        for pfx in prefixes:
            # Iterate files; delete only those whose name contains end_iso.
            total += delete_by_prefix(cache_root, pfx, contains=end_iso)
        logger.info(
            "Invalidated %d dependent parse caches (end_date=%s, contract=*)",
            total, end_iso,
        )
        return

    cache_root = chip_cache_dir()
    prefixes_with_contract: list[str] = [
        f"max_pain_{contract}_{end_iso}_",
        f"oi_walls_{contract}_{end_iso}_",
        f"pcr_series_per_contract_{contract}_{end_iso}_",
        f"pcr_classified_per_contract_{contract}_{end_iso}_",
    ]
    total = sum(delete_by_prefix(cache_root, pfx) for pfx in prefixes_with_contract)
    logger.info(
        "Invalidated %d dependent parse caches (end_date=%s, contract=%s)",
        total, end_iso, contract,
    )
```

##### `fetch_max_pain`

```python
async def fetch_max_pain(
    self,
    contract: str,
    end_date: date,
    trading_dates: list[date],
    lookback: int = 20,
    refresh: bool = False,
) -> dict:
    """Slice shared window + run parse_max_pain + parse_max_pain_hit_rate.

    Design v4 §2.1 / §2.2 / N11:
      contract: flat contract id e.g. "TXO202607" or "TXO202607W2".
      lookback: number of settled contracts to evaluate for hit_rate
                (already validated <= CHIP_WINDOW_TD in route layer).
      Route is responsible for get_trading_days(end_date, CHIP_WINDOW_TD)
      and passing both end_date + trading_dates.

    Cache key: max_pain_{contract}_{end_iso}_lb{lookback} (version CHIP).
    refresh=True causes shared-window invalidation cascade (N12) via
    _do_fetch_window; downstream caches with this contract+end_date drop
    too.
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

    end_iso = end_date.isoformat()
    cache_key: str = f"max_pain_{contract}_{end_iso}_lb{lookback}"
    if not refresh:
        cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
        if cached is not None:
            return cached

    return await self._run_once(
        f"max_pain_{cache_key}",
        lambda: self._do_fetch_max_pain(
            contract, end_date, trading_dates, lookback, cache_key, refresh,
        ),
    )


async def _do_fetch_max_pain(
    self,
    contract: str,
    end_date: date,
    trading_dates: list[date],
    lookback: int,
    cache_key: str,
    refresh: bool,
) -> dict:
    from services.finmind_options import (
        _CACHE_VERSION_OPTIONS_CHIP,
        parse_max_pain,
        parse_max_pain_hit_rate,
    )

    by_date = await self.fetch_taiwan_option_daily_window(
        trading_dates, end_date, refresh=refresh,
    )
    today_rows: list[dict] = by_date.get(end_date.isoformat(), [])
    current, current_warnings = parse_max_pain(today_rows, contract_date=_strip_id(contract))
    hit_rate, latest_pending, hit_warnings = parse_max_pain_hit_rate(
        by_date, contract_root=_root_id(contract), lookback=lookback,
    )
    result: dict = {
        "contract": contract,
        "date": end_date.isoformat(),
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "as_of_date": end_date.isoformat(),
        "current": current,
        "hit_rate": hit_rate,
        "latest_settlement_pending": latest_pending,
        "data_quality_warnings": [*current_warnings, *hit_warnings],
    }
    self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS_CHIP)
    return result
```

`_strip_id(contract)` / `_root_id(contract)` are module-level helpers (placed in pure data-transform section after line 660) returning `contract_date` (e.g. `"202607"`) and the option root (e.g. `"TXO"`) respectively. These match the existing `f"{contract['option_id']}{contract['contract_date']}"` flatten convention (line 416). Bodies:

```python
def _root_id(contract_id: str) -> str:
    """`TXO202607` -> `TXO`; `TXO202607W2` -> `TXO`."""
    # contract_date is YYYYMM(±W#); root is the alphabetic prefix.
    for i, ch in enumerate(contract_id):
        if ch.isdigit():
            return contract_id[:i]
    return contract_id


def _strip_id(contract_id: str) -> str:
    """`TXO202607` -> `202607`; `TXO202607W2` -> `202607W2`."""
    return contract_id[len(_root_id(contract_id)):]
```

##### `fetch_oi_walls`

```python
async def fetch_oi_walls(
    self,
    contract: str,
    end_date: date,
    trading_dates: list[date],
    lookback: int = 20,
    delta_window: int = 5,
    refresh: bool = False,
) -> dict:
    """Slice shared window + parse_oi_walls (static + dynamic per N4/N13) +
    parse_oi_walls_hit_rate.

    delta_window: trading days for dynamic_wall activity computation.
    Cache key: oi_walls_{contract}_{end_iso}_lb{lookback}_dw{delta_window}.
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

    end_iso = end_date.isoformat()
    cache_key: str = (
        f"oi_walls_{contract}_{end_iso}_lb{lookback}_dw{delta_window}"
    )
    if not refresh:
        cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
        if cached is not None:
            return cached

    return await self._run_once(
        f"oi_walls_{cache_key}",
        lambda: self._do_fetch_oi_walls(
            contract, end_date, trading_dates, lookback, delta_window,
            cache_key, refresh,
        ),
    )


async def _do_fetch_oi_walls(
    self,
    contract: str,
    end_date: date,
    trading_dates: list[date],
    lookback: int,
    delta_window: int,
    cache_key: str,
    refresh: bool,
) -> dict:
    from services.finmind_options import (
        _CACHE_VERSION_OPTIONS_CHIP,
        parse_oi_walls,
        parse_oi_walls_hit_rate,
    )

    by_date = await self.fetch_taiwan_option_daily_window(
        trading_dates, end_date, refresh=refresh,
    )
    spot_payload = await self.fetch_spot(end_date.isoformat(), refresh=refresh)
    spot: float = float(spot_payload.get("spot", 0.0))

    rows_today: list[dict] = by_date.get(end_date.isoformat(), [])
    # last `delta_window` trading days INCLUDING end_date (parser slices)
    window_dates: list[date] = trading_dates[-delta_window:]
    rows_history: list[list[dict]] = [
        by_date.get(d.isoformat(), []) for d in window_dates
    ]
    current, current_warnings = parse_oi_walls(
        rows_today=rows_today,
        rows_history=rows_history,
        contract_date=_strip_id(contract),
        delta_window=delta_window,
        spot=spot,
    )
    hit_rate, latest_pending, hit_warnings = parse_oi_walls_hit_rate(
        by_date, contract_root=_root_id(contract), lookback=lookback,
    )
    result: dict = {
        "contract": contract,
        "date": end_date.isoformat(),
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "as_of_date": end_date.isoformat(),
        "current": current,
        "hit_rate": hit_rate,
        "latest_settlement_pending": latest_pending,
        "data_quality_warnings": [*current_warnings, *hit_warnings],
    }
    self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS_CHIP)
    return result
```

##### `fetch_pcr`

```python
async def fetch_pcr(
    self,
    end_date: date,
    trading_dates: list[date],
    scope: str = "all_months",
    contract: str | None = None,
    lookback: int = 250,
    high_pct: float = 70.0,
    low_pct: float = 30.0,
    refresh: bool = False,
) -> dict:
    """Two-tier cache (N10):
      pcr_series_{scope}_{contract or 'all'}_{end_iso}_lb{lookback}
         -> threshold-INDEPENDENT (history of (date, pcr))
      pcr_classified_{scope}_{contract or 'all'}_{end_iso}_lb{lookback}_h{h}_l{l}
         -> threshold-DEPENDENT (classified + next_day_stats)

    Series cache survives threshold changes; classified cache is per
    (high, low) pair. Both versioned CHIP. Refresh invalidates both
    via delete_by_prefix.
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

    end_iso = end_date.isoformat()
    contract_segment: str = contract if contract is not None else "all"
    series_key: str = (
        f"pcr_series_{scope}_{contract_segment}_{end_iso}_lb{lookback}"
    )
    classified_key: str = (
        f"pcr_classified_{scope}_{contract_segment}_{end_iso}_"
        f"lb{lookback}_h{int(high_pct)}_l{int(low_pct)}"
    )
    if not refresh:
        cached = self._read_cache_v(classified_key, _CACHE_VERSION_OPTIONS_CHIP)
        if cached is not None:
            return cached

    return await self._run_once(
        f"pcr_{classified_key}",
        lambda: self._do_fetch_pcr(
            end_date, trading_dates, scope, contract, lookback,
            high_pct, low_pct, series_key, classified_key, refresh,
        ),
    )


async def _do_fetch_pcr(
    self,
    end_date: date,
    trading_dates: list[date],
    scope: str,
    contract: str | None,
    lookback: int,
    high_pct: float,
    low_pct: float,
    series_key: str,
    classified_key: str,
    refresh: bool,
) -> dict:
    from services.finmind_options import (
        _CACHE_VERSION_OPTIONS_CHIP,
        parse_pcr_history,
        parse_pcr_walk_forward_percentile,
        parse_pcr_next_day_stats,
    )

    # Per-contract weekly -> emit warning + null region (N5). Decided in
    # route layer; here we just honor it via parse_pcr_history short-circuit.

    by_date = await self.fetch_taiwan_option_daily_window(
        trading_dates, end_date, refresh=refresh,
    )

    # Series tier (threshold-independent).
    series_cached = (
        None if refresh
        else self._read_cache_v(series_key, _CACHE_VERSION_OPTIONS_CHIP)
    )
    if series_cached is not None:
        pcr_history: list[tuple[str, float]] = [
            (row["date"], float(row["pcr"])) for row in series_cached["pcr_history"]
        ]
        series_warnings: list[str] = list(series_cached.get("warnings", []))
    else:
        pcr_history, series_warnings = parse_pcr_history(
            by_date, scope=scope, contract=contract, lookback=lookback,
        )
        self._write_cache_v(
            series_key,
            {
                "pcr_history": [{"date": d, "pcr": p} for d, p in pcr_history],
                "warnings": series_warnings,
                "fetched_at": datetime.now().isoformat(timespec="seconds"),
            },
            _CACHE_VERSION_OPTIONS_CHIP,
        )

    # Classified tier (threshold-dependent).
    classified, wf_warnings = parse_pcr_walk_forward_percentile(
        pcr_history, high_pct=high_pct, low_pct=low_pct,
    )

    # next-day stats need TX close returns; fetch once per end_date.
    tx_returns: dict[str, float] = await self._fetch_tx_returns(
        trading_dates, refresh=refresh,
    )
    next_day_stats, stats_warnings = parse_pcr_next_day_stats(
        classified, tx_returns,
    )

    current: dict = _pcr_current_from_classified(classified, high_pct, low_pct)
    result: dict = {
        "date": end_date.isoformat(),
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "as_of_date": end_date.isoformat(),
        "scope": scope,
        "contract": contract,
        "current": current,
        "next_day_stats": next_day_stats,
        "data_quality_warnings": [
            *series_warnings, *wf_warnings, *stats_warnings,
        ],
    }
    self._write_cache_v(classified_key, result, _CACHE_VERSION_OPTIONS_CHIP)
    return result
```

##### `fetch_institutional`

```python
async def fetch_institutional(
    self,
    end_date: date,
    trading_dates: list[date],
    lookback: int = 60,
    corr_window: int = 60,
    refresh: bool = False,
) -> dict:
    """Independent fetch path (NOT slice of shared 250-td window).

    Datasets:
      TaiwanOptionInstitutionalInvestors (day session)
      TaiwanOptionInstitutionalInvestorsAfterHours (since 2021-10-13)
      TaiwanFuturesDaily TX (for next-day returns -> correlation)

    Cache key: institutional_{end_iso}_lb{lookback}_cw{corr_window}.
    Refresh does NOT cascade to shared-window cache (resources independent).
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

    end_iso = end_date.isoformat()
    cache_key: str = (
        f"institutional_{end_iso}_lb{lookback}_cw{corr_window}"
    )
    if not refresh:
        cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
        if cached is not None:
            return cached

    return await self._run_once(
        f"inst_{cache_key}",
        lambda: self._do_fetch_institutional(
            end_date, trading_dates, lookback, corr_window, cache_key, refresh,
        ),
    )


async def _do_fetch_institutional(
    self,
    end_date: date,
    trading_dates: list[date],
    lookback: int,
    corr_window: int,
    cache_key: str,
    refresh: bool,
) -> dict:
    from services.finmind_options import (
        _CACHE_VERSION_OPTIONS_CHIP,
        NIGHT_SESSION_AVAILABLE_FROM,
        parse_institutional,
        parse_institutional_correlation,
    )

    window_dates: list[date] = trading_dates[-lookback:]
    start_iso: str = window_dates[0].isoformat()
    end_iso: str = end_date.isoformat()

    async def _fetch_day_session() -> list[dict]:
        return await self._get(
            f"{_FINMIND_BASE}/data",
            {
                "dataset": "TaiwanOptionInstitutionalInvestors",
                "start_date": start_iso,
                "end_date": end_iso,
            },
        )

    async def _fetch_night_session() -> list[dict]:
        if end_date < NIGHT_SESSION_AVAILABLE_FROM:
            return []
        try:
            return await self._get(
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanOptionInstitutionalInvestorsAfterHours",
                    "start_date": max(
                        start_iso, NIGHT_SESSION_AVAILABLE_FROM.isoformat(),
                    ),
                    "end_date": end_iso,
                },
            )
        except httpx.HTTPError as exc:
            logger.warning("After-hours fetch failed: %s", exc)
            return []

    tx_returns_task = self._fetch_tx_returns(trading_dates, refresh=refresh)
    day_rows, night_rows, tx_returns = await asyncio.gather(
        _fetch_day_session(), _fetch_night_session(), tx_returns_task,
    )

    current, base_warnings = parse_institutional(
        day_rows=day_rows, night_rows=night_rows, end_date=end_date,
    )
    correlation, corr_warnings = parse_institutional_correlation(
        foreign_history=current.get("_foreign_history", []),
        tx_returns=tx_returns,
        corr_window=corr_window,
    )
    # Drop the internal `_foreign_history` key from payload (interior contract).
    current.pop("_foreign_history", None)

    result: dict = {
        "date": end_iso,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "as_of_date": end_iso,
        "current": current,
        "correlation": correlation,
        "data_quality_warnings": [*base_warnings, *corr_warnings],
    }
    self._write_cache_v(cache_key, result, _CACHE_VERSION_OPTIONS_CHIP)
    return result
```

##### `_fetch_tx_returns` (helper used by PCR + institutional)

```python
async def _fetch_tx_returns(
    self,
    trading_dates: list[date],
    refresh: bool = False,
) -> dict[str, float]:
    """One TaiwanFuturesDaily range call -> {iso_date: close_pct_return}.

    Cache key: tx_returns_{start_iso}_{end_iso}, version CHIP.
    Returns t+1 close return keyed by t (so parsers can look up
    tx_returns[t_iso] for "next day after t" without an extra index op —
    the parser convention).
    """
    from services.finmind_options import _CACHE_VERSION_OPTIONS_CHIP

    if not trading_dates:
        return {}
    start_iso: str = trading_dates[0].isoformat()
    end_iso: str = trading_dates[-1].isoformat()
    cache_key: str = f"tx_returns_{start_iso}_{end_iso}"
    if not refresh:
        cached = self._read_cache_v(cache_key, _CACHE_VERSION_OPTIONS_CHIP)
        if cached is not None:
            return cached["returns"]

    rows = await self._get(
        f"{_FINMIND_BASE}/data",
        {
            "dataset": "TaiwanFuturesDaily",
            "data_id": "TX",
            "start_date": start_iso,
            "end_date": end_iso,
        },
    )
    closes: list[tuple[str, float]] = sorted(
        ((r["date"], float(r["close"])) for r in rows if r.get("close")),
        key=lambda t: t[0],
    )
    returns: dict[str, float] = {}
    for i in range(len(closes) - 1):
        d_t, c_t = closes[i]
        _, c_t1 = closes[i + 1]
        if c_t > 0:
            returns[d_t] = (c_t1 - c_t) / c_t
    self._write_cache_v(
        cache_key,
        {
            "returns": returns,
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
        },
        _CACHE_VERSION_OPTIONS_CHIP,
    )
    return returns
```

#### 2.1.3 Module-level helpers (append after line 666, in pure data-transform section)

- `_root_id(contract_id: str) -> str` — already shown.
- `_strip_id(contract_id: str) -> str` — already shown.
- `_pcr_current_from_classified(classified: list[tuple[str, float, float, str | None]], high_pct: float, low_pct: float) -> dict` — extract the **latest** `(date, pcr, percentile, region)` tuple and shape it into the design v4 §2.1 `current` payload:

```python
def _pcr_current_from_classified(
    classified: list[tuple[str, float, float, str | None]],
    high_pct: float,
    low_pct: float,
) -> dict:
    """Latest row of classified PCR history -> `current` payload.

    Design v4 §2.1 PCR.current shape:
      { pcr, percentile, region, thresholds: { high_pct, low_pct } }.
    If history empty -> all numeric zero, region=None.
    """
    if not classified:
        return {
            "pcr": 0.0, "percentile": 0.0, "region": None,
            "thresholds": {"high_pct": high_pct, "low_pct": low_pct},
        }
    _, pcr, pct, region = classified[-1]
    return {
        "pcr": pcr, "percentile": pct, "region": region,
        "thresholds": {"high_pct": high_pct, "low_pct": low_pct},
    }
```

### 2.2 `backend/utils/cache.py` (EXTEND — `delete_by_prefix` contract per N12)

Append after `read_json` (line 42):

```python
def delete_by_prefix(
    root: Path,
    prefix: str,
    contains: str | None = None,
) -> int:
    """Delete cache files in *root* whose filename starts with *prefix*.

    If *contains* is supplied, additionally require that substring to be
    present in the filename (used by services/finmind._do_fetch_window when
    sweeping all contracts for a given end_date — match
    "<kind>_<contract>_<end_iso>_..." by `prefix="<kind>_"` +
    `contains=end_iso`).

    Returns the number of files deleted. Missing root -> 0 (not an error).
    Failures on individual files are logged via the caller (we re-raise
    OSError on permission issues; benign FileNotFoundError on concurrent
    delete is swallowed).
    """
    if not root.exists():
        return 0
    count = 0
    for p in root.iterdir():
        if not p.is_file():
            continue
        name = p.name
        if not name.startswith(prefix):
            continue
        if contains is not None and contains not in name:
            continue
        try:
            p.unlink()
            count += 1
        except FileNotFoundError:
            pass
    return count
```

Tested via M2 integration tests (no new unit test file — coverage falls out of `test_refresh_invalidates_dependent_pcr_keys_across_threshold_variants`).

### 2.3 `backend/tests/test_finmind.py` (EXTEND)

Per design v4 §6.0 + brainstorm SC-11: **delete the module-local `_reset_singleton` fixture** (lines 65-71). The new project-level `backend/tests/conftest.py` (module M1) installs an `autouse` `_reset_finmind_singleton_and_env` fixture that supersedes it. Leaving both produces double-monkeypatch and confusing failure traces.

No other modification to existing tests.

---

## 3. Test file to extend (preferred: `test_finmind_options.py`; new tests added to `test_finmind.py` for client-level)

Per the task brief: parser tests live in `test_finmind_options.py` (M3). M2's client-level integration tests go in **`backend/tests/test_finmind.py`** (extension) because they exercise `FinMindClient` methods — that's the file's purpose.

All new tests use the conftest-provided `bypass_finmind_rate_limiter` fixture (M1) and monkeypatch `FinMindClient._http` with the mock `AsyncMock` pattern already established (`_fm_response` / `_mock_http` helpers at lines 10-22).

### 3.1 New test functions in `backend/tests/test_finmind.py`

All standalone `async def test_*` (CLAUDE.md §2: `asyncio_mode=auto`, no `@pytest.mark.asyncio` decorator needed; existing tests still use the decorator but new tests follow the conftest-asyncio-auto pattern set by M1).

#### Inflight-dedup / shared-window cache

- `test_fetch_taiwan_option_daily_window_inflight_dedup_via_run_once` — SC-11/F17/I1: two concurrent `await client.fetch_taiwan_option_daily_window(dates, end_date)` calls share one fan-out task. Assert: `client._http.get.call_count == len(dates)` (not `2 * len(dates)`).
- `test_fetch_taiwan_option_daily_window_cache_hit_skips_fetch` — second call (no refresh) returns from disk; `call_count` stays at first-call value.
- `test_fetch_taiwan_option_daily_window_refresh_bypasses_cache` — `refresh=True` triggers re-fetch even with hot cache; `call_count` doubles.

#### Per-card cache hit/miss

- `test_fetch_max_pain_cache_hit_vs_miss` — F13: first call writes `max_pain_{contract}_{end}_lb20` cache; second call (no refresh) returns the cached payload without invoking `fetch_taiwan_option_daily_window`.
- `test_fetch_oi_walls_cache_hit_vs_miss` — same pattern, key `oi_walls_*_lb20_dw5`.
- `test_fetch_pcr_cache_hit_vs_miss` — checks classified-tier cache hit; series tier untouched.
- `test_fetch_institutional_cache_hit_vs_miss` — independent path, `tx_returns_*` + `institutional_*` keys.

#### Refresh invalidation (I1 + N12)

- `test_fetch_max_pain_refresh_invalidates_shared_window_cache` — F18: prime shared-window + `max_pain_*` caches; call `fetch_max_pain(..., refresh=True)`; assert `max_pain_*` file deleted before re-write AND shared-window file rewritten (compare `fetched_at`).
- `test_fetch_oi_walls_refresh_invalidates_shared_window_cache` — F18, key `oi_walls_*`.
- `test_fetch_pcr_refresh_invalidates_shared_window_cache` — F18, key `pcr_classified_*` AND `pcr_series_*` both gone.
- `test_refresh_invalidates_dependent_pcr_keys_across_threshold_variants` — v4 N12: prime `pcr_classified_all_months_all_{end}_lb250_h70_l30`, `..._h75_l25`, `..._h60_l40` (3 threshold variants); call `fetch_pcr(..., refresh=True)`; assert **all 3** classified files deleted (prefix sweep), plus `pcr_series_*`.
- `test_refresh_invalidation_is_inside_run_once_not_before` — v4 I1: kick off two concurrent `fetch_max_pain(..., refresh=True)` tasks via `asyncio.gather`; assert `delete_by_prefix` is invoked exactly once (not twice) — both refreshes share the dedup'd `_do_fetch_window`. Implementation: monkeypatch `utils.cache.delete_by_prefix` with a counter wrapper.

#### Lookback / dates plumbing

- `test_fetch_taiwan_option_daily_window_fans_out_per_trading_date` — for `trading_dates=[d1, d2, d3]` (3 dates) the client issues 3 HTTP calls keyed by `start_date=end_date=di`.
- `test_fetch_taiwan_option_daily_window_returns_dict_keyed_by_iso_date` — return shape is `{"2026-06-25": [...], "2026-06-24": [...]}`.

#### Helper functions

- `test_root_id_and_strip_id_monthly_and_weekly` — `_root_id("TXO202607") == "TXO"`, `_strip_id("TXO202607") == "202607"`, `_root_id("TXO202607W2") == "TXO"`, `_strip_id("TXO202607W2") == "202607W2"`.
- `test_pcr_current_from_classified_empty_returns_null_region` — empty list → `region=None`.
- `test_pcr_current_from_classified_returns_latest` — latest tuple wins.

#### `delete_by_prefix` direct tests (small surface, lives here vs new test file)

- `test_delete_by_prefix_matches_files_and_returns_count` — create 4 files in tmp dir; `delete_by_prefix(root, "max_pain_")` deletes 2 starting with that prefix, returns `2`, leaves other 2.
- `test_delete_by_prefix_with_contains_filter` — narrow by `contains="2026-06-25"`; only files containing that substring drop.
- `test_delete_by_prefix_missing_root_returns_zero` — non-existent path → returns `0` without raising.

---

## 4. Dependencies on other modules

| Symbol | Owning module | Used by |
|---|---|---|
| `_CACHE_VERSION_OPTIONS_CHIP` | M3 (`services/finmind_options.py`) | every new `fetch_*` here |
| `parse_max_pain`, `parse_max_pain_hit_rate` | M3 | `_do_fetch_max_pain` |
| `parse_oi_walls`, `parse_oi_walls_hit_rate` | M3 | `_do_fetch_oi_walls` |
| `parse_pcr_history`, `parse_pcr_walk_forward_percentile`, `parse_pcr_next_day_stats` | M3 | `_do_fetch_pcr` |
| `parse_institutional`, `parse_institutional_correlation` | M3 | `_do_fetch_institutional` |
| `NIGHT_SESSION_AVAILABLE_FROM` | M3 | `_do_fetch_institutional` |
| `get_trading_days` | M0 (`services/trading_calendar.py`) | **route layer only** — M2 receives `trading_dates: list[date]` as parameter (I2) |
| `delete_by_prefix` | this module's edit to `utils/cache.py` | `_invalidate_dependent_parse_caches` |
| `bypass_finmind_rate_limiter`, `NoOpBucket` | M1 (`backend/tests/conftest.py`) | every new client-level test |

Imports inside method bodies (lazy) for `_CACHE_VERSION_OPTIONS_CHIP` + parsers — matches the existing pattern at lines 414, 432-435, 491, 509-512, 538, 554-555. Keeps M2 ↔ M3 decoupled and avoids circular import.

---

## 5. SC coverage matrix

| File | SC-1 | SC-2 | SC-3 | SC-4 | SC-5 | SC-6 | SC-7 | SC-8 | SC-10 | SC-10b | SC-11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `backend/services/finmind.py` (extend) | ✓ fetch_max_pain | ✓ fetch_oi_walls | ✓ fetch_pcr | ✓ fetch_institutional | ✓ hit_rate orchestration | ✓ hit_rate orchestration | ✓ via fetch_pcr next_day_stats wiring | ✓ via fetch_institutional correlation wiring | ✓ httpx error -> empty rows fallback | (out of scope — frontend) | ✓ warning passthrough |
| `backend/utils/cache.py` (extend) | – | – | ✓ pcr threshold-variant invalidation | – | – | – | – | – | – | – | – |
| `backend/tests/test_finmind.py` (extend) | ✓ fetch_max_pain integration | ✓ fetch_oi_walls integration | ✓ fetch_pcr two-tier cache | ✓ fetch_institutional | ✓ shared-window invalidation (F18) | ✓ shared-window invalidation | ✓ tx_returns plumbing | ✓ tx_returns plumbing | ✓ dedup under concurrency (I1) | – | – |

(SC-0 = M1; SC-9 = M5 frontend integration; SC-10b = M5 frontend RTL test.)

---

## 6. Verification gate (M2 alone)

Run from `backend/`:

```sh
python -m pytest -q tests/test_finmind.py
python -m pytest -q tests/test_finmind.py::test_fetch_taiwan_option_daily_window_inflight_dedup_via_run_once -x
ruff check .
pyright services/finmind.py utils/cache.py
```

Module M2 is feature-complete when:
1. All new tests above pass green.
2. `ruff check .` is clean (line-length 100, no unused imports).
3. `pyright` basic mode reports zero new issues on `services/finmind.py` + `utils/cache.py`.
4. No regression in existing `test_finmind.py` tests (lines 74-end).

Real-env DevTools MCP screenshots happen in M5 (frontend) — M2 is pure backend.
