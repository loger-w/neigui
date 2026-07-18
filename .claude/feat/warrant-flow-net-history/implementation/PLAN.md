# Implementation PLAN(condensed)— warrant-flow-net-history

> mode: condensed(state.json `phase_2_mode`);對照 design.md v3。TDD 順序照節序。
> E# 取號:equity.spec.ts 現用至 E21 → 本 feature 用 **E22**。

## 1. backend/services/warrant_flow.py(🔵 refactor + 🔴 retention/cleanup 調整)

- 抽出 `async def try_build_day(stock_id: str, d: str, snap: dict, winfo: dict[str, dict],
  mapped_all: set[str] | None, refresh: bool) -> tuple[str, dict | None, set[str] | None]`
  — get_flow 候選日迴圈單日 body 原樣搬出(dump → traded → probe → fan-out → aggregate →
  落 cache);status ∈ {"built", "no_dump", "report_pending"}。cache 讀取與
  `_cleanup_flow_caches` 呼叫**留在 get_flow**(design §2.1)。
- `_RESULT_RETAIN_DAYS` 30 → 45;新增 `_NONTRADING_RETAIN_DAYS = 14`;
  `_cleanup_flow_caches` 加 `flow_nontrading_` prefix 清理(14 天 floor)。
- 檔頭 docstring 註:`warrant_flow_history` 豁免借用私有函式(design R13)。
- 失敗測試:既有 28 測試全綠(characterization,零行為差異);cleanup 行為改動的
  紅測試 → 節 4 `test_cleanup_retention_windows`(impl-review R1)。

## 2. backend/services/warrant_flow_history.py(🟢 新檔)

- 常數 `HISTORY_SLOTS = 20`、`SCAN_WEEKDAY_CAP = 30`、`BACKFILL_MAX = 3`。
- `async def get_flow_history(stock_id: str, backfill: bool = False) -> dict` —
  `wf._run_once(f"flow_history_{stock_id}_{int(backfill)}", _impl)`;
  FAKE 分支 `_fake_history()`(fixtures/warrant_flow/history.json,`date <= clock.today()`
  過濾 + 取最近 HISTORY_SLOTS,全 built、missing_count=0);快照空 → no_warrants payload
  (design §2.2 步驟 3 定型 shape);槽位掃描 `_scan_slots(stock_id, today)`(weekday 迴圈、
  marker 跳過、cache 合格 → built);backfill:候選 = missing 且 `d < today−1`、新→舊
  ≤3、序列、建前重讀 cache、`wf._run_once(f"flow_build_{stock_id}_{d}", ...)` 包
  `wf.try_build_day`、no_dump 且 `d < today−1` 寫 marker + 遞補(重跑同判定、受 cap)、
  report_pending 保持 missing;結束 ≥1 built → `wf._cleanup_flow_caches(today)`。
- `_marker_path(d) -> Path`:`chip_cache_dir() / f"flow_nontrading_{d}.json"`(versioned)。
- per-module `def get_finmind()` **不需要**(FinMind 呼叫全在 wf.try_build_day 內)。
- payload 組裝:days 舊→新、missing_count = missing 槽數、window/built/backfilled/
  empty_reason 鍵恆齊。
- 失敗測試(SC-1/2/3):見節 4 清單。

## 3. backend/routes/warrants.py(🟢)

- `@router.get("/api/warrants/{stock_id}/flow/history")`
  `async def get_warrant_flow_history(request: Request, stock_id: str, backfill: bool = False)`
  — `_validate_id` + `run_with_disconnect(request, warrant_flow_history.get_flow_history(...))`;
  FinMind httpx 不 catch(中央 handler);快照錯誤 service 內轉 502(同 flow 慣例)。
- 失敗測試:contract test(節 5)。

## 4. backend/tests/test_warrant_flow_history.py(🟢 新檔)

Stub 策略同 test_warrant_flow.py(monkeypatch `wfh.clock.today` + `wf.clock.today`、
`wfh.warrants.get_snapshot` + `wf.warrants.get_snapshot`、`wf.get_finmind`、
`wf._inflight` / cache dir 由 conftest CHIP_DATA_DIR 隔離)。預鋪 cache 檔 =
`atomic_write_json(_result_cache_path(...), {...payload, "_cache_version": 2})`。

失敗測試清單(全部先紅):
- `test_scan_reads_cached_summaries`(SC-1):預鋪 3 日 cache → days 值 == cache summary、
  舊→新排序、鍵恆齊全
- `test_cache_only_zero_finmind_calls`(SC-2):backfill=False → stub 記帳全零
- `test_backfill_caps_at_three_newest_first`(SC-3):5 缺日(< today−1)→ 只建最近 3、
  新→舊順序;再呼叫續補下 2
- `test_backfill_skips_recent_days`(R8):today no_dump + 昨日 report_pending 場景 →
  候選排除、仍建滿 3 個較舊缺日
- `test_backfill_marks_nontrading_and_refills`(R1/R3):舊日 no_dump → marker 落檔、
  槽遞補、下輪掃描跳過
- `test_backfill_report_pending_no_marker`:舊日 report_pending → 無 marker、槽 missing
- `test_no_volume_day_counts_built_with_null`(R7):no_volume cache 日 → built、
  external_net null
- `test_no_warrants_payload_shape`(R6):快照空 → 定型 shape
- `test_snapshot_error_502`:get_snapshot 拋 → HTTPException 502 warrant_upstream
- `test_backfill_rereads_cache_before_build`(R-D):候選日已被並發建好 → 零建置呼叫
- `test_cleanup_retention_windows`(impl-review R1;掛 commit 2 [red] 前,測 wf 不測 wfh):
  預鋪 46 天前 result cache + 15 天前 marker + 13 天前 marker + 近日 result cache →
  `_cleanup_flow_caches` → 前兩刪、後兩留(marker 清理不誤刪 warrant_flow_ 檔)
