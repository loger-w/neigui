# perf/options-market-load — optimize plan

## Phase 1 baseline(2026-07-20,本機 win32,uvicorn 單 process,disk cache 已有 283 個 txo_daily_* 共 402.5MB)

量測方式:curl `%{time_total}`;「stale 再訪」= 把今天相關 result cache 的 `fetched_at` 倒填 1 小時(模擬盤中 30 分 TTL 過期),9 支 options endpoint 並發打(= OptionsPage 真實載入形狀)。可重現步驟:`backend/scripts/bench_options_page.py`(本次入庫)。

| 情境 | 數字 |
|---|---|
| options 9 支並發,result cache 溫 | ~0.2s/支,wall ~0.5s |
| options 9 支並發,**stale 再訪** | **wall 6.12s**;連輕量端點(spot/retail_mtx)也 4.5s+ |
| 單支 stale max_pain | 2.20s(pyinstrument:**2.00s = read_json 讀 250 個 per-day cache**,compute 僅 0.19s) |
| 單支 stale pcr | 4.6s |
| market /snapshot(溫) | 0.24-0.77s 本機、1.0s prd |
| 讀 250 個 txo_daily 檔(獨立量測) | 1.77s、899,966 rows |

## Root bottleneck(Phase 2 profile 拍板)

`fetch_taiwan_option_daily_window` 每次 stale 重算都同步重讀 + JSON parse 整個 250 日 window(402MB raw rows,13 欄 × ~5.5k rows/日)。此 2 秒級純 CPU 段**持有 event loop**:
1. options 頁 3 支重算端點(max_pain / oi_walls / pcr)以外,同頁其他 6 支輕量端點也被 starve 到 4.5s+;
2. 同 process 的 `/api/market/snapshot` 同樣被卡 → 解釋「選擇權跟大盤一起極慢」;
3. prd(Railway 弱 CPU + 記憶體壓力)倍率放大,體感 10-20s+。

旁證:window 三個 consumer(fetch_max_pain / fetch_oi_walls / fetch_pcr)只用 rows 的 5 個欄位 `(option_id, contract_date, call_put, strike_price, open_interest)`,且全部 skip `oi<=0` rows、跨 trading_session 以加總聚合 — raw cache 內 ~60% 資料量從未被讀取者使用。

## 目標(Phase 5 用完全相同量測方式對照)

- options 9 支並發 stale 再訪 wall:6.12s → **< 2.0s**(本機)
- 單支 stale max_pain:2.20s → **< 0.8s**
- 溫路徑、既有測試、API payload:零退化

## 策略(單一策略,一個 commit)

**S1:window per-day cache 瘦身(txo_slim)**
raw `txo_daily_{date}` → 改存 build 時預聚合的 slim 檔 `txo_slim_{date}`:
- 聚合 key `(option_id, contract_date, call_put, strike_price)`,value = OI 跨 session 加總;丟棄 `oi<=0` entries;columnar list 存檔(非 object-per-row)。
- 讀取時 materialize 回 5 欄位 row dicts → **window 對 consumer 的 `{date_iso: list[dict]}` shape 不變**,parse functions(已測試鎖定)零改動;聚合語意與 parser 內部的 `bucket[strike]+=oi` 完全同構(等冪:先聚合再餵 vs 餵 raw 自聚合,輸出相同)。
- 遷移路徑:讀不到 slim 但 raw `txo_daily_{d}` 存在 → 從 raw build slim 落盤後刪該 raw(省 402MB;raw 從此無 reader,可再生 cache);兩者皆無 → FinMind fetch(現行邏輯)→ 只寫 slim。
- 預期:window IO 2.0s → ~0.3-0.5s(檔案 402MB → ~15MB);pcr compute 掃的 rows 從 5.5k/日降到 OI>0 的 ~2.5k/日。

### Cache invalidation 三欄(gate:缺一不准實作)

| 欄 | 內容 |
|---|---|
| 失效時機 | 歷史日(< today)slim 檔不朽(結算資料 frozen,同現行 raw 契約);today 的 slim 檔沿用現行 30-min `_is_stale` + `refresh=True` 重抓 trailing 1-2 日邏輯(判斷位置不動,只換存取格式);版本欄 `_cache_version` ≠ `_CACHE_VERSION_OPTIONS_SLIM` → 視為 miss |
| bust 觸發點 | (a) `_do_fetch_window` 內 today/refresh 日重抓後覆寫 slim(現行 `_write_cache_v` 同位置);(b) `_CACHE_VERSION_OPTIONS_SLIM` bump(services/finmind_options.py,人工);(c) refresh=True 既有 `_invalidate_chip_parse_caches` 不動 |
| 驗證測試名 | `test_finmind_window_cache.py`:既有 5 條(call-count 契約全保留)+ 新增 `test_window_slim_migrates_from_raw_without_finmind_call`、`test_window_slim_aggregates_sessions_and_drops_zero_oi`、`test_window_stale_today_only_refetches_today`(沿用既有)|

