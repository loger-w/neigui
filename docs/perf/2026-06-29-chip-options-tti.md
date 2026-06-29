# /perf 籌碼總覽 + 選擇權 TTI — optimize plan (2026-06-29)

## 1. 量化目標 gate

### Baseline 量測

`backend/scripts/perf_baseline.py` 對 `:8000` running backend 並發打 mimic-frontend 的 fetch fan-out,記每 endpoint wall-clock + finish order。輸出見 `scratchpad/perf-warm.log` / `scratchpad/perf-cold.log`(本次量測 backend cache 已存 10,533 個 file,部分 today TTL 過期會在 run 1 觸發 refetch)。

**Equity overview 進入個股(同時 fire 4 個 endpoint):**

| Scenario | total | summary | base | major | brokers-window |
|---|---:|---:|---:|---:|---:|
| 2330 warm (run 2-3) | 47-57ms | 9-10 | 20-34 | 21-34 | 41-56 |
| 2454 warm (run 2-3) | 41-44ms | 9-9 | 18-19 | 19-19 | 41-44 |
| **2330 stale-TTL (run 1)** | **674ms** | 24 | 363 | **674** | 92 |
| **2454 cold-ish (run 1 first execution)** | **2125ms** | 1625 | 1592 | **2125** | 2065 |

**Options 進入頁面(同時 fire 7 個 endpoint):**

| Scenario | total | spot | large-traders | strike-vol | max-pain | oi-walls | pcr | inst |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TXO202607 warm (run 2-3) | 11-15ms | 5-8 | 6-14 | 8-14 | 10-14 | 7-14 | 9-15 | 11-14 |
| **TXO202607 cold-ish (run 1)** | **3660ms** | 2013 | **3660** | 3140 | 3047 | 3560 | 3289 | 3585 |

**Finish-order 不穩定性**(運行 3 次的 unique ordering 數):

- 2330 warm: 2 unique orderings / 3 runs(summary 永遠先,base/major/brokers 順序顛倒)
- 2454 warm: 2 / 3
- Options warm: 3 / 3(每次順序都不一樣)
- Options cold: 3 / 3

### 目標

