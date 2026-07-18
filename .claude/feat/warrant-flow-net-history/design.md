# Design — warrant flow 外部淨額時序化(v3)

> Changelog:
> v3 2026-07-18 — review round 2 收斂:R8(P1)backfill 候選排除 d >= today−1;R9(P1)
>   快照時效口徑漂移入 Known Risks R-E(觀測沿既有 unmapped log,不加 payload 欄位);
>   R10 簽名統一 3-tuple;R11 missing_count 統一定義 + FAKE 滿窗;R12 marker retention 14 天;
>   R13 共用點公開命名 / 豁免明文。
> v2 2026-07-18 — review round 1 收斂:R1(P0)marker 近日 guard;R2(P1)_try_build_day
>   差異點明文(mapped_all 簽名 / cleanup 落點 / 同日雙建防護);R3(P1)遞補槽三規則;
>   R4/R5/R6/R7(P2)FAKE 組裝欄位、L# 結論、no_warrants shape、built 含 no_volume 註記。
> v1 2026-07-18 初版。
> 對應 brainstorm.md SC-1 ~ SC-7;拍板點決議見 brainstorm.md((iii) 混合 / 新區塊 / summary 級)。

## 1. 架構總覽

```
GET /api/warrants/{stock_id}/flow/history[?backfill=true]
  └─ routes/warrants.py(_validate_id + run_with_disconnect)
       └─ services/warrant_flow_history.py::get_flow_history(stock_id, backfill)
            ├─ _run_once inflight dedup(借用 warrant_flow._run_once)
            ├─ FAKE_FINMIND=1 → fixtures/warrant_flow/history.json 直讀(distilled 層)
            ├─ 槽位掃描(cache-only):weekday 迴圈讀 warrant_flow_<stock>_<d>.json
            │    + flow_nontrading_<d>.json marker(全市場級,跳槽)
            └─ backfill=true → 逐日(新→舊、序列、≤3 日)呼叫
                 warrant_flow.try_build_day(strict 單日建置,🔵 自 get_flow 抽出)
```

前端:`useWarrantFlowHistory` hook → `WarrantFlowNetHistory` 區塊(掛在
`WarrantFlowPanel` summary 條下方、top15 之上)→ `lib/warrant-flow-history-svg.tsx`
純函式算線段(null 斷點)。

## 2. Backend

### 2.1 `warrant_flow.py` 既有改動(🔵 refactor + 兩行為調整)

- **`try_build_day(stock_id, d, snap, winfo, mapped_all, refresh)
  -> tuple[str, dict | None, set[str] | None]` 抽出**(SC-1/SC-3 前置;**公開命名** —
  本就是為 history 共用而抽,review R13):把 `get_flow` 候選日迴圈的單日 body(dump →
  traded 過濾 → probe → fan-out → aggregate → 落 cache)原樣搬出,回傳
  `(status, payload, mapped_all)`(R10:單一簽名,無過程式擴充):
  - `("built", payload, m)` — 成功建置(含 no_volume payload,已落 cache)
  - `("no_dump", None, m)` — dump 空(假日/未上料)
  - `("report_pending", None, m)` — dump 有、probe 0 rows(報表未上料)
  `get_flow` 迴圈改呼叫它,行為零差異(28 個既有測試 = characterization 保護)。
  cache 讀取(refresh=False 命中即回)**留在 get_flow 迴圈**,`try_build_day` 只管建置。
  **抽取差異點明文**(review R2):
  - `mapped_all: set[str] | None`(None = 尚未建):首個非空 dump 時自建並隨 tuple 回傳,
    caller 跨日重用 — 保留 get_flow 現行 lazy 一次語意,unmapped_count 契約不變。
  - `_cleanup_flow_caches` **留在 get_flow 成功 return 前**(現行為,含 no_volume return
    不跑的差異照舊);history backfill 迴圈結束後(≥1 日 built 時)另呼一次。
  - **同日雙建防護**:history backfill 每日建置前**重讀 result cache**(主 panel 並發建好
    即跳過);backfill 自身的單日建置包 `_run_once(f"flow_build_{stock_id}_{d}", ...)`。
    get_flow 側不加內層 key(避免 nested shield 語意改動);殘餘窗口 = 主 panel 與
    backfill「同時」冷建同一日,雙寫同一 cache 無害,接受(進 Known Risks R-D)。
  - **跨模組私有借用豁免明文**(review R13):history 與 flow 同 domain 緊耦合(共用同一
    result cache 命名空間與 inflight registry),`_run_once` / `_result_cache_path` /
    `_read_versioned` / `_cleanup_flow_caches` 由 `warrant_flow_history` import 使用,
    **豁免** twse-tpex-conventions「跨模組私有禁止」慣例(該慣例本意是隔離無關 service);
    兩檔檔頭互註。共用主入口 `try_build_day` 公開命名。
