# Cold-start 優化計畫(perf/cold-start)

日期:2026-07-07。流程:/perf。分支:`perf/cold-start`。

## 背景與動機

Railway 部署(付費方案)開啟 Serverless 後,sleep 喚醒的第一發請求特別久。
User 原始訴求:「冷啟動時間能不能設定 / 間隔久一點」— Railway 的 10 分鐘 idle
門檻**不可自訂**(官方文件只有 Serverless 整體開關),所以走兩條路:
(a) code 端把 app 可控的啟動成本壓到最低;(b) 設定端建議(見 S4,非本流程 scope)。

## Phase 1 baseline(2026-07-07 量測)

| 量測 | 數字 | 方式 |
|---|---|---|
| Prod 冷啟動 TTFB(sleep 喚醒第一發) | **4.88s** | `curl -w time_starttransfer` 打 `neigui-production.up.railway.app/api/_meta/mode`,n=1 觀測 |
| Prod warm | ~0.20s | 同上,n=3 |
| Local time-to-ready(real FinMind) | **1.36s** median | `measure_startup.py`:spawn uvicorn → poll `/api/_meta/mode` 到 200,n=3 |
| Local time-to-ready(FAKE_FINMIND) | **0.66s** median | 同腳本,n=3 |
| TaiwanStockInfo 單發 | 0.44s / 4276 rows / 0.59 MB | 台灣→台灣;US→台灣會被 RTT ~150-200ms 放大 |

## Phase 2 root bottleneck(已證)

`main.py::lifespan` 在 yield 前 `await load_symbols()` — FinMind TaiwanStockInfo
同步等待完成前 **app 不 serve 任何流量**。占 local ready 51%(0.70s/1.36s);
prod 上此段被跨太平洋 RTT 放大,且疊在 Railway 平台 wake 之上。
import 段 0.30s 分散於 fastapi/httpx 無單點大戶(importtime 實測),CP 低不動。

## 目標(Phase 1 gate 定案)

1. **主指標(可重現)**:Local time-to-ready(real)< **0.8s**(= FinMind fetch 完全移出 critical path,回到 fake-mode 水位 + margin)
2. **副指標(觀測)**:Prod 冷啟動 TTFB 自 4.88s 顯著下降(平台 wake 段非 code 可解)

## 策略

### S1|lifespan 非阻塞化 + inflight dedup(採用)

- **做法**:`routes/symbols.py` 加 `ensure_load_task()`(module 持有 `asyncio.Task`
  引用,樣板 = `finmind_realtime._ensure_eod_task`);lifespan 改為 kickoff 背景
  task 即 yield;`_ensure_loaded()` 改 await `asyncio.shield(ensure_load_task())`
  (shield 防 client 斷線毒殺共用 task,對應 cancel-chain 慣例)。
- **預期幅度**:local ready(real) 1.36s → ~0.66s(-51%);prod 冷啟動減去
  「US→TW fetch + 序列化在所有請求前面」的段(估 1-3s)。
- **複雜度**:低(單 module + lifespan 兩行)。
- **新 failure mode 與對策**:
  - 背景載入與第一發 `/api/symbols/*` 競態 → dedup 共用同一 task,不重複 fetch
    (順帶修掉既有「並發空狀態 N 發 fetch」的浪費)。
  - client 斷線傳導取消共用 task → `asyncio.shield`。
  - 背景 task 例外無人 await → done_callback log(樣板同 `_ensure_eod_task`)。
  - shutdown 殘留 pending task → lifespan shutdown cancel + await。
- **配額**:1 request/載入,與現況同;dedup 使並發情境更省。非 cache,
  invalidation 三欄不適用(_symbols 本來就是 process 級 in-memory,生命週期不變)。

### S2|symbols 磁碟 cache(utils.cache pattern)— 不採用

Railway 磁碟 ephemeral(redeploy 全清),sleep-wake 磁碟持久性未證;
S1 已把 fetch 移出 critical path,cache 只能再省第一發 `/symbols/all` 的 0.4-3s
(且與背景載入 overlap 後實際感受更小);換來 listed/delisted 股票 staleness
的 invalidation 負擔。CP 不划算,拒絕。

### S3|import 段優化(lazy import)— 不採用

0.30s 分散無大戶,動了破壞慣例風險 > 收益。

### S4|Railway Serverless 設定(建議,非 code scope)

Idle 門檻不可調;要不冷啟動只能關 Serverless(Settings → Deploy → Serverless,
關閉後需 redeploy 生效)= 24/7 常駐計費。已付費方案下若 wake 延遲仍不可接受,
這是唯一完全解。最終回報時向 user 建議。

## 行為白名單(保證不變,對應既有測試)

