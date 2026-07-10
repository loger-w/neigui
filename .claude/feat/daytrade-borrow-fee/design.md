# Design — 券差查詢(daytrade-borrow-fee) v3

> Changelog:
> - v3(2026-07-11)round-2 修正:R2-1 partial 改 per-day 覆蓋檢查、R2-2 route 包 run_with_disconnect、R2-3 gather 語意單一化
> - v2(2026-07-11)round-1 review 修正:P0-1 tpex 過去月 cache 保護、P0-2 inflight dedup 改 shield+refcount 同構、P1-1 route catch httpx.HTTPError 基類、P2-2 no_trading_day 無條件、P2-3 client shutdown、P2-4 backoff resolution、P2-5 App.test 變更面、P2-6 cache 日粒度取捨
> - v1(2026-07-11 初版)

**Goal**:最上層 mode 新 tab「券差」,顯示最近可得交易日的上市 + 上櫃「應付現股當日沖銷券差借券費率」合併表,支援排序與高費率標色。
**Tech**:FastAPI service(httpx 直抓 TWSE RWD + TPEx OpenAPI,非 FinMind)+ React lazy page + TanStack Query。

## Global constraints

- 每個 `.py` 首行 `from __future__ import annotations`;type hints 無例外;logging 不 print。
- Error contract `{"detail": {"error": "<code>"}}`;502 upstream / 404 no_data。
- 「今天」一律 `services.clock.today()`(clock 凍結 timebomb 鎖著)。
- UI 繁中、semantic tokens、`cn()`;bull/bear 紅綠保留多空語意 — 本頁標色用 accent。
- 費率高標門檻 `FEE_HIGHLIGHT_THRESHOLD = 3.5`(百分比,service+前端各一具名常數,測試鎖同值)。

## 1. Backend — `services/daytrade_fee.py`(新檔)

### 1.1 抓取層(對應 SC-2 / SC-6 / SC-7 / edge 1,2,6)

- Module singleton `httpx.AsyncClient(timeout=30.0, headers={"User-Agent": UA})`,`_get_client()` lazy 建。
- `async def _fetch_month_raw(market: str, yyyymm: str) -> Any`:
  - `twse`:`GET https://www.twse.com.tw/rwd/zh/dayTrading/BFIF8U?date={yyyymm}01&response=json`;`stat != "OK"` 或 `data` 空 → `[]`。
  - `tpex`:`GET https://www.tpex.org.tw/openapi/v1/tpex_intraday_fee`(無參數,只回當月;查詢月 ≠ 當月 → 直接回 `[]` 不打)。
  - **FAKE 分支**:`FAKE_FINMIND == "1"` 時改讀 fixture(§5),不碰網路。
- `async def fetch_month(market, yyyymm, refresh) -> list[dict]`(normalize 後 rows):
  - Cache 檔:`chip_cache_dir() / f"borrow_fee_{market}_{yyyymm}.json"`,payload `{"_cache_version": 1, "fetched_on": "<clock.today()>", "rows": [...]}`。
  - 讀 cache 條件:版本符 + (`yyyymm` 為過去月 **或** `fetched_on == clock.today()`)— 當月資料每日長大,跨日即 stale;過去月不朽。`refresh=True` 跳過(下有兩道例外保護)。
  - **[P0-1] TPEx 過去月 cache 保護(兩道)**:(a) `market == "tpex"` 且 `yyyymm != 當月` → **無視 refresh 一律回 cache**(OpenAPI 無歷史,upstream 不可重抓,refresh 語意不適用);(b) 通用寫入守則:`_fetch_month_raw` 回空且既有 cache rows 非空 → **不覆寫**,回既有 cache(防上游暫時故障吃掉累積資料)。測試鎖:`tpex 過去月 + refresh=True 不得覆寫既有 cache`。
  - **[P0-2] Inflight dedup = `finmind.py::_run_once` 同構 local 實作**(shield + refcount,caller cancel 不殺共享 task;不 import finmind 私有函式,同構複製並註明樣板出處),key `f"{market}_{yyyymm}"`。測試鎖:兩 caller await 同 key、cancel 其一,另一 caller 正常取得結果。
  - **[P2-6] 當月 cache 日粒度取捨(顯式)**:盤後公告當日,早上抓過 cache 的 user 需手動 refresh 才看得到(refresh 按鈕為救濟);不套 finmind 分鐘級 staleness — 本源每日只更新一次,日粒度 + 手動救濟足夠。入 Known Risks。
  - **[P2-4] 不做自動 backoff/retry**:`[auto-default: 失敗直回 502、user refresh 救濟 | reason: 每日一發極低頻,spec §7「UA + backoff」的風險場景(限流)實際打不到;省 retry 複雜度]`— 此為 spec §7 TWSE 限流列的 resolution。
