# Design — 分點反查:當日買賣超股票(broker-daily-flows)v3

Changelog:
- v1(2026-07-21):初版。
- v2(2026-07-21):design review round 1 全 9 條 accepted 落地 — R1 名稱 join 降級、R2 date 驗證 400、R3 候選日改 weekday-loop、R4 422 契約記註、R5 net_amount 分類固化、R6 配額帳/目錄解耦、R7 layering 債明文、R8 changelog 交付項、R9 stock_name null 轉換。
- v3(2026-07-21):round 2 三條 accepted — R10 目錄降級機制具體化(_get_directory_or_none + broker_name fallback)、R11 useTraderSearch 補 refresh、R12 目錄 fixture 9600 名對齊真值。Phase 1 退出(P0=0 / P1=1≤2,全數落地)。

對應 brainstorm.md SC-1〜SC-8。樣板:backend = `services/warrant_flow.py`(候選日自適應 + module 級 `_run_once` + utils.cache),frontend = `WarrantFlowPanel` + `useWarrantFlow`(active gate + useForceRefreshQuery)。

## 1. 架構總覽

```
FinMind 專用 path                          FinMindClient(services/finmind.py)
  /taiwan_stock_trading_daily_report  ←──  fetch_daily_report_by_trader(trader_id, date)   [新]
  /data TaiwanSecuritiesTraderInfo    ←──  fetch_securities_trader_info()                  [新]
                                              │
                              services/broker_flows.py [新 module]
                                ├─ get_daily_flows(broker_id, date_param, refresh)
                                │    候選日 loop(≤3 交易日)→ 聚合 → 名稱 join → cache
                                ├─ search_traders(q) ← 目錄 cache(24h TTL)
                                └─ _aggregate_flows(rows) 純函式(單測直打)
                                              │
                              routes/broker.py [新 router]
                                ├─ GET /api/broker/daily-flows
                                └─ GET /api/broker/traders
                                              │
                              frontend
                                ├─ lib/broker-flows-data.ts(types)
                                ├─ lib/api.ts: api.brokerDailyFlows / api.brokerTraders
                                ├─ hooks/useBrokerDailyFlows.ts / useTraderSearch.ts
                                ├─ components/BrokerFlowsPanel.tsx(第五 tab 內容)
                                └─ App.tsx:Tab type + tab 按鈕 + hidden div + 跳轉 handler
```

## 2. Backend

### 2.1 FinMindClient 新 fetch(SC-1 / SC-3;MANIFEST gate 要求 _get 呼叫在 finmind*.py)

```python
async def fetch_daily_report_by_trader(self, trader_id: str, date_str: str) -> list:
    """分點反查:單分點單日全部成交(price-level rows)。專用 path,無 data_id;
    probe 2026-07-20:9600@2026-07-17 → 13,079 rows。"""
    return await self._get(
        f"{_FINMIND_BASE}/taiwan_stock_trading_daily_report",
        {"securities_trader_id": trader_id, "date": date_str},
    )

async def fetch_securities_trader_info(self) -> list:
    """分點目錄(全 1,011 筆,無 data_id、無日期參數)。"""
    return await self._get(
        f"{_FINMIND_BASE}/data",
        {"dataset": "TaiwanSecuritiesTraderInfo"},
    )
```

錯誤語意:`_get` 既有行為(httpx error → main.py 502 handler;rate limit 過 TokenBucket)。

### 2.2 services/broker_flows.py(新 module)

Module 骨架(warrant_flow.py 同構):
- `get_finmind()` per-module wrapper(finmind-conventions;test monkeypatch 點)。
- `_inflight: dict` + `_run_once`(warrants.py 同構 refcount + shield);**登記進 backend/tests/conftest.py 的模組級 _inflight 清理清單**(2026-07-19 commit 3c6fc8e 基建)。
- cache 走 `utils.cache.atomic_write_json / read_json / chip_cache_dir`,`_CACHE_VERSION = 1`。

