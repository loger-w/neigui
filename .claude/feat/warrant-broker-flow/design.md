# Design — warrant-broker-flow(權證買賣超分點)v3

**Changelog**
- v1(2026-07-14):初版。依 brainstorm.md(spike 校準後)+ spec §5 展開。
- v3(2026-07-14):round 2 全 5 條 accepted — R14 day-dump dedup key 帶 refresh 旗標(market_breadth F2 precedent);R15 空 dump 只在 D < today−1 落 cache(ingestion 緩衝日);R16 快照層 404 重包 warrant_upstream(no_data 專屬候選日耗盡);R17 空 payload 表補 no_trading_day 欄;R18 fixture 日期一致性約束。
- v2(2026-07-14):design-review round 1 全 13 條 accepted 落地 —
  R1 空狀態 payload 完整 shape;R2 fixture probe 存活約束;R3 收斂 per-warrant cache 決策(不做,標理由);R4 FAKE date 過濾語意;R5 cache retention;R6 TaskGroup 取消 siblings;R7 day-dump 跨 stock dedup;R8 lookback 10 + no_data 前端文案;R9 truncated 文案插值;R10 unmapped heuristic 口徑鎖;R11 changelog/截圖落點;R12 refresh 全量語意;R13 noTradingDay dead-field 註記。

對應 brainstorm SC:每節末標 `[SC-N]`。

---

## 1. 架構總覽

```
App.tsx(equity mode 第 4 個 tab「權證分點」,active gate)
  └─ WarrantFlowPanel(React.lazy)
       └─ useWarrantFlow(symbol, active) — TanStack useQuery, enabled = active && !!symbol
            └─ api.warrantFlow(stockId, refresh, {signal})
                 └─ GET /api/warrants/{stock_id}/flow?date=&refresh=
                      └─ services/warrant_flow.py::get_flow(stock_id, date?, refresh)
                           ├─ warrants.get_snapshot()            ← 條款快照(權證→標的,TWSE/TPEx)
                           ├─ _fetch_price_day(D)                ← TaiwanStockPrice date-only 全市場(1 req,per-date cache,跨 stock dedup)
                           ├─ 可得性 probe(成交金額最大權證,1 req)
                           ├─ fan-out ≤ 199 × fetch_warrant_trading_daily_report(wid, D)(TaskGroup)
                           └─ 聚合 → per (stock_id, D) result cache
```

## 2. Backend

### 2.1 新檔 `services/warrant_flow.py`(核心)

**落點決策**:spec §5.1 原寫 `services/warrants.py` 加 `build_flow`,但該檔已 517 行且職責 = TWSE/TPEx 直抓快照;flow 屬 FinMind fan-out 域(需 per-module `get_finmind()` wrap,finmind-conventions)。新檔隔離。`[auto-default: 新檔 warrant_flow.py | reason: 檔案職責邊界 + per-module patch 需求;API shape 不變,非方向性]`

常數:
```python
_CACHE_VERSION = 1
FLOW_CAP = 200                    # spike L-2 校準:cap 200 最壞覆蓋 95.69%(2330)
FLOW_LOOKBACK_DAYS = 10           # R8:春節級連假(>5 非週末日)也要能回退到最近交易日
_PRICE_DAY_KEEP_KEYS = ("stock_id", "Trading_money")   # day dump 裁欄後才落 cache
_DUMP_RETAIN_DAYS = 7             # R5:flow_prices_* 保留天數
_RESULT_RETAIN_DAYS = 30          # R5:warrant_flow_* result 保留天數
_WARRANT_PREFIXES = ("03","04","05","06","07","08","09","72","73","74")  # R10:與 spike 腳本同一口徑(memory reference_finmind_warrant_dataset 的代號區間)
```

**per-warrant 明細 cache 決策(R3,brainstorm §7 開放項收斂)**:fan-out 結果**不做** per (warrant, date) cache,只落 per (stock, date) result cache。`[auto-default: 無 per-warrant cache | reason: (a) 檔案數增長 200 檔/股/日 需另設 retention;(b) warrant_brokers 既有 cache 存聚合後 rows(丟 price),flow 需 price×股數 無法共用;(c) probe-first 已擋掉最常見的白燒(報表未上料);(d) 失敗重試全重燒 ≤200 req = 3.3%/hr,user-initiated 可接受。TaskGroup(R6)保證失敗當下 siblings 立即取消,不會 199 檔打完才丟]`

