# Design — 權證選擇器(盤中版)

- **版本**: v3(2026-07-11)
- **Changelog**:
  - v3:design-review round-2 全 4 條 accepted — R2-1 build 失敗/空回 backoff(`_last_build_attempt` + `BUILD_RETRY_COOLDOWN_SEC=60`,防輪詢放大重試風暴);R2-2 brainstorm edge case #1 同步 R1 語意;R2-3 brokers 的 warrant_id 套同一 regex 驗證;R2-4 頂層 quote_date/time fallback 鏈明定。
  - v2:design-review round-1 全 11 條 accepted 後修訂 — R1 `no_trading_day` 語意重定義(盤中回退昨日是常態,快照不發 flag,`as_of_date` 承載基準日);R2 檔案 cache 改固定檔名 `latest` + 明定 mem/檔失效條件;R3 quotes 經同一 build 入口(共用 `_run_once` key);R4 刪 `is_last_snapshot_of_day`;R5 明定 T 基準;R6 S_now fallback 鏈;R7 IV 迴圈讓出 event loop + build 時間 log;R8 cooldown 執行順序 + 上限;R9 error 邊界逐 endpoint;R10 假日誤輪詢記 Known Risk(quote_date 自動停輪詢 rejected:盤前開頁會鎖死輪詢);R11 重整鈕只綁 quotes 層。
  - v1:初版(依 brainstorm.md + spec §3/§4/§6 + Phase 0 spike 定案)
- 上游:`.claude/feat/warrant-selector/brainstorm.md`、`docs/specs/warrant-selector/spec.md`

## 0. 架構總覽

```
                     ┌─ EOD 快照(每日一次,lazy build)─────────────┐
TWSE MI_INDEX 0999 ──┤                                              │
TWSE MI_INDEX 0999P ─┤  services/warrants.py                        │
TWSE t187ap37_L ─────┤  normalize → join 行情×條款 → EOD 欄位       │──┐
TPEx issue/quts/close┤  + 昨日 IV 反解(warrant_pricing)            │  │
                     │  → per-underlying index → 檔案+記憶體 cache  │  │
                     └──────────────────────────────────────────────┘  │
                                                                       ▼
TWSE MIS(盤中五檔)─→ services/warrant_quotes.py ─→ routes/warrants.py ─→ React
                       批次≤100 → normalize → 盤中欄位              (3 endpoints)
                       cooldown 10s + _run_once dedup
FinMind 分點(T+1)─→ services/warrant_brokers.py(on-demand 單發)
```

計算全在 backend(spec §4「前端只呈現」);純數學抽 `warrant_pricing.py` 零 IO 模組。

## 1. Backend 檔案組織

### 1.1 `backend/services/warrant_pricing.py`(新,純函式零 IO)

BS 歐式近似 + IV 反解。**無新依賴**:norm CDF 用 `math.erf`(Φ(x) = (1+erf(x/√2))/2),反解用自寫 bracket 二分法(不引 scipy — decisions.md 無此依賴,YAGNI)。

```python
RISK_FREE_RATE = 0.016  # 無風險利率(spec §4 具名常數)

def bs_price(s, k, t, r, sigma, kind: Literal["call","put"]) -> float
def bs_delta(s, k, t, r, sigma, kind) -> float
def implied_vol(price, s, k, t, r, kind) -> float | None
    # per-share price;bracket σ∈[1e-4, 5.0];f(lo)·f(hi) 同號(價低於下界/超上界)→ None
    # 二分 100 iter / tol 1e-8;t<=0 或 price<=0 → None
```

pytest 鎖教科書數值(SC-2):Hull 案例 S=42,K=40,T=0.5,r=10%,σ=20% → call 4.759422…、put 0.808599…(assert 6 位小數);delta 對稱性;IV 反解 round-trip(bs_price 算價 → implied_vol 反解 → 還原 σ ±1e-6);邊界(價=0、t=0、深度價內外)→ None。

### 1.2 `backend/services/warrants.py`(新,EOD 快照)

樣板 = `daytrade_fee.py`:module-level `httpx.AsyncClient` + `_ssl_context()`(關 VERIFY_X509_STRICT)+ `aclose()` + `_run_once`(shield+refcount local 複製)+ `atomic_write_json`/`read_json` + `_CACHE_VERSION`。

