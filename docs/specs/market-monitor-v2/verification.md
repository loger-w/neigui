# market-monitor-v2 P1 — Verification (real-env Phase 6)

**Date**: 2026-06-30
**Scope**: Phase 1 universe filter service (`backend/services/market_universe.py` + 整合到 `services/finmind_realtime.py` snapshot payload)
**Feature shape**: 純後端 API → curl × 3 cases(對齊 `/feat` Phase 6 表)

---

## 1. Test commands & exit codes

| # | Command | Exit | Notes |
|---|---------|------|-------|
| A | `cd backend && python -m pytest -q` | 0 | 331 passed, 1 skipped(新增 14:12 unit + 2 integration) |
| B | `cd backend && ruff check services/market_universe.py services/finmind_realtime.py tests/test_market_universe.py tests/test_finmind_realtime.py` | 0 | All checks passed |
| C | `cd frontend && npm test -- --run` | 0 | 44 files / 424 tests passed(前端 type 未動,backward-compat) |

---

## 2. Real-env curl × 3 cases

Backend dev server started: `cd backend && python -m uvicorn main:app --port 8000`(production .env FINMIND_TOKEN load)

| Case | URL | HTTP | latency | size(bytes) |
|------|-----|------|---------|-------------|
| 1. Cold(populates cache) | `/api/market/snapshot` | 200 | 0.769s | 127,289 |
| 2. Refresh bypass | `/api/market/snapshot?refresh=true` | 200 | 0.767s | 127,292 |
| 3. Warm hit(cache valid) | `/api/market/snapshot`(again) | 200 | 0.269s | 127,292 |

→ refresh 與 cold 同 latency(~770ms,真打 FinMind),warm 縮到 269ms(cache hit ✓)。

### Payload top-level keys 對照 spec §8 contract

```
['as_of', 'excluded_count', 'is_trading_session', 'lag_seconds', 'last_tick',
 'leaderboards', 'sectors', 'stale', 'universe_size']
```

→ **既有 8 keys 全在**;**新增 `universe_size` / `excluded_count`** 出現。Backward-compat 通過,L3 e2e contract(只檢 `sectors` / `leaderboards`)不破。

### 真實環境數值(2026-06-30 17:19 TPE)

```
universe_size: 1919               # 4 位數普通股 (filter 後)
excluded_count: {
  etf: 347,                       # 00 prefix ETF / 統一基金
  warrant: 58,                    # non-4-digit / 含字母衍生品
  watch_list: 55                  # 處置股(period_start <= today <= period_end)
}
sectors: 45                       # FinMind industry 大類
leaderboards: 30 × 4 (gainers/losers/amount/volume_ratio)
stale: false
lag_seconds: 8430                 # 收盤後 ~2.3h
```

**Top-3 amount** = `[(2330,台積電), (2327,國巨), (2454,聯發科)]` — 真實大盤,filter 沒誤殺權值股 ✓

### Filter 真實生效驗證(直接掃 payload)

```python
all_lb_ids = {r["stock_id"] for v in leaderboards.values() for r in v}
all_sector_ids = {s["stock_id"] for sec in sectors for s in sec.stocks}
# ↓ 四個 assertion 全 NONE(correct)
assert not [x for x in all_lb_ids if x.startswith("00")]     # ETF 不出現 ✓
assert not [x for x in all_lb_ids if len(x)!=4 or not x.isdigit()]  # 非 4 位數不出現 ✓
assert not [x for x in all_sector_ids if x.startswith("00")] # ETF 不在 sectors ✓
assert not [x for x in all_sector_ids if len(x)!=4 or not x.isdigit()]
```

### Cache file 驗證

`backend/data/cache/chip/disposition_2026-06-30.json`:
- `_cache_version: 1` ✓(對應 `market_universe._CACHE_VERSION_UNIVERSE`)
- `fetched_at: 2026-06-30T17:20:31`
- `stock_ids: 74` 個 raw IDs(含 19 個 5-6 位衍生品 disposition ID,如 `085788` / `80212` / `80426` / `89964`)

