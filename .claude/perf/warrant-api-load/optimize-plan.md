# /perf warrant-api-load — optimize-plan(2026-07-15)

Baseline 與 profile 證據見同目錄 `baseline.md`。目標:2330 權證 tab 首開 冷 ≤5s / 熱 ≤2s。

## Root bottleneck(Phase 2 實驗定案;E4 後修正)

1. **[主因,E4 修正] TWSE MI_INDEX 未命中其 server-side cache 的重算本身就要 10-20s/查詢**:17:43 乾淨環境(backfill 讓路後、零併發流量)預熱 build 的 MI_INDEX 仍花 ~12s;E1(17:22,前一 build 剛暖過 TWSE cache)同查詢 0.23s。此成本在 TWSE 端,我方不可壓縮 → 正解 = 使用者請求永遠不當付款人(S3/S5)。
2. **[加重因] iv backfill 啟動即轟 TWSE**:E3 對照(停 backfill 後 43.5s → 4.62s)有 TWSE cache 殘暖的混淆,但 backfill 的歷史慢查詢(11-16s/個,E2 實測)串行佔用 + 對週末日白工掃描(~34 日 × 4 req + 5s sleep)確實與冷 build 搶資源,仍值得修(S1)。
3. **[次因] `_build_snapshot` 六個 upstream fetch 全序列**:並發化省掉第二個 MI_INDEX 的 10-20s(未命中日)+ TPEx 序列 ~2.4s(S2)。
4. IV 反解 37,957 檔僅 0.5s — 舊線索「63s = IV 反解」證偽。
5. **[S3 缺口 → S5] 預熱只在啟動跑一次**:長駐 backend 跨午夜後快照 stale,每日首請求仍付冷 build → 需背景 freshness keeper。

## 策略(優先序 = CP 值)

### S1|backfill 跳過週末日(root cause 修正,第 1 commit)

- **改動**:`warrant_iv_history._backfill` 掃描 loop 對 `d.weekday() >= 5` 直接 continue(不發請求、不 retry sleep)。台股週六補班日自 2016 起休市,週末必無資料 — 現行對每個週末日照發 4 請求 + 5s sleep 是純白工。
- **預期**:每次啟動省 ~34 日 × (4 req + ≥5s) ≈ 少 136 個 TWSE 請求與 ~3-8 分鐘轟炸窗;連帶把冷 build 撞節流的機率大幅壓低。
- **複雜度**:+2 行。**風險**:無(週末休市為監管事實);假日(非週末)照掃,語意不變。
- **測試**:`test_backfill_skips_weekend_days`(mock fetch_mi_index,assert 呼叫日期不含週六日)。

### S2|`_build_snapshot` upstream 並發化(第 2 commit)

- **改動**:同一候選日的 MI_INDEX 0999/0999P 並發;找到 as_of 後 t187 + TPEx quts/close/issue 四路並發(`asyncio.gather`)。跨候選日回退仍序列(語意不變)。
- **預期**:冷 build 4.6s → **~2s**(max(單路) + IV 0.5s)。E1b 實測 TWSE 對同日兩型並發無礙;TPEx OpenAPI 為靜態 JSON dump,並發 3 路溫和。
- **複雜度**:低(gather + 解構)。**風險**:錯誤語意 — gather 預設首個 exception propagate,其餘 task 不被 cancel(fire-and-forget 完成即棄);與現行「任一 fetch 炸 → build 炸」等價。
- **測試**:`test_build_fetches_run_concurrently`(mock fetch 記 in-flight 峰值 >1);既有 build 測試全綠 = 行為不變證據。

### S3|lifespan 預熱 snapshot build + backfill 讓路(第 3 commit)

- **改動**:`main.py` lifespan spawn 背景 task:`await warrants.get_snapshot()`(預熱,失敗 log warning 後放棄 — lazy 路徑接手)→ 完成後才 `ivh.ensure_backfill_task()`(backfill 排在預熱 build 之後,不搶 TWSE)。FAKE_FINMIND=1 不預熱(沿 ensure_backfill_task 慣例),但仍照舊 spawn backfill 入口(其內部自帶 FAKE no-op)。shutdown 時 cancel 該 task。
- **預期**:使用者可見冷首開 → 幾乎恆熱(<1s);趕在預熱完成前開頁也只等殘餘時間(`_run_once` inflight join)。
- **複雜度**:低-中(一個 orchestration task + 生命週期清理)。**風險**:(a) 每次啟動固定付一次 build(~6 upstream 請求、TWSE/TPEx 零配額)— dev --reload 頻繁重啟時多打,可接受;(b) 非交易日啟動 → build 7 天回退,與現行 lazy 行為相同;(c) build 失敗 → warning + lazy 接手,啟動不阻塞。
- **測試**:`test_lifespan_prewarms_snapshot`、`test_backfill_starts_after_prewarm`(順序斷言)、`test_prewarm_skipped_when_fake`。