**Fetch(6 發,皆帶 UA、零配額)**:
| 來源 | 端點 | 取用 |
|---|---|---|
| TWSE 行情(認購) | `rwd/zh/afterTrading/MI_INDEX?date=&type=0999&response=json` | tables[] 中 **fields 數==20** 那張(S-1:勿硬編 index) |
| TWSE 行情(認售) | 同上 `type=0999P` | 同上 |
| TWSE 條款 | `openapi/v1/opendata/t187ap37_L` | 全表 |
| TPEx 行情 | `openapi/v1/tpex_warrant_daily_quts` | 全表 |
| TPEx 買賣價 | `openapi/v1/tpex_mainboard_daily_close_quotes` | join 補 bid/ask |
| TPEx 條款 | `openapi/v1/tpex_warrant_issue` | 全表 |

**日期回退**(S-1:非交易日 = stat OK 全表空):build 從 `clock.today()` 起向前走,MI_INDEX 兩型皆空 → 前一天,最多 7 天;全空 → `HTTPException(404, {"error":"no_data"})`。found date = `as_of_date`。
**`no_trading_day` 語意重定義(R1)**:MI_INDEX 為收盤後發布,交易日盤中 build 必然回退到昨日 — **回退是常態不是異常**,快照 payload **不發** `no_trading_day` flag,基準日語意完全由 `as_of_date` 承載,前端顯示「快照基準日 as_of_date」。pytest 鎖:today 空 → 回退昨日時 payload 無 `no_trading_day` key 且 `as_of_date` = 昨日。(brainstorm SC-8 已同步 amendment。)
TPEx 端點只回最新一日,rows 日期與 TWSE as_of 不同日時仍合併,欄位 `tpex_date` 記錄。

**Normalize 髒點**(每點一測,fixture = probe 真實 payload 縮樣):
- t187ap37_L 日期 = 緊湊民國 `1150728` → `_roc_compact_to_iso`(S-4 修正 spec 的斜線記載)
- TPEx issue:`Date` 民國緊湊 / `ExpiryDate`+`ListedDate` 西元緊湊 `20260818`(同 payload 混用)
- **stripped-key lookup**:`row_get(row, key)` 以 `k.strip()==key` 比對(S-2:`Latest ExerciseRatio` 有無 leading space 皆解)
- TWSE 千分位、空字串價格、`漲跌(+/-)` HTML 欄(直接丟棄不用)、名稱 padding
- TPEx `Close="---"`(零成交)、`CapPrice="    "`(空白=無)、`LatesAskPrice` typo 原樣對 key
- 壞 row skip + `logger.warning`(單筆髒不炸整表)

**Universe(S-4)**:MI_INDEX(0999+0999P)代號 ∩ t187ap37_L 代號(自然排除牛熊/已到期)+ 防禦 `最後交易日 ≥ as_of`;TPEx 側 quts ∩ issue。行情有、條款缺(新掛牌 race)→ skip + warning(edge case 8)。

**每檔 warrant 快照欄位**:
```python
{"warrant_id", "name", "kind",          # "call"|"put"(TWSE 權證類型/TPEx Type → 認購=call)
 "market",                              # "twse"|"tpex"
 "underlying_id", "underlying_name",
 "strike",                              # 最新履約價格 / LatestExercisePrice
 "exercise_ratio",                      # TWSE: 每仟單位配發數量/1000(S-2);TPEx: Latest ExerciseRatio
 "last_trading_date", "maturity_date",  # ISO
 "is_reset",                            # TWSE 類別含「重設型」/ TPEx Reset=="Y"
 "eod_close", "eod_bid", "eod_ask",     # None = 無值
 "underlying_eod_close",
 "iv_prev",                             # 昨日 IV:以 EOD P 基準反解(P=close,無成交→mid,皆無/重設型→None)
                                        # 反解 T 基準 = (last_trading_date − as_of_date)/365(R5)
}
```