- **`_RESULT_RETAIN_DAYS` 30 → 45**(brainstorm edge 4):20 交易日 ≈ 28-30 曆日貼著 30 天
  retention,最舊槽會被 cleanup 掃掉造成左端永久缺口。45 天留 ~2 週餘裕。
- **`_cleanup_flow_caches` 加 `flow_nontrading_` prefix**:retention **14 天**(review R12:
  marker 依單次空回應永久化風險 — transient 空 dump 誤標真實交易日時,14 天自癒窗 +
  重判成本僅 1 次 dump 請求;假日不會變,重寫 marker 便宜)。

### 2.2 `warrant_flow_history.py`(新檔)

常數:`HISTORY_SLOTS = 20`、`SCAN_WEEKDAY_CAP = 30`、`BACKFILL_MAX = 3`。

```python
async def get_flow_history(stock_id: str, backfill: bool = False) -> dict:
```

流程:
1. `_run_once(f"flow_history_{stock_id}_{int(backfill)}", ...)` dedup(借 warrant_flow 的)。
2. FAKE 分支(§2.4)。
3. 快照(`warrants.get_snapshot()`)→ `by_underlying[stock_id]` 空 → **no_warrants payload
   (review R6 定型)**:`{window: 20, built: 0, missing_count: 0, backfilled: 0,
   empty_reason: "no_warrants", days: []}`(鍵恆齊全)。快照錯誤 → 502 `warrant_upstream`
   (同 get_flow R16)。
4. **槽位掃描**(cache-only,零 FinMind 請求 — SC-2):從 `clock.today()` 往前列 weekday,
   逐日:
   - `flow_nontrading_<d>.json` marker 存在 → 跳過(不佔槽)
   - `warrant_flow_<stock_id>_<d>.json` 版本合格 → `("built", summary)` 槽
   - 否則 → `("missing", None)` 槽(可能是未建交易日、也可能是未判明的假日)
   收滿 `HISTORY_SLOTS` 槽或掃滿 `SCAN_WEEKDAY_CAP` 個 weekday 為止。
5. **backfill=true**:取 missing 槽(新→舊)最多 `BACKFILL_MAX` 個(**候選集在掃描時固定**,
   遞補槽不進本輪候選 — review R3;**候選排除 `d >= today − 1`** — review R8:today/昨日
   槽多為「dump/報表未上料」的不可解態,會白燒 K=3 名額且每次點擊建 0 日;近日天然由主
   panel 的預設檢視建置,history backfill 專責較舊缺口。pytest 場景:today no_dump +
   昨日 report_pending 時仍建滿 3 個較舊缺日),**序列**逐日:
   - 建置前**重讀 result cache**(同日雙建防護,§2.1)→ 命中即槽轉 built 零成本
   - `try_build_day(...)`:
     - `built` → 槽轉 built(payload 已由 try_build_day 落 cache)
     - `no_dump` **且 `d < today − 1`** → 寫 `flow_nontrading_<d>.json` marker
       (`{"_cache_version": .., "non_trading": true}`),槽移除、遞補;
       **`d >= today − 1` 的 no_dump 不寫 marker、槽保持 missing**(review R1 —
       對齊 get_flow R15 recent_floor:今日/昨日 dump 空可能只是尚未上料,寫 marker
       會把真實交易日永久標成假日;明日掃描自然重判)
     - `report_pending` → 槽保持 missing(不 marker、不重試 — 明日自然可建)
   - **遞補規則**(review R3):遞補槽重跑掃描同一判定(marker 跳過 / cache 合格 → built /
     否則 missing);遞補同受 `SCAN_WEEKDAY_CAP` 約束(掃滿即止,寧短勿越 retention 下限)。
   - 序列而非並發:單日內部已有 cap 200 fan-out,並發多日會放大瞬時 burst 與失敗放大面。
   - upstream 失敗(httpx)不 catch → 中央 handler 502(已建日各自落 cache,partial 保留
     — brainstorm edge 5)。
   - 迴圈結束 ≥1 日 built → 呼一次 `_cleanup_flow_caches`(§2.1 落點決議)。