**資料流(`get_flow(stock_id, date=None, refresh=False)`)**:

1. `snap = await warrants.get_snapshot()`;`by_underlying.get(stock_id)` 空 → 回 **no_warrants 空 payload**(§2.2b;**不是 404** — 標的合法、只是無權證)。快照呼叫包 `try/except`:`httpx.HTTPError` **與快照層 `HTTPException(404, no_data)`**(`warrants._load_snapshot` build 失敗/7 天全空會 raise,R16)皆重包 `HTTPException(502, {"error": "warrant_upstream"})` — `no_data` 碼專屬「候選日耗盡」單一語意,前端文案不說謊;FinMind 錯誤放行給中央 handler → `finmind_error`。
2. 候選日:`date` 給定 → 從該日往前;未給 → 從 `clock.today()` 起往前,非週末日至多 `FLOW_LOOKBACK_DAYS` 個(spike L-1 自適應:T+0 晚間上料自動吃到)。
3. 對候選日 D:
   a. result cache 命中(`warrant_flow_{stock_id}_{D}.json`,`_cache_version` 驗)且非 refresh → 直接回。
   b. `_fetch_price_day(D, refresh)`:TaiwanStockPrice date-only 全市場。**獨立 cache** `flow_prices_{D}.json`(理由:market_breadth `_cleanup_stale_window_files` 刪非當前 window 的 `breadth_prices_*`,共用 prefix 互踩;獨立 prefix 隔離,代價每日 1 request)。函式**內部自帶** `_run_once(f"flow_prices_{D}_r{int(refresh)}")` + cache 讀寫(R7:跨 stock 併發只抓一次;**R14:dedup key 帶 refresh 旗標** — market_breadth F2 precedent,防 refresh 請求 join 到 cache-read 路徑的 in-flight task 靜默拿快取)。`refresh=true` 跳過此層 cache 重抓(R12:站內 refresh 全量語意)。裁 `_PRICE_DAY_KEEP_KEYS` 後落 cache;空 dump 快取條款(R15):**D ≥ today−1 且 rows 空 → 不落 cache**(當日稍晚上料 + FinMind EOD ingestion 跨午夜緩衝日;refresh 可自癒),D < today−1 空 → 落 cache(非交易日恆空)。dump 空 → 下一候選日。
   c. 交集:`by_underlying[stock_id]` 的 warrant_id ∩ dump `Trading_money > 0` rows → `traded`。全市場 unmapped:dump 內 `len(id)==6 and id[:2] in _WARRANT_PREFIXES` 且 `Trading_money > 0` 且不屬任一 underlying → `unmapped_count`(log + payload,全市場口徑,spike L-3;heuristic 與 spike 腳本同一 regex,含字尾字母的 6 碼牛熊證天然命中)。`traded` 空 → 回 **no_volume 空 payload**(§2.2b;D 是交易日、量為零是合法終態,**不回退**)。
   d. 依 Trading_money 降序取前 `FLOW_CAP`,`truncated = len(traded) > FLOW_CAP`,`analyzed = min(len(traded), FLOW_CAP)`。
   e. **可得性 probe**:對 top-1 權證 `fetch_warrant_trading_daily_report(wid, D)`,caller 過濾 `row["date"] == D`;0 rows → 報表未上料 → 下一候選日(probe 結果不落 cache)。
   f. fan-out 其餘 analyzed−1 檔:**`asyncio.TaskGroup`**(R6:首錯自動取消 siblings,不白燒配額);TokenBucket 已限流。任一失敗 → 整包 raise(ExceptionGroup 內第一個 httpx error re-raise),result cache 不落檔。
   g. 聚合(§2.2a)→ `atomic_write_json` per (stock_id, D) → 順手 `_cleanup_flow_caches()`(R5:刪 `flow_prices_*` 檔名日期 < today−7、`warrant_flow_*` < today−30;單次 iterdir,失敗 skip — 對齊 `_cleanup_stale_window_files` 慣例)→ 回 payload。
