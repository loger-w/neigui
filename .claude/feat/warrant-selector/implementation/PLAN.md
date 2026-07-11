# Implementation PLAN — warrant-selector(condensed)

依 design.md v3。goal_efficiency_mode:wave batch commit(`[waveN]` tag,body 列 SC-N)。每節 = 一檔:動什麼 / signature / 失敗測試 ↔ SC。
(round-1 review 全 8 條 accepted 已修入:R1 404 no_data 測試、R2 fixture warrant_id 對齊約束、R3 `f"{_FINMIND_BASE}/data"`、R4 data_date 取 rows 日期、R5 put delta 階梯 −1、R6 13:35 inclusive、R7 tpex_date 測試、R8 refetchInterval false 分支測試。)

## Wave 1 — 定價純函式(SC-2)

### `backend/services/warrant_pricing.py`(create)
- 零 IO 純函式模組;`RISK_FREE_RATE = 0.016`;`_norm_cdf(x) = (1 + math.erf(x / math.sqrt(2))) / 2`。
- `bs_price(s: float, k: float, t: float, r: float, sigma: float, kind: str) -> float`(kind: `"call"|"put"`;t<=0 → 內在價值 max(0, ±(s−k)))
- `bs_delta(s, k, t, r, sigma, kind) -> float`(call: Φ(d1);put: Φ(d1)−1;t<=0 階梯:call S>K→1 否則 0,put S<K→**−1** 否則 0)
- `implied_vol(price: float, s: float, k: float, t: float, r: float, kind: str) -> float | None`:bracket σ∈[1e-4, 5.0] 二分 100 iter tol 1e-8;price<=0 / t<=0 / s<=0 / 出界(f(lo)·f(hi) 同號)→ None。

### `backend/tests/test_warrant_pricing.py`(create)
- Hull 教科書:S=42,K=40,T=0.5,r=0.10,σ=0.20 → call ≈ 4.759422,put ≈ 0.808599(6 位小數)[SC-2]
- put-call parity;delta 邊界(含 put t=0、S<K → −1);IV round-trip σ=0.15/0.35/0.80 還原 ±1e-6;邊界 None(price=0、t=0、price 低於內在價值)[SC-2]

## Wave 2 — EOD 快照 service(SC-2/7/8)

### `backend/services/warrants.py`(create)
- 樣板 daytrade_fee.py:`_ssl_context` / `_get_client` / `aclose` / `_run_once` local 複製;常數 `_CACHE_VERSION=1`、`BUILD_RETRY_COOLDOWN_SEC=60.0`、`SNAPSHOT_LOOKBACK_DAYS=7`、`IV_YIELD_EVERY=500`。
- fetch 六函式(各含 FAKE 分支讀 `tests_e2e/fixtures/warrants/<name>.json`):`_fetch_mi_index(date_iso, type_code) -> list[list]`(取 fields==20 的 table)、`_fetch_t187ap37() -> list[dict]`、`_fetch_tpex_quts/_fetch_tpex_close/_fetch_tpex_issue() -> list[dict]`。
- normalize:`_roc_compact_to_iso(s)`、`_row_get(row: dict, key: str)`(stripped-key)、`_parse_price(s) -> float | None`(千分位/空字串/`---`/`-`)、`normalize_twse_market_row(row) -> dict | None`、`normalize_twse_terms_row(row) -> dict | None`、`normalize_tpex_*_row(...)`;壞 row skip+warning。
- `_build_snapshot(refresh: bool) -> dict`:日期回退(today 起 ≤7 天,兩型 MI_INDEX 皆空→前一日)→ universe 交集(+ `last_trading_date >= as_of`)→ join → `iv_prev` 反解(P=close→mid→None;is_reset→None;T=(ltd−as_of)/365;每 500 檔 `await asyncio.sleep(0)`)→ `by_underlying` index → `atomic_write_json("warrants_snapshot_latest.json")` + `_snapshot_mem`;空 universe 不覆寫非空 cache;耗時 `logger.info`。
- `_load_snapshot(refresh: bool) -> dict`:mem→檔→(無效且過 backoff)`_run_once("snapshot_build", ...)`;`_last_build_attempt` 寫入邏輯照 design §1.2 R2-1。
- `async def get_underlying_warrants(stock_id: str, refresh: bool = False) -> dict` → `{"as_of_date", "warrants": [...]}`(無權證 → 空 list)。