**`get_daily_flows(broker_id: str, date_param: str | None, refresh: bool) -> dict`**(SC-1/SC-2/SC-8):
1. date 驗證(R2):`date_param` 非 None 時 `try: date_type.fromisoformat(date_param) except ValueError: raise HTTPException(400, {"error": "invalid_date"})`(regex 擋不住 2026-02-31);parse 成 `date` 型後才 clamp:`start = min(parsed, clock.today())`(edge 5)。
2. 目錄前置檢查(R6 + R10 機制):目錄取用走內部 helper `_get_directory_or_none() -> dict[str, str] | None`(id → name;`except (httpx.HTTPError, HTTPException): logger.warning + return None`,catch 具體)— **不**經 search_traders 的 raise 路徑。directory 非 None 且 `broker_id` 不在其中 → `HTTPException(404, {"error": "broker_not_found"})`(edge 3);directory 為 None/空 → 跳過檢查續行(flows 不因目錄故障 502/503;無效 id 由步驟 5 的 503 收口)。`broker_name` = 目錄 join;**目錄不可得時 fallback = broker_id**(payload 契約寫死;前端 name===id 時只顯示一次)。
3. 候選日(R3):沿 warrant_flow `_candidate_dates` weekday-loop 樣板 — 從 start 往前取 **3 個非週末日**(自適應含 T+0,不依賴 trading_calendar 的 TaiwanFuturesDaily 上料時序;國定假日空一天 = 多燒 1 request 換簡單性)。
4. 對每個候選日依序:
   a. cache key `bflow_{broker_id}_{d}`;`refresh=False` 且 cache 命中(今日 TTL 30 min 走 `_is_stale` 同款判準、過去日無條件)→ 直接用。
   b. miss → `_run_once(f"bflow_{broker_id}_{d}_r{int(refresh)}", ...)` 內 fetch;**空 rows 不落 cache**(21:00 上料自動吃到)、非空落 cache(payload 帶 `fetched_at`)。
   c. 得非空 rows → break。
5. 全部候選日空 → `HTTPException(503, {"error": "broker_flows_unavailable"})`。
6. `_aggregate_flows(rows)` + 名稱 join → payload:
```json
{ "broker_id": "9600", "broker_name": "富邦",
  "requested_date": "2026-07-21", "as_of_date": "2026-07-17",
  "no_trading_day": true, "stock_count": 1136, "fetched_at": "...",
  "buy_top":  [{"stock_id": "2330", "stock_name": "台積電",
                "buy_lots": 500, "sell_lots": 120, "net_lots": 380,
                "net_amount": 431200000}],
  "sell_top": [ ...同 shape,net_amount < 0... ] }
```
   - `no_trading_day = as_of_date != requested_date`(跨檔契約);`broker_name` 從目錄 join。
   - cache 的是「單日 rows 聚合後 payload」(per (broker, as_of_date)),requested_date / no_trading_day 是 request-scope 欄位,回應時算,不入 cache。

**`_aggregate_flows(rows: list) -> tuple[list[dict], list[dict], int]`** 純函式(SC-1):
- group by `stock_id`:`buy_shares = Σ buy`、`sell_shares = Σ sell`、`net_amount = Σ((buy - sell) × price)`(row 級,價位精確)。
- lots:`buy_lots = buy_shares // 1000`、`sell_lots = sell_shares // 1000`、`net_lots = buy_lots - sell_lots`(截斷慣例對齊 `_parse_broker_history`)。
- `net_amount` round 成 int(元)。
- buy_top = `net_amount > 0` 依 net_amount 降冪前 30;sell_top = `net_amount < 0` 依 net_amount 升冪前 30;`net_amount == 0` 兩邊都不進。回傳 `(buy_top, sell_top, stock_count)`,stock_count = distinct stock_id 總數(edge 2)。
- **分類鍵 = 排序鍵 = net_amount 固化**(R5):net_lots 與 net_amount 符號可背離(低買高賣同量 → net_lots=0、net_amount<0 → 入賣超表;張數欄可為 0 或反號)。UI 表名用「金額買超 / 金額賣超」對齊口徑;單測固化背離 case。

