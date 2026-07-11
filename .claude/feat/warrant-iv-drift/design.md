# design — warrant-iv-drift v4(Phase 1 定稿)

Changelog:
- v4(2026-07-11):review round 3(0×P0 / 1×P1 / 4×P2,退出條件成立)全 5 條折入 — refresh 不重跑 rebuild(R21:archive 回傳 wrote)、rebuild 檔集合自檢再跑(R22)、backfill 起點 today-1(R23)、序列洞補 null placeholder 定案(R24)、rebuild timing log + IO yield(R25)。
- v3(2026-07-11):review round 2 全 9 條 accepted(design-review-round-2.json)— 序列 LRU generation guard(R12)、rebuild yield + CPU 量化 + 降階條款(R13)、lazy rebuild 真實模式改背景 spawn(R14)、非交易日判定 retry(R15)、underlying_close fallback + Known Risk(R16)、FAKE 不 spawn run_post_build / rebuild 不落檔(R17)、讀取端版本驗證(R18)、backfill 脫鉤 snapshot 入口(R19)、rebuild 三觸發點 _run_once 串行化(R20)。
- v2(2026-07-11):review round 1 全 11 條 accepted(design-review-round-1.json)— archive/rebuild 背景化(R2/R11)、FAKE lazy drift accessor(R1)、TPEx 落後日不寫入(R3)、rebuild 清序列 LRU(R4)、rel 公式定案(R5)、攤平規則(R6)、保留策略+讀取統一 60 檔(R7)、倒掛雙側 None(R8)、wn1430 pytest fixture 補位(R9)、merge shallow copy(R10)。
- v1(2026-07-11):初版。

對應 `brainstorm.md` SC-1〜SC-8。方案 A(per-day distilled archive + 每日預算 drift + on-demand 序列組裝)。

## 1. 架構總覽

```
資料流(backend)
  daily snapshot build(services/warrants.py::_build_and_store,既有)
    └→ [新] 快照寫檔成功後 spawn 獨立背景 task(R2/R11:不掛回應路徑、
         不隨 request cancel;模組級 handle,shutdown 收乾):
           warrant_iv_history.archive_from_snapshot(snap)        ← SC-1
             寫 chip/warrant_iv_history/<as_of>.json(immutable,存在即跳過)
             (iv_bid / iv_ask 當場反解,沿 warrant_pricing.implied_vol)
           → warrant_iv_history.rebuild_drift_summary()          ← SC-3/4 供給
             讀最近 60 個 day files → 每權證 series → detect_drift()
             → 寫 chip/warrant_iv_drift_latest.json + mem 層 + 清序列 LRU(R4)

  lifespan startup(main.py)
    └→ [新] warrant_iv_history.ensure_backfill_task()           ← SC-2
         背景循序補 60 交易日缺檔(TWSE MI_INDEX×2/日 + TPEx wn1430×1/日
         + FinMind 補 TPEx 標的價缺口);完成後 rebuild_drift_summary()

  GET /api/warrants/{stock_id}(既有)                            ← SC-4
    └→ get_underlying_warrants 讀取時 merge iv_drift label(不入快照檔;
       drift map 走 lazy accessor get_drift_map(),R1)

  GET /api/warrants/{warrant_id}/iv-history(新)                 ← SC-5
    └→ warrant_iv_history.get_iv_history(warrant_id)
         underlying 查 snapshot → 讀 day files 組該 underlying 全權證序列
         (per-underlying mem LRU + inflight dedup)→ 該權證 series + drift

資料流(frontend)
  useWarrants → WarrantSelector 表格新欄「IV趨勢」                 ← SC-6
  row 展開 → useWarrantIvHistory(expandedId) → WarrantIvHistory 元件
    → lib/warrant-iv-svg.ts 純函式算兩線 path → SVG               ← SC-7
```

## 2. 檔案組織