- TLS:TPEx 若 py3.12 也炸 SKI(spec spike)→ `truststore.SSLContext` 注入 client;**禁 verify=False**。

### 1.2 Normalize(對應 SC-7,純函式可單測)

- `def normalize_twse_row(row: list[str]) -> dict`:`["115/07/01", "0050      ", "元大台灣50      ", "25,000", "3.500%"]` → `{"date": "2026-07-01", "market": "twse", "stock_id": "0050", "name": "元大台灣50", "lending_shares": 25000, "fee_rate": 3.5}`。民國 `115/07/01` → `+1911`;strip;千分位;`%` 去尾。
- `def normalize_tpex_row(row: dict) -> dict`:`Date "1150701"`(民國無斜線,前 3 碼年)→ iso;**key `" LendingVolume"` 帶 leading space 原樣取**;`LendingFee "1.000"` → 3.5 同單位(已是 %,直接 float)。
- 壞 row(欄位缺 / parse 失敗)→ skip + `logger.warning`(單筆髒不炸整表)。

### 1.3 日彙整 `async def get_day(date_str: str | None, refresh: bool) -> dict`(對應 SC-2/4;edge 2,5)

1. `target = date_str or clock.today().isoformat()`;`month = target[:7]`。
2. 抓 target 月兩市場 rows:**裸 `asyncio.gather`(無 return_exceptions)[R2-3]** — 任一市場例外直接上拋至 route 邊界 502(資料完整性 > 部分呈現;TPEx「非當月直接空」不算炸);sibling fetch 允許在背景跑完(結果只寫 cache,無副作用),不需手動 cancel。
3. `as_of = max(該月兩市場 rows 中 date ≤ target)`;無 → 前月遞迴**一次**(同抓法);再無 → `HTTPException(404, {"error": "no_data"})`。
4. **[P2-2]** `no_trading_day = as_of != target`,**無條件**(target 已含 `date_str or today` fallback;對齊 CLAUDE.md §4 `as_of_date !== requested_date` 契約,v2 date picker 直接可用)。pytest 補「date 給定 + 回退 → flag true」case。
5. `partial` **[R2-1] per-day 覆蓋檢查**:`as_of` 月 ≠ 當月(`clock.today()` 之月)且 tpex rows 中**不存在 `date == as_of`** → `["tpex"]` — 同時涵蓋「全空」與「cache 凍結在月中、缺 as_of 日」兩態(P0-1 保護 (a) 使過去月 tpex cache 永久凍結,只查空會漏 stale 態)。測試鎖:tpex 過去月 cache 含月中資料但缺 as_of 日 → partial 帶 tpex。
6. `rows` = as_of 當日兩市場合併,**逐筆保留**(同股多筆不折疊 — FinMind 判死主因),預設排序 `(-fee_rate, -lending_shares, stock_id)`。
7. `month_counts` = as_of 月全 rows 按 `stock_id` 計 **distinct date 數**(同日多筆算 1;brainstorm edge 5)。
8. 回 `{"as_of_date", "no_trading_day"(true 才帶), "partial"(缺才帶), "rows", "month_counts"}`。

## 2. Backend — `routes/daytrade_fee.py`(新檔)+ `main.py` 註冊

```python
router = APIRouter()

@router.get("/api/daytrade-fee")
async def get_daytrade_fee(
    request: Request, date: str | None = None, refresh: bool = False,
) -> dict:
    try:
        # [R2-2] run_with_disconnect:對齊 chip/options/market 全部 upstream-IO route
        # 慣例;client 斷線即 cancel handler,P0-2 的 shield+refcount 才有 production
        # 觸發源(cancel-chain skill)。
        return await run_with_disconnect(request, svc.get_day(date, refresh))
    except httpx.HTTPError as exc:  # [P1-1] 基類全蓋(ReadError/RemoteProtocolError/... 不漏)
        logger.warning("borrow fee upstream error: %s", exc)
        raise HTTPException(status_code=502, detail={"error": "borrow_fee_upstream"}) from exc
```

- **必須在 route 層 catch `httpx.HTTPError` 基類** — main.py 中央 handler 會把漏網 httpx 例外標成 `finmind_error`(錯標籤);基類 catch 仍屬「具體 catch」(單一語意族),route 測試補 `httpx.ReadError` case。
- `date` 格式驗證:`date.fromisoformat` 失敗 → 400 `{"error": "bad_date"}`。
- main.py:`from routes.daytrade_fee import router as daytrade_fee_router` + `app.include_router(daytrade_fee_router)`;**[P2-3]** lifespan `finally` 段補 `await daytrade_fee_svc.aclose()`(service 提供 `aclose()` 關 module client,對齊 finmind `_client.close()` 慣例)。

