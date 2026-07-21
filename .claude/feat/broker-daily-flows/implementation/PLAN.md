# Implementation PLAN(condensed)— broker-daily-flows

依 design.md v3。goal_efficiency_mode:4 waves,wave batch commit(body 列 SC-N)。
Rev 1(impl review round 1 全 5 條 accepted):R1 formatAmountZh 獨立命名、R2 search_traders 4 測試案、R3 traders 422 案、R4 module 級 _is_stale、R5 fixture 獨特數值防汙染。

## Wave 1 — Backend core(SC-1 / SC-2 / SC-3 / SC-8)

### backend/services/finmind.py
- 新增 2 個 fetch(放 warrant fetch 附近,docstring 註 probe 佐證):
  - `async def fetch_daily_report_by_trader(self, trader_id: str, date_str: str) -> list` → `_get(f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report", {"securities_trader_id": trader_id, "date": date_str})`
  - `async def fetch_securities_trader_info(self) -> list` → `_get(f"{_FINMIND_BASE}/data", {"dataset": "TaiwanSecuritiesTraderInfo"})`
- 失敗測試:test_broker_flows.py::test_fetch_daily_report_by_trader_params(monkeypatch `_get` 斷參數)

### backend/services/broker_flows.py(新檔)
- Module 骨架 = warrant_flow.py 同構:`logger`、`_CACHE_VERSION = 1`、`get_finmind()` per-module wrapper、`_inflight` + `_run_once`(refcount+shield 同構抄)、cache via `utils.cache`。
- `_candidate_dates(start: date) -> list[str]`:weekday-loop 往前取 3 個非週末日(warrant_flow._candidate_dates 同構,n=3)。
- `_aggregate_flows(rows: list) -> tuple[list[dict], list[dict], int]`:group by stock_id;buy_lots=Σbuy//1000、sell_lots=Σsell//1000、net_lots=buy_lots−sell_lots、net_amount=round(Σ((buy−sell)×price));buy_top=net_amount>0 降冪 30、sell_top=net_amount<0 升冪 30、==0 不進;回 (buy_top, sell_top, distinct_count)。
- `_is_stale(payload: dict, max_age_minutes: int) -> bool`:module 級自寫(R4;判準對齊 FinMindClient._is_stale 的 fetched_at 齡期比較,不 import 該 staticmethod)。
- `_get_directory_or_none(refresh: bool = False) -> dict[str, str] | None`:cache key `broker_directory`(TTL 24h,`_is_stale(payload, 24*60)`);miss → `_run_once("broker_directory")` fetch 全表落 cache;`except (httpx.HTTPError, HTTPException): logger.warning; return None`;空 rows → None(不落 cache)。
- `async def search_traders(q: str) -> list[dict]`:directory None → `HTTPException(503, {"error": "broker_directory_unavailable"})`;id 前綴(casefold)或名稱 substring;`[{"broker_id","broker_name"}]` ≤50。
- `async def get_daily_flows(broker_id: str, date_param: str | None, refresh: bool) -> dict`:design §2.2 步驟 1-6(date fromisoformat→400 invalid_date;clamp today;目錄 404 前置 + None 降級;候選日 loop:cache 命中(今日 TTL 30min/過去日無條件)→ 用;miss → `_run_once(f"bflow_{broker_id}_{d}_r{int(refresh)}")` fetch,空不落 cache;全空 → 503 broker_flows_unavailable;聚合 + `routes.symbols.get_symbol_name_map()` join(`except ValueError: {}`);broker_name = 目錄 join 或 fallback broker_id)。
- 失敗測試(test_broker_flows.py):聚合 6 案(含符號背離)/ 候選日回退 3 案 + mock 計數 ≤3 / cache 4 案(命中 0 fetch、空不落、refresh bypass、今日 TTL 過期重抓)/ dedup 1 案 / 404 / 目錄降級 2 案(status + broker_name fallback)/ symbols 降級 1 案 / 目錄 cache 24h 1 案 / **search_traders 4 案(R2:id 前綴含大小寫、名稱 substring、>50 截斷、目錄不可得 503 broker_directory_unavailable code 斷言)**。SC-1/2/3/8。

### backend/routes/broker.py(新檔)+ backend/main.py
- router 兩個 GET(design §2.3;date 無 pattern);main.py import + `app.include_router(broker_router)`。
- 失敗測試(test_broker_routes.py):缺 broker_id → 422;**traders 缺 search → 422(R3)**;date=2026-02-31 → 400 invalid_date;future date clamp(monkeypatch clock);503/404 shape 透傳。SC-1/2。

### backend/routes/symbols.py
- `async def get_symbol_name_map() -> dict[str, str]`(design §2.2;3 行)。
- 失敗測試:併入既有 symbols test 檔(名稱 map + unavailable raise 原樣)。

### backend/tests/conftest.py
- broker_flows 加入模組級 `_inflight` 清理清單(3c6fc8e 基建,照既有 8 模組樣式)。

