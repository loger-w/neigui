# Implementation Spec — `backend/services/finmind_realtime.py` integration

**Pre-reading**: `../design.md` v2 §4.4

## 1. Additions to `services/finmind_realtime.py`

Add two helpers next to existing `_fetch_breadth`:

```python
async def _fetch_sector_breadth(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
) -> list[dict] | None:
    """market-monitor-v2 P3 (SC-6) — delegate to sector_aggregation.compute_sector_breadth.

    Empty universe → None (silent skip).
    Exception path handled by caller try/except httpx.HTTPError only (F6: after
    design v2 F3 fix, aggregation returns [] on empty prices instead of raising).
    """
    if not universe:
        return None
    from services import sector_aggregation as sa
    return await sa.compute_sector_breadth(end_date, universe, sector_map, refresh=refresh)


async def _fetch_sector_volume_ratio(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
) -> list[dict] | None:
    if not universe:
        return None
    from services import sector_aggregation as sa
    return await sa.compute_sector_volume_ratio(end_date, universe, sector_map, refresh=refresh)
```

## 2. Modification to `_do_fetch_market_snapshot`

Locate the existing P2 breadth try/except (currently lines ~548-552), and **immediately after** it, insert two independent try/except blocks:

```python
# 既有 P2 breadth try/except(不動,保留 ValueError catch 因 P2 compute_breadth 仍 raise universe_empty path)
try:
    breadth = await _fetch_breadth(clock.today(), allowed, refresh=refresh)
except (httpx.HTTPError, ValueError) as exc:
    logger.warning("market snapshot: breadth compute failed: %s", exc)
    breadth = None

# P3 SC-6 sector_breadth (F6: only httpx after F3 empty→[] fix)
try:
    sector_breadth = await _fetch_sector_breadth(
        clock.today(), allowed, primary_sector, refresh=refresh
    )
except httpx.HTTPError as exc:
    logger.warning("market snapshot: sector_breadth compute failed: %s", exc)
    sector_breadth = None

# P3 SC-6 sector_volume_ratio (independent try/except from sector_breadth)
try:
    sector_volume_ratio = await _fetch_sector_volume_ratio(
        clock.today(), allowed, primary_sector, refresh=refresh
    )
except httpx.HTTPError as exc:
    logger.warning("market snapshot: sector_volume_ratio compute failed: %s", exc)
    sector_volume_ratio = None
```

Then extend the return dict (bottom of the function) with two new keys, **preserving existing key order**:

```python
return {
    "as_of": now.isoformat(),
    "last_tick": last_tick.isoformat() if last_tick else None,
    "is_trading_session": in_session,
    "stale": stale,
    "lag_seconds": lag,
    "sectors": sectors,
    "leaderboards": leaderboards,
    "universe_size": len(allowed),
    "excluded_count": {
        "etf": len(excluded["etf"]),
        "warrant": len(excluded["warrant"]),
        "watch_list": len(excluded["watch_list"]),
    },
    "breadth": breadth,
    # market-monitor-v2 P3 (SC-6) — sector aggregations
    "sector_breadth": sector_breadth,
    "sector_volume_ratio": sector_volume_ratio,
}
```

**Critical (F6 stale-lock sequel)**: `stale = isinstance(universe_res, BaseException) or sector_degraded or watch_degraded` is NOT touched — sector_breadth / vol_ratio failing does not flip stale (they are EOD data ≠ intraday degradation).

## 3. Failure tests (Phase 3 red)

Add to `backend/tests/test_finmind_realtime.py` a new test class:

```python
class TestSnapshotSectorAggregations:
    """SC-6 — sector_breadth + sector_volume_ratio integration."""

    async def test_snapshot_payload_adds_sector_breadth_and_vol_ratio(...):
        """Happy path: both fields present in payload with correct shape."""

    async def test_snapshot_sector_breadth_fail_does_not_flip_stale(...):
        """F6 sequel: sector_breadth raise → payload sector_breadth=None but stale not True."""

    async def test_snapshot_sector_vol_ratio_fail_independent_of_breadth(...):
        """Partial fail: sector_breadth ok, vol_ratio raises → payload has sector_breadth list + sector_volume_ratio=None."""

    async def test_snapshot_empty_universe_both_sector_fields_none(...):
        """Empty allowed set → both fields None (silent skip via `_fetch_*` gate)."""
```

- **T-INT-1**: mock `_fetch_sector_breadth` + `_fetch_sector_volume_ratio` returning fixture lists → assert payload["sector_breadth"] and payload["sector_volume_ratio"] present + shape correct + existing 4 leaderboards + universe_size + excluded_count + breadth unchanged
- **T-INT-2**: mock `_fetch_sector_breadth` raise `httpx.HTTPError` → assert payload["sector_breadth"] is None + payload["stale"] is False (assuming universe/sector_map/watch_list all ok)
- **T-INT-3**: mock `_fetch_sector_breadth` returning list, `_fetch_sector_volume_ratio` raise → assert breadth list preserved, vol_ratio None, stale unaffected
- **T-INT-4**: force allowed=set() (mock upstream) → both fields None
- (existing tests must still pass — sanity check universe_size / excluded_count / breadth / leaderboards / sectors unchanged)

## 4. Not done in this file

- `services/sector_aggregation.py` implementation → see `sector_aggregation.md`
- Frontend components → out of scope (spec.md Phase 5)

## 5. Known Risks

- **R1**: If reviewer flags "prefer `asyncio.gather + return_exceptions=True` for the 3 breadth/sector_breadth/vol_ratio calls" — accept only if language of design v2 §4.4 is amended to justify. Current design chose sequential + independent try/except for clarity + shared cache benefit.
