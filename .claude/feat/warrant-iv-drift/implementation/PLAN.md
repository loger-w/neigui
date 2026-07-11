# implementation PLAN — warrant-iv-drift(condensed,對 design v4)

Wave 分組(goal_efficiency_mode,commit body 列 SC-N):
- **wave1** 純函式 drift(SC-3)
- **wave2** archive / backfill / 序列服務(SC-1/2)
- **wave3** API 面 + FAKE fixture(SC-4/5)
- **wave4** 前端資料層 + SVG 純函式(SC-6/7 基建)
- **wave5** 前端 UI(SC-6/7)
- **wave6** e2e(SC-8)

跨檔契約速查:label = `"declining"|"rising"|"stable"|"insufficient"`;攤平 drift = `{label, slope_bid, slope_ask, n_valid}`(n_valid = max 兩側);iv-history payload = `{warrant_id, terms_approx_dates, series:[{date, iv_bid, iv_ask}], drift}`。

---

## wave1 — backend/services/warrant_iv_drift.py(Create;SC-3)

純函式零 IO,樣板 warrant_pricing.py。常數:`MIN_VALID_POINTS=20`、`REL_CHANGE_THRESHOLD=0.15`、`CONSISTENCY_MIN=0.60`。
```python
DriftLabel = Literal["declining", "rising", "stable", "insufficient"]
def theil_sen_slope(points: list[tuple[int, float]]) -> float        # caller(detect_side)以 MIN_VALID_POINTS gate 保證 ≥2 點
def detect_side(series: list[float | None]) -> dict                  # {"label","slope","n_valid"};x=list index(含 None 洞)
def detect_drift(iv_bid: list[float | None], iv_ask: list[float | None]) -> dict  # {"label","bid":{...},"ask":{...}}
def flatten_drift(d: dict) -> dict                                    # {"label","slope_bid","slope_ask","n_valid"}
```
detect_side:pairwise 斜率一次算出雙用(中位數 = Theil-Sen;同號占比 = 持續性);`rel = slope * (last_valid_x - first_valid_x) / median(valid)`。overall 優先序 declining > rising > (雙側 insufficient) > stable。

### backend/tests/test_warrant_iv_drift.py(Create)
失敗測試(SC-3):`test_declining_series`、`test_rising_series`、`test_stable_series`、`test_single_spike_stays_stable`、`test_insufficient_points`、`test_gap_index_not_compressed`(洞不壓縮 x,R5/R24)、`test_flatten_n_valid_max`(R6)。

## wave2 — backend/services/warrant_iv_history.py(Create;SC-1/2)