4. 候選日耗盡 → `HTTPException(404, {"error": "no_data"})`(前端專屬文案見 §3.2;R8:lookback 10 已涵蓋春節,404 = 真異常)。

整條 3 包進 `_run_once(f"flow_{stock_id}_{date or 'latest'}_{refresh}", ...)` inflight dedup(refcount + shield,cancel-chain)。

### 2.2 Payload 契約

**(a) 正常 payload**(spec §3 三層聚合;金額單位 = 元,float;前端格式化):

Row 級:`buy_value = price × buy`、`sell_value = price × sell`(同分點多價位多筆分開累加)。

```json
{ "as_of_date": "2026-07-13",
  "no_trading_day": true,          // 僅顯式 date 且 as_of != date 時出現(§2.4)
  "truncated": true, "total_traded": 477, "analyzed": 200, "unmapped_count": 118,
  "empty_reason": null,
  "summary": { "call": {"buy_value": 0.0, "sell_value": 0.0},
               "put":  {"buy_value": 0.0, "sell_value": 0.0} },
  "top_buy_branches":  [ { "broker_id": "9268", "broker_name": "凱基-台北",
      "buy_value": 0.0, "sell_value": 0.0, "net_value": 0.0,
      "warrants": [ {"warrant_id":"066211","name":"台積電群益5C購01","kind":"call",
                     "buy_value":0.0,"sell_value":0.0,"net_value":0.0} ] } ],
  "top_sell_branches": [ "…同 shape,net_value < 0,依 net 升序 15 檔" ],
  "warrants": [ {"warrant_id":"066211","name":"…","kind":"call",
                 "trading_money": 0.0, "net_value": 0.0} ] }
```
- `top_buy_branches`:`net_value > 0` 依降序取 15;`top_sell_branches`:`net_value < 0` 依升序取 15。分點內 `warrants` 依 `abs(net_value)` 降序 — 展開明細零 API。
- `warrants`(明細表):cap 後全列,`trading_money`(來自 dump)降序;`net_value` = 該權證全分點 buy−sell。
- name/kind 取自快照 rows(§warrants.py `by_underlying` 內已有 `name`/`kind`)。

**(b) 空 payload(R1)** — 鍵**恆齊全**,TS type 無 optional 歧義:

| 欄 | `no_warrants` | `no_volume` |
|---|---|---|
| `as_of_date` | **null**(未進候選日迴圈,無資料日;UI 不 render badge) | `"D"`(交易日確定) |
| `no_trading_day`(R17) | **恆缺席**(未進候選日迴圈,無比較基準) | 沿 §2.4 規則:顯式 date 且 D != date → true,否則缺席;TS type `no_trading_day?: boolean` |
| `empty_reason` | `"no_warrants"` | `"no_volume"` |
| `truncated` | false | false |
| `total_traded` / `analyzed` / `unmapped_count` | 0 / 0 / 0 | 0 / 0 / 實際值 |
| `summary` | 四值全 0 | 同左 |
| `top_buy_branches` / `top_sell_branches` / `warrants` | `[]` | `[]` |

no_warrants 空 payload 不落 result cache(快照當日重建後可能出新權證;成本零 fetch)。no_volume 落 cache(D 已定,終態)。`[SC-2][SC-3][SC-4][SC-6][SC-7]`

### 2.3 FinMind / FAKE 接點

- `services/finmind.py` 加:
  ```python
  async def stock_price_universe_day(self, date: str) -> list:
      """TaiwanStockPrice date-only 全市場單日(warrant_flow day dump)。"""
      return await self._get(f"{_FINMIND_BASE}/data",
                             {"dataset": "TaiwanStockPrice", "start_date": date, "end_date": date})
  ```
  (dataset 名已在 `_get` shapes,MANIFEST gate 不撞。)