## 3. Frontend

### 3.1 Mode 接線(SC-1;market-pipeline「4-way ternary」規則)

- `ModeSwitch.tsx`:`type Mode = "equity" | "options" | "market" | "borrow"`;`MODES` 加 `{ key: "borrow", label: "券差" }`(role=tablist / aria-current 既有結構自動涵蓋)。
- `App.tsx`:三元鏈改 4-way — `mode === "market" ? <MarketPage/> : <BorrowFeePage/>`(**不用 hidden**,mode 層級 ternary 慣例);`BorrowFeePage` `React.lazy()` + Suspense fallback「載入券差頁面...」。localStorage `"mode"` 既有讀寫直接相容 `"borrow"`。
- **[P2-5] 已知行為變更**:三元鏈 else 分支 = fallback 終點,4-way 後 localStorage 垃圾 mode 值的 fallback 從 MarketPage 變 BorrowFeePage;`App.test.tsx` 的 invalid-mode 測試註解需同步(assertion 本身仍綠)。

### 3.2 型別 + API client

- `lib/borrow-fee.ts`(新):
  ```ts
  export interface BorrowFeeRow { market: "twse" | "tpex"; stock_id: string; name: string;
    lending_shares: number; fee_rate: number; date: string }
  export interface BorrowFeeData { as_of_date: string; no_trading_day?: boolean;
    partial?: string[]; rows: BorrowFeeRow[]; month_counts: Record<string, number> }
  ```
- `lib/api.ts` 加:
  ```ts
  daytradeFee(refresh?: boolean, options?: RequestOptions): Promise<BorrowFeeData>
  // → get(`${BASE}/daytrade-fee`, refresh ? { refresh: "true" } : {}, options)
  ```
  (`date` 參數 backend 有、前端 v1 不傳 — brainstorm auto-default。)

### 3.3 Hook `hooks/useDaytradeFee.ts`(新)

`useChipBubble` 樣板:`useQuery({ queryKey: ["daytrade-fee"], queryFn: ({signal}) => api.daytradeFee(force, {signal}) })`,`forceRefreshRef` pattern;頁面只在 borrow mode mount(ternary)→ 不需 `enabled` gate。回傳 `{ data, loading, error, refresh, noTradingDay }`(`noTradingDay = data?.no_trading_day ?? false`)。

### 3.4 元件(SC-2/3/4/5;UI 依 frontend-design + bencium 紀律在既有 design system 內執行)

- `components/BorrowFeePage.tsx`(lazy 進入點):
  - Header 行:標題「券差查詢」+ 資料日 badge(`no_trading_day` 時沿用既有「無交易日」樣式字樣「非交易日,顯示 MM-DD」)+ `partial` 註記「上櫃資料缺(來源僅提供當月)」+ 重新整理按鈕(沿 App header 按鈕樣式,spinner + aria-busy)。
  - 說明副行(中性、無方向文案):「證交所/櫃買標借公告之借券費率,法定上限 7%」。
  - 空狀態:「本月無券差資料」/ error 顯示 `error.message`。
- `components/DaytradeFeeTable.tsx`:
  - 欄:市場(上市/上櫃 outline badge)、代號、名稱、借券股數、借券費率、本月次數;數字欄 `tabular-nums` 右對齊。
  - 排序 state `{key, dir}`,點標題循環 desc→asc;`aria-sort` 標注。預設 `fee_rate desc`。
  - `fee_rate >= FEE_HIGHLIGHT_THRESHOLD`(3.5,前端常數同名)→ row `data-testid="fee-high"` + `text-accent` 費率 cell。
  - month_counts 由 `month_counts[row.stock_id] ?? 1` 合成欄位。
- `lib/borrow-fee-utils.ts`(新,純函式單測):`sortRows(rows, key, dir, monthCounts)`(count 排序需 map)、`formatShares(n)`(千分位)、`formatFee(n)`(兩位小數 + %)。

## 4. 測試