archive / backfill / drift summary / 序列組裝。模組常數:`_CACHE_VERSION=1`、`HISTORY_DIR="warrant_iv_history"`、`DRIFT_FILE="warrant_iv_drift_latest.json"`、`WINDOW_FILES=60`、`PRUNE_KEEP=90`、`DRIFT_YIELD_EVERY=200`、env `WARRANT_IV_BACKFILL_DAYS`(預設 60,0 停用)。local 複製 `_run_once` / `_ssl_context`(慣例:不跨模組 import 私有)。
```python
def ensure_post_build_task(snap: dict) -> None        # = design 的 run_post_build spawn 入口封裝(同日 dedup + FAKE guard 內收);
                                                      # FAKE=="1" 或 as_of None → no-op;同日 task 進行中不重 spawn(R2/R17);
                                                      # task 內:wrote = await archive_from_snapshot(snap);僅 wrote=True 才 rebuild(R21)
async def archive_from_snapshot(snap: dict) -> bool   # 存在→False;tpex_date!=as_of 不寫 tpex 列(R3);倒掛雙 None(R8);寫後 prune 90(R7)
def ensure_backfill_task() -> None                    # lifespan 入口;FAKE / env 0 → no-op
async def aclose() -> None                            # cancel + await 全部背景 task + 關閉本模組 httpx client(沿 warrants.aclose 樣板)
async def _fetch_underlying_close_range(stock_ids: set[str], start: str, end: str) -> dict[str, dict[str, float]]
                                                      # R16 缺口補抓:{stock_id: {date: close}};per-underlying range 一次,走 get_finmind()
async def get_drift_map() -> dict[str, dict]          # lazy:mem→檔(版本不符=無,R18)→FAKE 同步 rebuild(不落檔,R17)/真實回空+spawn(R14)
async def rebuild_drift_summary() -> dict             # _run_once("drift_rebuild") 串行(R20);缺席補 (date,None,None)(R24);每 200 檔 yield+每檔 load yield(R13/R25);結束檔集合自檢 re-run max1(R22);完成清 LRU + generation+1(R4/R12)+timing log
async def get_iv_history(warrant_id: str, refresh: bool = False) -> dict   # 404 not_found 由 route 判(回 None);LRU 容量 4 + generation guard
def _load_day_archives(limit: int = WINDOW_FILES) -> list[tuple[str, dict]]  # FAKE 分支讀 fixtures/warrants/iv_history.json 的 days
async def _fetch_wn1430_rows(date_iso: str) -> list   # 舊站 php,民國日期;回已 normalize rows [phase-3 補註:命名定案]
def parse_wn1430(body: dict, date_iso: str) -> list[dict]  # [phase-3 補註:取代逐 row normalize —
                                                      # 欄序需由 fields 名稱 stripped 對照解出(mini-probe 實測 17 欄),
                                                      # row 級函式拿不到 fields;stat=="ok" 小寫 + echo date 校驗 +
                                                      # 四欄名齊備 guard(code-review CR-A1)]
async def _backfill() -> None                         # today-1 往回(R23);空回 retry 5s(R15);terms 自抓不走 _load_snapshot(R19);S:MI_INDEX 列自帶+FinMind 缺口補(R16, per-underlying range 一次)
```

### backend/services/warrants.py(Modify)
- `_fetch_mi_index` → 公開 `fetch_mi_index`(改名 + 更新 3 個內部 caller;行為不變)。
- [phase-3 補註] `_fetch_t187ap37`/`_fetch_tpex_issue` 同批公開化(backfill terms 自抓需要;跨模組私有禁令下唯一乾淨解,test monkeypatch 名同步)。
- [phase-3 補註] `normalize_tpex_issue_row` 補 `underlying_id` key(additive;backfill TPEx 標的價 gap 判定用)。
- [phase-3 補註] `get_snapshot(refresh)` 公開入口 + `find_warrant_underlying(snap, wid)` 純函式(iv-history 查 underlying)。
- [phase-3 補註] `services/finmind.py` 加 `FinMindClient.stock_price_range(symbol, start, end)`(R16 缺口補抓;契約鎖 mutation-verified)。
- `_build_and_store`:`atomic_write_json` 成功後 `ivh.ensure_post_build_task(snap)`(**函式內 local import** `from services import warrant_iv_history as ivh` — 避免循環 import:ivh 模組層 import warrants 用 fetch_mi_index)。
- 新公開 `def find_warrant_underlying(snap: dict, warrant_id: str) -> str | None`(掃 by_underlying;get_iv_history 用)。
- `get_underlying_warrants`:每列 `{**w, "iv_drift": drift_map.get(...)}` shallow copy merge(R10),drift_map = `await ivh.get_drift_map()`。

### backend/tests/test_warrant_iv_history.py(Create)
失敗測試:`test_archive_writes_day_file`(shape+短鍵)、`test_archive_idempotent_returns_false`、`test_archive_skips_tpex_on_lag`(R3)、`test_archive_inverted_quote_both_none`(R8)、`test_archive_prunes_old_files`(R7)、`test_post_build_skips_rebuild_when_archive_false`(R21,monkeypatch rebuild 計數)、`test_series_axis_fills_missing_dates`(R24)、`test_wn1430_normalize_variants`(原始 aaData 縮樣含舊年份欄名,R9)、`test_backfill_skips_existing_and_nontrading`(retry 後判非交易日,R15)、`test_backfill_starts_yesterday`(R23)、`test_backfill_fills_underlying_close_gap_via_finmind`(R16,monkeypatch get_finmind)、`test_drift_map_lazy_fake_builds_from_fixture`(R1/R17)、`test_rebuild_version_mismatch_treated_missing`(R18)、`test_series_lru_discarded_on_generation_mismatch`(R12)、`test_rebuild_reruns_once_on_fileset_change`(R22)。R20 串行化不另測(靠 `_run_once` 既有樣板行為,豁免註明)。(monkeypatch fetch + tmp cache dir + 假鐘,asyncio_mode auto)