- `/api/symbols?search=` 過濾語意(prefix + name substring、cap 20)
- `/api/symbols/all` 回完整清單
- 載入失敗且清單空 → 503 `{"detail":{"error":"symbols_unavailable"}}`
- 空清單 lazy reload 契約(`test_*_lazy_reloads_when_empty`)
- FAKE_FINMIND fixture 旁路與 `FAKE_FINMIND` fail-loud 驗證(仍在 lifespan 同步 raise)
- shutdown 時 finmind client close
- `test_symbols_route.py` 全數不改動且保持綠

**允許改變的(即優化本身)**:app ready 時點提前到 symbols 載入完成之前;
載入窗口內的 `/api/symbols/*` 請求由「連不上(server 未 listen)」變為
「連上後 await 共用載入」— response 語意不變,純 timing。

## E2E 判準(e2e-conventions 已讀,2026-07-07)

API 契約零改動,歸「純 backend service 重構」格 → **豁免新增 spec**;
lifespan 屬基建層,Phase 6 全跑既有 e2e 套件確認(不加新 spec)。
commit message 註 `[no-e2e: startup path only, contract unchanged]`。

## 測試計畫(TDD,紅先行)

1. **RED**:`test_lifespan_startup_not_blocked_by_symbols_load` — monkeypatch
   永不完成的 load_symbols,`asyncio.wait_for(lifespan enter, 1s)` 現行 code 必
   timeout 紅;S1 後綠。
2. 並發 dedup:兩個並發 `_ensure_loaded` 只觸發一次 load。
3. 取消不毒殺:await 中的請求被 cancel,共用 task 不被取消。
4. shutdown 清理:lifespan exit 後無 pending task。
5. 既有 `test_symbols_route.py` 全綠(行為合約)。

## Benchmark 入庫

`backend/scripts/measure_startup.py`(scratchpad 版本 repo 化):spawn uvicorn →
poll `/api/_meta/mode` 至 200,支援 real/fake 模式與 n 次取 median。
回歸守門由測試 1(deterministic,不依賴網路/閾值)承擔;數字追蹤用腳本手動跑。

## Commit 切分(一策略一 commit)

1. `🔴 perf(symbols): lifespan 非阻塞化 — load_symbols 移出啟動 critical path`
   (S1 code + 測試 + benchmark 腳本)
2. changelog PATCH entry(寫前讀 changelog-conventions,依同 ship event 規則
   決定併入或獨立 chore commit)

## Review 修訂(2026-07-07,3-lens 對抗式 review,11 findings 全採納)

- **[P0] 跨 loop 殘留**:`ensure_load_task()` 重建判準 = `task is None or task.done()
  or task.get_loop() is not get_running_loop()`(loop guard);`tests/conftest.py`
  加 autouse reset `_load_task = None`(tests_e2e 同步)。雙保險。
- **[P1] shutdown 規格**:`shutdown_load_task()` — cancel 後 `await task`,
  `except CancelledError: if not task.cancelled(): raise`(不吞外層取消);
  lifespan shutdown 先清 task、`fm_mod._client.close()` 放 `finally`。
- **[P1] done_callback**:先 `if task.cancelled(): return` 再 `task.exception()`
  (樣板 `_cleanup` finmind_realtime.py:637 同款 guard)。
- **[P1] done-task 必重建**:保住「每 request 空清單重試一次」lazy-retry 契約
  (`test_*_lazy_reloads_when_empty` 依賴)。
- **[P2] 失敗信號**:主失敗路徑 = task 正常結束但 `_symbols` 空(load_symbols 內部
  吞例外),post-await `if not _symbols: raise ValueError` 不可省;
  task 被 cancel(shutdown 窗口)→ `if task.cancelled(): raise ValueError` 轉 503,
  awaiter 自身被 cancel(client 斷線)→ 原樣 re-raise。
- **[P2] main.py**:改 import `ensure_load_task`,刪 `load_symbols` from-import
  (monkeypatch 相容 + 單一 task 來源)。
- **[P2] RED 測試**:走 `app.router.lifespan_context(app)`(真啟動路徑);
  綠階段必 `__aexit__` 清背景 task。
- **[P2] e2e gate 顯式化**:`global-setup.ts` 補一發 `/api/symbols/all` 期待非空
  (S1 後 webServer url gate 語意從「symbols 已載」弱化為「server 有回應」)。
- **[P2] prod 宣稱限定**:「減 1-3s」只對不依賴 symbols 的 endpoint 成立;
  `/api/symbols/*` 第一發 e2e 時間 ≈ 不變(fetch 只提早 kickoff)。Phase 5 對照
  分別量兩條路徑,prod 冷啟動 n 拉高。

## 順手發現(不在本次動,記 next-time)

- `load_symbols` 未走 `FinMindClient._get` / TokenBucket / per-module
  `get_finmind()` wrap,為 conventions 制定前的既有債。