## Wave 2 — FAKE / fixtures / contract(SC-7 backend 半)

### backend/services/finmind_fake.py
- `_get` rows resolve 後、date filter 前加:`trader_id = params.get("securities_trader_id", ""); if trader_id: rows = [r for r in rows if r.get("securities_trader_id") == trader_id]`。
- 失敗測試:加進既有 fake client test 檔(有 filter / 無參數不變 / SecIdAgg 既有呼叫不變)。

### backend/tests_e2e/fixtures/(2 新檔)+ MANIFEST.json
- `taiwan_stock_trading_daily_report_trader_9600_2026-06-26.json`:手造 ~10 rows(2330 多價位買>賣、2412 賣>買、0050 僅買),欄位對 probe 實測 shape:`{securities_trader, price, buy, sell, securities_trader_id, stock_id, date}`。**R5 防汙染:2412/0050 rows 用獨特可辨識數值(如 buy=7,777,000 股級距)** — data_id fallback 若讓 chip 鏈吃到這些 rows,測試會以明確數字差異炸出而非 silent 過綠。
- `taiwan_securities_trader_info.json`:6 筆真值(9600 富邦/9604 富邦-陽明/9608 富邦-台東 + 凱基 9200、無關 2 筆),shape:`{securities_trader_id, securities_trader, date, address, phone}`。
- MANIFEST 條目 2 條(design §4.2 keys)。與 Wave 1 fetch method 同 PR 不同 commit 沒問題(MANIFEST gate 掃 code 是否含 dataset 名,Wave 1 已落)→ 保險起見 fixtures 與 FAKE filter 同 wave commit。
- fixture 完成後清 `e2e/.cache`。

### backend/tests_e2e/test_api_broker.py(新檔)
- FAKE server 下:daily-flows 200 shape 全欄位 + buy_top 內容斷言;traders 搜「富邦」≥3 筆;缺參數 422 + detail list;date=2026-02-31 → 400 invalid_date。SC-7。

## Wave 3 — Frontend(SC-4 / SC-5 / SC-6)

**開工前先呼叫 `frontend-design` + `bencium-controlled-ux-designer`(執行約束)+ 讀 `frontend-testing` skill。**

### frontend/src/lib/broker-flows-data.ts(新檔)
- design §3.1 三個 interface;**R1:market-format.formatAmount 是百萬 M 口徑(market-format.ts:39),不重用** — 此檔加 `formatAmountZh(n: number): string`(千/萬/億中文縮寫,負值帶號)+ 單測 4 案(千/萬/億/負值與 0)。

### frontend/src/lib/api.ts
- `brokerTraders(search, options)` / `brokerDailyFlows(brokerId, refresh?, options)`(design §3.2,get() 既有管道)。

### frontend/src/hooks/useBrokerDailyFlows.ts(新檔)
- useWarrantFlow 同構(design §3.3);回 `{ data, loading, error, noTradingDay, refresh }`。
- 失敗測試:useBrokerDailyFlows.test.ts(enabled gate / noTradingDay / error 終態,frontend-testing 慣例)。

### frontend/src/hooks/useTraderSearch.ts(新檔)
- design §3.3;回 `{ data, loading, error, refresh }`。
- 測試併入 Panel 測試(mock api 層)即可,不獨立檔。

### frontend/src/components/BrokerFlowsPanel.tsx(新檔)
- design §3.4:props `{ active, onPickStock }`;搜尋 debounce 200ms + dropdown(鍵盤上下/Enter);金額買超/金額賣超雙表(bull 紅/bear 綠 token);空狀態×3;no_trading_day 標註;stock_count>60 註;refresh 鈕;繁中全文案;`onPickStock(sid, row.stock_name || null, brokerId)`。
- 失敗測試:BrokerFlowsPanel.test.tsx(兩表渲染/空狀態/標註/回呼帶 broker_id/名稱空退代號)。

### frontend/src/App.tsx
- `Tab` type +`"broker-flows"`;tab 按鈕「分點反查」;hidden div + lazy + Suspense;`handleFlowStockPick`(design §3.5)。
- 失敗測試:App.test.tsx 加 tab 出現 + 切換(輕量)。

### frontend/src/lib/changelog.ts
- MINOR bump + VersionEntry(寫前讀 changelog-conventions)。

## Wave 4 — E2E(SC-7)

### e2e/specs/equity.spec.ts
- 新 E#(接現行編號):切「分點反查」tab → 搜「富邦」→ 選 9600 → 資料級斷言(買超表 2330 + 張數值;賣超表 2412)→ 點 2330 列 → tab 回籌碼總覽 + header 2330。selector 對 page snapshot,痛點註解。
- 前置:e2e/.cache 清過;FAKE_TODAY=2026-06-26 無回退。

## 驗證 gate(Phase 5)
pytest -q / ruff check . / npm test(vitest)/ npm run build / e2e npm test(判準表:需要)。
