# /perf snapshot-hot-path — optimize-plan

2026-07-02。前置:①mcclellan-scaling(a8288ae)②sector-override-phantom(e2db45b)已 merge。

## Phase 1 — 量化目標(gate)

| Metric | 現況(實測) | 目標 | 量測方式 |
|---|---|---|---|
| warm snapshot | **37.1s**(component profile)/ 37.3s(curl) | **< 3s** | `urllib` timing 對 `:8000/api/market/snapshot`(uvicorn --reload dev) |
| refresh=true | ~278s + 128 FinMind calls(audit) | **< 10s** | 同上帶 `?refresh=true` |
| event loop 阻塞 | cold compute 期間其他 endpoint 被卡(sync json.load 7.9s×4) | 並發請求不被 EOD parse 卡 | cold compute 進行中並發 curl `/api/symbols`,量 latency |
| cache 增長 | breadth_prices_* 每日 +1.5GB,零清理(現況 2 檔 3.06GB) | 增長有界(steady state ≤ 當日檔) | cache dir du + 檔案數 |

可重現量測腳本:`scratchpad/profile_snapshot.py`(component 分解)+ curl timing one-liner。

## Phase 2 — Profile 證據(2026-07-02 實測)

```
component                     seconds   share
intraday(universe+sector+mv+watch+純計算)  0.61   1.6%
eod_breadth(P2)                  9.29  25.1%
eod_sector_breadth(P3)           9.19  24.8%
eod_vol_ratio(P3)                9.07  24.5%
eod_amount_share(P4)             8.91  24.0%
TOTAL                           37.06        universe=1917
```

- 單次 `json.load`(1.52GB,5.75M rows)= **7.9s**;4 compute 各自 re-parse 同一檔 = 31.6s
- **Root bottleneck = 每 request 4 次重複 parse**,不是 aggregation 計算(每 compute 扣 parse 後僅 ~1.2s)
- 裁欄實測:keep 5 keys 只縮到 **0.578x(0.88GB)**,audit 的「~10x」估計錯誤(值域佔大頭)
- rows 5.75M = 全市場 ~2 萬 instrument(universe 只 1917 檔,但 cache 是 raw upstream 語意)

## Phase 3 — 策略裁決(CP 值排序)

| # | 策略 | 預期改進 | 複雜度 / 風險 | 裁決 |
|---|---|---|---|---|
| C1 | EOD result-level cache,key=(end_date, universe_digest) | warm 37s → ~0.6s(消滅全部 4 次 parse;98.4% 佔比直接歸零) | cache invalidation 風險:component None 不得 pin;universe 變動要重算(digest 進 key);refresh 語意本 commit 不動 | **採納,最先** |
| C2 | refresh 只 bust intraday,不進 EOD fetcher | refresh 278s → ≈warm(EOD 是 T-1 資料,「重新整理=看最新盤中」心智模型) | 🔴 行為改動:失去「手動強制重抓 EOD」路徑(補償:end_date 前進自然失效 + version bump 後門) | **採納**(紅測試先行,獨立 commit) |
| C3 | ~~大 JSON read/write `asyncio.to_thread`~~ **實驗推翻**(2026-07-02):`json.load` 是單一 C call、整份文件 parse 期間持 GIL,to_thread 下實測 ticker max gap 6.35s / real-env 探針 max 8.98s — to_thread 救不了 CPU-bound C parse | — | 假綠教訓:sleep-mock 單元測試會釋放 GIL,測不到這個 | **改 C3a/C3b** |
| C3a | breadth_prices cache 改 chunked JSONL(meta 行 + 每 100k rows 一行),read/write 逐 chunk `json.loads/dumps` in to_thread | GIL stall 上界 = 單 chunk ~65-100ms(合成實驗:2.4M rows chunked parse ticker max gap 97ms vs 單文件 6350ms) | 格式變更 bump `_CACHE_VERSION_BREADTH` 1→2(一次全量重抓);legacy 單文件檔讀取要 cheap-invalidate 不整份 parse | **採納** |
| C3b | `_fetch_eod_results` 以 `sa._derive_window` 預抓 rows 一次,注入 4 個 compute(加 optional `prices` 參數) | recompute 4 次 parse → 1 次(wall ~34s → ~11s);冷啟動 fetch 後 rows 已在記憶體,3 個 sibling 零 parse | 簽名 add-only;window 對齊沿用 T36 lock 慣例補測試 | **採納** |
| C4 | 寫新 window 檔時 pattern-delete 舊檔 | 增長有界:3GB+/∞ → 單日檔 steady state | 小;對齊 `_invalidate_chip_parse_caches` 慣例 | **採納** |
| C5 | 寫入裁欄 5 keys + bump `_CACHE_VERSION_BREADTH` | 檔 1.52→0.88GB(1.7x),cold parse 7.9→~4.6s | 小;bump 觸發一次全量重抓(合法);**實測效益遠低於 audit 估計,降為最後** | **採納(降級)** |
| — | json.load → 由 C1 消滅重 parse | (併入 C1) | — | 併入 C1 |
| C6 | payload 加 `eod_as_of: string \| null` | 非 perf;P5 前端依賴的 add-only 欄位 | 🟢 獨立 commit | **採納**(prompt 明列) |
| — | 增量 fetch(重用昨日 window 檔只補新交易日,消滅每日 277s 冷啟動) | cold 277s → ~10s | 大改:cache key 設計重構,與 C4 清理互動 | **不採納**,寫 next-time(目標 gate 不含 cold) |

**一個策略一個 commit,每 commit 後量測歸因。順序:C1 → C2 → C3 → C4 → C5 → C6。**

### C1 設計細節(cache invalidation 特別小心)

- 位置:`finmind_realtime.py` 把 4 個 EOD compute 包成 `_fetch_eod_results(end_date, allowed, primary_sector, refresh)`
- Key:`eod_results_{end_date}_{md5(sorted(allowed))[:12]}`,走既有 `_read_cache/_write_cache`(`_CACHE_VERSION_REALTIME` 版控)
- **component None(compute 失敗)不寫入 cache** → 下一 request 自動重算該 component,不 pin 失敗
- universe 盤中變動(早盤 tick 稀疏)→ digest 變 → 重算:正確行為,非 bug
- 語意等價論證:prices cache 本就 24h TTL,同日內 EOD 結果已凍結;result cache 以 end_date 為 key = 同一凍結窗,**行為不變**
- refresh=true 本 commit照舊 bypass result cache + 傳進 fetcher(C2 才改語意)

## 行為不變白名單(全程必綠)

- backend 全部既有測試(453 passed 基準)= P1/P2/P3/P4 行為合約
- payload shape:既有欄位全部不動(C6 只 add)
- equity `/api/chip/*`、options `/api/options/*` 不碰
- Bull/bear、排序、None-safe、known_gaps 語意不動

## Phase 5 量測計畫

每 commit 後:warm curl;C2 後加 refresh curl;C3 後加並發 latency;C4/C5 後 cache dir du。
最終跑 Phase 1 全表 + 不退化檢查(`/api/symbols` 或 chip endpoint 抽一個量 baseline)。
