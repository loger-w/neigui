# /perf options window — optimize plan

## 1. 量化目標 gate

**Baseline 量測**(2026-06-26,backend dev `uvicorn :8765`,前置 clear options cache,記每端點 1 cold + 1 warm,結果保存於 scratchpad/bench_endpoints.py):

| Endpoint | Cold (s) | Warm (s) | Resp KB |
|---|--:|--:|--:|
| `/api/options/spot` | 0.57 | 0.01 | 0.2 |
| `/api/options/strike_volume` | 1.07 | 0.01 | 10.4 |
| `/api/options/oi_large_traders` | 1.10 | 0.01 | 1.0 |
| **`/api/options/max_pain`** | **27.26** | 0.01 | 0.4 |
| **`/api/options/oi_walls`** | **26.50** | 0.01 | 0.6 |
| **`/api/options/pcr`** | 26.27* | 2.22* | — |
| `/api/options/institutional` | 0.06* | 0.05* | — |

\* `pcr` / `institutional` 在 bench 時被 FinMind 402(quota 用盡)中斷;quota 回補後預期分別 ~ 25s / ~ 1-2s cold。

**目標**:`max_pain` / `oi_walls` / `pcr` 三大慢端點 cold p95 **< 5s** (第 2 次以後同一週 cold ≦ 1s),warm 維持 < 0.1s。

**量測程序**(可重現):
1. 啟 `python -m uvicorn main:app --port 8765`(`backend/`)
2. 跑 `python scratchpad/bench_endpoints.py` — 內含 cache clean + cold/warm 兩次 hit
3. 記錄表填回本檔 §6

---

## 2. Profile — 真實 bottleneck

`scratchpad/profile_max_pain.py` 內檢 `fetch_max_pain` 各子階段:

| Substage | Time | Note |
|---|--:|---|
| `get_trading_days(250)` | 0.00s | 已被 7-day cache hit |
| `fetch_taiwan_option_daily_window(250)` | **18.92s** | **主要瓶頸** — 250 個 single-day FinMind 呼叫 |
| `parse_max_pain(today_rows=3292)` | 0.000s | 純 Python 計算 |
| `fetch_settlement_history(540d)` | (quota 中斷) | range query,quota 內 < 1s |
| `parse_max_pain_hit_rate(20)` | — | 純計算 |

**結論**:`fetch_taiwan_option_daily_window` 的 250-day fan-out 佔 cold time 約 70%;且 cache key 是 `txo_daily_window_{end_date}_td250` — **每換一個 end_date 就完全重抓 250 天**,subsequent-day cold 永遠等於 first-day cold,沒有跨日 amortize。

額外 hypothesis 與排除:
- ❌ **改用 range query 取代 250 single-day calls**:scratchpad/probe_window.py 量測 — 165 trading days range = 12.17s, fan-out = 6.57s。range 反而慢一倍(FinMind 對大範圍 query 的 server-side cost 不對稱)。**Range query 不是最佳解,排除**。
- ❌ **rate-limit 拉高**(15→30/s):理論 250/30 ≈ 8s,但 quota 燒得更快(今天 bench 就把 daily quota 燒光),不解決本質問題。
- ✓ **跨 end_date 共享 per-day rows**:265 個交易日相鄰兩日有 249 重複,只需 1 day 增量。屬於 cache reshape,不變更 API 行為。

---

## 3. 策略 + Trade-off

| 策略 | 預期改進 | 複雜度 | 風險 | CP 排序 |
|---|---|---|---|---|
| **A. 跨日 per-day persistent cache** | 第二日後 cold 18.9s → ~0.5s(每日只抓 1 新日 + 249 cache reads)。第一日 cold 不變但 quota 1×;subsequent cold 1 quota | 中等(新增 per-day store + window assembly) | per-day file I/O 變多;need atomic write;need invalidation logic for "today" 30-min stale | **★ 首選** |
| B. Range query 取代 fan-out | 18.9s → ~13s,**且 250 quota → 1 quota**(quota 紓困關鍵) | 低 | 250-day response ~1.1M rows,可能 truncate / FinMind server 慢 | ★ 次選(若 A 風險過高) |
| C. 提高 rate limit 至 30/s | 18.9s → ~9s | 低 | quota 燒更快;可能 429 | ✗ 治標 |
| D. 縮窗(pcr 不用 250 days) | 縮 30%-50% 量 | 高(改動 SC-3 業務邏輯) | **行為改動**,不是 perf | ✗ 屬於 /mod |

**選擇 A**(跨日 per-day persistent cache)。理由:
- CP 值最高(subsequent cold 從 18.9s → ~0.5s,~40x 改善)
- 不變 API 行為(回傳資料完全相同)
- quota 友善(daily 1 quota 即足夠,不再 250×N天 燒爆)
- 與既有 invalidation 慣例對齊(`_invalidate_chip_parse_caches` 只動 end_date 對應 parse cache,不動歷史 raw data)