6. 組 payload(§2.3),`asyncio` 純組裝(無重算 — 每日值直讀 cache 的 `summary`)。

**Marker 檔語意衝突防範**:`flow_nontrading_<d>.json` 檔名 prefix 與
`warrant_flow_<stock>_<d>.json` 不同,`get_flow` 的 `_result_cache_path` 讀不到它,
互不干擾;versioned(`_CACHE_VERSION` 同 warrant_flow),bump 即失效。

### 2.3 Response payload(SC-1)

```json
{
  "window": 20,
  "built": 13,
  "missing_count": 7,
  "backfilled": 0,
  "empty_reason": null,
  "days": [
    { "date": "2026-06-19", "status": "built",
      "call": { "trade_value": 2.5e8, "external_net": 1.2e7 },
      "put":  { "trade_value": 1.3e7, "external_net": null } },
    { "date": "2026-06-24", "status": "missing", "call": null, "put": null }
  ]
}
```

- `days` **舊→新排序**(圖 x 軸自然序);built 槽 call/put 直接複製 result cache 的
  `summary.call/put`(零重算);no_volume 日 = built 槽 `trade_value 0 / external_net null`。
- **built 計數含 no_volume / 全 null 日**(review R7 已知呈現特性):「已累積 N/20 日」的
  N 可能大於圖上可繪點數(null 日不出點)— 文案語意 =「已建置的資料日」,接受不另計。
- **`missing_count` 定義統一**(review R11):= `days` 中 `status == "missing"` 槽數
  (真實與 FAKE 同一式);`days.length` 可 < `window`(SCAN_WEEKDAY_CAP 截斷時),
  文案分母仍用 `window`。
- `empty_reason`:`"no_warrants"` | null。
- 不含 `no_trading_day` flag(本 endpoint 無 date 參數)。

### 2.4 FAKE 分支(SC-6 前置)

`FAKE_FINMIND=1` → 讀 `tests_e2e/fixtures/warrant_flow/history.json`(子目錄直讀,
不入 MANIFEST — twse-tpex FAKE 子目錄慣例)。fixture = **distilled 層**(backfill 型
feature 注入點,warrant_iv_history 樣板):

```json
{ "days": [ { "date": "2026-06-08", "call": {...}, "put": {...} }, ... ] }
```

- 服務端**複製查詢語意**:fixture days 過 `date <= clock.today()` 過濾 + 取最近
  `HISTORY_SLOTS` 槽再組 payload(讓 windowing 邏輯被 e2e 實跑)。
- **FAKE 組裝欄位定型**(review R4 + R11):fixture 提供**滿窗 20 個交易日**(含 ≥1 個
  null 日);days 全標 `built`,`window = HISTORY_SLOTS`、`built = len(days)`、
  `missing_count = 0`(同真實定義:days 中 missing 槽數)、`backfilled` 恆 0、
  `empty_reason` null — FAKE 與真實 payload shape 完全同構。
  **SC-5 累積態(built < 2)僅由 RTL 覆蓋**,e2e 不驗。
- 日期對齊 FAKE_TODAY=2026-06-26 往回的實際交易日;含 ≥1 個 null 日(斷點路徑上 e2e)。
- 原始組裝路徑(掃 cache / marker / backfill)由 pytest 覆蓋(§2.5),不依賴 FAKE。

### 2.5 Backend 測試

`backend/tests/test_warrant_flow_history.py`(conftest 基建沿用;monkeypatch
`wfh.clock.today`、`wfh.warrants.get_snapshot`、`wf.get_finmind`):

