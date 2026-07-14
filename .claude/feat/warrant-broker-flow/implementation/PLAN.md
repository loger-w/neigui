# Implementation Plan — warrant-broker-flow(condensed)

> 依 design.md v3。每檔一節:動什麼 / signature / 失敗測試對應 SC-N。
> TDD 順序:backend(§B1→B5)→ frontend(§F1→F6)→ e2e(§E1→E3)。
> Phase 3 對齊規則:粒度不足就地補 `[phase-3 補註]`,介面級衝突走失敗回退表。

## Global constraints

- Python:`from __future__ import annotations` 首行、全 type hints、`logging`、error contract `{detail:{error}}`、`clock.today()`(禁 `date.today()`)、ruff line-length 100。
- TS:semantic tokens、繁中 UI、`cn()`、TanStack useQuery signal 直傳、hook 回傳 shape `{data, loading, error, refresh, ...}`。
- 色彩:淨買超 bull 紅 / 淨賣超 bear 綠;認購認售 badge 中性。
- Commit tag:`[red]`/`[green]`/`[refactor]`,🟢 前綴(純新功能)。

---

## B1. `backend/services/finmind.py`(修改,+8 行)

- `stock_price_range` 旁加:
  ```python
  async def stock_price_universe_day(self, date: str) -> list:
      """TaiwanStockPrice date-only 全市場單日 — warrant_flow day dump(design v3 §2.3)。"""
      return await self._get(f"{_FINMIND_BASE}/data",
          {"dataset": "TaiwanStockPrice", "start_date": date, "end_date": date})
  ```
- 失敗測試(impl-R2:B4 stub 整個 client、FAKE 又繞過 client,此方法零覆蓋 → 必須直測):`tests/test_warrant_flow.py` 加 `test_stock_price_universe_day_request_shape` — monkeypatch `FinMindClient._get` 捕 `(url, params)`,assert `dataset=="TaiwanStockPrice"`、`start_date==end_date==date`、params 無 `data_id` 鍵。

## B2. `backend/services/warrant_flow.py`(新增,核心 ~300 行)

- 常數:`_CACHE_VERSION=1`、`FLOW_CAP=200`、`FLOW_LOOKBACK_DAYS=10`、`_PRICE_DAY_KEEP_KEYS=("stock_id","Trading_money")`、`_DUMP_RETAIN_DAYS=7`、`_RESULT_RETAIN_DAYS=30`、`_WARRANT_PREFIXES=("03",...,"09","72","73","74")`。
- `def get_finmind()` per-module wrap(warrant_brokers 樣板)。
- `async def _run_once(key: str, coro_fn)` — module-level `_inflight` refcount + shield(warrants.py 同構)。
- `def _candidate_dates(date: str | None) -> list[str]` — 起點 `date or clock.today().isoformat()`,往前非週末日取 `FLOW_LOOKBACK_DAYS` 個(**含起點**;對照 warrant_brokers 從 today−1 起,flow 自適應含 T+0 — design spike L-1)。
- `async def _fetch_price_day(d: str, refresh: bool) -> list[dict]`:
  - FAKE 分支(`FAKE_FINMIND=="1"`):讀 `fixtures/warrants/price_day.json`(`FAKE_FINMIND_FIXTURES_DIR` override,warrants.py `_read_fixture` 同構),**filter `row["date"] == d`**,不落 cache。
  - 真實:inner `_run_once(f"flow_prices_{d}_r{int(refresh)}")`;非 refresh 先讀 `flow_prices_{d}.json`;fetch → 裁 `_PRICE_DAY_KEEP_KEYS` → 空 rows 且 `d >= (clock.today()-timedelta(days=1)).isoformat()` 不落檔,否則落檔。
