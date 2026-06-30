# Design — market-monitor-v2 P1 universe filter service

**Date**: 2026-06-30(事後追補)
**Pre-reading**: `brainstorm.md` 同 dir

> Canonical design source = `docs/specs/market-monitor-v2/plan.md` Phase 1 章節。本檔薄包裝,只列「跨檔架構決策」,具體函式 signature 在 `implementation/*.md`。

## 架構

```
                       fetch_market_snapshot (existing)
                                  │
                                  ▼
                  _do_fetch_market_snapshot (existing, 改)
                                  │
              ┌───────────────────┴───────────────────┐
              │              asyncio.gather            │
              │  (return_exceptions=True, 4-tuple)     │
              ▼                                          ▼
     _fetch_universe                          _fetch_watch_list (NEW)
     _fetch_sector_map                                    │
     _fetch_market_value_map                              ▼
                                          market_universe.fetch_disposition_stocks
                                                          │
                                                          ▼
                                          FinMind TaiwanStockDispositionSecuritiesPeriod
                                                  + 24h JSON cache
                                                          │
              ┌───────────────────┬───────────────────────┘
              ▼                   ▼
       primary_sector 過濾    market_universe.filter_universe
       (existing whitelist)   (NEW: ETF 00 prefix / warrant non-4-digit / watch_list)
                                  │
                                  ▼
                       allowed: set[str]
                                  │
                                  ▼
                  stock_universe = [r for r in u if sid in allowed]
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                          ▼
        _group_by_sector                       _compute_leaderboards
              │                                          │
              ▼                                          ▼
                  snapshot payload + universe_size + excluded_count
                                + stale = ... or watch_degraded (NEW)
```

## 檔案組織

| 檔 | 角色 |
|---|---|
| 🟢 `backend/services/market_universe.py`(新) | pure classify + filter + disposition fetch + orchestrator |
| 🔵 `backend/services/finmind_realtime.py`(改) | 加 `_fetch_watch_list` wrapper + gather 4-tuple + 套 filter + 新 payload fields + stale 加 watch_degraded |
| 🟢 `backend/tests/test_market_universe.py`(新) | 12 unit + 2 Phase 4 P1 fix test = 14 tests |
| 🔵 `backend/tests/test_finmind_realtime.py`(改) | 2 new integration test + 4 既有 test 補 `_fetch_watch_list` mock + 1 既有 test 加 `stale=True` assertion |

## 跨檔契約

1. **`market_universe.get_finmind()` indirection**:每個 service module wrap own `get_finmind()` 以利 monkeypatch 不汙染其他 module(對應 CLAUDE.md §9 新 lesson)
2. **`fetch_disposition_stocks` failure semantics**:服務層 raise(narrow `httpx.HTTPError`),上層 `_fetch_watch_list` 用 `gather(return_exceptions=True)` graceful empty,**但**拉 `stale=True`(對應 spec §6.1 contract 不可 silent 違反)
3. **snapshot payload backward-compat**:新欄位 add only,既有 8 top-level keys 不變;前端 type 暫不擴(P5 frontend phase 處理)
4. **`_CACHE_VERSION_UNIVERSE = 1`** 獨立於 `_CACHE_VERSION_REALTIME` 與 `_CACHE_VERSION`,不互相 invalidate(file scope 隔離 by filename pattern)

## 安全 / 輸入驗證 / 權限邊界

- 無對外 user input 直接打 dataset name(`TaiwanStockDispositionSecuritiesPeriod` 寫死)
- FinMind token 來自 `.env`(既有路徑)
- snapshot endpoint 維持公開 read-only,無新權限要求

## Known Risks(spec §9 + Phase 4 review accepted refute)

1. 注意股 dataset 缺 — P1 only cover 處置股(disposition);若未來補注意股需 fallback TWSE OpenAPI
2. `excluded_count` post-whitelist 語意 — banner 文案要顯式 hedge(見 CLAUDE.md §9 lesson)
3. KY 股 / 興櫃 6 位數普通股若未來納 universe,需 patch `classify_stock_id`
4. disposition cache 一日一檔長期累積 1MB/年(refuted P2,可忽略)
5. `_run_once` no refresh discriminator(refuted P2,服務內部 idempotent)