**快照 cache(R2,兩層 + 固定檔名)**:
- 檔案:**固定檔名 `warrants_snapshot_latest.json`**(原子覆寫),payload = `{"_cache_version", "as_of_date", "fetched_on", "tpex_date", "by_underlying": {uid: [w, ...]}}`。讀取端不需先知道 as_of — 解 R2 的 key 悖論。
- 記憶體:module-level `_snapshot_mem: dict | None`(10–15MB JSON 不能每 request 重讀檔);啟動後首讀從檔案載入。
- **有效性判定(mem 與檔同一規則)**:`_cache_version == _CACHE_VERSION` 且 `fetched_on == clock.today().isoformat()` → 有效;否則 rebuild(交易日每晨一次;rebuild 後 as_of 可能不變 — 盤中回退,見上)。`refresh=true` 無條件 rebuild。
- rebuild 全程走 `_run_once("snapshot_build")`(**單一全域 key**,warrants 與 quotes 兩入口共用,R3);「上游空不覆寫非空」保護沿 daytrade_fee 樣板(全 6 發後 universe 為空且既有 cache 非空 → 回 cache 不覆寫)。
- **Build backoff(R2-1)**:module-level `_last_build_attempt: float | None`(monotonic),rebuild 結束(成功/空回/例外)皆寫入;cache 無效但 `monotonic() - _last_build_attempt < BUILD_RETRY_COOLDOWN_SEC`(具名常數 60.0)→ 直接回既有 stale cache(mem 或檔),不重打 upstream;`refresh=true` 豁免。防 15s 輪詢在上游故障日把 rebuild 變成重試風暴(每次空回 ≈ 18 次 upstream hit)。pytest 鎖「空回後 60s 內第二請求不觸發第二次 build」。
- **IV 反解迴圈每 500 檔 `await asyncio.sleep(0)`**(R7:純 CPU 不凍整個 event loop),build 耗時 `logger.info` 記錄(量測數據供後續優化判斷)。

**對外**:`async def get_underlying_warrants(stock_id: str, refresh: bool) -> dict` → `{"as_of_date", "warrants": [...]}`(空 list = 無權證,200 回,SC-7)。**quotes 層取清單也走本函式**(R3)。
**FAKE 層**(e2e-conventions):`FAKE_FINMIND=="1"` 分支在 6 個 fetch 函式內讀 `tests_e2e/fixtures/warrants/<name>.json`(原始 upstream shape 縮樣;檔缺 = 空),normalize 路徑實跑。

### 1.3 `backend/services/warrant_quotes.py`(新,盤中層)

```python
MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
MIS_BATCH_SIZE = 100          # S-6:140 OK / 145 炸,留 headroom
QUOTES_COOLDOWN_SEC = 10.0    # S-6;前端 refetchInterval 15s > cooldown
QUOTES_COOLDOWN_MAX = 8       # cooldown dict 上限(R8):保留最近 N 個 underlying
MISPRICE_FAIR_BAND = 0.10     # 估價差 ±10% 內 = 「合理」[auto-default: spec 授權實作期校準]
IV_PCTL_MIN_SAMPLES = 5       # 同組樣本 < 5 → null
IV_PCTL_MONEYNESS_BAND = 0.10 # 分組:同標的+同 kind+|moneyness 差|≤0.10
IV_PCTL_TENOR_RATIO = 2.0     #       +天期比 ∈ [1/2, 2]
```

- `get_quotes(stock_id, refresh) -> dict` 資料流(R3/R8 定序):
  1. **cooldown 檢查**:`_cooldown[stock_id]` 存在且 `monotonic() - ts < 10s` 且非 refresh → 直接回 payload。
  2. miss / refresh → `_run_once(f"quotes_{stock_id}", ...)`(S-7 並發合流);coroutine 內:
     a. `warrants.get_underlying_warrants(stock_id, refresh=False)` 取清單(快照未建 → 觸發共用 `snapshot_build`,首開 warrants+quotes 兩請求合流單次 build,R3;pytest 鎖「併發兩 endpoint 只觸發一次 build」)。
     b. 空清單 → 直接回 `{"stock_id", "quotes": {}}`(不打 MIS)。
     c. MIS 批次 ≤100 **序列**送出(prefix:權證 market twse→`tse_`/tpex→`otc_`;標的 prefix = 其權證所在市場 — S-6 市場乾淨分割);標的 code 一併入首批。
     d. normalize → 逐檔算盤中欄位 → 組 payload → **寫回 `_cooldown[stock_id] = (ts, payload)`(refresh 也寫回,R8)**,超過 `QUOTES_COOLDOWN_MAX` 踢最舊。