- `test_scan_cap_truncates_window`(impl-review R2):大量 marker 場景 → 掃滿
  SCAN_WEEKDAY_CAP 即止、days.length < 20、missing_count = missing 槽數

## 5. backend/tests_e2e/test_api_warrants.py(🟢 追加)+ fixtures/warrant_flow/history.json

- fixture:滿窗 20 交易日(FAKE_TODAY=2026-06-26 往回實際交易日,週末跳過),
  每日 `{date, call: {trade_value, external_net}, put: {...}}`;**≥1 日 external_net null**
  (斷點);數值手造但量級對齊真實(1e7~1e8)。
- contract test:`GET /api/warrants/2330/flow/history` → 200、days.length == 20、
  全 built、missing_count == 0、null 日存在、`detail.error` 契約(bad id → 400)。

## 6. frontend/src/lib/warrant-flow-data.ts(🟢 追加 types)

- `WarrantFlowHistoryDay { date; status: "built" | "missing"; call; put }`、
  `WarrantFlowHistoryPayload { window; built; missing_count; backfilled;
  empty_reason: "no_warrants" | null; days }`(design §3.1 逐字)。

## 7. frontend/src/lib/api.ts(🟢)

- `warrantFlowHistory(stockId: string, backfill?: boolean, options?: RequestOptions):
  Promise<WarrantFlowHistoryPayload>` — params `backfill ? { backfill: "true" } : {}`,
  GET `${BASE}/warrants/${stockId}/flow/history`。divergence 註解(refresh vs backfill,
  design §3.2)。

## 8. frontend/src/lib/warrant-flow-history-svg.tsx + .test.ts(🟢 新檔)

- `computeNetHistoryChart(days: WarrantFlowHistoryDay[], width: number, height: number)
  -> { callSegments: Pt[][]; putSegments: Pt[][]; zeroY: number; xTicks; yTicks } | null`
  (built 槽 < 2 → null;x = built 槽等距 index;y 恆含 0;null 日切段;單點段由元件畫圓點)。
- 失敗測試(SC-4):null 日切段(3 值 + 中間 null → 2 段)、全 null 線 → 0 段、
  y domain 含 0、built < 2 → null、missing 槽不佔 x 位。

## 9. frontend/src/hooks/useWarrantFlowHistory.ts + .test.ts(🟢 新檔)

- `useForceRefreshQuery` 樣板(design §3.3 逐字);queryKey `["warrant-flow-history", stockId]`;
  force → `api.warrantFlowHistory(stockId, force, { signal })`。
- 失敗測試:回傳 shape { data, loading, error, refresh }、refresh 帶 backfill=true
  (vi.spyOn api;frontend-testing 慣例)。

## 10. frontend/src/components/WarrantFlowNetHistory.tsx + .test.tsx(🟢 新檔)

- Props `{ symbol: string; active: boolean }`;內部用 useWarrantFlowHistory +
  useContainerSize(恆存 wrapper);`data-testid="flow-net-history"`。
- 三態(design §3.5):built ≥ 2 → SVG 雙線(認購 text-ink 實線 / 認售 text-ink-muted
  虛線 + legend + 零軸)+ missing_count > 0 時「已累積 N/20 日」+「補建缺日」button;
  built < 2 → 累積提示文案 + CTA;empty_reason no_warrants 或 !symbol → return null。
  error → 區塊內一行文案;寬 < 320 → 只顯文案。
- 失敗測試(SC-4/5/7):兩態文案、CTA 觸發 refresh、線 class 無 bull/bear(SC-7 正向
  assert stroke class 含 ink)、null 斷點段數(直接餵 payload,RTL + jsdom pragma)。

## 11. frontend/src/components/WarrantFlowPanel.tsx(🟢 小改)

- `FlowBody` props 擴 `symbol: string; active: boolean`(impl-review R3:現行 FlowBody
  簽名無此二值),WarrantFlowPanel 呼叫處透傳;summary 區塊之後插
  `<WarrantFlowNetHistory symbol={symbol} active={active} />`。
- 註:FlowBody 僅在 data 存在時 render(三態 ternary)→ 主 panel loading / error /
  no_warrants 態 history 區塊天然不 mount,與 design §3.5 隱藏語意一致。
  區塊自 fetch(hook enabled gate),Panel 不傳 data。

## 12. e2e/specs/equity.spec.ts(🟢 E22)

- `// 痛點: 外部淨額時序 — FAKE 滿窗 fixture 資料級斷言(點數/段數對 fixture,
  防 visibility-only 假綠)`;flow tab 開啟 → `flow-net-history` 可見、
  polyline 段數/點數與 fixture 一致(null 日切段反映)、無 bull/bear class。
- 跑前清 `e2e/.cache`(慣例)。

## 13. frontend/src/lib/changelog.ts(🟢)

- MINOR 0.35.0 → 0.36.0 新 entry(寫前讀 `changelog-conventions`)。

## Commit 序(三類分離)

1. 🔵 refactor(chip): try_build_day 抽出(節 1 refactor 面,既有測試綠)
2. 🔴 fix/chore(chip): retention 45 + nontrading cleanup(節 1 行為面;與 1 分開)
3. 🟢 [red]/[green] × 節 2-5(backend history + tests + fixture + route)
4. 🟢 [red]/[green] × 節 6-11(frontend)
5. 🟢 e2e E22 + changelog