- 槽位掃描:預鋪 result cache 檔(tmp CHIP_DATA_DIR)→ 值 == cache summary(SC-1)
- cache-only 零請求:stub 記帳 assert 零 dump/report 呼叫(SC-2)
- backfill 上限與順序:5 缺日場景只建最近 3 日、新→舊;再呼叫續補(SC-3)
- 假日 marker:dump 空日寫 marker、槽遞補、下輪掃描跳過
- report_pending:不 marker、槽保持 missing
- no_volume 日:built 槽 external_net null
- no_warrants / 快照 502 傳導
- `days` 舊→新排序 + 鍵恆齊全

`backend/tests_e2e/test_api_warrants.py`:history endpoint contract test
(FAKE 下 shape / days 數 / detail.error 契約)。

## 3. Frontend

### 3.1 types(`lib/warrant-flow-data.ts` 追加,不開新檔)

```ts
export interface WarrantFlowHistoryDay {
  date: string;
  status: "built" | "missing";
  call: WarrantFlowSideValue | null;
  put: WarrantFlowSideValue | null;
}
export interface WarrantFlowHistoryPayload {
  window: number;
  built: number;
  missing_count: number;
  backfilled: number;
  empty_reason: "no_warrants" | null;
  days: WarrantFlowHistoryDay[];
}
```

### 3.2 api client(`lib/api.ts`)

```ts
warrantFlowHistory(stockId: string, backfill?: boolean, options?: RequestOptions):
  Promise<WarrantFlowHistoryPayload>
// params: backfill ? { backfill: "true" } : {};GET `${BASE}/warrants/${stockId}/flow/history`
```

**divergence 註記**:本 endpoint 用 `backfill` 不用 `refresh` — `refresh=true` 契約義
=「跳 cache 全重抓」,對 20 日 series 字面義 ≈ 4000 req,誤觸即燒滿配額;`backfill`
語意 =「只補缺、絕不重建已建日」。hook 的 `refresh()` 對映 `backfill=true`(force →
backfill 轉換在 api 呼叫端,useForceRefreshQuery 慣例)。

### 3.3 hook(`hooks/useWarrantFlowHistory.ts`)

`useForceRefreshQuery` 樣板(useWarrantFlow 同構):

```ts
export function useWarrantFlowHistory(stockId: string, active: boolean) {
  const { data, isFetching, error, refresh } = useForceRefreshQuery<WarrantFlowHistoryPayload>({
    queryKey: ["warrant-flow-history", stockId],
    enabled: active && !!stockId,
    queryFn: (force, { signal }) => api.warrantFlowHistory(stockId, force, { signal }),
  });
  return { data: data ?? null, loading: isFetching, error: error ? error.message : null, refresh };
}
```

### 3.4 SVG 純函式(`lib/warrant-flow-history-svg.tsx` + colocated test)

`computeNetHistoryChart(days, width, height)`(chip-svg / warrant-iv-svg 慣例:
無 React 依賴、可獨立單測):

- 輸入:`WarrantFlowHistoryDay[]`(舊→新)+ 容器尺寸。
- x = trading-day index 等距(只畫 built 槽日期;missing 槽不佔 x 位 — 佔位會產生
  「假 gap」誤導為斷點);y = external_net 線性 scale,**恆含 0**(零軸參考線)。
- 輸出:`{ callSegments, putSegments, zeroY, xTicks, yTicks }`;segments =
  `{x,y}[][]` — **null 日切段**(SC-4:連續非 null 日成段,null 日斷開,不補 0)。
- 單線僅 1 點的段 → 圓點 marker(線畫不出來)。

### 3.5 區塊元件(`components/WarrantFlowNetHistory.tsx` + colocated test)

- 落點:`WarrantFlowPanel` `FlowBody` 內 summary 區塊之後、top15 grid 之前;
  `<div data-testid="flow-net-history">`。
- 標題列:「外部淨額時序(近 20 交易日)」+ 累積狀態文案 + CTA:
  - `built >= 2` → 畫圖;`missing_count > 0` → 標題列附「已累積 {built}/{window} 日」
    + `補建缺日` button(→ `refresh()`,即 backfill=true;loading 時 disabled)
  - `built < 2` → 不畫圖,顯示「資料累積中(已累積 {built}/{window} 日)——
    每日檢視或按補建累積」+ 同 CTA(SC-5)
  - `empty_reason === "no_warrants"` → 整區塊隱藏(主 panel 已有全版 no_warrants 態)