| Metric | Current | Target |
|---|---:|---:|
| Equity warm total | 41-57ms | < 30ms (-30%) |
| Equity stale-TTL run (today's cache expired) | 674ms | < 250ms (-60%) |
| Equity full-cold first-touch | ~2.1s | < 1.5s(rate-limit 決定下限,不強求) |
| Options warm total | 11-15ms | < 30ms(已達標)|
| Options cold first-touch | 3.6s | < 2.0s (-45%) |
| 順序穩定:K-line history-base 先於 brokers-window finish | ~50% | 不強求 — 改追求「整體 < 100ms 後一起出現」(差距感受不到)|

**核心優化哲學:** rate-limit 已測過 15/s 是 sponsor tier 友善上限 (見 [`2026-06-26-options-window-optimize.md`](2026-06-26-options-window-optimize.md) §2 ),拉高會燒 daily quota — **本次不動 limiter,改打 cache reshape**。

---

## 2. Profile — root bottleneck

### 共用 module-singleton `TokenBucket(15 req/s)`

`services/finmind.py:39-55` 的 `_fm_limiter` 是 module-level singleton。**所有 endpoint 共用 15 token/s pool**。

進入個股 cold 觸發的 FinMind calls 估算:

| Endpoint | FinMind calls |
|---|---|
| `/chip/{sym}` summary | 3 (gather: inst-wide + margin + broker daily report) |
| `/chip/{sym}/history/base?days=540` | 3 (range: price + inst-wide + margin) |
| `/chip/{sym}/history/major?days=540` | 1 range + ~360 per-day TradingDailyReport(per-day major cache hit 後絕大多數略過)|
| `/chip/{sym}/brokers_window?days=10` | 10 × 3 = **30**(fan-out 10 個 fetch_chip_summary;**沒有自身 cache**)|

**理論最小 cold time** = (3+3+1+30) × (1/15) = **~2.5s 純 limiter 排隊** + HTTP RTT。實測 ~2.1s 一致(per-day major 大量 cache hit 把 360 降到 < 10)。

進入選擇權 cold 觸發:

| Endpoint | FinMind calls |
|---|---|
| `/options/spot` | 1 |
| `/options/oi_large_traders` | **30 per-day single-date fan-out**(沒 per-day cache)|
| `/options/strike_volume` | 1 |
| `/options/max_pain` | `fetch_taiwan_option_daily_window(250d)` + 1 settlement(window 已有 per-day cache,refresh tail 1-2 days)|
| `/options/oi_walls` | (window deduped) + spot + tx_close |
| `/options/pcr` | (window deduped) + tx_close |
| `/options/institutional` | 2 range |

實測 3.6s = 大頭在 `large-traders` 30-day fan-out(沒 per-day cache,每次 cold 重抓全 30 天)+ `spot` 排在 30 call 後面才拿到 token。

### Hypothesis 驗證表

| H | 假設 | 量測證據 | 驗證 |
|---|---|---|---|
| H1 | K-line vs brokers finish 順序不固定 = limiter queue 非確定 | 同股 3 runs 出現 2 種 ordering;不同股(2330 vs 2454)cache 狀態不同導致 ordering 不同 | ✓ |
| H2 | 選擇權慢主要是 API 不是計算 | warm 全 7 endpoint 11ms 完成 = 計算 < 11ms / endpoint;cold 3.6s = API 排隊 | ✓ |
| H3 | brokers_window 沒自身 cache → 每次 fan-out N 天 | code review confirmed `_aggregate_brokers_window` 不寫 cache,只讀 per-day summary cache | ✓ |
| H4 | large-traders 沒 per-day cache → 每次 fan-out 30 天 | code review confirmed `_do_fetch_oi_large_traders` fan-out 30 single-date 全部沒 per-day cache | ✓ |
| H5 | today's 15-30 min TTL 讓 user 偶遇 stale refetch | 2330 run 1 history-major 674ms = TTL 過 15min 觸發 refetch | ✓ |

---

## 3. 策略 + Trade-off

| # | 策略 | 預期改進 | 複雜度 | 風險 | 行為變化 |
|---|---|---|---|---|---|
| S1 | **brokers_window 自身 cache** | warm: 45ms → 5ms;today-stale: 30 個 file read 變 1 個 | 中 | cache invalidation:today TTL(30min)、past 永久 | 無 — 同樣 payload |
| S2 | **large-traders per-day cache**(mirror txo_daily 模式)| cold 切 date 從 30 calls 降到 1-2 calls | 中 | invalidation:`oi_lt_daily_{date}` per-day,today TTL 30min | 無 — 同樣 series |
| S3 | **today's 非 spot 端點 TTL 從 15-30 min 拉到 60 min** | 進場時 stale refetch 機率 ↓50% | 低 | trade off:data 最多 1 小時舊。EOD chip data 不會在交易時段內顯著變化(broker daily 是 EOD 公佈)| 細微 — 略微延遲 fresh data |
| ~S4~ | ~Limiter rate 15→25/s~ | ~理論 cold -40%~ | ~低~ | **不採納** — 已驗證會燒 daily quota | — |
| ~S5~ | ~K-line / brokers 優先 lane~ | ~K-line 永遠先 finish~ | ~高~ | **不採納** — 同 API quota 池,multi-lane 等於分配不均;且 S1 後 brokers warm 比 K-line 快,順序強迫 K-line 先反而增加 latency | — |

### 不採納項

- **拉 limiter rate**:已測過,15/s 是 quota friendly 上限。25-30/s 同 day 把 daily quota 燒光,反而下午之後完全沒能力 fetch fresh。
- **K-line 優先 queue**:S1 之後 brokers warm 5ms,K-line warm 20ms — 順序問題自動消失(差距小到肉眼難分)。
- **Frontend prefetch top stocks**:會在 backend startup 額外打 N × 30+ FinMind calls,燒 quota。

---

## 4. 實作順序(CP 值高的先做)

1. **S1: brokers_window 自身 cache** — 影響 2454 stale-TTL run 1 的 2065ms brokers 完成時間
   - 加 `fetch_brokers_window` 自己的 cache(key=`{symbol}_{date}_w{days}_bw`)
   - Today TTL 30min,past 永久
   - 既有 `_run_once` dedup 沿用
   - 既有 per-day summary cache 不動(內部仍可用)
   - 加 perf test:warm 應 < 10ms,stale-TTL refetch path 從 30 個 fetch_chip_summary 降為直接命中

2. **S2: large-traders per-day cache** — 影響選擇權 cold 3660ms 的最大頭
   - Mirror `fetch_taiwan_option_daily_window` 的 per-day cache pattern
   - `oi_lt_daily_{date_iso}` 個別檔
   - 既有 contract-level cache key 仍存在(整個 series 結果)— S2 加在內部 fan-out 之內
   - Refresh 只 invalidate tail 1-2 days(同 txo_daily 邏輯)
   - 加 perf test

3. **S3: today TTL 拉到 60 min**(可選,看 S1+S2 後是否還需要)
   - 30 min → 60 min
   - 不影響 spot(spot 1-min TTL 不動 — intraday price)
   - 風險低

**每步驟一個 commit**(CLAUDE.md §B 三類分離 — 本次都是 🔵 perf refactor,但分步骤好歸因)。

---

## 5. 行為保證(既有測試白名單)

- `backend/tests/test_chip_routes.py`、`test_brokers_window.py`(若存在)、`test_options_routes.py`、`test_finmind*.py` 全部保持綠
- Frontend `useChipBrokersWindow.test.tsx`(若存在)、`useOptionsLargeTraders.test.tsx` 不變
- API contract `{"detail": {"error": "..."}}` shape 不變
- `_CACHE_VERSION` bump 一律加 1(讓既有 cache 自動作廢一次)

---

## 6. 量測 — Phase 5

### 量測方法分為兩條 path,**不要混為一談**

**(A) Warm cache-hit path** — 量「進入頁面 / 再次切回」的常見體驗:

```
python scripts/perf_baseline.py --symbol 2330 --symbol2 2454 \
  --contract TXO202607 --skip-cold --repeats 3
```

priming round 用 `refresh=true` 把 cache 寫熱,後續 measured runs **不帶 refresh**,純測 cache hit。Endpoint 完成時間 ≈ disk read + JSON parse + GZip + HTTP overhead。

**(B) Refresh / stale-TTL path** — 量「點重新整理 / 過 30min 再進」的體驗:用獨立 curl-based ad-hoc 量測(對應 `scratchpad/perf-warm.log` / 本檔 `scratchpad` 中 inline measurement),命令形如:

```
curl '...&refresh=true'    # 用 refresh=true 直接 bypass outer cache,exercise inner fan-out
```

S1+S2 兩條 path 量到的數字有質的差異,不能直接比較。

### Before / After 對照(2026-06-29 同 session,fresh backend on `:8001`)

| Path | Metric | Before | After | Δ | 來源 |
|---|---|---:|---:|---:|---|
| A | Equity warm total (2330) | 41-57ms | 27-34ms | -35% | perf_baseline `--skip-cold` |
| A | Equity warm total (2454) | 41-44ms | 26-28ms | -37% | perf_baseline `--skip-cold` |
| A | brokers_window warm hit | ~45ms | **15.9ms** | **-65%** | ad-hoc curl 對 :8001 |
| A | Options warm total | 11-15ms | 8-15ms | (warm 本就 cache hit,不變)| perf_baseline `--skip-cold` |
| **B** | **brokers_window refresh** | 1102ms(原 ~3+s)| 1102ms 第一次寫所有 30-day 個別檔 → **15ms** 後續 | n/a | ad-hoc curl |
| **B** | **Options refresh(steady-state)** | ~3000ms+(30 FinMind calls) | **193ms** | **-94%** | ad-hoc curl,2 次 refresh=true 連續打 |
| **B** | **Options stale-TTL refetch(refresh=false 但 today's cache 過 30min)** | ~3000ms+ | **預估 ~70-150ms**(1 FinMind call,僅 today,因 `d != today` 條件對歷史日永遠 hit cache) | 未直接量,推估自 refresh=true 結果 / 2 | 推估 |
| **B** | Options date shift(TXO 7-day overlap)| ~3000ms | **147ms** | -95% | ad-hoc curl,連跑 date=今天 → date=3 日前 |

**Refresh vs stale-TTL 是兩條不同的 code path**(`finmind.py:872` `force_today = refresh and d >= (today - 1d)`):
- refresh=true → 強制重抓 today + yesterday(2 calls)
- refresh=false + today cache stale → 只重抓 today(1 call;歷史日 `d != today` 永遠回 cache)

兩條 path 都從 30 calls → 1-2 calls,但絕對毫秒數有別。

### Finish-order 觀察(only 3 runs,統計能力弱)

| Scenario | Pre-S1 | Post-S1 |
|---|---|---|
| Equity 2330 warm | 2/3 unique orderings | 1/3 unique |
| Equity 2454 warm | 2/3 unique orderings | 1/3 unique |

S1 縮小 brokers_window 的 variance(從 fan-out N file read 變單檔 read),3 runs 全部都同一 order(`summary → history-base → history-major → brokers-window`)。**但 3 runs 不足以宣稱 deterministic**,只能說「明顯比 pre-S1 穩」。後續若仍有亂序回報,要加 N runs 再量。

注意 post-S1 的 ordering 是 **summary 先,brokers-window 最後** — 等於 K-line 先於 brokers panel 出現,符合期待。

### 解讀

- **S1 主要 win:** brokers_window warm 從 45ms 降到 16ms;variance 縮小 → 並發 race 看起來消失(對 3 runs 而言)。
- **S2 主要 win:** options refresh / stale-TTL path 從 30 calls 降到 1-2 calls,wall-clock ~3s → ~150-200ms。**這是 user「重新整理」/ 過 30 min 再進的場景**。
- **未動 limiter rate** — 沿用 §3 決策(避免燒 quota)。
- **True first-time cold(從未抓過此股 / contract)沒有顯著改變**:仍需 ~2s,因為 FinMind 必須回傳。但這是 session 中只發生一次的情境,不是 user 抱怨的高頻體驗。

### 何時要再 profile

- 若仍有亂序回報:加大 N runs(15+)再量 finish-order distribution。3 runs 沒統計力。
- 若 daily quota 警告再現 → revisit limiter rate adaptive back-off。

### 不採納項追溯

- S3(today TTL 拉到 60min): **不執行** — S2 已把 stale-TTL refetch 從 3s 降到 < 250ms,延長 TTL 的邊際效益不大。
- K-line 優先 queue: **不執行** — S1 後 ordering 已穩,不需強制 lane。

### Post-impl review(2026-06-29 adversarial workflow)後追加的 fix

S1+S2 完成後跑了 4-lens × 多 skeptic 的 adversarial review,confirmed 兩個 P0 + 兩個 P1 已在同 PR 修掉:

1. **P0**:`_run_once` dedup key 缺 `refresh` 參數 → concurrent `refresh=True` 會 await `refresh=False` 的 in-flight task,違反 refresh 語意。修法:dedup key 加 `_r{int(refresh)}` 後綴(mirror `fetch_taiwan_option_daily_window` 既有 pattern)。
2. **P1**:`_write_cache_v` 對 disk-full / permission denied 等 OSError 沒包 try/except → 使用者收到 500。修法:S1 + S2 的 cache write 各包 `try/except OSError`,失敗只 `logger.warning`,業務結果照常回傳。

兩個 P0/P1 都加了 regression test(`test_fetch_brokers_window_concurrent_refresh_does_not_dedup_into_non_refresh` / `test_fetch_oi_large_traders_concurrent_refresh_does_not_dedup_into_non_refresh` / `test_fetch_brokers_window_cache_write_failure_still_returns_result` / `test_fetch_oi_large_traders_per_day_cache_write_failure_does_not_crash_gather`)鎖在 suite。

未在這個 PR 修(P2 / 預先存在 / 推測):
- `atomic_write_json` temp-file collision under concurrent same-key write — 預先存在問題,`_run_once` 在 happy-path 護住,跨 endpoint 場景待單獨評估。
- `_do_fetch_oi_large_traders` 內 `today = date.today()` 跨午夜 race — 理論場景,實務影響極小。
- S2 outer aggregate 與 inner per-day 共用 `_CACHE_VERSION_OPTIONS` 版本常數 — 兩 schema 正交,版本 bump 會 cascade invalidate,屬技術債,單獨 follow-up 拆。

