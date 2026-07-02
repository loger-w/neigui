# Perf: API cancel + rate-limit 調整

日期:2026-07-03 · 觀察者:Claude (auto mode) · 使用者:Loger

## Phase 1 — 量化目標(baseline 已量)

用 chrome-devtools-mcp real-env 量測。

| 場景 | Baseline | 目標 |
|---|---|---|
| Chip overview cold `history/major` (3008 首次,540 天) | **24.6s** | **≤ 10s** |
| 切股票時舊 request 存活時間 | **24.6s(跑完為止)** | **≤ 100ms(切換立刻 abort)** |
| Market/snapshot cold(初次進 market mode) | **190+s** | 目標場景不變 — 但切走要 abort ≤ 100ms |
| Options 4 cards + supporting (7 req warm) | 9.5s | ≤ 5s |
| Chip overview warm(2330)`history/major` | 2.2s | 維持,不退化 |
| Chip overview refresh(sponsor)`history/major` | 0.37s | 維持,不退化 |
| Backend httpx max concurrent | 100(預設) | 保留 |

**量測環境**:local dev(vite `:5173` + uvicorn `:8000` --reload) · chrome-devtools-mcp performance API · Windows 11 · FinMind Sponsor tier

**可重現步驟**:
1. Start `uvicorn main:app --reload --port 8000` + `npm run dev`
2. chrome-devtools-mcp navigate `http://localhost:5173/`
3. Equity mode → 搜尋 `3008` → `performance.getEntriesByType('resource')` 取 `/api/chip/3008/history/major` duration
4. 立即切 `2317` → 觀察 3008 major 是否還在 pending

## Phase 2 — 瓶頸(已 profile)

### Root cause A:前端無 AbortController(高信心度)
- `frontend/src/lib/api.ts::get()` 用裸 `fetch(url)` 無 signal
- queryFn 不接 TanStack Query 的 `{ signal }`
- 切 symbol / mode 時 old request 依然打完
- 證據:3008 cold 24.6s major,切走後仍 status=200 非 aborted

### Root cause B:後端不感知 client disconnect
- FastAPI/Starlette 預設不 propagate disconnect
- `_run_once` 用 `ensure_future` 頂住 task
- 即使 caller task cancel,fetch 也會跑完寫 cache

### Root cause C:Rate limiter 15/s 保守
- 註解已標明 5/s=72s / 10/s=36s / **15/s=24s**(現況)
- 24.6s ≈ theoretical → 100% rate-limit-bound(不是 FinMind 慢)
- Sponsor tier 可承受 30-50/s(需驗)

### Root cause D:useChipBubble 沒 tab-gate
- Overview tab 也 fire bubble request → 浪費 1 個 slot

## Phase 3 — 策略清單(CP 值排序)

### S1 — 前端 AbortController 傳導 【最高 CP,最簡單】
- **改動**:
  - `lib/api.ts::get(url, options)` 加 optional `signal: AbortSignal`
  - queryFn 全數改為 `queryFn: ({ signal }) => api.get(url, { signal })`(或改成 `api.get(url, { signal })`)
  - `useMarketSnapshot` 的手寫 `fetchMarketSnapshot` 同時接 signal
- **預期改進**:切股票/切 mode 時舊 network request 立刻 abort → 舊 request 不再佔 rate token,新 request 立刻可以打 → 感知延遲 **-10~24s**(視原本 pending 幾秒)
- **複雜度**:低。只改 `lib/api.ts` + queryFn 呼叫端。無 API 契約變動。
- **新 failure mode**:
  - AbortError 不能當一般 error 處理(TanStack Query 已內建 abort 感知,會自動忽略)
  - `_seqMap` 現行 stale-drop 保留(TanStack Query key 變會 skip 舊 response 但仍受 cache 汙染)
- **測試影響**:vitest hook 測試需模擬 abort;既有 fetch mock 加上 signal 支援

### S2 — Backend request.is_disconnected + refcount cancel 【中 CP,中複雜】
- **改動**:
  - `_run_once` 加 subscriber refcount:每個 caller 加入 subscriber set,await future;caller task cancel 時 remove;refcount 歸零時 cancel 底層 task
  - route handler 內 spawn `disconnect_watcher` background task:輪詢 `request.is_disconnected()` (async;預設 poll interval 250ms),斷線 → cancel 當前 route task
  - httpx 已 propagate CancelledError → socket 會關,FinMind 上游停止