- `async def _fetch_report(wid: str, d: str) -> list[dict]` — `fetch_warrant_trading_daily_report(wid, d)` 後 filter `row["date"] == d`。
- `def _aggregate(reports: dict[str, list[dict]], winfo: dict[str, dict], money: dict[str, float]) -> dict` — **純函式**(單測主體):row 級 `price×buy`/`price×sell`(缺 price/壞 row → `logger.warning` skip);回 `{summary, top_buy_branches, top_sell_branches, warrants}`(shape = design §2.2a;top_buy = net>0 降序 15、top_sell = net<0 升序 15、branch 內 warrants 依 abs(net) 降序、warrants 表依 trading_money 降序)。
- `def _empty_payload(reason: str, as_of: str | None, unmapped: int) -> dict` — design §2.2b 鍵恆齊全。**`no_trading_day` flag 不在此函式內**(impl-R5):由 `get_flow` 回傳前對「正常 + no_volume」payload 統一貼(同一段邏輯:顯式 date 且 as_of != date → `payload["no_trading_day"] = True`;no_warrants 未進候選日迴圈,恆缺席)。
- `def _cleanup_flow_caches(today: date) -> int` — iterdir 刪 `flow_prices_*` < today−7、`warrant_flow_*` < today−30(檔名尾段日期 parse;失敗 skip)。
- `async def get_flow(stock_id: str, date: str | None = None, refresh: bool = False) -> dict` — design §2.1 資料流 1-4 全序;外層 `_run_once(f"flow_{stock_id}_{date or 'latest'}_{refresh}")`;快照 httpx/HTTPException(404) → 502 `warrant_upstream`;fan-out 用 `asyncio.TaskGroup`,except* httpx re-raise 第一個;`no_trading_day` 僅顯式 date 且 as_of != date。
- 失敗測試(`tests/test_warrant_flow.py`)→ design §2.5 測項 1-11:SC-6(cap/truncated/analyzed)、SC-7(兩空態)、SC-8(回退/cache/refresh/no_trading_day)+ 聚合鎖 + unmapped prefix 邊界 + TaskGroup 取消 + retention + R14 併發。

## B3. `backend/routes/warrants.py`(修改,+15 行)

- `_VALID_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")`;`def _validate_date(v) -> None` → regex **+ `date.fromisoformat(v)` try/except ValueError**(R2-2:`2026-13-99` 形狀合法但日曆非法,不擋會在 `_candidate_dates` 炸 500)→ 皆 400 `{"error": "bad_date"}`。
- endpoint(design §2.4 原文);import `warrant_flow`。
- 失敗測試:B5 contract。

## B4. `backend/tests/test_warrant_flow.py`(新增,~400 行)

- conftest 基建(autouse singleton reset);`monkeypatch.setattr(warrant_flow, "get_finmind", lambda: fake)` + `monkeypatch.setattr(warrant_flow.warrants, "get_snapshot", ...)`;`CHIP_DATA_DIR` 由 conftest 隔離。
- Fake FinMind stub:記 call log 的物件(`stock_price_universe_day` / `fetch_warrant_trading_daily_report` 可逐日/逐檔設回傳或 raise)。
- 測項 = design §2.5 1-11,外加:
  - 測項 12(impl-R3,鎖 design R16):`warrants.get_snapshot` raise `httpx.ConnectError` 與 `HTTPException(404, {"error":"no_data"})` 兩 case → 皆轉 `HTTPException(502, {"error":"warrant_upstream"})`;FinMind fan-out 層 httpx 錯誤放行不轉包(中央 handler 職責)。
  - 測項 9 加 sub-case(impl-R5):no_volume 空態 + 顯式 date 回退 → `no_trading_day: true`。
  - fixture 一致性 assert(R18 + impl-R4):讀 tests_e2e fixtures 驗 (a) price_day 日期 == 各報表 fixture rows 日期;(b) 跨 fixture 聚合後「凱基-台北」net > 0(E1 斷言的存活條件 — 030012 既有 rows 凱基淨買 800,方向須保持一致);跳過缺檔。
- 對應:SC-6/SC-7/SC-8 全在此鎖。

## B5. `backend/tests_e2e/test_api_warrants.py`(修改,+3 測試)