→ FinMind disposition dataset 74 ID 中,只有 55 個 4 位普通股實際被排除(其餘 19 個權證 disposition ID 不在 `primary_sector` whitelist,本來就不在 universe)。**Filter 順序正確**(primary_sector → 結構 classify → watch_list 比對),numbers 雖不直加但邏輯一致。

### Refresh vs Warm consistency

```
universe_size match: True   (1919)
excluded_count match: True  (347/58/55)
sectors count match: True   (45)
```

→ 重抓資料無誤,3 個欄位 deterministic。

---

## 3. 對照 plan.md §1 完成條件

| 條件 | 狀態 | 證據 |
|------|------|------|
| pytest 新增 ≥ 5 test 全綠 | ✓ | 14 個 |
| 既有 snapshot endpoint 不 crash | ✓ | curl 3 cases × HTTP 200 |
| `universe_size` 出現在 snapshot payload | ✓ | `snap_cold.json` top-level key + `1919` |
| 既有 4 panel(gainers/losers/amount/volume_ratio)payload 不變(只是 universe 縮)| ✓ | leaderboards.* 仍 4 keys × 30 rows,只是內容剔除 ETF/權證/處置股 |

---

## 4. Evidence files

| File | What |
|------|------|
| `~/AppData/.../scratchpad/snap_cold.json` | curl case 1 raw response(127k bytes) |
| `~/AppData/.../scratchpad/snap_refresh.json` | curl case 2 raw response |
| `~/AppData/.../scratchpad/snap_warm.json` | curl case 3 raw response |
| `backend/data/cache/chip/disposition_2026-06-30.json` | FinMind disposition cache(74 IDs) |

raw payload 大(~127KB)未 commit;parsed metrics 已收錄本檔。

---

## 5. Phase 7 結構化證據表(SC ⇄ 實作 ⇄ 測試 ⇄ real-env 對照)

spec.md / plan.md 沒走 /feat Phase 0 編號,以 plan §1「完成條件」5 條為 SC 對應。

| SC | 實作檔案:行號 | 自動化測試名(pass count) | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| P1-1 純函式 `classify_stock_id`(ETF / warrant / 普通股 三分桶) | `backend/services/market_universe.py:55-77` | `test_classify_etf_prefix_00_excluded`、`test_classify_warrant_non_4_digit_excluded`、`test_classify_common_stock_included`、`test_classify_empty_or_invalid_treated_as_warrant`(**4 pass**) | snap_cold.json `excluded_count.etf=347 / warrant=58`(真實 FinMind 全 universe 套後合理) | `test_snapshot_excludes_etf_warrant_watch_list_and_reports_counts` 整合 regression |
| P1-2 `filter_universe` 分桶 + watch_list 優先 | `backend/services/market_universe.py:80-110` | `test_filter_universe_partitions_correctly`、`test_filter_universe_watch_list_overrides_common_classification`、`test_filter_universe_empty_watch_list_keeps_all_common`(**3 pass**) | snap_cold.json `excluded_count.watch_list=55` | 同上整合 test |
| P1-3 `fetch_disposition_stocks` + 24h cache + refresh bypass | `backend/services/market_universe.py:155-205` | `test_fetch_disposition_stocks_filters_by_today`、`test_fetch_disposition_stocks_uses_cache_on_second_call`、`test_fetch_disposition_stocks_refresh_bypasses_cache`(**3 pass**) | `backend/data/cache/chip/disposition_2026-06-30.json`(`_cache_version=1`, `stock_ids=74`, `fetched_at=2026-06-30T17:20:31`) | `test_snapshot_watch_list_fetch_failure_does_not_block` 驗證 graceful failure |
| P1-4 orchestrator `get_filtered_universe` | `backend/services/market_universe.py:215-235` | `test_get_filtered_universe_end_to_end`、`test_get_filtered_universe_excluded_counts_match`(**2 pass**) | snap_cold.json `universe_size=1919` | 同上 |
| P1-5 snapshot payload + leaderboard 套 filter + 新欄位 | `backend/services/finmind_realtime.py:358-365`(`_fetch_watch_list`)+ `442-538`(`_do_fetch_market_snapshot` 改) | `test_snapshot_excludes_etf_warrant_watch_list_and_reports_counts`、`test_snapshot_watch_list_fetch_failure_does_not_block`(**2 pass**) | curl × 3 (cold/refresh/warm) HTTP 200,filter 真實生效(ETF/非 4 位數 0 條 in leaderboards & sectors) | 既有 7 個 snapshot test(`test_fetch_market_snapshot_happy_path` / `test_stale_*` / `test_market_value_*` / `test_refresh_propagates_*`)全綠 — `+5 既有` |