- **MIS normalize**(髒點各一測):`z=="-"` → None;價量字串尾綴 `_` strip;`a`/`b` 五檔 `_` 分隔取**第一檔**為最佳買賣價,`f`/`g` 同;`-` 佔位 → None;`tlong` ms epoch → `quote_date`(ISO)+ `quote_time`(`HH:MM`,`t` 欄直用)。
- **S_now fallback 鏈(R6)**:標的 MIS `z` → 標的 MIS mid → 快照 `underlying_eod_close` → 皆無 → 全表計算欄 null(仍列出);normalize 測試一條。
- **T 基準(R5)**:盤中欄位一律 `T = (last_trading_date − clock.today())/365`;`iv_prev` 是快照層以 as_of 的 T 反解(§1.2)。pytest 鎖 as_of=昨日、today=今日的差一天 case(短天期敏感)。
- **每檔盤中欄位**(spec §4 全表;基準 P:`z` 有值用 z,否則 mid=(bid+ask)/2,皆無 → 計算欄全 null 但列出):
  `price, best_bid, best_ask, best_bid_vol, best_ask_vol, moneyness, days_left, iv, delta, leverage, spread_ratio, spread_lev_ratio, theo_price, mispricing_pct, mispricing_label("cheap"|"fair"|"expensive"|None), iv_percentile, quote_time`
  - `theo_price = bs_price(S_now, K, T, r, iv_prev) × ratio`(iv_prev None / 重設型 → theo/估價差 null)
  - `iv_percentile`:該檔現價 IV 在分組(同標的+同 kind+moneyness band+tenor ratio)現價 IV 中的百分位(0–100);樣本<5 → null
  - per-share 換算:IV 反解用 `P/ratio`;實質槓桿 = `delta × S × ratio / P`
- payload:`{"stock_id", "underlying_price", "quote_date", "quote_time", "quotes": {warrant_id: {...}}}`(dict keyed by id,前端 O(1) merge;`is_last_snapshot_of_day` 已刪 — R4,收盤判定由前端 `isMarketOpen` 承擔)。
- **頂層 quote_date/quote_time fallback(R2-4)**:標的 MIS 記錄的 `tlong` → 缺則取本批 msgArray 最大 `tlong` → 全缺 → 皆 null(前端「最後更新」省略不顯);normalize 測試一條。
- **Provider 抽象保留**:MIS fetch 隔離在 `_fetch_mis_raw(ex_ch_batch) -> list[dict]` 單函式,換源只動它。FAKE 分支讀 `fixtures/warrants/mis_quotes.json`(原始 msgArray shape)。

### 1.4 `backend/services/warrant_brokers.py`(新,分點展開)+ `services/finmind.py` 擴充

- finmind.py 加 `async def fetch_warrant_trading_daily_report(self, warrant_id: str, date: str) -> list`:dataset `TaiwanStockWarrantTradingDailyReport`,`data_id` 必填、**`end_date` 留空**(memory + spec 2.1:單日單發)。**與 e2e MANIFEST 條目同 commit**(e2e-conventions gate)。
- warrant_brokers.py 依 finmind-conventions **per-module wrap** `get_finmind()`(禁直 import)。
- `get_brokers(warrant_id, refresh) -> dict`:從 `clock.today()-1` 起向前試(跳週末),FinMind 回空再退一天,最多 5 日;全空 → `{"data_date": None, "rows": []}`(前端顯示無資料,不 404 — 權證存在但無分點報表屬常態)。命中日檔案 cache `warrant_brokers_{id}_{date}.json` + `_CACHE_VERSION`;rows = `[{broker_name, buy, sell, net}]` 依 |net| 降序。

### 1.5 `backend/routes/warrants.py`(新)+ `main.py` 接線

```python
@router.get("/api/warrants/{stock_id}")            # → svc get_underlying_warrants
@router.get("/api/warrants/{stock_id}/quotes")     # → warrant_quotes.get_quotes
@router.get("/api/warrants/{warrant_id}/brokers")  # → warrant_brokers.get_brokers
```
- 路徑歧義消解:brokers 有獨立後綴不衝突;stock_id **與 warrant_id(R2-3)**皆驗證 `^[0-9A-Za-z]{4,6}$` 否則 400 `{"error":"bad_symbol"}`(未驗證的 warrant_id 直傳 FinMind data_id 會以 ×5 日回退放大配額浪費);contract test 各鎖一條。
- 每 handler 包 `run_with_disconnect`(cancel-chain)。
- **Error 邊界逐 endpoint(R9)**:
  - `warrants` / `quotes` handler:`except httpx.HTTPError` → 502 `{"error":"warrant_upstream"}`(基類全蓋,沿 daytrade_fee 教訓 — 不讓中央 handler 錯標 finmind_error)。
  - `brokers` handler:**不 catch httpx**(上游真的是 FinMind,沿中央 handler → `finmind_error`)。
  - contract test 各鎖一個 error code(test_api_warrants.py)。