- `test_flow_shape`:`GET /api/warrants/2330/flow` 200 → 頂層鍵齊全(as_of_date/truncated/total_traded/analyzed/unmapped_count/empty_reason/summary/top_buy_branches/top_sell_branches/warrants)+ summary call/put 四值 + branch row 鍵。
- `test_flow_bad_symbol`:`/api/warrants/../flow` 形狀非法 → 400 `bad_symbol`;`test_flow_bad_date`:`?date=2026/06/25` **與 `?date=2026-13-99`(日曆非法,R2-2)** → 400 `bad_date`。
- FAKE fixtures(同 commit,B6):跑在 FAKE_FINMIND=1 conftest 下。

## B6. e2e fixtures(新增/修改)

- `tests_e2e/fixtures/warrants/price_day.json`(新):rows 皆 `date=2026-06-25`;`030011`(Trading_money=5_000_000,**top-1,probe 存活**)、`030012`(3_000_000)、`03001P`(1_200_000)、`030013/030014/030015`(=0,不配報表 fixture)、`2330`(普通股 4 碼,80_000_000,不計)、`03998B`(unmapped 牛熊形狀,600_000)→ 期望 unmapped_count=1、analyzed=3。`_note` 註明 R2/R18 約束與報表 fixture 清單。
- `TaiwanStockWarrantTradingDailyReport_030011.json`(新)+ `_03001P.json`(新):rows date=2026-06-25,含 `price` 欄;030011 3 分點(9200 凱基-台北 / 9800 元大-總公司 / 9600 富邦-建國)數字設計成:9200 淨買、9800 淨賣、9600 近平;03001P 2 分點(put summary 驗證用)。**跨 fixture 方向一致約束(impl-R4)**:同 broker 在所有 fixture 的淨向不得翻轉(凱基恆淨買、元大恆淨賣),`_note` 寫明,B4 fixture assert 鎖聚合後凱基 net > 0。
- `TaiwanStockWarrantTradingDailyReport_030012.json`(修改):rows **補 `price` 欄**(additive;warrant_brokers 不讀 price,warrant-selector E# 不受影響)。
- `MANIFEST.json`:加 030011 / 03001P 兩條目(`_note` 註 flow + 日期)。

## F1. `frontend/src/lib/warrant-flow-data.ts`(新增,~60 行)

- Types(design §2.2 對應;`as_of_date: string | null`、`no_trading_day?: boolean`、`empty_reason: "no_warrants" | "no_volume" | null`、`kind: "call" | "put"`):`WarrantFlowSummary` / `WarrantFlowBranchWarrant` / `WarrantFlowBranch` / `WarrantFlowWarrantRow` / `WarrantFlowPayload`。
- `export function barRatio(value: number, max: number): number` — `max <= 0 → 0`,否則 `min(1, abs(value)/max)`。
- `export function formatValue(v: number): string` — `fmtAmount(Math.abs(v))` 薄 wrap(impl-R1:fmtAmount 對負值會掉進「元」分支輸出 `-5,000,000 元`;賣超欄/淨賣值一律以 abs 呈量、方向由色彩與欄位語意表達 — design §3.1 formatValue 保留,內裡 DRY 委派 fmtAmount)。
- 失敗測試(`warrant-flow-data.test.ts`):barRatio(0 max、負值、clamp)+ formatValue(億/萬/0/**負值 → abs 縮寫**)。

## F2. `frontend/src/lib/api.ts`(修改,+8 行)

- `warrantFlow(stockId: string, refresh?: boolean, options?: RequestOptions): Promise<WarrantFlowPayload>` → `get(`${BASE}/warrants/${stockId}/flow`, params, options)`(warrantBrokers 同構)。

## F3. `frontend/src/hooks/useWarrantFlow.ts`(新增,~40 行)+ test

- ```ts
  export function useWarrantFlow(stockId: string, active: boolean): {
    data: WarrantFlowPayload | null; loading: boolean; error: string | null;
    refresh: () => void; noTradingDay: boolean; }
  ```
- `useQuery({ queryKey: ["warrant-flow", stockId], enabled: active && !!stockId, queryFn: ({signal}) => api.warrantFlow(stockId, force, {signal}) })` + `forceRefreshRef`(useWarrantBrokers 樣板)。`noTradingDay = data?.no_trading_day ?? false`(R13 註記:UI 無消費者,shape 慣例)。
- 失敗測試(SC-1):active=false 不呼叫 api(vi.spyOn);轉 true 呼叫;refresh 帶 force=true;error 終態 message。

## F4. `frontend/src/components/WarrantFlowPanel.tsx`(新增,~250 行)+ test

- `export function WarrantFlowPanel({ symbol, active }: { symbol: string; active: boolean })`(WarrantSelector 同構;內部掛 useWarrantFlow);default export 供 `React.lazy`。
- 結構 = design §3.2(進度文案 / no_data 文案 / 兩空態 / badge / truncated 插值 / summary 四格 / 兩欄 top15 bar + 展開 / 明細表);`useContainerSize` < 640 疊直;`useState<string|null>` 展開;data-testid:`warrant-flow-panel` / `flow-date-badge` / `flow-buy-col` / `flow-sell-col` / `flow-warrant-net`。
- **UI 動工前呼叫 frontend-design + bencium-controlled-ux-designer**(memory 指示;Phase 3 第一個 F4 紅測試前)。
- 失敗測試(SC-1..SC-7):§3.3 清單(jsdom pragma、afterEach(cleanup)、色彩正向 assert + 方向性文案 null assert)。

## F5. `frontend/src/App.tsx`(修改,~20 行)

- `type Tab = "overview" | "bubble" | "warrants" | "warrant-flow"`;tab 鈕「權證分點」(權證右);`const WarrantFlowPanel = lazy(...)`;`<div hidden={tab !== "warrant-flow"}>` + Suspense fallback「載入權證分點元件...」;`<WarrantFlowPanel symbol={symbol} active={tab === "warrant-flow"} />`。
- 失敗測試:App 既有 tab 測試模式擴充(切 tab render panel testid;lazy → `findByTestId`)。

## F6. `frontend/src/lib/changelog.ts`(修改,Phase 8 前)

- VersionEntry MINOR bump(0.x.0);寫前讀 `changelog-conventions` skill。

## E1. `e2e/specs/equity.spec.ts`(修改,新 describe「權證分點 tab」)

- E#:搜 2330 → 切「權證分點」→ `flow-date-badge` 含「06-25」+ `flow-buy-col` 內分點名「凱基-台北」與非零金額(資料級)→ 點該 row 展開 → 明細含 030011。痛點註解連 SC-1/SC-3。
- 前置:清 `e2e/.cache`(fixture 改動)。

## E2. `e2e/specs/no-trading-day.spec.ts`(修改,+1 test)

- NTD#(R2-1 改 API 級,UI 級與 E1 重複零資訊量):playwright `request` context 直打 `/api/warrants/2330/flow?date=2026-06-27`(週六)→ assert `no_trading_day === true` 且 `as_of_date === "2026-06-25"`(SC-8 顯式 date 分支;UI badge 口徑由 E1 覆蓋)。

## E3. `backend/tests_e2e/test_api_warrants.py` — 已列 B5(contract 與 e2e fixture 同 commit)。

---

## 對應矩陣(SC → 檔)

| SC | 檔 |
|---|---|
| SC-1 | F3/F4/F5 + E1 |
| SC-2 | F4 + B2(summary)|
| SC-3 | F4(兩欄+展開+疊直)+ E1 |
| SC-4 | F4 + B2(warrants 排序)|
| SC-5 | F4 test(色彩 binding + 文案 null)|
| SC-6 | B2(cap)+ F4(插值註記)|
| SC-7 | B2(_empty_payload)+ F4(兩文案)|
| SC-8 | B2(回退/cache/refresh/flag)+ B5 |
| SC-9 | Phase 5/6(auto-verify + 截圖)|