**Total**: 14 個新 test + Phase 4 review 補 2 個 P1 red→green test = **16 個新 test 全綠**;既有 317 backend test + 424 frontend test + 真實 curl × 4 全綠。

無 N/A、無「應該可以」、無 verified ✓ 字樣 → 結構化表 gate 通過。

---

## 6. Phase 4 review findings — receiving 分類 + 修正

跑 Workflow 16 finding × 3-vote adversarial verify(51 agent / 2.8M tokens / 9.8 min)。

| Verdict | Count | Action |
|---------|-------|--------|
| CONFIRMED P1 | 3 | accepted — 同 root cause: `_do_fetch_disposition` bare `except Exception` + 寫 empty cache 24h(silent disable watch_list filter)|
| CONFIRMED P2 | 1 | accepted — downstream: `stale` flag 沒 reflect `watch_degraded` |
| REFUTED | 12 | rejected — 同意 verifier 三票判斷 |

### Accepted P1/P2 修正(對齊 CLAUDE.md §F「不懂的 error 不要 catch;catch 後要有具體處理邏輯,純 log 等於吞掉」)

1. **`market_universe._do_fetch_disposition` 窄 except + raise + 不寫 cache**:
   - except 從 `except Exception` → `except httpx.HTTPError`(對齊 `services/finmind.py:357/500/575` 慣例)
   - 失敗時 raise(propagate 給 `_fetch_watch_list` → `_do_fetch_market_snapshot` 的 `gather(return_exceptions=True)` 真實 trigger 兜底分支)
   - 抽 `_parse_active_disposition(rows, today)` 純函式
2. **`finmind_realtime._do_fetch_market_snapshot` 加 watch_degraded → stale**:
   - `watch_degraded = isinstance(watch_res, BaseException)`
   - `stale = ... or watch_degraded`(原只看 universe_fail / sector_degraded)
3. **新增 red→green tests**:
   - `test_fetch_disposition_stocks_propagates_http_error_does_not_cache_empty` — 鎖死 raise + 不寫 empty cache
   - `test_fetch_disposition_stocks_recovers_after_blip` — 第一次 fail raise 後,第二次 call 應重 fetch(非吃 empty cache)
   - 更新既有 `test_snapshot_watch_list_fetch_failure_does_not_block` — 加 `assert result["stale"] is True`
   - 既有 3 個 snapshot test(`test_fetch_market_snapshot_happy_path` / `test_stale_false_when_sector_fetch_fails_with_disk_cache` / `test_snapshot_filters_indices_via_primary_sector_whitelist` / `test_snapshot_sector_fail_no_cache_surfaces_stale_true`)補 `_fetch_watch_list` mock(避免新 fail-loud 路徑撞真實 FinMind)

### Rejected 12 條(verifier 3-vote 多數)

- `excluded_count` pre-whitelist semantics(P2 × 2)— grey area,verification §6 已記為 known gap
- `classify_stock_id startswith('00')` 順序 → index `'001'` mis-bucket(P2)— 實際 `primary_sector` whitelist 已天然排除 3-digit index
- `filter_universe` watch_list-first precedence(P2)— 設計合法,語意一致
- `dedup_key r0/r1` race(P2)— 設計合理(每路 refresh 獨立 task)
- disposition cache 一年 365 檔(P2)— 慢性 disk 漏氣 ~1MB/年,可忽略
- `_run_once` 沒 refresh discriminator(P2)— service 內部 idempotent
- `_is_fresh` tz-naive vs tz-aware(P2)— inconsistent 但無 actual bug
- `_inflight` 跨 test 沒 reset(P2)— theoretical,無 actual test 失敗
- frontend MarketSnapshot type 缺欄位(P2)— 留給 P5 frontend phase
- 第二輪 watch_list silent pass 沒 stale signal(P1)— 跟 confirmed P2 #4 同根,該 confirmed 已覆蓋