- `backend/tests/test_daytrade_fee.py`:normalize 髒點各一(SC-7 全清單)、cache 讀寫/當月 stale/過去月不朽/refresh bust(monkeypatch `_fetch_month_raw` 計數)、**[P0-1] tpex 過去月 + refresh 不覆寫既有 cache、空回應不覆寫非空 cache**、**[P0-2] 並發 dedup:雙 caller 同 key cancel 其一另一正常**、get_day 回退三態(當月內 / 跨月一次 / 404)、no_trading_day(**含 date 給定 + 回退 → true**)/ partial / month_counts(同日多筆算 1)、排序鍵。fixture = probe 真實 payload 縮樣(inline dict)。
- `backend/tests/test_daytrade_fee_routes.py`:TestClient + monkeypatch service;shape、bad_date 400、upstream 炸 → 502 `borrow_fee_upstream`(**不是** finmind_error;**含 `httpx.ReadError` case 驗基類 catch**)。
- `backend/tests_e2e/test_api_daytrade_fee.py`:FAKE mode contract test(fixture 驅動,payload shape + `detail.error`)。
- Frontend vitest:`borrow-fee-utils.test.ts`(排序/格式化)、`useDaytradeFee.test.ts`(hook shape + error 終態,frontend-testing 慣例)、`DaytradeFeeTable.test.tsx`(渲染、排序點擊、標色 testid、`queryByText(/軋空|回補|做多|做空/) → null`)、`BorrowFeePage.test.tsx`(空狀態 / no_trading_day badge / partial 註記)、`ModeSwitch.test.tsx` 既有測試補第 4 顆(若有既有 assertion 鎖 3 顆需同步 — 行為合約變更,SC-1 已涵蓋)、**[P2-5] `App.test.tsx` 補 borrow mode mount + localStorage persistence case + invalid-mode 測試註解更新**。
- e2e(判準結論見 brainstorm):
  - `navigation.spec.ts` N#:mode 列 4 顆、切到「券差」`aria-current` + reload 持久化(既有 N# 若 assert 恰 3 顆需改 — 屬 SC-1 行為變更,非測試遷就)。
  - 新 `specs/borrow-fee.spec.ts` BF1:切券差 → 表格 row 數 > 0、費率降序(首列 ≥ 末列資料級 assertion)、`fee-high` testid 存在、資料日 badge 非空。
  - `[amendment 2026-07-11: SC-4 的 no-data 回退 e2e 改由 pytest + vitest 覆蓋 — 單一 webServer fixture 無法同時呈現有料/無料兩態;e2e 只鎖 happy path]`

## 5. E2E fake 層(非 FinMind 資料源的 fixture 機制,新課題)

- 依附既有旗標:`FAKE_FINMIND=1` 時 `_fetch_month_raw` 讀 `FAKE_FINMIND_FIXTURES_DIR`(未設 → `backend/tests_e2e/fixtures`)下:
  - `borrow_fee/twse_{yyyymm}.json` — **原始 TWSE response shape**(`{stat, fields, data}`,probe 縮樣改日期至 2026-06)
  - `borrow_fee/tpex.json` — 原始 TPEx array
  - 檔缺 → 視同該月空(走 SC-4 回退,不炸)。
- **放子目錄 `fixtures/borrow_fee/`**:避免誤觸 `test_fake_finmind_manifest.py` 的 MANIFEST drift gate(該 gate 管 FinMind dataset 對映;Phase 3 落地時先讀該 test 確認 glob 範圍,若掃 flat `*.json` 則子目錄天然隔離)。
- Fixture 日期對齊 `FAKE_TODAY=2026-06-26`(Fri,現行 fixture 基準日):TWSE 202606 rows 含 06/26 當日 → e2e happy path `as_of = 2026-06-26` 無 NTD badge。
- 改 fixture 後跑 e2e 前清 `e2e/.cache`(skill 規則;本 feature cache 檔前綴 `borrow_fee_` 也落該 dir)。

## 6. SC ↔ 設計對映

| SC | 設計節 |
|---|---|
| SC-1 | §3.1(ModeSwitch + 4-way ternary + lazy) |
| SC-2 | §1.3 / §2 / §3.4(合併表 + month_counts + 預設降序) |
| SC-3 | §3.4(FEE_HIGHLIGHT_THRESHOLD 常數 ×2 + testid;文案禁令入 vitest) |
| SC-4 | §1.3 步驟 3-5 / §3.4 badge / §4 測試分工(e2e 只 happy path,amendment) |
| SC-5 | §3.4 排序 state + §3.4 utils 純函式 |
| SC-6 | §1.1 cache 條款(當月跨日 stale / 過去月不朽 / refresh bust) |
| SC-7 | §1.2 normalize 純函式 + §4 髒點測試 |
| SC-8 | Phase 3 尾:讀 `changelog-conventions` 後加 VersionEntry(MINOR) |
| SC-9 | Phase 5 auto-verify 全套 + Phase 6 截圖 |

## Known Risks

- **[P2-6] 當月 cache 日粒度**:盤後公告當日,早上已抓 cache 的 user 需手動「重新整理」才看得到當日資料(跨日自動 stale)。取捨:本源每日僅更新一次,不值得分鐘級 staleness 複雜度。
- **TPEx TLS(spec spike)**:py3.12 未實測;炸則 truststore(Phase 3 第一步驗)。
- **TPEx 歷史缺**:OpenAPI 僅當月;`partial` flag + UI 註記為既定降級(spec §7 接受)。