| 動作 | 檔案 | 職責 |
|---|---|---|
| Create | `backend/services/warrant_iv_drift.py` | 純函式零 IO:Theil-Sen 斜率 + drift 判定(SC-3)。樣板 = warrant_pricing.py |
| Create | `backend/services/warrant_iv_history.py` | archive 寫入 / backfill / drift summary / 序列組裝(SC-1/2/5) |
| Modify | `backend/services/warrants.py` | `_fetch_mi_index` → 公開 `fetch_mi_index`;build 尾端呼叫 archive + summary;`get_underlying_warrants` merge `iv_drift`(SC-4) |
| Modify | `backend/routes/warrants.py` | 新 endpoint `/api/warrants/{warrant_id}/iv-history`(SC-5) |
| Modify | `backend/main.py` | lifespan:`ensure_backfill_task()` + shutdown cancel + `warrant_iv_history.aclose()` |
| Create | `backend/tests/test_warrant_iv_drift.py` | SC-3 五合成 case |
| Create | `backend/tests/test_warrant_iv_history.py` | SC-1 archive 冪等/shape、SC-2 backfill 跳非交易日/中斷重入、序列組裝 |
| Modify | `backend/tests/test_warrants_routes.py` | SC-4 欄位 / SC-5 endpoint(正常/空/400) |
| Modify | `backend/tests_e2e/test_api_warrants.py` | contract:iv_drift 欄 + iv-history shape |
| Create | `backend/tests_e2e/fixtures/warrants/iv_history.json` | FAKE 用合成 day archives(單檔多日,見 §7) |
| Modify | `frontend/src/lib/warrant-data.ts` | `WarrantTerm.iv_drift` + `WarrantIvHistoryPayload` 型別 |
| Modify | `frontend/src/lib/api.ts` | `api.warrantIvHistory(warrantId, refresh, {signal})` |
| Create | `frontend/src/hooks/useWarrantIvHistory.ts`(+test) | useQuery,enabled=展開;樣板 = useWarrantBrokers |
| Create | `frontend/src/lib/warrant-iv-svg.ts`(+test) | 純 SVG 計算:series → 兩線 path + 軸刻度(無 React) |
| Create | `frontend/src/components/WarrantIvHistory.tsx`(+test) | 展開區 IV 圖 + loading/error/空狀態 + 近似註記 |
| Modify | `frontend/src/components/WarrantSelector.tsx`(+test) | 「IV趨勢」欄 + 展開區掛 WarrantIvHistory |
| Modify | `e2e/specs/equity.spec.ts` | E12(drift 欄)/ E13(展開 IV 圖)(SC-8) |

計 19 檔 → Phase 3 啟用 goal_efficiency_mode(/auto 契約,>15 檔)。

## 3. SC-1 每日 archive

`archive_from_snapshot(snap: dict) -> bool`(回傳「本次是否新寫檔」,R21)。呼叫方式(R2/R11):`_build_and_store` 在快照 `atomic_write_json` 成功後 `asyncio.create_task(warrant_iv_history.run_post_build(snap))`(空快照 `as_of_date is None` 不 spawn;**FAKE_FINMIND=="1" 也不 spawn**,R17 — e2e 的 drift 供給由 §6 lazy 路徑成立,不得把 fixture 衍生檔寫進真 cache 目錄)— archive + rebuild 都在這個獨立背景 task 內,**不掛回應路徑、不被 `_run_once` 的 subscriber-cancel 連坐**;模組級 task handle,`aclose()` 時 cancel + await 收乾,同日已有 task 進行中則不重 spawn。

- 目標檔 `chip_cache_dir() / "warrant_iv_history" / f"{as_of}.json"`;**存在即 return False**(immutable;同日重 build / refresh 不重寫)。
- **run_post_build 內僅在 archive 回傳 True 才呼叫 rebuild_drift_summary()**(R21:前端 refresh 慣例每次帶 true → 每次重跑 `_build_and_store`;輸入 day files 未變時不得重跑 20-60s rebuild)。
- **TPEx 落後日防護(R3)**:`snap["tpex_date"] != as_of` 時 TPEx(market=="tpex")列一律不寫入該檔 — 前一交易日資料寫進 as_of 檔名會造成序列日期錯位且 immutable 不可自癒;缺席 = 序列洞,後續日自然補齊。
- 寫檔後 prune:`warrant_iv_history/` 內僅保留最新 90 檔,更舊刪除(R7;來源可重抓,非唯一副本)。
- Payload:
  ```json
  { "_cache_version": 1, "date": "2026-07-11", "terms_approx": false,
    "warrants": { "<wid>": { "b": 0.55, "a": 0.56, "c": 0.55, "s": 1085.0,
                              "ivb": 0.412, "iva": 0.428 } } }
  ```
  短鍵(b/a/c/s=bid/ask/close/underlying_close raw,ivb/iva=反解 IV,null 容許)— 30k 檔/日約 1.5-2MB。存 raw 是保險:drift 常數/反解修正時可離線重算,不需重抓。
