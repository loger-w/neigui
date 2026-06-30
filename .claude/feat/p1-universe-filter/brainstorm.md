# Brainstorm — market-monitor-v2 P1 universe filter service

**Date**: 2026-06-30(事後追補,/feat Phase 0 規範)
**Scope**: M(4 檔 + 加新 FinMind dataset `TaiwanStockDispositionSecuritiesPeriod`)— 對外 API backward-compat add-only,**不**升 L(無 hot path / 鑑權 / 加密 / 金流)

> **Note on backfill**:本 feature 一開始走「直接 reuse 既有 `docs/specs/market-monitor-v2/{spec,plan}.md` + TDD 紅先行」捷徑,**跳過正規 Phase 0/1/2 artifact**。事後依使用者要求補 `.claude/feat/<slug>/` artifact 釘檔。本檔抓取既有 spec.md §3 7 條成功條件,賦予 SC-N 編號 + 驗證方式,供 Phase 7 結構化證據表(在 `docs/specs/market-monitor-v2/verification.md §5`)對照。

## Canonical source

| 角色 | 路徑 |
|---|---|
| 規格(原 Phase 0 brainstorm 等價) | `docs/specs/market-monitor-v2/spec.md`(主要看 §3 / §6.1 / §8) |
| 計劃(原 Phase 1 design 等價) | `docs/specs/market-monitor-v2/plan.md`(主要看 Phase 1) |
| 驗證證據 | `docs/specs/market-monitor-v2/verification.md` |

## 成功條件(SC-N 編號 + 驗證方式)

抓自 spec.md §3 + plan.md §Phase 1「完成條件」5 條:

| SC | 描述 | 驗證方式 |
|---|---|---|
| SC-1 | 純函式 `classify_stock_id` 三分桶(ETF / warrant / 普通股) | unit test 4 個(`test_classify_*`)+ real-env curl 看 `excluded_count` 分桶數合理 |
| SC-2 | `filter_universe` 純函式分桶 + watch_list 優先 | unit test 3 個(`test_filter_universe_*`) |
| SC-3 | `fetch_disposition_stocks` walks FinMind `TaiwanStockDispositionSecuritiesPeriod` + 24h cache + refresh bypass | unit test 3 個(`test_fetch_disposition_*`)+ inspect cache file `data/cache/chip/disposition_<date>.json` |
| SC-4 | orchestrator `get_filtered_universe` end-to-end(抓 TaiwanStockInfo + disposition + 分桶) | integration test 2 個(`test_get_filtered_universe_*`) |
| SC-5 | snapshot payload 套 filter,新增 `universe_size` + `excluded_count`,不破壞舊 4 panel | integration test 2 個(`test_snapshot_excludes_*`)+ curl × 3 看 ETF / 非 4 位數真實 NONE in leaderboards & sectors + 既有 7 snapshot test 全綠 |

(Phase 4 review 補上 P1 修正 → 同 SC-5 範圍,phase_4 += 1。修正:disposition fetch fail 不 silent swallow / stale signal 反映 watch_degraded。)

## Edge cases(spec.md §9 + plan.md §1 衍生)

1. FinMind 無「注意股」獨立 dataset → P1 只 cover 處置股,注意股 known gap
2. disposition 期間覆蓋判斷(period_start == today / period_end == today / period_end < period_start)
3. `_run_once` inflight dedup 跨 refresh=True/False
4. 24h cache TTL 跨日(cache_key 含 today.isoformat() → 跨日自動失效)
5. **(Phase 4 補)** disposition fetch 失敗(httpx 502/timeout/token expiry)— 必須 raise,不可 swallow + 寫 empty cache 24h(spec §6.1 contract silent 違反)

## Out of scope(留 V2.5 / 後續 spec)

- 注意股 dataset(TWSE OpenAPI fallback)
- KY 股 / 興櫃 6 位數普通股 universe 擴充
- frontend universe banner 文案(P5 frontend phase)
- `MarketSnapshot` TypeScript type 更新(P5 frontend)

## S/M/L 判定 = **M**

- 動的檔 4 個(2 service + 2 test + verification.md + CLAUDE.md §9)
- 加新 FinMind dataset(`TaiwanStockDispositionSecuritiesPeriod`)— 算「加新資料流」
- API contract backward-compat add-only(`universe_size` / `excluded_count` 新欄位,舊欄位不動)
- **不**在 hot path / 不碰鑑權 / 加密 / 金流 → **不升 L**

→ Phase 1/2 各 1 輪 review;這次只跑 Phase 4 review(因為 Phase 1/2 跳掉,事後追補)