## wave3 — API 面(SC-4/5)

### backend/routes/warrants.py(Modify)
```python
@router.get("/api/warrants/{warrant_id}/iv-history")
async def get_warrant_iv_history(request: Request, warrant_id: str, refresh: bool = False) -> dict
```
`_validate_id`(400)→ `run_with_disconnect` 包 `warrant_iv_history.get_iv_history`;回 None → 404 `{"error":"not_found"}`;catch `httpx.HTTPError` → 502 `warrant_upstream`(snapshot 冷 build 可觸網路)。

### backend/main.py(Modify)
import `warrant_iv_history as ivh_mod`;lifespan yield 前 `ivh_mod.ensure_backfill_task()`;shutdown 巢狀 finally 鏈**最外層先** `await ivh_mod.aclose()`(cancel 背景 task 要在 client close 前)。

### backend/tests_e2e/fixtures/warrants/iv_history.json(Create)
`{"_cache_version":1, "days": {"<YYYY-MM-DD>": {"warrants": {"<wid>": {"b":..,"a":..,"c":..,"s":..,"ivb":..,"iva":..}}}}}` — 自 FAKE_TODAY=2026-06-26 往回 25 個平日;3 檔權證(id 取自既有 `mi_index_0999.json` universe):一檔 ivb/iva 線性遞減(觸發 declining)、一檔平穩、一檔僅 5 日(insufficient)。

### backend/tests/test_warrants_routes.py(Modify)
失敗測試:`test_warrants_rows_carry_iv_drift`(SC-4)、`test_iv_history_ok_shape`、`test_iv_history_unknown_warrant_404`、`test_iv_history_bad_id_400`、`test_iv_history_empty_archives_returns_200_empty_series`(SC-5 核心 edge:series==[] 且 drift.label=="insufficient",不炸)。

### backend/tests_e2e/test_api_warrants.py(Modify)
contract 補:warrants 列含 `iv_drift` key;`GET /api/warrants/<fixture遞減wid>/iv-history` → series 非空 + drift.label=="declining"。

## wave4 — 前端資料層(SC-6/7 基建)

### frontend/src/lib/warrant-data.ts(Modify)
```ts
export type IvDriftLabel = "declining" | "rising" | "stable" | "insufficient";
// WarrantTerm 加:iv_drift: IvDriftLabel | null;
export interface WarrantIvPoint { date: string; iv_bid: number | null; iv_ask: number | null }
export interface WarrantIvDrift { label: IvDriftLabel; slope_bid: number | null; slope_ask: number | null; n_valid: number }
export interface WarrantIvHistoryPayload { warrant_id: string; terms_approx_dates: string[]; series: WarrantIvPoint[]; drift: WarrantIvDrift }
```

### frontend/src/lib/api.ts(Modify)
`warrantIvHistory(warrantId: string, refresh?: boolean, options?: RequestOptions): Promise<WarrantIvHistoryPayload>` — 沿 warrantBrokers 樣板(走 module cache,非輪詢)。

### frontend/src/hooks/useWarrantIvHistory.ts(Create;+test)
useWarrantBrokers 同構:`useWarrantIvHistory(warrantId: string | null)` → `{data, loading, error, refresh}`,queryKey `["warrant-iv-history", warrantId]`,enabled `!!warrantId`。
失敗測試(useWarrantIvHistory.test.ts):null 不抓 / 成功回 data / error 終態(沿 useWarrantBrokers.test.ts pattern)。