- main.py:`include_router(warrants_router)` + lifespan shutdown `await warrants_mod.aclose()`、`await warrant_quotes_mod.aclose()`。

## 2. Frontend 檔案組織

### 2.1 `lib/warrant-data.ts`(型別)+ `lib/api.ts` 擴充

- 型別:`WarrantTerm`(快照 row)、`WarrantQuote`(盤中 row)、`WarrantRow = WarrantTerm & Partial<WarrantQuote>`(merge 後)、`WarrantsPayload` / `WarrantQuotesPayload` / `WarrantBrokersPayload`。
- api.ts 加 `warrants(stockId, refresh?, options?)` / `warrantQuotes(stockId, refresh?, options?)` / `warrantBrokers(warrantId, refresh?, options?)`。
- **接點風險(已解)**:`__apiGet` module cache TTL 5 分鐘會吞輪詢 → `RequestOptions` 加 `noCache?: boolean`(跳 `_cache` 讀寫,不影響既有 caller);`warrantQuotes` 恆帶 `noCache: true`。

### 2.2 `lib/warrant-utils.ts`(純函式,vitest 全蓋)

- `filterWarrants(rows, filters)`:認購/認售、剩餘天數下限、價內外範圍、委買量>0、估價差範圍、IV 百分位上限(SC-4;null 欄位的列在該 filter 啟用時剔除,預設不啟用不剔)。
- `sortWarrants(rows, key, dir)`:預設 `spread_lev_ratio` asc;**null 恆沉底**(不論 asc/desc)。
- `isMarketOpen(d: Date)`:週一–五 09:00–13:35 Asia/Taipei(`Intl.DateTimeFormat` 取台北時間;常數具名)。國定假日不判(R10 取捨,見 Known Risks)。
- `mergeWarrantRows(terms, quotes)`:by warrant_id,O(n)。

### 2.3 Hooks(統一 `{ data, loading, error, refresh, ...extras }`)

- `useWarrants(stockId, enabled)`:queryKey `["warrants", stockId]`;`enabled: !!stockId && enabled`(tab 未開不抓);extras:`asOfDate`(快照基準日,R1 — 無 noTradingDay)。forceRefreshRef pattern 照 `useDaytradeFee`。
- `useWarrantQuotes(stockId, enabled)`:queryKey `["warrant-quotes", stockId]`;`refetchInterval: () => isMarketOpen(new Date()) ? QUOTES_REFETCH_MS : false`(**QUOTES_REFETCH_MS = 15_000** 具名 export,測試鎖值 SC-3);`refetchIntervalInBackground: false`;extras:`quoteTime` / `quoteDate`(「最後更新 HH:MM」)。輪詢 queryFn 不帶 refresh(cooldown 生效);`refresh()` 帶 refresh=true。
- `useWarrantBrokers(warrantId | null)`:`enabled: !!warrantId`(row 展開才抓,SC-6);extras `dataDate`。

### 2.4 `components/WarrantSelector.tsx`(新)+ `App.tsx` 接線

- App.tsx:`type Tab = "overview" | "bubble" | "warrants"`;第三個 tab 按鈕「權證」(同款 className);`<div hidden={tab !== "warrants"}>` + `React.lazy(WarrantSelector)`(§3 慣例);props:`symbol`、`active={tab==="warrants"}`(hooks 的 enabled gate — `hidden` 保 DOM 但 enabled=false 時不抓)。權證 hooks 掛在 WarrantSelector 內部,不進 App.tsx 的全域 refresh。
- **重整鈕綁定(R11)**:tab 內重整鈕**只呼叫 `useWarrantQuotes.refresh()`**(輕操作,跳 cooldown);快照 rebuild(重操作 10–20s)不暴露 UI 入口,保留 API 級救濟(`/api/warrants/{id}?refresh=true`)。
- WarrantSelector:篩選列(SC-4 controls)+ 表格(SC-2 欄位;`<table>` + sticky header + `overflow-auto`;行動版横向捲動)+ row 展開分點(SC-6,`<button aria-expanded>`)+ 空狀態(SC-7)+ 「最後更新 HH:MM」+ 「快照基準日 as_of_date」+ 重整鈕。
- **視覺紀律(SC-5)**:認購/認售 badge = accent/outline(非紅綠);估價標籤「偏貴/合理/偏便宜」中性色階(ink-muted / ink / accent 系);差槓比標色 = 中性強度階;`data-testid="warrant-kind-badge"` / `"mispricing-label"` 正向 assert;嚴禁方向性文案(RTL 負向 assert)。**實作前呼叫 `frontend-design` + `bencium-controlled-ux-designer`**(Phase 3 wave6 開工步驟)。
- UI 繁中(「權證」「此標的無掛牌權證」「最後更新」「資料日」…);`cn()`;semantic tokens。