- `warrant_flow.get_finmind()` per-module wrap(finmind-conventions)。
- **FAKE 層**:`FAKE_FINMIND=1` 時 `_fetch_price_day` **service 直讀** `tests_e2e/fixtures/warrants/price_day.json`(沿 `warrants.py::_read_fixture` pattern + `FAKE_FINMIND_FIXTURES_DIR` override),**並以請求的 D 過濾 `row["date"] == D`**(R4:模擬 date-only 查詢語意,對齊 finmind_fake `_get` 的 in-memory date filter;D 不符 → 空 → 候選日迴圈自然回退,不寫錯日 cache)。
  **偏離「FinMind 資料走 MANIFEST」慣例,顯式理由**:universe fixture 進 `_store[(TaiwanStockPrice, "")]` 會被 market_breadth 的 FAKE per-day loop 吃到,汙染 market mode e2e 基準;`fixtures/warrants/` 子目錄直讀(MANIFEST flat 掃描天然隔離,e2e-conventions 已沉澱)完全隔離。原始 shape 解析面由 pytest 縮樣 fixture 補(distilled 層變體條款)。
- fan-out 分點報表 fixture:沿既有 MANIFEST 路徑(per warrant_id 條目;030012 已存在)。**Fixture 存活約束(R2 + R18)**:`price_day.json` 中 Trading_money 最大的 mapped 權證**必須**有對應報表 fixture(probe 單點存活條件);其餘有量 mapped 權證要嘛各配 fixture、要嘛 Trading_money=0;**報表 fixture rows 的 `date` 必須等於 price_day.json 的日期(FAKE_TODAY−1 = 2026-06-25)**(R18:報表只帶 start_date → finmind_fake 整包回傳,靠 caller date 過濾;日期錯與檔案缺表現同為 probe 0 rows,難 debug)— `_note` 互引時同時寫明日期,pytest 加 fixture 一致性 assert(price_day 日期 == 各報表 fixture rows 日期)。

### 2.4 Route(`routes/warrants.py` 加一 endpoint)

```python
@router.get("/api/warrants/{stock_id}/flow")
async def get_warrant_flow(request, stock_id, date: str | None = None, refresh: bool = False):
    _validate_id(stock_id)
    if date is not None: _validate_date(date)   # YYYY-MM-DD regex → 400 bad_date
    return await run_with_disconnect(request, warrant_flow.get_flow(stock_id, date, refresh))
```
- FinMind httpx 錯誤不 catch → 中央 handler 502 `finmind_error`;快照錯誤 service 內轉 `warrant_upstream`(§2.1-1)。
- `no_trading_day`:**只在 `date` 給定且 `as_of_date != date` 時設 true**。`[auto-default: flag 僅限顯式 date | reason: T+1 lag 下對 today 比較恆真,flag 失去資訊量;UI 以資料日 badge 明示(SC-2)]`

### 2.5 Backend 測試(`tests/test_warrant_flow.py` + `tests_e2e/test_api_warrants.py` 增列)

單元(conftest 基建;`monkeypatch.setattr(warrant_flow, "get_finmind", ...)` + snapshot monkeypatch):
1. 聚合數值鎖:手造 6 權證 × 3 分點 rows(含同分點多價位、單向 buy=0/sell=0)→ summary 四數字、branch net、top15 排序、warrant 明細降序、分點內 warrants 依 abs(net) 降序。
2. cap:201 檔有量 → analyzed=200、truncated=true;≤200 → false;truncated 時 `analyzed` 欄 = FLOW_CAP。
3. 交集 + unmapped:快照外權證形狀 id → 不入統計、unmapped_count 正確;4 碼普通股不計;**prefix 邊界**:71 開頭 6 碼不計、含字尾字母 6 碼(03xxxB)計入(R10)。
4. 候選日回退:D dump 空 → D-1;D probe 0 rows → D-1;皆有 → 用 D。
5. 空狀態:無掛牌 → no_warrants 空 payload(as_of_date null、鍵齊全、不落 cache);有掛牌零成交 → no_volume(as_of_date=D、落 cache、不回退)。
6. cache:同 (stock,date) 二次呼叫零 fetch;refresh=true 重抓**且 day-dump 也重抓**(R12);`_CACHE_VERSION` 不符視同 miss;**併發 case(R14)**:refresh 與非 refresh 同時打,assert refresh 路徑真重抓(dedup key 隔離)。
7. 空 dump 快取條款(R15):D ≥ today−1 空不落檔;D < today−1 空落檔。
8. fan-out 失敗:第 k 檔 raise httpx → 整包 raise、result cache 不落檔、**其餘 in-flight 被取消**(TaskGroup;以 fetch call count / cancel 旗標 assert)。
9. `no_trading_day`:date 給定回退 → true;預設查詢 → 無 flag。
10. probe 節省:報表未上料日 fan-out 零呼叫(fetch call count == 每候選日 1)。
11. retention:寫入後舊檔(dump >7d / result >30d)被清,新檔保留。