### 既有測試「該變」預標

- `test_window_first_fetch_calls_finmind_once_per_date` line 67 `out[d.isoformat()] == [_row(d)]`:回傳 rows 從 raw 13 欄變 slim 5 欄(聚合後)。此 assert 改為驗 5 欄位語意等值。其餘 call-count assert 不動。

## 行為保證不變白名單

- 全部 `backend/tests`(741 passed baseline),特別是 `test_finmind_options.py`(parse 函式零改動)、`test_options_routes.py`(API payload 契約)
- frontend vitest 888 passed / e2e O# spec(如判準需要)
- API 對外 payload:max_pain / oi_walls / pcr / strike_volume / spot 回應欄位與數值完全相同
- FinMind call 次數契約:冷 fan-out / overlap 重用 / refresh trailing-2 / today 30-min stale,全部維持

## S2:strike_volume per-day cache(S1 量測後補,2026-07-20)

S1 後重量測:9 支並發 stale wall 2.20s,殘餘瓶頸 = `strike_volume` 2195ms(profile:
標準單跑 0.84s 幾乎全網路 — 每次 stale 都重抓 7 天 × 全 TXO chain ~8MB;並發時與其他
FinMind 請求搶頻寬放大)。改 per-day cache `txo_sv_{date}`:6 個歷史日凍結,stale 只重抓
今天 1 天(payload 1/7)。

**語意注意**:parse_strike_volume 的 session 聚合 = volume 加總 + OI 取 **MAX**(跨
session),與 window slim 的 OI 加總**不同構** — 不能共用 txo_slim,獨立 per-day 檔存
per (option_id, contract_date, call_put, strike) 的 {v: vol_sum, o: oi_max},保留
vol>0 OR oi>0 entries(兩者皆 0 的 entry parse 本來就 drop,prev-day lookup 語意不變)。
materialize 帶 date 欄(parse 以 (date, cp, strike) 分組)。

### Cache invalidation 三欄

| 欄 | 內容 |
|---|---|
| 失效時機 | 歷史日(< today)txo_sv 檔不朽;today 檔 30-min `_is_stale`;refresh=True 重抓 trailing(today+昨天,同 oi_lt 慣例);`_cache_version` ≠ `_CACHE_VERSION_STRIKE_VOL_DAY` → miss |
| bust 觸發點 | (a) fetch_strike_volume 內 today/refresh 日重抓後覆寫;(b) `_CACHE_VERSION_STRIKE_VOL_DAY` bump(人工);result cache(`*_strike_vol`)沿用既有 `_CACHE_VERSION_STRIKE_VOL` 不動 |
| 驗證測試名 | `test_finmind_window_cache.py::test_strike_volume_per_day_cache_only_refetches_today`、`::test_strike_volume_day_cache_vol_sum_oi_max` |

預期:stale strike_volume 0.84s → ~0.3s;9 支並發 wall 2.20s → < 1.5s。

## Phase 5/7 結果(2026-07-20,同 Phase 1 量測方式:bench_options_page.py)

| Metric | Before | After(S1+S2) | 改善 |
|---|---|---|---|
| options 9 支並發 stale 再訪 wall | 6.12s | **0.60s** | **10.3x**(目標 <2.0s ✓)|
| 單支 stale max_pain | 2.20s | 0.59s | 3.7x(目標 <0.8s ✓)|
| 單支 stale pcr | 4.61s | 0.59s | 7.8x |
| stale strike_volume(並發下) | 6.05s | 0.36s | 16.8x |
| market /snapshot(options stale 同場) | 4.5s+(starved) | 0.37s | 12x+ |
| 溫路徑 9 支 wall | ~0.5s | 0.08s | 無退化 |
| window disk cache | 402.5MB | 20.9MB | 19x 縮 |

- 行為零差異證據:`evidence/before_*.json` vs `after_*.json` 四支 endpoint byte-identical(排除 fetched_at)。
- 其他 metric 無退化:backend 745 passed / ruff clean / frontend 888 passed / build 過;e2e O# 6 passed + M# 9 passed(FAKE 路徑含 raw→slim migration 實跑);refresh=true 與 400 邊界 curl 實測正常。
- FinMind 配額:sv 首次 build +7 req(一次性),之後每日 1 小 call 取代每 30 分 1 大 call — 淨節省。
- 一次性遷移成本:deploy 後首個 stale 請求 ~3.9s(讀 283 raw → 寫 slim → 刪 raw),之後穩態。

## 不做(記 next-time)

- window 結果 in-memory memo(記憶體風險,S1 達標即不需要)
- pcr per-day 預聚合(parse 函式簽名要動,S1 後再評)
- market EOD 每日首請求冷載入(既有設計,skill 已載明勿當 regression 修)