- 版本語意(R18):讀取端(`_load_day_archives` / `get_drift_map` 讀檔分支)對 `_cache_version` 不符 → **視同缺檔**(沿 `_read_snapshot_file` 樣板);day file 缺口由 daily/backfill 自然重建,latest.json 不符走 rebuild。
- IV 反解:對 bid、ask 各一次 `implied_vol(px/ratio, s, k, t, r, kind)`;`is_reset` / 欄缺 → 該側 None;`bid > ask` 倒掛(edge 2)→ **ivb/iva 皆 None**(pair 層級無效,對齊 `_warrant_price_basis` 判準,R8)。`t` 以 `last_trading_date - date`。每 500 檔 `await asyncio.sleep(0)`(沿 IV_YIELD_EVERY)。
- `terms_approx`:daily 路徑 false(當日條款);backfill 寫入的檔 true(用現行條款近似,edge 4)。

## 4. SC-2 backfill(lifespan 背景)

`ensure_backfill_task() -> None`(main.py lifespan 呼叫;模組級 task handle,shutdown `cancel_backfill_task()` await 收乾):

- Guard:`FAKE_FINMIND == "1"` 直接 return;`WARRANT_IV_BACKFILL_DAYS` env(預設 `60`,`0` 停用)。
- 流程(單一 asyncio background task,循序;**不依賴 `_load_snapshot` 入口**,R19 — 該入口可 raise HTTPException(連假 404 / cooldown),在無 route 邊界的背景 task 內語意錯位):
  1. 直接抓現行 terms(t187ap37 / tpex issue 各一次)。
  2. 自 `clock.today() - timedelta(days=1)` 往回逐日曆日走(R23:今日檔一律留給 daily archive 路徑 — 消除同檔雙寫者與 terms_approx 誤標),直到湊滿 N 個交易日檔或回看 `N*2+11` 日曆日為止:
     - 檔已存在 → 計入、跳過(冪等,edge 8)。
     - `fetch_mi_index(d, "0999")` + `fetch_mi_index(d, "0999P")` 皆空 → **隔 5s retry 一次**,仍空才判非交易日跳過不落檔(R15:transient 上游失敗與真非交易日在 `_extract_mi_table` 回值不可區分;週一〜週五空回加 `logger.warning` 供人工複查)。全窗零交易日 → `logger.error("warrant iv backfill found no trading days")` 結束(下次進程啟動重試)。
     - TPEx:`_fetch_tpex_wn1430(d)`(§4.1)。
     - 標的價 S:TWSE 權證列自帶 `underlying_close`(**歷史 payload 該欄未逐欄驗,Known Risk R-3**;該欄缺值的 TWSE 標的一併併入 §4.2 FinMind 缺口補抓,R16);TPEx 權證的 S 先查同日 TWSE 列已出現的同標的值,缺口才 FinMind `TaiwanStockPrice`(§4.2)。
     - 過濾:TWSE 列 ∩ `terms_by_id`、TPEx 列 ∩ `issue_by_id`(自然排除 ETF 混入與已下市,edge 7)。
     - 反解 + 寫檔(`terms_approx: true`)。
  3. 全部完成 → `rebuild_drift_summary()`。
- 失敗處理:單日 fetch 例外 → `logger.warning` 跳過該日續走(壞一日不炸整段);task 頂層 `except asyncio.CancelledError: raise`、`except Exception: logger.exception`(背景 task 邊界,等同 route 邊界慣例)。
- 速率:不加人工 sleep — TWSE 每發 ~10s 自然限速(probe 實測);FinMind 走既有 TokenBucket。

### 4.1 TPEx 歷史抓取 `_fetch_tpex_wn1430(date_iso) -> list[dict]`