### 2.5 `lib/changelog.ts`

MINOR bump → `0.25.0`,寫 entry 前讀 `changelog-conventions`。

## 3. e2e(判準已定案於 brainstorm)

- fixtures `backend/tests_e2e/fixtures/warrants/`(子目錄,MANIFEST 不掃):`mi_index_0999.json` / `mi_index_0999P.json` / `t187ap37_L.json` / `tpex_warrant_issue.json` / `tpex_warrant_daily_quts.json` / `tpex_mainboard_close.json` / `mis_quotes.json` — 原始 upstream shape 縮樣(≤10 檔權證,標的取 fixture 既有 symbol),日期對齊 FAKE_TODAY=2026-06-26(Fri,已驗星期)。
- FinMind 分點 fixture:flat `warrant_broker_*.json` + MANIFEST 條目(dataset `TaiwanStockWarrantTradingDailyReport`)**與 fetch method 同 commit**。
- `e2e/specs/equity.spec.ts` 新 E#:E-warrants-1 tab 切換 + 表格資料級 assertion(數值非空,踩 2026-07-07 教訓);E-warrants-2 篩選(認售 toggle 後 row 數變);E-warrants-3 空狀態;E-warrants-4 row 展開分點。每 test 帶 `// 痛點:` 註解;selector 對 snapshot。
- `backend/tests_e2e/test_api_warrants.py`:三 endpoint contract(shape + detail.error)。
- 跑 e2e 前清 `e2e/.cache`。

## 4. SC ↔ 設計對照

| SC | 設計節 |
|---|---|
| SC-1 tab + 換標的刷新 | §2.4(App.tsx)+ §2.3 queryKey 含 stockId |
| SC-2 全欄位表格 + 預設排序 | §1.1–§1.3(計算)+ §2.2 sort + §2.4 表格 |
| SC-3 輪詢啟停 + 最後更新 | §2.3 useWarrantQuotes + §1.3 cooldown |
| SC-4 篩選器 | §2.2 filterWarrants + §2.4 篩選列 |
| SC-5 中性標色/無方向文案 | §2.4 視覺紀律 |
| SC-6 分點展開 | §1.4 + §2.3 useWarrantBrokers |
| SC-7 空狀態 | §1.2 空 list 200 + §2.4 |
| SC-8 as_of_date/refresh/cache(no_trading_day 語意見 §1.2 R1) | §1.2 日期回退 + cache 語意 |
| SC-9 完成 gate | §3 e2e + Phase 5/6 |

## 5. 邊界與失敗模式

- 上游(TWSE/TPEx/MIS)httpx 例外 → route 502 `warrant_upstream`;FinMind(brokers)例外沿既有中央 handler(R9 逐 endpoint,見 §1.5)。
- 非交易日:快照回退 + `as_of_date` 揭示;MIS 收盤後回最後快照(行為零分支,spec §3.2)。
- 快照 build 進行中的並發請求:`_run_once("snapshot_build")` 單一全域 key 合流(warrants + quotes 共用,R3),首請求 ~10–30s(6 發 + 3 萬檔 IV 反解)。IV 反解迴圈每 500 檔讓出 event loop(R7)+ build 耗時 log;實測 >5s 再議 thread offload(先量再優化)。
- MIS schema 無預警變動:normalize 髒點測試 + provider 單點隔離。

## 6. Known Risks

1. MIS 限流曲線量測於週六盤外;盤中負載未實測 → cooldown 10s + 批次序列化保守化,常數具名可一行調。
2. 估價差 label 門檻 ±10% 為 auto-default 初值,待真實分布校準(具名常數)。
3. 快照冷 build 首請求延遲 ~10–30s(每日一次);IV 迴圈已讓出 loop 但單次 bs_price 評估間仍佔 CPU,對其他 endpoint 有輕度延遲影響 — 實測 log 佐證後再決定是否 offload(YAGNI;next-time 候選)。
4. 國定假日/颱風假前端照常輪詢(isMarketOpen 只判週間+時段,R10):由 backend cooldown 吸收(每 15s 一次輕 request,MIS 回舊快照,無害);quote_date 自動停輪詢方案 rejected(盤前開頁會把輪詢鎖死)。
