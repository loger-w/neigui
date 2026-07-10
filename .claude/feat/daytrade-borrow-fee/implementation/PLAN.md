# Implementation PLAN — daytrade-borrow-fee(condensed)

依 design.md v3。Wave batch commit(goal_efficiency_mode,`[waveN]` tag,body 列 SC)。
`[auto-default: goal_efficiency_mode=true | reason: 18 檔 > 15,/auto 契約條件成立]`

## Wave 1 — Backend service(SC-2/4/6/7)

### backend/services/daytrade_fee.py(新)
- 常數:`_CACHE_VERSION = 1`、`FEE_HIGHLIGHT_THRESHOLD = 3.5`(對外文件用,前端同名)、`_UA = "Mozilla/5.0 (neigui-backend)"`、`TWSE_URL` / `TPEX_URL`。
- `_get_client() -> httpx.AsyncClient`:module singleton,timeout 30.0 + UA header;TLS 炸 SKI 時 truststore fallback(Phase 3 第一步實測決定是否需要)。`async def aclose() -> None` 供 lifespan。
- `def _roc_slash_to_iso(s: str) -> str`(`"115/07/01"` → `"2026-07-01"`)、`def _roc_compact_to_iso(s: str) -> str`(`"1150701"`)。
- `def normalize_twse_row(row: list) -> dict | None`、`def normalize_tpex_row(row: dict) -> dict | None`(壞 row → None + warning;輸出 shape 見 design §1.2,含 `market` 欄)。
- `async def _fetch_month_raw(market: str, yyyymm: str) -> list`:twse → BFIF8U json 的 `data`(stat != OK → []);tpex → 非當月直接 [] 不打網路,當月 GET;`FAKE_FINMIND=="1"` → 讀 `<fixtures_dir>/borrow_fee/{twse_{yyyymm}|tpex}.json`(缺檔 → []),fixtures_dir = `FAKE_FINMIND_FIXTURES_DIR` or `<backend>/tests_e2e/fixtures`。
- `async def fetch_month(market: str, yyyymm: str, refresh: bool = False) -> list[dict]`:cache 檔 `borrow_fee_{market}_{yyyymm}.json`(chip_cache_dir);讀取條件 + P0-1 兩道保護 + 空不覆寫非空,全依 design §1.1;內層過 `_run_once(f"{market}_{yyyymm}", ...)`。
- `_inflight: dict[str, dict]` + `async def _run_once(key: str, coro_fn)`:finmind.py::_run_once 同構(ensure_future + refs + shield + 歸零 cancel),docstring 註明樣板出處。
- `async def get_day(date_str: str | None, refresh: bool = False) -> dict`:design §1.3 全流程(裸 gather、回退鏈、404 no_data、no_trading_day 無條件、partial per-day、rows 排序 `(-fee_rate, -lending_shares, stock_id)`、month_counts distinct-date)。
- 測試 hook:module-level `get_clock_today()` 薄 wrapper?否 — 直接 `from services import clock` + `clock.today()`,test 用 monkeypatch.setattr(clock, "today")。

### backend/tests/test_daytrade_fee.py(新;失敗測試 ↔ SC)
- SC-7:`test_normalize_twse_row_dirty`(民國/padding/千分位/百分號)、`test_normalize_tpex_row_dirty`(compact 民國/leading-space key/無 % 費率)、`test_normalize_bad_row_returns_none`。
- SC-6:`test_fetch_month_caches_and_refresh_busts`(monkeypatch `_fetch_month_raw` 計數)、`test_current_month_cache_stale_next_day`(monkeypatch clock.today)、`test_past_month_cache_immortal`。
- P0-1:`test_tpex_past_month_refresh_serves_cache`、`test_empty_raw_does_not_overwrite_nonempty_cache`。
- P0-2:`test_run_once_dedup_concurrent`、`test_run_once_cancel_one_waiter_other_survives`。
- SC-4:`test_get_day_falls_back_within_month`、`test_get_day_recurses_prev_month_once`、`test_get_day_404_no_data`、`test_no_trading_day_flag_with_explicit_date`。
- SC-2:`test_get_day_merges_markets_sorted_fee_desc`、`test_month_counts_distinct_dates`(同日多筆算 1)、`test_rows_keep_multiple_entries_per_stock`。
- R2-1:`test_partial_tpex_stale_cache_missing_asof_day`、`test_partial_tpex_empty_past_month`。
- **[R1-2] 檔內 module-local autouse fixture**:reset `daytrade_fee._client = None` + `_inflight.clear()`(對齊 conftest 的 `fm._client` reset 慣例;conftest 不管新 module)。
- **[R1-3] SC-3 常數鎖**:`test_fee_highlight_threshold_value`(assert `FEE_HIGHLIGHT_THRESHOLD == 3.5`,註解指向前端同名測試)。