`GET https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=<民國Y/MM/DD>&se=EW`(probe 驗證,回溯 ≥3 年)。

- 民國日期:`f"{y-1911}/{m:02d}/{d:02d}"`。
- 回應 `aaData` 17 欄 list;normalize `normalize_tpex_wn1430_row(row) -> dict | None`:代號、close、最後買價、最後賣價(索引依 probe 欄序,實作期對 fixture 校欄名;舊年份「千股」欄名差異只影響量欄,本 feature 不取量)。壞 row skip + warning。
- `stat` 小寫 `"ok"`;echo date 校驗回的是指定日,不符視為空。
- TLS:共用本 service 的 `_ssl_context()`(local 複製樣板,不跨模組 import 私有)。

### 4.2 FinMind 標的價缺口補抓

`_fetch_underlying_close_range(stock_ids: set[str], start: str, end: str) -> dict[str, dict[str, float]]`(回 `{stock_id: {date: close}}`;impl round 1 R6 定案簽名):對每檔缺口標的 `TaiwanStockPrice` 抓整段 range 走 `get_finmind()` 既有介面。缺口量級:TPEx 權證標的多與 TWSE 權證重疊,估 <50 檔/日;60 日 backfill 上限約 3000 requests 內、實際遠低(跨日重複標的可 memo 整段 range 一次抓:改為**per-underlying 抓整段 60 日 range 一次**,總請求 = 缺口標的數 ≈ <50)。
`[auto-default: per-underlying range 一次抓 | reason: 請求數最小(<50 vs 3000);FinMind 有現成 start_date/end_date 介面]`

## 5. SC-3 drift 純函式(services/warrant_iv_drift.py)

```python
DriftLabel = Literal["declining", "rising", "stable", "insufficient"]

MIN_VALID_POINTS = 20        # 有效點門檻(60 日窗)
REL_CHANGE_THRESHOLD = 0.15  # 窗口相對變化 |slope*(n-1)/median_iv| 門檻
CONSISTENCY_MIN = 0.60       # 方向持續性:同號 pairwise 斜率占比

def theil_sen_slope(points: list[tuple[int, float]]) -> float: ...
def detect_side(series: list[float | None]) -> dict:
    # {"label": DriftLabel, "slope": float | None, "n_valid": int}
def detect_drift(iv_bid: list[float | None], iv_ask: list[float | None]) -> dict:
    # {"label": DriftLabel, "bid": {...}, "ask": {...}}
```

- `detect_side`:輸入序列的 index 即 **窗口內交易日 index(含 None 洞)**;有效點 `< MIN_VALID_POINTS` → insufficient;Theil-Sen 斜率(有效點 pairwise 斜率中位數,x = 交易日 index,天然抗單日 spike)→ 窗口相對變化 `rel = slope * (last_valid_x - first_valid_x) / median(valid)`(R5:以實際有效跨度計,稀疏序列不低估);`rel <= -T` 且持續性 ≥ C → declining;`rel >= T` 且持續性 ≥ C → rising;否則 stable。
- 持續性 = pairwise 斜率中與整體同號的比例(Kendall 式;O(n²) 於 n≤60 無壓力,60 點 = 1770 對)。
- overall label 優先序:任一側 declining → declining;否則任一側 rising → rising;否則兩側皆 insufficient → insufficient;否則 stable。
  `[auto-default: declining > rising 優先 | reason: 遞減直接損害持有人是本 feature 動機;兩側衝突罕見,展開圖有雙側細節可查]`
- **攤平規則(R6)**:summary 檔與 API response 的 `{label, slope_bid, slope_ask, n_valid}` 由 `detect_drift` 巢狀結果攤平:`slope_bid = bid.slope`、`slope_ask = ask.slope`、`n_valid = max(bid.n_valid, ask.n_valid)`。
- 常數為初校值,Phase 6 以真實 60 日資料抽樣校準(brainstorm §2)。

## 6. SC-4/5 讀取端

### drift summary

`rebuild_drift_summary() -> dict`:列出 `warrant_iv_history/*.json`(排序取**最近 60 檔**,與 §1 一致,R7)→ 逐檔 load 一次組 per-warrant `ivb`/`iva` 序列 → `detect_drift` → 寫 `warrant_iv_drift_latest.json`。