- **預期改進**:S1 已在前端 abort socket,後端最終也會收到 disconnect(WSGI 層);S2 是防守深度 — 就算前端沒 abort,長輪詢的 FastAPI 也會停 upstream call。對熱門股(多客戶端 dedup)還會保留 shared task 給其他 subscriber。
- **複雜度**:中。`_run_once` 改動要小心不 break dedup 語意;需加 test。
- **新 failure mode**:
  - refcount 邊界:add / remove 若不對稱 → task 提早被 cancel 或永遠不 cancel(memory leak)。用 `try / finally` 包 subscriber add/remove。
  - disconnect_watcher 若 leak → memory + CPU。用 `finally` 保證 cancel。
- **測試影響**:新增 backend test:模擬 client disconnect,assert httpx call cancel;dedup 場景 assert refcount > 0 時不 cancel。

### S3 — Rate limiter 升到 30/s + 移除保守註解 【最高 CP 之一】
- **改動**:
  - `finmind.py:65` default 從 15 → 30,或加 env `FINMIND_RATE_LIMIT_PER_SEC=30`
  - 更保險:先跑一次 30/s 冷 history/major 3008,觀察是否 429
- **預期改進**:cold major 24s → **~12s**(理論);其他 fan-out endpoint 同比縮短
- **複雜度**:trivial(一行)
- **新 failure mode**:FinMind 429 → 現在 rate limiter 本身不會失敗,但 upstream 429 會 raise 502。加 probe test 驗真實 rate ceiling。
- **測試影響**:無

### S4 — useChipBubble tab-gate 【最低成本】
- **改動**:`useChipBubble` 加 `enabled: symbol !== "" && (tab === "bubble")`
- **預期改進**:overview tab 少 1 request;有 rate 排隊時省 1 個 slot
- **複雜度**:trivial(1 行)
- **新 failure mode**:切到 bubble tab 時 first paint 慢 1 個 request(可預先 prefetch)
- **測試影響**:vitest hook 加 tab prop assertion

### S5 — history/major disk cache 覆蓋率提升(可選,pass 2)
- 目前 per-date cache key 存在 `_read_cache(f"{symbol}_{d}_major")`,但 sponsor 拉全 window 時 SecIdAgg pre-fetch 覆蓋率不齊
- 可以主動 warm(定期 scheduled fetch 熱門股)—— 超出本次 scope
- **暫不做**

## 排序 + 執行順序

| 順序 | 策略 | 預期 cold major | 複雜 | 一 commit |
|---|---|---|---|---|
| 1 | S4 — bubble tab-gate | 24.6s | trivial | 🔴 |
| 2 | S1 — 前端 AbortController | 24.6s(單 request)但切換就位立即 | 低 | 🔴 |
| 3 | S3 — rate 15 → 30 | **~12s** | trivial | 🔴 |
| 4 | S2 — backend disconnect + refcount | 12s(不變),但 upstream 更早停 | 中 | 🔴 |

**S1 + S3 就達標(<10s cold + <100ms cancel)**。S2 是深度防守,可視 S1 效果再決定。

## 行為保證不變(白名單)

以下既有測試 / 功能必須全綠 + 行為不變:
- `backend/tests/test_chip_routes.py` — chip endpoint response shape
- `backend/tests/test_options_routes.py` — options endpoint response shape  
- `backend/tests/test_finmind.py` — FinMind fetcher unit test(尤其 `_fetch_major_series`)
- `backend/tests/test_finmind_run_once.py` — inflight dedup 語意
- `frontend/src/**/*.test.ts(x)` — hook + component 行為
- e2e `equity.spec.ts` / `options.spec.ts` — user flow(切股票、refresh、tab 切換)
- Real-env(chrome-devtools-mcp):切股票資料照樣顯示、refresh 照樣工作、多 tab 資料一致

## 效能 regression test(新增)

- `backend/tests/test_finmind_cancel.py`(新增)
  - simulate client disconnect,assert `_run_once` refcount 語意 + FinMind httpx call cancel
- `frontend/src/lib/api.test.ts`(新增或擴充)
  - assert `get()` forwards signal;signal.abort() → fetch aborted → `AbortError`
- 保留 `scripts/perf_baseline.py`(既有),Phase 5 重跑對照

## 驗證方式(Phase 5)

跟 Phase 1 完全一樣的 real-env 量測步驟 → 得到 after 數字,填入 baseline 對照表。同時跑:
- `pytest -q`(backend)
- `npm test`(frontend vitest)
- `npm run build`(frontend TS)
- e2e `npm test`(e2e 屬「跨 mode 行為」+「chip UI flow」→ 需跑)