### S5|snapshot freshness keeper(第 5 commit,S3 的跨午夜補完)

- **改動**:`_prewarm_then_backfill` 尾端進常駐 loop:每 `SNAPSHOT_FRESHNESS_INTERVAL_SEC`(300s)呼叫一次 `_load_snapshot(refresh=False)` — fresh 時為純 mem 檢查(~0 成本),跨午夜 stale 後最遲一個 tick 內背景重 build。失敗記 debug、下一 tick 重試(60s backoff 防風暴)。
- **預期**:長駐 backend 的「每日首請求付冷 build」徹底消滅;使用者可見冷路徑只剩「正好撞進 build 進行中」的 join 殘餘。
- **複雜度**:+10 行(同一 task 內 loop,shutdown 既有 cancel 覆蓋)。**風險**:每日凌晨多一次背景 build(~10 upstream 請求、零 FinMind 配額);資料語意與 lazy 路徑逐位相同(fetched_on 判準不變)。
- **測試**:`test_freshness_keeper_reloads_after_prewarm`(interval 縮短後斷言 ≥2 次 load)。

### S4|quotes MIS 批次有限並發(第 4 commit,熱路徑 margin)

- **改動**:`warrant_quotes._build_quotes` 的 16 批序列 → `asyncio.Semaphore(3)` 有限並發,結果按批次序合併(dict update 無序敏感)。
- **預期**:盤中熱首開 quotes 1.4-1.8s → **~0.6s**(貼 2s 線 → 有 margin);盤後 0.35s → ~0.15s。
- **複雜度**:低。**風險**:MIS 非官方端點,spec S-6 當時保守選擇序列(單批 145 炸是 size 上限,非並發證據)— 並發度取 3 溫和試探;若真實環境驗證(Phase 6)出現 MIS 錯誤/封鎖徵兆,單獨 revert 本 commit。
- **測試**:`test_mis_batches_bounded_concurrency`(記 in-flight 峰值 ∈ (1, 3]);既有 quotes 測試全綠。

## Cache invalidation 三欄(強制檢查)

本計畫**不新增任何 cache 層**:S3 預熱只是提早呼叫既有 `_load_snapshot`,沿用其失效機制。既有機制不動,列示如下供核對:

| 欄 | 內容 |
|---|---|
| 失效時機 | snapshot:`fetched_on != clock.today()` 即 stale;`_CACHE_VERSION` bump 全作廢 |
| bust 觸發點 | `/api/warrants/{id}?refresh=true`(唯一重 build 入口,R11);cooldown:`?refresh=true` on quotes |
| 驗證測試名 | 既有 `test_refresh_skips_valid_cache` / `test_cache_version_bump_invalidates` / `test_file_cache_survives_process_restart`(必須維持全綠) |

## 行為保證不變白名單

- `get_underlying_warrants` / `get_quotes` payload shape 與數值(iv_prev、iv、mispricing…)完全不變
- build 失敗語意:空回不覆寫非空 cache、7 天回退全空 404、60s backoff — 不變
- backfill 產出 archive 內容不變(僅:不掃週末、啟動時序延後)
- quotes cooldown 10s、前端 15s 輪詢 — **user 明示設計值,不動**
- error contract(502 warrant_upstream / 404 not_found)不變
- 既有 backend 703 測試 + frontend 802 測試全綠

## 不做(本輪)與理由

- **chip 主力 fan-out 優化**:量測後冷 150d = 2.4s(可見窗)/ 540d +6.5s(背景)、熱 <1s — 無單一 bottleneck(受 FinMind 單日 API 形狀 + 40/s rate limiter 界定)。改善方向是「540d 拖曳才抓」(已分流 /mod,省配額為主)與增量 fetch(next-time 既有條目)。本輪不動。
- **backfill「weekday empty」資料完整性問題**(7/10 慢查詢回空疑似 transient):屬 bug 調查,不混 perf,記 next-time。
- **flow warm 路徑 T+0 dump ~2s**:設計常數(R15),user 未列目標;不動。
- **orjson / 增量 fetch**:與本 bottleneck 無關。

## Benchmark 入庫(Done 條件之一)

`backend/scripts/bench_warrant_api.py`:對本機 :8000 量 warrants/quotes 冷熱時序(冷 = 指示先 stash snapshot 重啟),輸出對照表;可重複跑。