### `backend/tests/test_warrants_service.py`(create;fixture = probe payload 縮樣 conftest tmp_path)
- normalize 髒點各一:民國緊湊、stripped-key(有/無 leading space)、千分位、空字串價、`---`、`CapPrice="    "`、壞 row skip 不炸 [SC-2]
- 日期回退:today 空表 → as_of=昨日且 payload **無** `no_trading_day` key [SC-8 amendment]
- universe:已到期(ltd < as_of)剔除、行情有條款缺 skip、牛熊不進(fixture 不含 0999B 型即天然驗交集)[SC-2]
- cache:refresh 跳 cache、`_CACHE_VERSION` bump 失效、空回不覆寫非空、**空回後 60s 內第二請求不重 build**(monkeypatch monotonic)[SC-8]
- 併發:warrants+quotes 同時首請求只觸發一次 build(fetch counter)[SC-8/R3]
- 回退 7 天皆空且無既有 cache → `HTTPException` 404 `detail.error=="no_data"`(service 層 raise,route 不得誤包 502)[SC-8/impl-R1]
- 跨源日期不一致:TPEx fixture 日期 ≠ TWSE as_of → 仍合併且 payload `tpex_date` 正確 [SC-2/impl-R7]
- `iv_prev`:有成交用 close、零成交用 mid、皆無/重設型 None [SC-2]
- 無權證標的 → 空 list [SC-7]

## Wave 3 — 盤中 quotes + routes(SC-2/3/8)

### `backend/services/warrant_quotes.py`(create)
- 常數照 design §1.3(`MIS_BATCH_SIZE=100` / `QUOTES_COOLDOWN_SEC=10.0` / `QUOTES_COOLDOWN_MAX=8` / `MISPRICE_FAIR_BAND=0.10` / `IV_PCTL_*`);`_fetch_mis_raw(ex_ch: str) -> list[dict]`(provider 單點,FAKE 讀 `mis_quotes.json`)。
- `_parse_mis_row(m: dict) -> dict | None`:`z=="-"`→None、尾綴 `_` strip、五檔取第一檔、`-` 佔位、tlong→(quote_date, quote_time)。
- `_compute_row(term: dict, q: dict | None, s_now: float | None, today: date, group_ivs) -> dict`:design §1.3 全欄位;P=z→mid→None(None→計算欄全 null);T 用 clock.today。
- `async def get_quotes(stock_id: str, refresh: bool = False) -> dict`:cooldown→`_run_once(f"quotes_{stock_id}")`→get_underlying_warrants→空清單早退→批次序列 MIS(權證+標的,prefix 依 market)→S_now fallback(z→mid→underlying_eod_close→None)→iv_percentile 分組→payload(頂層時間戳 fallback:標的 tlong→批次 max→null)→寫回 cooldown(含 refresh)。
- `aclose()`(自有 client 或共用 warrants client — 共用:`from services import warrants` 用其 `_get_client`?**否**,自帶 client 照樣板,獨立 aclose)。

### `backend/tests/test_warrant_quotes.py`(create)
- MIS normalize 髒點:`z="-"`、尾綴 `_`、五檔第一檔、`-` 佔位 [SC-2]
- 計算欄位數值鎖:手算一檔 call(給定 S/K/T/ratio/P → iv/delta/leverage/spread/差槓比/theo/估價差,對 warrant_pricing 輸出)[SC-2]
- T 差一天 case:as_of=昨日 vs today 的 T 不同(短天期)[SC-2/R5]
- cooldown:10s 內第二請求不打 MIS(fetch counter)、refresh 跳過且寫回、>8 標的踢最舊 [SC-3]
- S_now fallback 鏈 + 頂層時間戳 fallback [R6/R2-4]
- iv_percentile:樣本<5 → null;分組正確(不同 kind 不混)[SC-2]
- P 皆無 → 計算欄全 null 但列出 [SC-2 edge 2]