**名稱 join**(SC-1):`routes/symbols.py` 新增公開 accessor:
```python
async def get_symbol_name_map() -> dict[str, str]:
    await _ensure_loaded()
    return {s["symbol"]: s["name"] for s in _symbols}
```
join 不到 → `stock_name = ""`(edge 4,前端顯示代號)。
- **降級路徑**(R1):`_ensure_loaded` 在 symbols 載入失敗時 raise `ValueError("symbols_unavailable")`(symbols.py:144,151)— broker_flows 呼叫端 `except ValueError: name_map = {}`(名稱純裝飾,不得拖垮 flows endpoint);補對應測試。
- **Layering 債明文**(R7):services → routes 反向 import,已知債;symbols 狀態本質是 service 資料卻長在 route 檔,不在本 feature 修(單一 consumer,薄 wrapper YAGNI)。

**`search_traders(q: str) -> list[dict]`**(SC-3):
- 目錄 cache key `broker_directory`,TTL 24h(`fetched_at` 判齡);miss → `_run_once("broker_directory", ...)` fetch 全表落 cache。
- 過濾:`q` 為 id 前綴(case-insensitive)或名稱 substring;回 `[{"broker_id", "broker_name"}]` 上限 50。
- 空表(upstream 掛)→ `HTTPException(503, {"error": "broker_directory_unavailable"})`。

### 2.3 routes/broker.py(新 router)+ main.py 註冊

```python
router = APIRouter()

@router.get("/api/broker/traders")
async def get_broker_traders(search: str = Query(min_length=1)) -> list[dict]:
    return await broker_flows.search_traders(search)

@router.get("/api/broker/daily-flows")
async def get_broker_daily_flows(
    broker_id: str = Query(min_length=1),
    date: str | None = Query(default=None),
    refresh: bool = Query(default=False),
) -> dict:
    return await broker_flows.get_daily_flows(broker_id.strip(), date, refresh)
```
- main.py `app.include_router(broker_router)`。
- 錯誤路徑沿 main.py 集中 handler(httpx → 502;HTTPException 原樣;內部 ValueError 不外露 — broker_flows 直接 raise HTTPException,對齊 warrant_flow 慣例;date 解析 ValueError 在 service 層攔截轉 400,見 §2.2 步驟 1)。
- **缺必填參數 = FastAPI 422**(R4):`detail` 為 validation list,**不在** `{"error": code}` contract 內 — 既有全站行為,contract test 預期 422 + list shape,不動 main.py handler。
- route 層 `date` 不做 regex pattern(驗證集中 service 層 fromisoformat,單一真源)。
- date 參數:v1 前端不傳(恆走 today);參數保留給 curl / 未來(YAGNI 邊界:不做前端 date picker)。

## 3. Frontend

### 3.1 types — lib/broker-flows-data.ts

```ts
export interface FlowStockRow {
  stock_id: string; stock_name: string;
  buy_lots: number; sell_lots: number; net_lots: number; net_amount: number;
}
export interface BrokerFlowsPayload {
  broker_id: string; broker_name: string;
  requested_date: string; as_of_date: string; no_trading_day: boolean;
  stock_count: number; fetched_at: string;
  buy_top: FlowStockRow[]; sell_top: FlowStockRow[];
}
export interface TraderHit { broker_id: string; broker_name: string; }
```
金額顯示 formatter(千/萬/億縮寫)重用 `lib/market-format.ts` 既有函式(實作時確認名稱,缺再補純函式 + 單測)。

### 3.2 api.ts