## Wave 2 — Backend route + e2e fake 層(SC-2/4 route 面)

### backend/routes/daytrade_fee.py(新)
- `router = APIRouter()`;`GET /api/daytrade-fee`(`request: Request, date: str | None, refresh: bool`);**[R1-1] `from datetime import date as date_type`**,驗證 `date_type.fromisoformat(date)`(參數名 `date` 是對外 query 契約,保留)→ 失敗 400 `bad_date`;`run_with_disconnect(request, svc.get_day(...))`;`except httpx.HTTPError` → 502 `borrow_fee_upstream`(design §2 snippet 原樣)。

### backend/main.py(改)
- import + `app.include_router(daytrade_fee_router)`;lifespan finally 段加 `await daytrade_fee.aclose()`(在 finmind close 之前或後皆可,各自 try 不互卡 — 用巢狀 finally)。

### backend/tests/test_daytrade_fee_routes.py(新)
- `test_shape_ok`(monkeypatch get_day)、`test_bad_date_400`、`test_upstream_error_502_borrow_fee_upstream`(raise `httpx.ConnectError`)、`test_read_error_also_502`(`httpx.ReadError`,P1-1)、`test_404_no_data_passthrough`。

### backend/tests_e2e/fixtures/borrow_fee/twse_202606.json + tpex.json(新)
- 原始 upstream shape 縮樣(probe 真實 payload 改日期):twse `{stat:"OK", fields:[...], data:[6-8 rows,日期涵蓋 115/06/23~115/06/26,含 8046 同日雙筆 + 3.5%/7% 高費率 + 0050 ETF]}`;tpex array 3-4 rows(`Date:"1150626"`、`" LendingVolume"` 原樣 key)。日期對齊 FAKE_TODAY=2026-06-26。

### backend/tests_e2e/test_api_daytrade_fee.py(新)
- FAKE mode contract:`test_daytrade_fee_shape`(rows>0、as_of=2026-06-26、無 no_trading_day、month_counts 型別)、`test_fee_sorted_desc`。跑法對齊 tests_e2e 既有慣例(Phase 3 開工先讀該 dir 現有檔)。

## Wave 3 — Frontend 資料層(SC-2/5)

### frontend/src/lib/borrow-fee.ts(新)
- `BorrowFeeRow` / `BorrowFeeData` interfaces(design §3.2 原樣)+ `export const FEE_HIGHLIGHT_THRESHOLD = 3.5`。

### frontend/src/lib/api.ts(改)
- `daytradeFee(refresh?: boolean, options?: RequestOptions): Promise<BorrowFeeData>` → `get(`${BASE}/daytrade-fee`, refresh ? {refresh:"true"} : {}, options)`。

### frontend/src/lib/borrow-fee-utils.ts(新)
- `export type SortKey = "fee_rate" | "lending_shares" | "month_count" | "stock_id"`
- `sortRows(rows: BorrowFeeRow[], key: SortKey, dir: "asc"|"desc", monthCounts: Record<string, number>): BorrowFeeRow[]`(穩定排序,tie-break stock_id asc)
- `formatShares(n: number): string`(千分位)、`formatFee(n: number): string`(`3.50%`)。