### `backend/routes/warrants.py`(create)+ `backend/main.py`(modify)
- 三 endpoint 照 design §1.5;`_VALID_ID = re.compile(r"^[0-9A-Za-z]{4,6}$")`;warrants/quotes catch `httpx.HTTPError`→502 `warrant_upstream`;brokers 不 catch;全包 `run_with_disconnect`。
- main.py:import + `include_router` + lifespan `await warrants_mod.aclose()` / `await warrant_quotes_mod.aclose()`。

### `backend/tests/test_warrants_routes.py`(create)
- 400 bad_symbol(兩 path 參數各一)[R2-3];502 warrant_upstream(monkeypatch raise httpx.ConnectError)[SC-8];200 shape;quotes 空標的 200 空 dict [SC-7]

## Wave 4 — 分點展開(SC-6)

### `backend/services/finmind.py`(modify)
- 加 `async def fetch_warrant_trading_daily_report(self, warrant_id: str, date: str) -> list`:`self._get(f"{_FINMIND_BASE}/data", {"dataset": "TaiwanStockWarrantTradingDailyReport", "data_id": warrant_id, "start_date": date})`(end_date 留空;inline f-string 對齊既有 18 個 fetch_*,不抽常數 — impl-R3)。**同 commit**:flat fixture `warrant_broker_030012.json` + MANIFEST 條目(不然 MANIFEST gate 紅)。fixture rows 日期全部 = FAKE_TODAY−1(2026-06-25;impl-R4)。

### `backend/services/warrant_brokers.py`(create)
- `def get_finmind():`(per-module wrap);`_CACHE_VERSION=1`、`BROKER_LOOKBACK_DAYS=5`。
- `async def get_brokers(warrant_id: str, refresh: bool = False) -> dict`:today−1 起跳週末向前 ≤5 日;**FinMind start_date open-ended 會回多日 rows → 以 rows 的 `date` 欄過濾出查詢日,`data_date` 取自 rows 實際日期而非查詢日**(impl-R4);命中寫 `warrant_brokers_{id}_{date}.json`;全空 `{"data_date": None, "rows": []}`;rows `[{broker_name, buy, sell, net}]` |net| 降序。

### `backend/tests/test_warrant_brokers.py`(create)
- 回退命中 T-1、跳週末、全空回 data_date None、cache 命中不重打、refresh 跳 cache、|net| 降序、**多日 rows 過濾出查詢日 + data_date 取 rows 日期**(impl-R4)[SC-6]

## Wave 5 — 前端 lib + hooks(SC-1/3/4/5 邏輯層)

### `frontend/src/lib/warrant-data.ts`(create)
- `WarrantTerm` / `WarrantQuote` / `WarrantRow = WarrantTerm & Partial<WarrantQuote>` / 三 payload 型別(欄位對 design §1.2/§1.3 payload;snake_case 照 backend)。

### `frontend/src/lib/api.ts`(modify)
- `RequestOptions` 加 `noCache?: boolean`;`get()` 開頭 `if (options?.noCache) return fetch 路徑不讀寫 _cache`(實作:抽 `_fetchJson` 或 noCache 分支跳 cache 讀寫兩處)。
- `warrants(stockId, refresh?, options?)` / `warrantQuotes(stockId, refresh?, options?)`(恆 merge `noCache: true`)/ `warrantBrokers(warrantId, refresh?, options?)`。
- 測試:api.test.ts 既有檔加 noCache 行為一測(同 key 兩發都打 fetch)[SC-3]

### `frontend/src/lib/warrant-utils.ts`(create)+ `warrant-utils.test.ts`
- `QUOTES_REFETCH_MS = 15_000`;`WarrantFilters` 型別 + `filterWarrants(rows, f)`;`sortWarrants(rows, key, dir)`(null 沉底);`isMarketOpen(d: Date) -> boolean`(Asia/Taipei 週一–五 09:00–13:35,**13:35 inclusive**(收盤撮合 13:30 緩衝)→ 13:35 open / 13:36 closed,impl-R6);`mergeWarrantRows(terms, quotesById)`。
- 測試:每 filter 一測(含 null 剔除語意)、sort null 沉底 asc/desc、isMarketOpen 邊界(08:59 closed/09:00 open/13:35 open/13:36 closed/週六 closed)、merge 對齊 [SC-3/4]

