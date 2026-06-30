# Implementation — backend/services/finmind_realtime.py changes

**Date**: 2026-06-30(事後追補)
**Pre-reading**: `../design.md` + `docs/specs/market-monitor-v2/plan.md` §Phase 1 完成條件

## Signatures(新 / 改)

```python
async def _fetch_watch_list(refresh: bool = False) -> set[str]:
    """SC-5 (NEW). Thin wrapper over market_universe.fetch_disposition_stocks
    for patchability. Tests `patch('services.finmind_realtime._fetch_watch_list')`
    to bypass real FinMind call."""

async def _do_fetch_market_snapshot(refresh: bool) -> dict:
    """CHANGED:
      - gather 從 3-tuple → 4-tuple(加 _fetch_watch_list)
      - 加 watch_degraded = isinstance(watch_res, BaseException)
      - watch fetch fail → watch_list=set() AND watch_degraded=True
      - 對 stock_universe 套 filter_universe → allowed set → 再 filter
      - payload 加 universe_size + excluded_count
      - stale = ... or sector_degraded or watch_degraded (NEW: 加 watch_degraded)
    """
```

## 失敗測試清單對應 SC-N

| SC | Test names | Status |
|---|---|---|
| SC-5 | `test_snapshot_excludes_etf_warrant_watch_list_and_reports_counts`, `test_snapshot_watch_list_fetch_failure_does_not_block`(assert `stale=True`)| 2 pass |
| SC-5 regression | 既有 `test_fetch_market_snapshot_happy_path` / `test_stale_false_when_sector_fetch_fails_with_disk_cache` / `test_snapshot_filters_indices_via_primary_sector_whitelist` / `test_snapshot_sector_fail_no_cache_surfaces_stale_true` 補 `_fetch_watch_list` mock | 4 既有全綠 |

## 跨檔契約

- snapshot payload 新增 keys = `{universe_size: int, excluded_count: {etf, warrant, watch_list}}`
- 舊 keys(`as_of` / `last_tick` / `is_trading_session` / `stale` / `lag_seconds` / `sectors` / `leaderboards`)型別不變
- L3 e2e contract test 只檢 `sectors` / `leaderboards` → backward-compat 通過

## Phase 4 review accepted P1/P2 fixes 落實在這個檔

| Finding | Fix location |
|---|---|
| P2 `stale` 沒 reflect `watch_degraded` | `_do_fetch_market_snapshot` `watch_degraded = isinstance(...)` + `stale = ... or watch_degraded` |
| (related to market_universe.py 的 disposition fail-loud)| `_fetch_watch_list` 沒改;由 market_universe 的 raise + gather return_exceptions 串成「watch fail → 視為空 set + stale=True」 |