**序列洞語意(R24,與 §5 R5 銜接)**:窗口日期軸 = 該 60 檔的日期集合(升冪);權證於某檔日缺席(TPEx 落後日不寫入 / 新掛牌前 / 壞 row skip)→ 補 `(date, None, None)` placeholder,**不壓縮 index** — detect_drift 輸入與 SC-5 series 同此軸(前端「缺值日斷線」渲染語意一致)。`test_warrant_iv_history.py` 加「中段缺席日」case 鎖住。

**IO/量測(R25)**:逐檔 load 迴圈每檔後 `await asyncio.sleep(0)`(單檔 ~150ms parse stall 不連放);完成時 `logger.info("drift summary rebuilt: warrants=%d days=%d in %.1fs", ...)`(沿 `_build_snapshot` 樣板)— 此 log 即降階條款「>60s」的量測依據。

**檔集合自檢(R22)**:rebuild 結束時重列目錄最近 60 檔,與開始時集合不一致(backfill 於 rebuild 窗內完成寫檔、觸發被 dedup join 消費)→ 同 key 內自我再跑一輪(max 1 次),避免短窗結果 stale 至下一交易日。

**CPU 邊界(R13)**:量級 ≈ 30k 權證 × 2 側 × ~1770 pairwise(Theil-Sen + 持續性共用同一批 pairwise 斜率,算一次雙用)≈ 1e8 純 Python 運算,估 20-60s — 背景 task 內**每 200 權證 `await asyncio.sleep(0)`**(event loop 不得長段餓死;沿 IV_YIELD_EVERY 慣例另立常數 DRIFT_YIELD_EVERY=200)。**降階條款**:Phase 5 實測單次 rebuild >60s → 持續性檢定改 O(n) 相鄰差分符號比例、pairwise 抽樣上限 800 對,常數同步記 design changelog。

**串行化(R20)**:rebuild 三個觸發點(run_post_build / backfill 完成 / lazy accessor)統一經同一 `_run_once("drift_rebuild", ...)` key,不並發雙跑。

**併發 generation guard(R12)**:模組級 `_rebuild_generation` counter,rebuild 完成 +1 並清序列 LRU;序列組裝(§SC-5)開始時記下 generation,組裝完 insert LRU 前比對 — 不符即丟棄不入 cache(該次請求照常回應)。防 backfill 完成瞬間的 insert-after-clear race(backfill 補舊檔不改 LRU key,stale entry 無自然失效)。

Payload:
```json
{ "_cache_version": 1, "built_from": ["2026-04-14", "...", "2026-07-11"],
  "drift": { "<wid>": { "label": "declining", "slope_bid": -0.002, "slope_ask": -0.001, "n_valid": 55 } } }
```
mem 層 `_drift_mem`;完成時**同步清空 §6.SC-5 的序列 LRU**(R4:backfill 往回補檔不改最新檔日,LRU key 對此無感,必須顯式失效)。呼叫點:`run_post_build` 內 archive 後、backfill 完成後。stable/insufficient 也入表(展開區要顯示雙側數據)。

**lazy accessor(R1,R14 修訂)**:`get_drift_map() -> dict` — mem 有 → 回;無 → 讀 `warrant_iv_drift_latest.json`(版本不符視同無檔,R18);檔也無 →
- **FAKE 模式**:同步 `rebuild_drift_summary()` 現算(fixture ~25 日 × 3-4 檔,毫秒級;經 `_load_day_archives()` fixture 分支,e2e drift 供給鏈成立;**只寫 mem 不落 latest.json**,R17)。
- **真實模式**:立即回空 dict + spawn 一次性背景 rebuild(run_post_build 同 pattern 的模組級 handle;已有 rebuild 進行中不重 spawn)— 分鐘級 rebuild 不得回到 request 路徑被 `run_with_disconnect` 的 cancel 連坐 thrash(R14,cross-round:R2 的背景化理由對此路徑同樣成立);下輪請求吃 mem。
rebuild 結果即使空 dict 也寫 mem(built marker),避免無 archive 環境每 request 重掃目錄。

### SC-4 merge