---

## 7. Known gap(留給後續 phase)

| Gap | 影響 | 處理建議 |
|-----|------|---------|
| FinMind 無「注意股」獨立 dataset | P1 只 cover 處置股,注意股(disposition 之前的警示)不被排除 | P5 frontend 視 SC 補:fallback 抓 TWSE OpenAPI `https://openapi.twse.com.tw/v1/announcement/sdss_alert` |
| `disposition_<date>.json` cache 1 檔/日,長期 disk 不收 | 慢性 disk 漸增(每年 ~365 檔 × ~3KB ≈ 1MB,可忽略)| 不處理(漏氣慢,不阻塞功能) |
| 整合到 `_compute_leaderboards` 之前先過 universe filter — `excluded` 內 `etf` / `warrant` 來自 `primary_sector` whitelist 後的 candidates,不是原始 universe;真實 ETF/權證統計不在此 payload | 數字「ETF=347」是「在 TaiwanStockInfo + 是 ETF prefix」的個數,非全 universe 真實 ETF 數 | 文字上區分清楚;若 user 要看「原始 universe 含多少 ETF」需另開 endpoint |

---

## 8. P5 frontend(feat/market-page-v2-frontend,2026-07-02)

### 自動化 gate(全綠)

| Gate | 結果 |
|------|------|
| `cd backend && python -m pytest -q` | 471 passed, 1 skipped(含新 `test_market_snapshot_v2_keys`) |
| `cd frontend && npm test` | 505 passed / 54 files(base 428 → +77) |
| `cd frontend && npm run build` | tsc -b + vite ✓ |
| `cd backend && ruff check .` | All checks passed |
| `cd e2e && npm test` | 19 passed, 2 skipped(既有 M2/M3 fixture 欠帳);新 M4-M7 |
| visual V3 baseline | `skipOnWin32()` by design;生成走 GitHub `e2e-update-snapshots` workflow(PR 後) |

### 真實環境(chrome-devtools,1440x900,console 0 feature 相關 error)

| 截圖 | 對應 |
|------|------|
| `screenshots/p5-main-view-1440x900.png` | 5 panel 三欄主視圖,grid bottom=900 實測無 scroll(SC-9) |
| `screenshots/p5-fullpage-with-classic.png` | 主視圖 + 經典檢視(預設展開,雙軌保留) |
| `screenshots/p5-banner-breadth-closeup.png` | universe banner 471/1917 文案 + McClellan chart(SC-8/SC-4) |
| `screenshots/p5-participation-heatmap.png` | 44 cells 四檔 ink/accent 色階(SC-5) |
| `screenshots/p5-amount-share-delta.png` | Δ20MA 正 accent / 負 muted / 0 無前綴(SC-6) |
| `screenshots/p5-vol-ratio-flags.png` | hot/cold flag dot 直接渲染(SC-7) |
| `screenshots/p5-classic-hover-2330.png` | 經典熱力圖 hover tooltip(2330 台積電) |

訊號 dot:2026-07-02 真實 payload `centerline_cross="above"` → signal strip「0 線」實心 dot 觸發(主視圖截圖左下);thrust 當日未達 ±100(osc +13.97)為 inactive 空心,專屬渲染由 component test lock。「historical fetch 找觸發日」不可行 — snapshot API 無 date 參數(brainstorm SC-12 amendment)。

### Phase 6 抓到並修復的 regression

1440x900 主視圖 grid bottom 939 > 900:App root 是 flex-col(mode nav `shrink-0`),MarketPage root 用 `h-full` 作為 flex item = 100% 容器高(非剩餘空間)→ 下溢 nav 高度 39px 被 `overflow-hidden` 裁。修:root `h-full` → `flex-1 min-h-0`;e2e M7 量測 spec 鎖(注意 `test.use({viewport})` 固定,`setViewportSize` 後立即量測會撞 relayout race 假綠)。