### `frontend/src/hooks/useWarrants.ts` / `useWarrantQuotes.ts` / `useWarrantBrokers.ts`(create)+ 各 `.test.ts`
- signature:`useWarrants(stockId: string, enabled: boolean)` → `{data, loading, error, refresh, asOfDate}`;`useWarrantQuotes(stockId, enabled)` → `{..., quoteDate, quoteTime}`(refetchInterval 函式式:open→`QUOTES_REFETCH_MS`,否則 false;`refetchIntervalInBackground: false`);`useWarrantBrokers(warrantId: string | null)` → `{..., dataDate}`。
- 測試(frontend-testing 慣例,vi.spyOn api):enabled=false 不 fetch、refresh 帶 true、quotes 的 refetchInterval 函式兩分支皆鎖(isMarketOpen true → 15_000、false → false;mock isMarketOpen,impl-R8)、brokers null 不 fetch [SC-1/3/6]

## Wave 6 — UI(SC-1/2/4/5/6/7;開工先呼叫 frontend-design + bencium-controlled-ux-designer)

### `frontend/src/components/WarrantSelector.tsx`(create)+ `WarrantSelector.test.tsx`
- props `{symbol: string; active: boolean}`;內部三 hooks;篩選列(SC-4 六控件)+ `<table>` sticky header(SC-2 欄序照 spec §5.2)+ row 展開(`aria-expanded`,分點 T-1 標註)+ 空狀態「此標的無掛牌權證」+ 「快照基準日 as_of」「最後更新 HH:MM」+ 重整鈕(只 quotes.refresh,R11)。
- badge:`data-testid="warrant-kind-badge"`(認購=accent 實底/認售=outline;非紅綠)、`data-testid="mispricing-label"`(偏貴/合理/偏便宜中性階)。
- 測試:欄 header 齊全、預設差槓比升序(首 row 斷言)、認售 toggle 篩選、空狀態、**負向 assert `queryByText(/做多|做空|買進|賣出|建議|滿倉/)` null**、badge testid 正向 assert、展開分點 lazy [SC-2/4/5/6/7]

### `frontend/src/App.tsx`(modify)
- `type Tab = "overview" | "bubble" | "warrants"`;第三 tab 鈕「權證」;`<div hidden={tab !== "warrants"}>` + `React.lazy` + `<Suspense>`;`<WarrantSelector symbol={symbol} active={tab === "warrants"} />`。

### `frontend/src/lib/changelog.ts`(modify)
- v0.25.0 entry(寫前讀 changelog-conventions)[SC-9]

## Wave 7 — e2e(SC-9)

### `backend/tests_e2e/fixtures/warrants/*.json`(create ×7)+ `warrant_broker_*.json`(flat,wave 4 已建)
- 縮樣原始 shape;標的用 fixture 既有 symbol(查 MANIFEST 現有,如 2330);≤10 檔權證;日期對齊 FAKE_TODAY=2026-06-26;`mi_index_0999.json` 含 tables 外殼(stat/tables[9])。**跨 wave 契約(impl-R2):快照 fixtures 必含 wave 4 的 `warrant_broker_030012.json` 對應 warrant_id(030012),掛在 e2e 使用的標的下**(E-W4 展開分點才走得通)。

### `backend/tests_e2e/test_api_warrants.py`(create)
- 三 endpoint contract:200 shape、400 bad_symbol、error code 字串 [SC-8]

### `e2e/specs/equity.spec.ts`(modify)
- E-W1 tab 切換+資料級 assertion(row 數 >0 且差槓比欄非空);E-W2 認售 toggle row 數變;E-W3 空狀態(無權證 symbol);E-W4 展開分點。每 test `// 痛點:` 註解;selector 對 snapshot;跑前清 `e2e/.cache` [SC-1/4/6/7]