```ts
brokerTraders(search: string, options?: RequestOptions): Promise<TraderHit[]>
  → get(`${BASE}/broker/traders`, { search }, options)
brokerDailyFlows(brokerId: string, refresh?: boolean, options?: RequestOptions): Promise<BrokerFlowsPayload>
  → get(`${BASE}/broker/daily-flows`, { broker_id, ...(refresh && {refresh:"true"}) }, options)
```

### 3.3 hooks

```ts
// useBrokerDailyFlows.ts — useWarrantFlow 同構
useBrokerDailyFlows(brokerId: string, active: boolean)
  → useForceRefreshQuery<BrokerFlowsPayload>({
      queryKey: ["broker-flows", brokerId],
      enabled: active && !!brokerId,
      queryFn: (force, { signal }) => api.brokerDailyFlows(brokerId, force, { signal }),
    })
  → { data, loading, error, noTradingDay, refresh }   // SC-4 / SC-6

// useTraderSearch.ts — 輕量 useQuery
useTraderSearch(q: string)   // q = debounce 後字串,'' → enabled:false
  → useQuery({ queryKey: ["broker-traders", q], enabled: q.length >= 1,
               queryFn: ({ signal }) => api.brokerTraders(q, { signal }),
               staleTime: 24*60*60*1000 })
  → { data, loading, error, refresh }   // R11:refresh = refetch 包一層,對齊 CLAUDE.md §3 hook shape
```

### 3.4 BrokerFlowsPanel.tsx(SC-4 / SC-5 / SC-6)

Props:`{ active: boolean; onPickStock: (stockId: string, stockName: string | null, brokerId: string) => void }`。
內部 state:`selectedTrader: TraderHit | null` + 搜尋框字串(debounce 200ms,BrokerSearch 既有節奏)。

版面(桌面):上方分點搜尋列(輸入框 + dropdown,鍵盤上下 + Enter,BrokerSearch 互動慣例)+ 選定分點徽章(id + name)+ as_of_date 標註;下方左右兩欄:**金額買超表**(bull 紅)/ **金額賣超表**(bear 綠)(R5 口徑對齊,張數欄可為 0 或反號);<lg 上下堆疊(frontend-conventions 響應式)。表格欄:代號/名稱(name 空 → 顯示代號)、買張、賣張、買賣超(張)、金額(縮寫)。列 click + Enter → `onPickStock(sid, row.stock_name || null, brokerId)`(R9:"" → null 轉換在 Panel 端,對齊 App symbolName 的 null 慣例)。

狀態:
- 未選分點 → 引導文案「搜尋分點名稱或代號」。
- loading → 既有 skeleton/「載入中」慣例。
- error → hook error 字串(繁中映射走 api.ts 既有 `__apiGet` 錯誤處理)。
- `noTradingDay` → 「{requested_date} 尚無資料,顯示 {as_of_date}」標註(SC-6)。
- buy_top/sell_top 空 → 該欄「無買超」/「無賣超」(edge 1)。
- `stock_count > 60` → 表頭註「共 {stock_count} 檔,各列前 30」(edge 2)。
- 全 UI 文字繁中;色走 semantic token(`text-bull` / `text-bear` 或既有 chip 表格 token,實作時對齊 ChipBrokersPanel)。

不進全域 refresh(同 WarrantFlowPanel);面板自帶重新整理鈕呼叫 hook.refresh()。

### 3.5 App.tsx 接線(SC-4 / SC-5)

- `type Tab = ... | "broker-flows"`;tab 按鈕「分點反查」;`hidden` div + `React.lazy` + Suspense(現有四 tab 同構)。
- 跳轉 handler:
```ts
const handleFlowStockPick = useCallback((sid: string, name: string | null, brokerId: string) => {
  setTab("overview");
  handlePick(sid, name);                          // 會 reset selectedBrokerIds
  setSelectedBrokerIds(new Set([brokerId]));      // 之後預選反查分點
}, []);
```
- 已知顯示限制:K 線 overlay 名稱來自該股 top_brokers 同 id(App.tsx:136);預選分點若不在該股 top list,ChipBrokersPanel 既有 fallback 路徑處理(ChipBrokersPanel.tsx:183)→ overlay 照畫、名稱顯示退化為 id。列入 Known Risks(非 SC 阻斷)。