### frontend/src/hooks/useDaytradeFee.ts(新)
- useChipBubble 樣板:queryKey `["daytrade-fee"]`、forceRefreshRef、回傳 `{ data, loading, error, refresh, noTradingDay }`。

### 對應 vitest(colocated,失敗測試 ↔ SC)
- SC-5:`borrow-fee-utils.test.ts`(各 key 雙向 + tie-break + month_count 用 map)。
- SC-2:`useDaytradeFee.test.ts`(shape、error 終態、noTradingDay 導出;frontend-testing 慣例 vi.spyOn api)。

## Wave 4 — Frontend UI(SC-1/2/3/4/5)

### frontend/src/components/ModeSwitch.tsx(改)
- `Mode` 加 `"borrow"`;MODES 加 `{ key: "borrow", label: "券差" }`。

### frontend/src/App.tsx(改)
- `const BorrowFeePage = lazy(...)`;三元鏈末端改 `: mode === "market" ? (<Suspense>...</Suspense>) : (<Suspense fallback=「載入券差頁面...」><BorrowFeePage /></Suspense>)`。

### frontend/src/components/BorrowFeePage.tsx(新)
- `export function BorrowFeePage(): ReactElement`;內用 useDaytradeFee;header(標題/資料日 badge/NTD 樣式/partial 註記/重新整理鈕 aria-busy)+ 空狀態/錯誤列 + `<DaytradeFeeTable rows month_counts />`;UI 紀律:semantic tokens、繁中、frontend-design + bencium 已載入本 session 的準則(既有 design system 內執行,數字 tabular-nums)。

### frontend/src/components/DaytradeFeeTable.tsx(新)
- props `{ rows: BorrowFeeRow[]; monthCounts: Record<string, number> }`;sort state `{key, dir}` 預設 `fee_rate desc`;th button + `aria-sort`;fee ≥ threshold → row `data-testid="fee-high"` + `text-accent`;市場欄 outline badge(上市/上櫃,非紅綠)。

### 對應 vitest
- SC-1:`ModeSwitch.test.tsx` 補第 4 顆 + 既有 3 顆 assertion 同步;`App.test.tsx` 補 borrow mount + localStorage persistence + invalid-mode 註解更新(P2-5)。
- SC-2/3/4/5:`DaytradeFeeTable.test.tsx`(渲染/排序點擊/標色 testid/方向文案 null)、`BorrowFeePage.test.tsx`(空狀態/NTD badge/partial 註記/refresh 呼叫/**[R1-4] 方向文案 null assertion 也掛 page 層全文**)。
- **[R1-3] 前端常數鎖**:`borrow-fee-utils.test.ts` 加 `FEE_HIGHLIGHT_THRESHOLD === 3.5`(註解指向 backend 同名測試)。

## Wave 5 — e2e + changelog(SC-1/2/8)

### e2e/specs/navigation.spec.ts(改)
- N# mode 列 assertion 補「券差」第 4 顆:點擊 → `aria-current="page"`、reload 持久化;先讀既有檔對 selector(不憑記憶),既有「恰 3 顆」類 assertion 同步為 4。

### e2e/specs/borrow-fee.spec.ts(新)
- BF1(SC-2/3):`// 痛點:` 註解;切「券差」→ 表格 rows > 0、首列費率 ≥ 末列、`fee-high` testid ≥ 1、資料日 badge 文字含 `2026-06-26`(資料級 assertion,防 visibility-only 假綠)。
- 跑前清 `e2e/.cache`(fixture 新增)。

### frontend/src/lib/changelog.ts(改,SC-8)
- 讀 `changelog-conventions` skill 後新增 MINOR VersionEntry(index 0)。

## 驗收 gate(SC-9)
`pytest -q` + `ruff check .`(backend)→ vitest → `npm run build` → e2e `npm test`(AI 實跑)→ DevTools 截圖 `docs/specs/daytrade-borrow-fee/screenshots/`。
