# Phase 7 — Goal Verification(market-sector-amount-share)

**Date**: 2026-07-02。重讀 brainstorm.md 後逐 SC 核對;所有測試數字為本 phase fresh 執行
(非引用歷史 run)。

| SC-N | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據路徑 | regression 抽樣對象 |
|---|---|---|---|---|
| SC-1 extract | `backend/services/sector_aggregation.py:252`(`_extract_amount_by_stock`) | `TestExtractAmountByStock` A1~A5+A26 — **6 passed** | evidence/snapshot_full.json(45 sectors 由真實 FinMind rows extract 而來,share 加總 1.000000 間接證 extract 正確) | A4 duplicate later-wins / A26 負值 clamp(mutation-hardened) |
| SC-2 today_share | `backend/services/sector_aggregation.py:292`(`_aggregate_sector_amount_share` today 段) | `TestAggregateSectorAmountShare` A6~A10 subset — 全班 **14 passed** | evidence/SC-2_SC-3_SC-4_SC-6_validation.txt:sum(today_share)=1.000000;「其他」=0.78%(E5/R4) | A7 缺席語意 / A8 KG7 lock(T-E2) |
| SC-3 share_delta | 同上(past window 段,`sector_aggregation.py:314-323`) | A11~A15+A24+A25(同班 14 passed 內) | 同上:delta +12 / −33 / None 0(正負皆現;None 0 = 全 45 sector 歷史 ≥ 20 有效日,成熟市場合理) | A14 T-E3 半契約 + A25 share-0.0 日 + A24 recency(mutation-verified) |
| SC-4 排序 | 同上(sort key,`sector_aggregation.py:333`) | A16~A17(同班 14 passed 內) | 同上:45 entries sorted DESC = True | A17 tie-break ASC |
| SC-5 orchestrator | `backend/services/sector_aggregation.py:435`(`compute_sector_amount_share`) | `TestComputeSectorAmountShareOrchestrator` A18~A23 + `TestConstantsLock::test_T37` — **7 passed** | evidence/SC-5_warm_cache_second_request.json:warm 36.78s/36.84s 無 cold refetch → cache_key 共用生效(冷啟動僅首請求 277.8s) | T37 window 全等 lock;A21 httpx propagate;A22 refresh 傳達 |
| SC-6 整合 | `backend/services/finmind_realtime.py:424`(helper)/ `:630`(try/except)/ `:658`(payload key) | P4 T-INT-1~5(`-k "amount_share or delegate_args"`)— **5 passed** | evidence/SC-2_SC-3_SC-4_SC-6_validation.txt:key present、位置 = 末位緊接 sector_volume_ratio、每 entry 恰 3 keys、stale=false | T-INT-2 P3 兩欄 intact / T-INT-4 except 寬度(mutation-verified)/ P1-P3 欄位:universe_size=1917、breadth non-null、sector_breadth 45、sector_volume_ratio 45 |

## Edge case 對照(brainstorm §3)

| Edge | Test lock | 狀態 |
|---|---|---|
| E1 新上市 → None | A13 | pass |
| E2 today total=0 → [] | A8 | pass |
| E3 過去日 total=0 skip | A14(+對照組)+ A25(share-0.0 日反向) | pass |
| E4 缺欄 → 0.0 | A5 | pass |
| E5 sector_map 缺 → 其他 | A9 + real-env 其他=0.78% | pass |
| E6 週末 end_date | A23 | pass |
| E7 duplicate later-wins | A4 | pass |

## Out-of-scope 核對(brainstorm §4)

- `git diff 848db55..HEAD --stat`:僅 4 個 backend 檔(+ 後續 artifact),零 frontend — ✓
- `_extract_close_and_volume_by_stock` 未擴 tuple(P3 aggregate 函式 body 零改動;唯一 P3
  函式觸碰 = `_fetch_prices_window` docstring comment-only,獨立 🔵 commit 標示,Phase 4
  CONS-1 裁決紀錄在 code-review-round-1.json)— ✓
- `_CACHE_VERSION_REALTIME` / `_CACHE_VERSION_BREADTH` 未 bump — ✓(diff 無此行)

## 結論

6/6 SC 全綠,7/7 edge 有 lock,無失敗類型觸發,無 meta-cycle 計數。→ 進 Phase 8。