- 線色(SC-7):認購 = `text-ink` 實線、認售 = `text-ink-muted` 虛線(`strokeDasharray`)
  + legend(WarrantIvHistory LegendItem 同構);零軸 = `text-line-strong`。
  **不套 bull/bear**(series ≠ 方向;方向由零軸上下表達)。
- 響應式:`useContainerSize` 掛恆存 wrapper(null-ref 陷阱慣例);寬 < 320 不畫圖只顯文案。
- hook 的 error → 區塊內一行錯誤文案(不整版蓋掉 flow 主內容)。
- UI 實作前呼叫 `frontend-design` + `bencium-controlled-ux-designer`(user 固定指示)。

### 3.6 changelog

`frontend/src/lib/changelog.ts` MINOR bump 0.35.0 → **0.36.0**(新指標區塊,
使用者可感)。entry 文字寫法進 Phase 3 時讀 `changelog-conventions`。

## 4. E2E(SC-6)

- `e2e/specs/equity.spec.ts` 新 E#:flow tab 開啟 → `flow-net-history` 區塊存在,
  **資料級 assertion**:polyline/段數與 fixture days 對得上(非 visibility-only)、
  null 日斷點反映在段數。selector 對 page snapshot(首輪 trace 校準)。
- fixture:`tests_e2e/fixtures/warrant_flow/history.json`(§2.4;≥1 null 日)。
- e2e `.cache` 清理:fixture 新增後跑 e2e 前清 `e2e/.cache`(慣例)。
- **live-contract L# 結論**(review R5):**不加** — history 是 cache 組裝層,無新上游
  dataset;FinMind 面(dump / 分點報表)的 live 契約已由 flow 既有覆蓋承擔。

## 5. SC 對應

| SC | 章節 |
|---|---|
| SC-1 endpoint + 零重算 | §2.2 / §2.3 |
| SC-2 cache-only 零請求 | §2.2 步驟 4 |
| SC-3 bounded backfill | §2.2 步驟 5 |
| SC-4 雙線 + null 斷點 | §3.4 / §3.5 |
| SC-5 累積提示 + CTA | §3.5 |
| SC-6 e2e 資料級 | §2.4 / §4 |
| SC-7 中性配色 | §3.5 |

## 6. Known Risks

- **R-A backfill 端點時長**:3 缺日冷建 ≈ 15-45s。dev(vite proxy)與 prd 正式域名
  (直連 Railway)cancel 鏈通、斷線即棄;preview deploy(rewrite fallback)>30s 必死
  — 已建日逐日落 cache,重試自然續補,接受(cancel-chain 慣例:長計算脫鉤是 EOD 樣板,
  本 endpoint 靠 per-day persistence 取得等效重試性,不上背景 task 機器)。
- **R-B missing 槽的假日歧義**:未 backfill 前 missing 槽可能實為假日,`missing_count`
  暫時高估;backfill 後自然收斂(marker)。UI 文案用「已累積 N/20 日」不提「缺 M 日」,
  迴避高估數字直出。
- **R-C 顯式 date 查詢與 history 槽位互益**:user 在主 panel 顯式查歷史日會替 history
  多建槽 — 無害,天然加速累積。
- **R-D 同日雙建殘餘窗口**(review R2 接受):主 panel 與 backfill 恰好同時冷建同一日
  → 雙倍 fan-out 一次性浪費,雙寫同一 cache 冪等無害;防護 = backfill 建置前重讀 cache
  + per-day `_run_once`,殘餘機率低,接受。
- **R-E backfill 快照時效口徑漂移**(review R9 接受):backfill 用「今日」條款快照重建
  最遠 ~40 曆日前的歷史日 — 期間到期下市的權證已不在快照,該日歸 unmapped、其 HO net
  不入 external_net → backfill 槽相對「當日自然建置槽」**系統性偏低**(高量近到期檔
  影響尤甚)。無歷史快照源無法根治(快照歷史化 v1 out of scope,同 next-time 既有條目);
  觀測沿 `try_build_day` 既有 unmapped log,**評估後不加** payload 欄位 / degraded 標記
  (v1 無 UI 消費者)。失真侷限左端較舊 backfill 槽,趨勢判讀主要吃右端自然累積槽,接受。
