# Implementation — backend/services/market_universe.py

**Date**: 2026-06-30(事後追補)
**Pre-reading**: `../design.md`(架構圖)+ `docs/specs/market-monitor-v2/plan.md` §Phase 1

## Signatures(對 SC-N 對應)

```python
def classify_stock_id(stock_id: str) -> str | None:
    """SC-1. Returns 'etf' | 'warrant' | None (普通股 pass through).
    Rules:
      - empty / whitespace → 'warrant'
      - startswith('00') → 'etf'
      - len != 4 or not isdigit → 'warrant'
      - else → None
    """

def filter_universe(candidates: list[str], watch_list: set[str]) -> dict:
    """SC-2. Returns:
      {
        "universe": set[str],
        "excluded": {"etf": [...], "warrant": [...], "watch_list": [...]},
      }
    Precedence: watch_list 優先(若 sid in watch_list,進 watch 桶,不再 classify)
    """

async def fetch_disposition_stocks(today: date | None = None, refresh: bool = False) -> set[str]:
    """SC-3. FinMind TaiwanStockDispositionSecuritiesPeriod;24h cache by today key.
    Returns active set (period_start <= today <= period_end).
    
    Failure semantics (Phase 4 P1 fix):
      - httpx.HTTPError → propagate (do NOT write empty cache)
      - parse errors → silently skip that row
    """

async def _do_fetch_disposition(today: date, cache_key: str) -> set[str]:
    """Internal: try _get → except httpx.HTTPError raise → write_cache success only."""

def _parse_active_disposition(rows: list[dict], today: date) -> set[str]:
    """Internal pure parse extracted from _do_fetch_disposition for testability."""

async def get_filtered_universe(today: date | None = None, refresh: bool = False) -> dict:
    """SC-4. Orchestrator: fetch TaiwanStockInfo + disposition, partition.
    Returns same shape as filter_universe."""

def get_finmind():  # patchable indirection
    """Wrap services.finmind.get_finmind so tests can monkeypatch this module's
    symbol without affecting other service modules. See CLAUDE.md §9 lesson."""
```

## 失敗測試清單對應 SC-N

| SC | Test names | Status |
|---|---|---|
| SC-1 | `test_classify_etf_prefix_00_excluded`, `test_classify_warrant_non_4_digit_excluded`, `test_classify_common_stock_included`, `test_classify_empty_or_invalid_treated_as_warrant` | 4 pass |
| SC-2 | `test_filter_universe_partitions_correctly`, `test_filter_universe_watch_list_overrides_common_classification`, `test_filter_universe_empty_watch_list_keeps_all_common` | 3 pass |
| SC-3 | `test_fetch_disposition_stocks_filters_by_today`, `test_fetch_disposition_stocks_uses_cache_on_second_call`, `test_fetch_disposition_stocks_refresh_bypasses_cache`, `test_fetch_disposition_stocks_propagates_http_error_does_not_cache_empty`*, `test_fetch_disposition_stocks_recovers_after_blip`* | 3 + **2 Phase 4** = 5 pass |
| SC-4 | `test_get_filtered_universe_end_to_end`, `test_get_filtered_universe_excluded_counts_match` | 2 pass |

\* Phase 4 review confirmed P1:disposition fetch fail 不能 silent swallow 寫 empty cache 24h。

## Cache layout

| File | TTL | Cache version | Notes |
|---|---|---|---|
| `data/cache/chip/disposition_<date>.json` | 24h | `_CACHE_VERSION_UNIVERSE = 1` | 一日一檔(跨日自動失效),累積 ~365 檔/年(refuted P2) |

## Known Risks(同 design.md,複錄):

- 注意股 dataset 缺(P1 only 處置股)
- KY 股 / 興櫃未納
- `_run_once` no refresh discriminator(內部 idempotent,refuted P2)
- `_is_fresh` tz-naive vs sibling 不一致(refuted P2,無 actual bug)