### frontend/src/lib/warrant-iv-svg.ts(Create;+test)
```ts
export interface IvChartGeom { bidPath: string; askPath: string; xTicks: {x:number;label:string}[]; yTicks: {y:number;label:string}[] }
export function computeIvChart(series: WarrantIvPoint[], width: number, height: number): IvChartGeom | null
```
缺值日斷線(null → 下一有效點重新 `M`;不插值);雙側全 null → null。y domain = 有效 IV min/max 加 padding;x 均分交易日 index。
失敗測試(warrant-iv-svg.test.ts):基本兩線 path / 中段 null 斷線(path 含兩段 M)/ 全 null 回 null / y 軸刻度單調。

## wave5 — 前端 UI(SC-6/7)

**動工前先呼叫 `frontend-design` + `bencium-controlled-ux-designer` + 讀 `frontend-conventions`(user 常設指示)。**

### frontend/src/components/WarrantIvHistory.tsx(Create;+test)
`WarrantIvHistory({ warrantId }: { warrantId: string })`:掛 useWarrantIvHistory;loading `載入引波歷史...` / error 繁中 / 空(series 空或全 null)`無歷史引波資料`;svg `data-testid="warrant-iv-chart"`,bid 實線 / ask 虛線 + 圖例「買價IV / 賣價IV」(ink 階,非紅綠);`terms_approx_dates` 非空 → `歷史 IV 以現行條款近似`(text-ink-dim)。
失敗測試:loading / error / 空狀態 / 正常渲染 path 非空 / 近似註記條件。

### frontend/src/components/WarrantSelector.tsx(Modify;+test)
- HEADERS「IV百分位」後插 `{ key: null, label: "IV趨勢" }`;cell `data-testid="iv-drift-label"`:declining→`長期遞減`、rising→`長期遞增`、其餘 `—`(text-ink-muted,不用紅綠)。
- 展開列:`<WarrantIvHistory warrantId={r.warrant_id} />` 置於分點明細上方(同 colSpan cell 內 stack)。
失敗測試(WarrantSelector.test.tsx 追加):drift label 對映 3 case、`expect(screen.queryByText(/惡意|坑/)).toBeNull()` 文案鎖、展開時 WarrantIvHistory 出現。

### frontend/src/lib/changelog.ts(Modify)
User-visible 新功能 → MINOR bump 新 VersionEntry(index 0);**寫 entry 前讀 `changelog-conventions`**(CLAUDE.md §7)。

## wave6 — e2e(SC-8)

### e2e/specs/equity.spec.ts(Modify)
- `E12: 權證表 IV趨勢欄資料級 assertion(SC-6)`:搜尋 fixture 標的 → 權證 tab → 遞減 wid 的 row 內 `[data-testid="iv-drift-label"]` 文字 = `長期遞減`(資料級,不只 visible;痛點註解連回 SC-6 + options-page-v2 visibility 事故)。
- `E13: 展開 IV 時序圖(SC-7)`:展開遞減權證 → `[data-testid="warrant-iv-chart"] path` 存在且 `d` 屬性非空。
- 跑前清 `e2e/.cache`(e2e-conventions)。

---

## 驗證 gate(Phase 5-6,auto-verify)
- Phase 5 自動化:backend `python -m pytest -q` + `ruff check .`;frontend `npm test` + `npm run build`;e2e `npm test`(本次屬「需要 e2e」類型,必跑;跑前清 `e2e/.cache`)。
- Phase 6 真實環境(SC-7 驗證欄明定):chrome-devtools-mcp 真實截圖 — SC-6 表格「IV趨勢」欄 + SC-7 展開 IV 圖,存 `.claude/feat/warrant-iv-drift/evidence/SC-6_*.png` / `SC-7_*.png`;收尾依 §6 慣例入 `docs/specs/warrant-iv-drift/screenshots/` commit。backend 改動驗證前檢查 --reload watcher(e2e-conventions)。
- Phase 6 另擷取真實 60 檔 rebuild 的 `drift summary rebuilt ... in %.1fs` log 讀數入 evidence;**>60s 即依 design §6 降階條款處理**(O(n) 持續性 + pairwise 抽樣)並記 design changelog。