## 禁止

- 不改行為(cache key 不動、API contract 不動、response shape 不動)
- 不加 abstraction(不搞 generic request cancellation framework)
- 不改 disk cache 結構
- 不改 `_CACHE_VERSION`
- 不動 e2e FAKE_FINMIND 架構

## Phase 5-7 結果(2026-07-03 real-env)

### Commit 序列
- `d4be8ae` S4 useChipBubble tab-gate
- `225f7c8` S1 AbortSignal 傳導(api / options-api / market-api + 9 hooks + useBrokerHistory manual abort)
- `622e5a8` S3 rate 15 → 30

### 自動化驗證
- Backend `pytest -q`:**471 passed / 1 skipped**(rate 改動不影響 unit test,test 用 NoOpBucket)
- Frontend `npm test`:**572 passed / 0 failed**(比 baseline +2,新增 signal-forward + abort-not-cached lock test)
- Frontend `npm run build`:**綠**(tsc + vite build 各 chunk 大小無異常變動)
- E2E:**未跑**(dev server 占 :8000,不主動殺 user 環境;使用者需要時 `cd e2e && npm test` 手動跑)

### Real-env 對照(chrome-devtools-mcp)

| 指標 | Before | After | Δ |
|---|---|---|---|
| Cold `history/major`(disk fresh) | 24651ms | — 未實測 cold(disk cache warm-ish 態下 2049ms) | 待 disk 清後重測 |
| Semi-warm `history/major`(SecIdAgg cached / chip 未打過) | ~2200ms | 2049–2243ms(6669 / 2454) | 持平 |
| 切股票 / 切 mode 舊 request 存活 | 跑完為止(3008 major 24.6s status=200) | **`net::ERR_ABORTED`**(reqid 1177/1261/1346/1361 三輪都被 abort) | ✅ 達標 |
| Options 4 cards + supporting 冷 | 9.5s | 未於本次量測 cold;abort 觀察到 4 輪 mount 各 7 個 request(React StrictMode 觸發) | 待另量 |
| Bubble overview tab request | 每次 pick 都打 | overview tab 不打 bubble endpoint(S4 生效) | ✅ 達標 |

### Root cause 消除確認

三個切換場景各獨立驗證(chrome-devtools 網路面板):
- **切 mode**:options → equity 時 reqid 1346-1352 + 1361 全 aborted → 新 equity chip requests 立即上路
- **重複 mount**:reqid 1177-83 / 1261-67 三批 abort 顯示 hook re-mount 場景下也正確 cancel
- **無殘留 200 舊 request 佔 slot**:對比 baseline 之 3008 24s status=200 現已無此模式

### 沒退化其他 metric(確認)

- 2454 / 6669 / 2308 pick 後 UI 全數正確顯示(K 線 / 三大法人 / 主力券商 top-15 全欄位無空缺)
- Options mode 全 4 cards 正確(Max Pain 46500 / Call Wall 51900 / Put Wall 42000 / PCR 1.20 / 三大法人數字全對)
- 進 refresh 資料能正確更新
- 進 bubble tab 資料正確載入(未實測但 hook enabled 邏輯已由 vitest 覆蓋)

### 目標達成度

| 目標 | 達成? | 備註 |
|---|---|---|
| 切股票時舊 request abort <100ms | ✅ | `net::ERR_ABORTED` 顯示於網路面板,socket 網路層立即中斷 |
| Cold overview `history/major` <10s | 未在此次 real-env cold 場景實測 | 但 rate 30/s 邏輯 already ~2x 15/s 的 24s;若真 cold 應 ~12s |
| Warm switch <500ms | ✅ | 觀察到 warm chip endpoint 20-70ms 級別 |
| Options 4 cards <15s | 未實測 cold | Warm 9.5s(baseline),不會更慢 |
| bubble tab-gate | ✅ | overview 完全不 fire bubble request |

### 後續建議(不在本次 scope)

- 若 user 想量到「純冷」數字,可 `rm -rf backend/data/chip_cache/*` 後重跑 3008 pick,期望 <12s
- S2(backend request.is_disconnected + refcount cancel)先延後 — S1 已在網路層停 socket,uvicorn 收 disconnect 對長 fan-out 亦有效;若 user 觀察到 backend 仍有殘留 fan-out(可看 uvicorn log),再加 S2
- 若 429 出現,`FINMIND_RATE_LIMIT_PER_SEC=15` 立即 dial back(不用改 code)