Contract(tests_e2e):`/flow` 200 shape 鍵齊全 + `bad_symbol` / `bad_date` 400。`[SC-6][SC-7][SC-8]`

## 3. Frontend

### 3.1 檔案

| 檔 | 動作 | 內容 |
|---|---|---|
| `lib/warrant-flow-data.ts` | 新增 | Payload TS types(空欄恆齊全,`as_of_date: string \| null`)+ 純函式:`barRatio(value, max)`、`formatValue(元→億/萬 字串)` |
| `lib/api.ts` | 增列 | `warrantFlow(stockId, refresh?, options?)` → `GET /api/warrants/{id}/flow` |
| `hooks/useWarrantFlow.ts` | 新增 | `useWarrantFlow(stockId, active)` → `{data, loading, error, refresh, noTradingDay}`;`enabled: active && !!stockId`;`forceRefreshRef` pattern(useWarrantBrokers 樣板);queryKey `["warrant-flow", stockId]`。**noTradingDay 註記(R13)**:僅 hook shape 慣例對齊(CLAUDE.md §4),前端不帶 date 參數 → 恆 false、UI 無消費者;資料日提示走 badge |
| `components/WarrantFlowPanel.tsx` | 新增 | 全 UI(§3.2) |
| `App.tsx` | 修改 | `Tab` type 加 `"warrant-flow"`;tab 鈕「權證分點」(權證右側);`hidden` div + `React.lazy` + Suspense(「載入權證分點元件...」) |
| `lib/changelog.ts` | 增列 | VersionEntry MINOR bump(R11;寫 entry 前讀 changelog-conventions,Phase 8 前完成) |

### 3.2 WarrantFlowPanel 結構 `[SC-1..SC-7]`

```
<div data-testid="warrant-flow-panel">
  loading 且無 data → 進度文案「彙整分點資料中,首次載入約需數秒…」(SC-1)
  error 含 no_data → 「近 10 個交易日無分點資料」(R8);其他 error → hook error 訊息
  empty_reason=no_warrants → 「此標的目前無掛牌權證」(SC-7A;不 render badge — as_of_date null)
  empty_reason=no_volume  → 「資料日 MM-DD 全部權證零成交」(SC-7B;badge 照 render)
  ├─ header:資料日 badge「資料日 MM-DD」(data-testid="flow-date-badge";as_of_date null 時省略)
  │         + truncated 註記「僅統計成交金額前 {analyzed} 檔權證」(R9:插值,零雙源;SC-6)
  ├─ summary 條(SC-2):認購 買/賣、認售 買/賣 四格;認購/認售 badge 中性 token
  │   (border-line + text-ink-muted,不用紅綠 — SC-5)
  ├─ 兩欄(SC-3,useContainerSize < 640px 疊直):
  │   買超 15 大(data-testid="flow-buy-col"):row = 分點名 + bar + 金額,text-bull(紅)
  │     row 可點展開該分點權證明細(warrant_id/name/買賣金額);展開零 API
  │   賣超 15 大(data-testid="flow-sell-col"):text-bear(綠)
  └─ 權證明細表(SC-4):代號/名稱/類型/成交金額/淨買賣超,金額降序
      淨值色:>0 text-bull、<0 text-bear(data-testid="flow-warrant-net")
</div>
```
- 展開 state:`useState<string | null>(expandedBrokerId)`。
- semantic tokens、`cn()`、繁中(含 aria-label)。bull/bear token 名以 `index.css` `@theme` 現名為準(Phase 3 對齊)。
- Phase 3 UI 開工前呼叫 `frontend-design` + `bencium-controlled-ux-designer`(memory 指示)。

### 3.3 前端測試