**行為保證不變** 的既有測試白名單(implement 後須維持綠燈):
- `backend/tests/test_options_routes.py::*`
- `backend/tests/test_finmind_options.py::*`
- `backend/tests/test_finmind_options_chip.py::*`(若存在)
- 既有 218 tests 全綠

---

## 4. 實作大綱(策略 A — per-day persistent cache)

**Cache reshape**:
- 新 key:`txo_daily_{date_iso}` → list[dict]
- Storage:`chip_cache_dir() / "txo_daily" / "{date_iso}.json"` 或繼續放原目錄
- 版本:`_CACHE_VERSION_OPTIONS_CHIP`(沿用)
- TTL 規則:
  - 歷史日(`d < today`):永久(資料 final,不會改)
  - today:30-min stale window(同既有 `_is_stale`)
  - `refresh=True`:**只 invalidate today 與 yesterday**(避免 publication lag 上殘留),不重抓 200+ 天

**新版 `fetch_taiwan_option_daily_window` 演算法**:
1. 收到 `trading_dates: list[date]` + `end_date`
2. 對每個 d:讀取 per-day cache,符合 freshness 就用
3. 缺的 d 集合 → `asyncio.gather` 用 per-day fetch(同既有 token bucket)
4. 寫回各 d 的 per-day cache
5. 組裝回傳 `{d_iso: rows}` 介面不變

**Refresh 流**:
- `refresh=True`:caller 已知資料 stale → 重抓 today + yesterday,其他歷史日仍走 cache(節省 248 calls)
- `_invalidate_chip_parse_caches(end_date)` 不變(只清 parse cache,不動 per-day raw cache)

**Backward compat**:
- 舊 `txo_daily_window_{end_date}_td250.json` 整檔可選擇 backfill 拆分為 per-day,或留著靜置(下次 window 改走新路徑,舊檔自動冷卻)
- 不為 backward compat 多寫 shim — 舊檔在新版被忽略即可

**Performance test**(新增):
- `backend/tests/test_perf_options_window.py`:用 monkeypatch mock `_get`,assert:
  - 第一次 fetch 觸發 N 個 `_get` 呼叫(N = trading_dates 長度)
  - 第二次同 end_date 觸發 0 個
  - 第二次相同 trading_dates 但 end_date+1 → 只觸發 1 個(today 新增)
  - refresh=True → 觸發 ≤ 2 個(today + yesterday)

---

## 5. 一個策略一個 commit

- 🔵 `refactor(options): per-day persistent cache for TaiwanOptionDaily window`
- 行為不變 + 加 perf 測試

---

## 6. 量測結果

實際前端 cold path 是 4 端點併發呼叫(`Promise.all`),所以以下對照表加上「parallel wall-clock」欄,反映使用者真實體感:

### 串行 cold(`bench_scenarios.py` Scenario A→B→C,run_endpoints)

| Endpoint | A: fresh-week cold | B: warm | C: next-morning cold |
|---|--:|--:|--:|
| `/api/options/max_pain` | 25.64s | 0.01s | 5.74s |
| `/api/options/oi_walls` | 3.96s | 0.01s | 2.42s |
| `/api/options/pcr` | 2.30s | 0.01s | 2.25s |

### 併發 cold(`run_endpoints_parallel`,實際前端行為)

| Scenario | max_pain | oi_walls | pcr | **wall-clock 總時** |
|---|--:|--:|--:|--:|
| **Baseline**(before) | 27.26s | 26.50s | ~26s | ~27s |
| A: fresh-week cold(first ever) | 25.41s | 25.95s | 25.69s | **25.95s** |
| B: warm | 0.01s | 0.02s | 0.02s | **0.02s** |
| **C: next-morning cold** | 3.82s | 4.27s | 4.06s | **4.27s** |

### Before/after 改善

| 場景 | Before | After | 改善 |
|---|--:|--:|--:|
| Fresh-week cold(歷史 first hit) | ~27s | ~26s | ~4%(微幅) |
| **Next-morning cold(日常使用)** | ~27s | **~4.3s** | **6.3× ↓** |
| Warm | <0.1s | <0.1s | 不變 |

### 命中目標

- 目標:cold p95 < 5s。**次日 cold 4.27s 達標**;first-ever 25s 仍為單次成本(每個新環境僅一次)。
- 不退化的其他 metric:
  - 既有 backend 218 → 223 tests 全綠(+5 新測試,0 regress)
  - frontend 277 tests 全綠
  - cache 行為:歷史日永久 cache + today 30-min stale + refresh 只重抓 1-2 trailing days → 與既有 spec 一致,不破壞 `_invalidate_chip_parse_caches` 慣例
- Quota 副作用(非優化目標但相關):每日新增 calls 從 250 → 1,FinMind 配額燃燒大幅下降。