`get_underlying_warrants` 回傳前對每列 shallow copy 附標:`{**w, "iv_drift": drift_map.get(wid, {}).get("label")}`(R10:不就地變異 `_snapshot_mem` 共享 dict)。drift_map 走 `get_drift_map()`(R1)。**merge 在讀取時**,不烙進快照檔:backfill 完成即時生效,不需 snapshot 重 build;快照檔 shape 不變 → `_CACHE_VERSION` 不 bump。

### SC-5 endpoint

`GET /api/warrants/{warrant_id}/iv-history?refresh=` → `get_iv_history(warrant_id, refresh)`:

1. `_load_snapshot(False)` 查 warrant → underlying;找不到 → 404 `{"error": "not_found"}`。
2. per-underlying 序列組裝:讀最近 60 個 day files(**版本不符的檔視同缺,R18**),抽該 underlying 全權證(wid → 序列),存 mem LRU(容量 4,key=underlying_id+最新檔日;refresh=true 剔除該 key;**insert 前比對 `_rebuild_generation`,不符棄置**,R12)+ `_run_once` inflight dedup(local 複製)。冷路徑 ~1-2s(60 檔 × ~2MB parse),與分點展開延遲同級。
3. 回應:
   ```json
   { "warrant_id": "030001", "terms_approx_dates": ["2026-04-14", "..."],
     "series": [ { "date": "2026-04-14", "iv_bid": 0.45, "iv_ask": 0.47 }, ... ],
     "drift": { "label": "declining", "slope_bid": -0.002, "slope_ask": -0.001, "n_valid": 55 } }
   ```
   archive 全缺 → `series: []` + `drift: {"label": "insufficient", ...}`(200,SC-5)。
4. route:`_validate_id` 沿用(400 bad_symbol);catch `httpx.HTTPError` → 502 `warrant_upstream`(snapshot 冷 build 可能觸發網路);`run_with_disconnect` 包裹(cancel-chain)。

## 7. FAKE / e2e(SC-8)

- `warrant_iv_history.py` 的 day-files 載入點(drift summary + 序列組裝共用同一 loader `_load_day_archives()`)加 FAKE 分支:`FAKE_FINMIND=="1"` 時改讀 `tests_e2e/fixtures/warrants/iv_history.json` — **單檔多日**。**偏離「fixture 存原始 upstream shape」慣例的顯式理由(R9)**:backfill/archive 寫入路徑在 FAKE 下無意義(e2e 不跑 20 分鐘 backfill),注入點只能在 distilled 層;交換條件 = wn1430 normalize 以 **pytest** 原始 `aaData` 縮樣 fixture 補單元覆蓋(含舊年份「千股」欄名變體,列入 `test_warrant_iv_history.py` 測項),解析面不留零覆蓋。格式:`{"days": {"<date>": {"warrants": {...day payload...}}}}`,合成 ~25 個交易日 × 3-4 檔權證(一檔明確遞減、一檔平穩、一檔點數不足),日期對齊 FAKE_TODAY=2026-06-26 往回排(權證 fixture 既有基準日)。drift 判定 / 序列組裝走**真 code path**(fixture 是 archive 層,不是結果層)。
- FAKE 模式:archive 寫入與 backfill 皆 no-op(ensure_backfill_task guard;archive_from_snapshot 在 FAKE 下直接 return — e2e cache 目錄不落歷史檔)。
- e2e:`equity.spec.ts` 加
  - E12:搜尋 fixture 標的 → 權證 tab → drift 欄出現「長期遞減」(資料級 assertion,對映 fixture 遞減檔);
  - E13:展開遞減權證 → `[data-testid="warrant-iv-chart"]` 內 svg path 存在且 `d` 非空(資料級,不只 visible)。
  - 痛點註解連回 SC-6/SC-7。
- MANIFEST gate:子目錄 fixture 天然隔離(twse-tpex-conventions),不入 MANIFEST。
- fixture 日期需驗星期(e2e-conventions;合成日直接取 FAKE_TODAY 往回的平日序列)。

## 8. SC-6/7 前端

### 型別 / API