- `lib/warrant-flow-data.test.ts`:barRatio 邊界(max=0)、formatValue(億/萬/0)。
- `hooks/useWarrantFlow.test.ts`:active=false 不 fetch;active 轉 true 才 fetch;refresh 帶 force;error 終態(frontend-testing 慣例)。
- `components/WarrantFlowPanel.test.tsx`(jsdom pragma + afterEach(cleanup)):SC-1 進度文案、SC-2 四數字與 badge、SC-3 top15 + 展開、SC-4 排序欄位、SC-5 色彩 binding 正向 assert + `queryByText(/做多|做空|賣選|滿倉/)` null、SC-6 truncated 插值註記、SC-7 兩文案(no_warrants 無 badge / no_volume 有 badge)、no_data error 文案(R8)。

## 4. e2e(brainstorm §5 定案)

- `equity.spec.ts` 新 describe「權證分點 tab」:切 tab → badge 資料日 + 買賣超欄出現(資料級 assertion:分點名 + 非零金額,非 visibility-only)+ 點分點展開明細。
- `no-trading-day.spec.ts` NTD#:凍鐘週末 → flow badge 顯示回退資料日(驗證口徑 = badge 日期字串,非 no_trading_day flag — R13)。
- fixtures:`fixtures/warrants/price_day.json`(日期 = FAKE_TODAY−1 = 2026-06-25;6 權證 rows + 1 檔 4 碼普通股 row + 1 檔 unmapped 形狀 id;**R2 存活約束:Trading_money 最大的 mapped 權證必有報表 fixture,其餘 mapped 有量權證各配 fixture 或設 Trading_money=0,`_note` 互相引用**)+ MANIFEST 條目 `TaiwanStockWarrantTradingDailyReport_<wid>.json`(與 fetch method 同 commit — gate 順序耦合)+ **改 fixture 後清 `e2e/.cache`**。

## 5. 驗證產出(SC-9,R11)

- 自動化:pytest / ruff / vitest / build / e2e(auto-verify)。
- 截圖:`docs/specs/warrant-broker-flow/screenshots/` — 寬版(兩欄並排 + summary + 明細表)、窄版(疊直)、展開明細態;chrome-devtools MCP 實拍(Phase 6)。

## 6. 邊界與風險

| 風險 | 處置 |
|---|---|
| prd Vercel 30s:冷 fan-out ≤200 req ≈ 5-8s(40/s bucket) | 遠低於 30s;Phase 6 real-env 量測寫證據;cap 上調需重評(cancel-chain 第五環) |
| 配額:冷查詢 ≤ 202 req = 3.4%/hr;refresh 重燒同量 | 切 tab 才載入 + per (stock,date) cache;可接受(spec 拍板) |
| FinMind 中途 402(配額乾)| TaskGroup 首錯取消 siblings → 整包 fail 502,不 cache 部分結果;重試從零(R3 決策已標) |
| 快照(TWSE/TPEx)故障 | service 內轉 502 warrant_upstream |
| 大 payload(200 權證 × 分點明細)| 粗估 <1MB,Gzip middleware 已掛;不分頁(YAGNI) |
| e2e fixture 汙染 market mode | price_day 走 warrants/ 子目錄直讀 + D 過濾,不進 MANIFEST _store(§2.3) |
| cache 增長 | `_cleanup_flow_caches`:dump 7 天 / result 30 天(§2.1-3g) |

## Known Risks

- FinMind TaiwanStockPrice 的 EOD 上料截止時點未實測(spike L-1 只驗分點報表 lag);R15 的 today−1 緩衝日 + refresh 自癒為緩解,極端 ingestion 延遲(>1 日)下仍可能把交易日空 dump 落 cache(7 天 retention 內自然過期)。
- 「當晚 T+0 報表是否上料」未直測(spike 跑在上午);自適應候選日設計使其不影響正確性,只影響資料新鮮度下限。
- **對映用當下快照查歷史候選日**(Phase 4 code-review):權證在 (d, 快照 as_of] 間到期 → 該權證成交入 unmapped_count 而非統計。預設查詢(d ≈ as_of)零影響;顯式舊 date / 深度回退才失真。修法 = 快照歷史化,v1 out of scope(next-time 已記)。