## 4. FAKE / fixtures / e2e(SC-7)

### 4.1 FakeFinMindClient._get 擴充

現況不濾 `securities_trader_id` → 加通用過濾(複製上游語意,e2e-conventions):
```python
trader_id = params.get("securities_trader_id", "")
if trader_id:
    rows = [r for r in rows if r.get("securities_trader_id") == trader_id]
```
位置:rows resolve 之後、date filter 之前。既有 SecIdAgg fixture(BROKER001)rows 含 securities_trader_id 欄 → 天然相容(其呼叫本就帶該參數,過濾後不變)。

### 4.2 fixtures + MANIFEST(與 fetch method 同 commit;基準日 2026-06-26 Fri)

| 檔名 | MANIFEST | 內容 |
|---|---|---|
| `taiwan_stock_trading_daily_report_trader_9600_2026-06-26.json` | `{dataset: "taiwan_stock_trading_daily_report", data_id: ""}` | 9600 @ 2026-06-26 手造縮樣:2330 多價位(買>賣)、2412(賣>買)、0050(僅買)共 ~10 rows,原始 upstream shape |
| `taiwan_securities_trader_info.json` | `{dataset: "TaiwanSecuritiesTraderInfo", data_id: ""}` | 縮樣 ~6 筆(取 probe 實測真值:9600「富邦」、9604「富邦-陽明」、9608「富邦-台東」+ 凱基/無關各 1-2),原始 shape。R12 註:warrant fixtures 內 9600=「富邦建國」為既存手造 artifact,與目錄異名非本輪引入,不動 |

- universe-key `("taiwan_stock_trading_daily_report", "")` 汙染面檢查:`_get` 的 data_id fallback 會讓「查無 per-stock fixture 的股票」吃到本 fixture(按 stock_id 過濾)— 縮樣只含 2330/2412/0050;2330 有既有 per-stock fixture 直接命中不走 fallback;確認 2412/0050 無其他 e2e flow 打 per-stock daily report(目前僅 chip summary 對 2330)→ 風險受控,e2e 全綠為準。
- trader info fixture 無日期參數查詢 → FAKE `_get` 無 date filter 全量回傳,正確。
- 欄位名對 parser `row.get(...)` 清單逐一校(e2e-conventions 2026-07-07 事故)。
- fixture 改動後清 `e2e/.cache`。

### 4.3 e2e spec

- `e2e/specs/equity.spec.ts` 新 E#:切「分點反查」tab → 搜「富邦」→ 選 9600 → **資料級 assertion**(買超表含 2330 + 具體張數;賣超表含 2412)→ 點 2330 列 → 斷言 tab 回「籌碼總覽」+ header 顯示 2330。FAKE_TODAY=2026-06-26 → 無回退,`no_trading_day=false`。
- `backend/tests_e2e/test_api_broker.py`:daily-flows shape(欄位齊)+ traders 搜尋 + 缺必填參數 → **422 + detail list**(R4,validation 不在 error contract)+ `date=2026-02-31` → 400 `{"error": "invalid_date"}`(R2)。

## 5. SC 對應表

| SC | 設計節 |
|---|---|
| SC-1 | §2.1 / §2.2(_aggregate_flows + payload)/ §2.3 |
| SC-2 | §2.2 get_daily_flows 步驟 2-4(候選日 ≤3、空不落 cache、503)|
| SC-3 | §2.2 search_traders / §2.3 |
| SC-4 | §3.3 / §3.4 / §3.5(tab)|
| SC-5 | §3.4 onPickStock / §3.5 handleFlowStockPick |
| SC-6 | §3.3 noTradingDay / §3.4 標註 |
| SC-7 | §4 全節 |
| SC-8 | §2.2 cache + _run_once + 候選日上限(mock 計數測試)|