- `WarrantTerm` 加 `iv_drift: "declining" | "rising" | "stable" | "insufficient" | null`。
- `WarrantIvHistoryPayload = { warrant_id: string; terms_approx_dates: string[]; series: { date: string; iv_bid: number | null; iv_ask: number | null }[]; drift: { label: ...; slope_bid: number | null; slope_ask: number | null; n_valid: number } }`。
- `api.warrantIvHistory(warrantId, force, { signal })` — 沿 `__apiGet` + `?refresh=true` 慣例。

### SC-6 表格欄

- HEADERS 在「IV百分位」後插 `{ key: null, label: "IV趨勢" }`(不排序 — label 類別欄)。
- cell:`declining → 長期遞減`、`rising → 長期遞增`、`stable | insufficient | null → —`;文字 `text-ink-muted`,不用紅綠(中性鐵則);`data-testid="iv-drift-label"`。
- vitest:label 對映 + `expect(screen.queryByText(/惡意|坑/)).toBeNull()` 文案鎖(沿 TXO 方向性文案鎖 pattern)。

### SC-7 展開區

- `WarrantIvHistory({ warrantId })` 元件:`useWarrantIvHistory(expanded ? warrantId : null)`;掛在既有分點明細**上方**同 colSpan 展開列內(一次展開同列兩塊:IV 圖 + 分點)。
- 狀態:loading `載入引波歷史...` / error(hook error 繁中)/ `series` 全空或全 null → `無歷史引波資料`。
- 圖:`lib/warrant-iv-svg.ts` 純函式 `computeIvChart(series, width, height) -> { bidPath: string, askPath: string, xTicks: [...], yTicks: [...] }`;缺值日斷線(path M 重起,不插值)。元件端 svg 掛 `data-testid="warrant-iv-chart"`,兩線以實線(bid)/ 虛線(ask)區分 + 圖例文字「買價IV / 賣價IV」,顏色走 ink 階(非紅綠)。
- `terms_approx_dates` 非空 → 圖下加一行 `text-ink-dim`:「歷史 IV 以現行條款近似」(edge 4)。
- 響應式:沿 `useContainerSize`(frontend-conventions;實作前讀該 skill + frontend-design 雙 skill,brainstorm §8)。

## 9. 邊界 / 錯誤處理

- 新 service 對外例外面:TWSE/TPEx httpx 錯誤在 backfill task 內逐日吞(warning + 跳日,背景 task 無 route 邊界);iv-history route 走 §6.4。FinMind 例外在 backfill 內同樣逐標的 warning + 跳過(缺 S → 該權證該日 IV None)。
- 背景 task 邊界(`run_post_build` / backfill 共通):頂層 `except asyncio.CancelledError: raise` + `except Exception: logger.exception`;兩者皆持模組級 handle,`aclose()` cancel + await 收乾(R2)。
- 檔案 IO:`read_json` 壞檔回 None → 該日視同缺(不炸);寫入走 `atomic_write_json`。
- 型別:全檔 `from __future__ import annotations` + 全簽名 hints;logging 走 `logging.getLogger(__name__)`。

## 10. Known Risks

- R-1:FinMind `TaiwanStockPrice` per-underlying range 補抓的實際缺口數未實測(估 <50 標的);若實測顯著偏高(>500)→ 改按日全市場查詢或退化為「TPEx 權證 backfill 期 IV 缺」並記 next-time。
- ~~R-2~~(2026-07-11 Phase 3 mini-probe 解除):wn1430 實測 17 欄 fields 名稱對照解欄序(非 index 硬編),2023 舊年份僅量欄名「千股」變體;缺欄 guard 由 code-review CR-A1 補上。
- ~~R-3~~(2026-07-11 Phase 3 mini-probe 解除):MI_INDEX 2026-03-10 歷史 payload row[19] 標的收盤價 29,540/29,540 全有值;FinMind fallback 照設計保留。
- R-4(round 2 R15 殘餘):retry 一次後仍空的真交易日(TWSE 當日長時間故障)成為永久序列洞;單洞 drift 容忍度高,連續多日洞需人工重跑 backfill(刪對應缺日後重啟),記 warning log 供發現。
- R-5(round 2 R19 殘餘):backfill 全窗零交易日(啟動時上游全故障)→ task 結束不自動重試,下次進程啟動補;daily archive 路徑不受影響。