## 6. 測試盤點

Backend(`backend/tests/`):
- `test_broker_flows.py`:_aggregate_flows(聚合/截斷/排序/0 淨額排除/單向空表/stock_count/**net_lots–net_amount 符號背離**(R5))、候選日回退(首日空→次日、全空 503、mock 計數 ≤3、weekday-loop 跳週末)、cache(命中 0 fetch / 空不落 cache / refresh bypass)、dedup(並發同 key 1 fetch)、broker_not_found 404、**目錄不可得降級跳過 404 檢查 + broker_name fallback = broker_id**(R6/R10)、**symbols_unavailable 降級空 name map**(R1)、目錄 cache 24h。
- `test_broker_routes.py`:缺 broker_id → 422、`date=2026-02-31` → 400 invalid_date(R2)、future date clamp、錯誤 shape。
- symbols accessor:`get_symbol_name_map` 最小測試(併入既有 symbols test 檔)。
- MANIFEST gate 既有 3 測試自動覆蓋新 fixture。
Frontend(vitest,先讀 frontend-testing skill):
- `useBrokerDailyFlows.test.ts`(enabled gate / noTradingDay / error 終態)。
- `BrokerFlowsPanel.test.tsx`(渲染兩表 / 空狀態 / no_trading_day 標註 / onPickStock 回呼帶 broker_id / stock_name 空退代號)。
- App.test.tsx:新 tab 出現 + 切換(輕量)。
E2E:§4.3。

## 7. Known Risks

1. K 線 overlay 預選分點名稱退化為 id(§3.5 顯示限制)— 接受,不擋 SC-5(overlay 本體照畫)。
2. FinMind 對「無效 broker_id」與「未上料」同回 0 rows — 以目錄前置 404 緩解;目錄本身 T+? 更新頻率未知(新開分點短窗內查不到);目錄不可得時 404 檢查降級跳過(R6),無效 id 此窗內以 503 收口(語意略糊,接受)。
3. `("taiwan_stock_trading_daily_report", "")` universe fixture 的 data_id fallback 汙染面 — 縮樣限定 + e2e 全綠把關(§4.2)。
4. 候選日 weekday-loop 不識國定假日(R3 trade-off):連假日多燒 1〜2 requests 空查後回退,不影響正確性。

## 8. 配額(SC-8)

單次反查完整帳(R6):flows 冷 1〜3 requests(候選日 weekday-loop,無 calendar 依賴)+ 目錄冷 +1(24h TTL 攤提,前置檢查與 search 共用同 cache);全 warm 0。無 fan-out。相對 6000/hr 配額可忽略。SC-8 mock 計數測試口徑:單次 get_daily_flows 在目錄已 warm 時 ≤ 3。

## 8.5 Phase 4 amendments(2026-07-21 code review 落地,詳 code-review-round-*.json)

- [amendment 2026-07-21] `search_traders` 純空白 query 提前回 `[]`(C3);`broker_id` 白名單 `[0-9A-Za-z]{1,10}` 不符 404(S6);目錄 helper 無 refresh 參數(S5 死參移除)。
- [amendment 2026-07-21] 今日 cache 過 TTL 重抓遇上游短暫空回應 → serve stale cache 不倒退前一日(C4)。
- [amendment 2026-07-21] 前端:dropdown 三態出口(錯誤繁中/搜尋中/查無)+ selectedEcho 防 refocus 誤導(V1)+ activeIdx 驅動 scrollIntoView(V2);`ERROR_TEXT` 三碼繁中 map;`formatAmountZh` 億門檻 99,995,000。

## 9. 交付清單補項

- `frontend/src/lib/changelog.ts`:MINOR bump + VersionEntry(R8;寫 entry 文字前讀 `changelog-conventions` skill)。
