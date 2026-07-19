# refactor/chip-bubble-p3-harvest — 批 B(chip-bubble review P2/P3 收割)

來源:docs/next-time.md「From /mod chip-bubble-intraday-overlay」(2026-06-29 workflow
wc2wlfiym review 遺留)。/auto 模式;退出條件 = 既有測試前後皆全綠。行為絕對不變。

## Phase 1|Why

intraday overlay 的 review P2/P3 積欠近三週:色票散落(STROKE 不在 chip-theme)、
命名不一致(intraday-line-svg 不帶 chip- 前綴、Props 不 export)、guard 重複
(外層 length 檢查與子元件自 guard 雙份)、測試缺口(cache stale / upstream failure /
default-date / fallback 軸 / date-change)。user 排程收割,chip 區無並行改動。

## Phase 2|測試覆蓋盤點

Baseline:2026-07-19 18:08 pre-push 全套綠(pytest 735+1 skip / ruff clean /
vitest 887 / build 成功),本分支樹與該次 push 的 main(fc831e8)相同。

條目重驗(2026-06-29 條目 vs 現況):
- **F-P3-20 moot**:useChipIntraday 已於 2026-07-17 force-refresh-query 收割改寫為
  useForceRefreshQuery,forceRefreshRef 不存在 → 不做,next-time 條目註記後刪。
- F-P3-19 仍有效(鎖 queryKey 含 date 的接線,date 換 → 以新 date 重抓)。
- 其餘條目全部仍在(行號漂移:z-order 註解現在 chip-bubble-svg.tsx:640-642、
  chartWidth 在 :650、cW 定義在 :484)。

## Phase 3|步驟

- **Step T1(🟢 測試補強,單一 commit)**
  - F-P2-4 `test_finmind.py::test_fetch_chip_intraday_today_cache_refetches_when_stale`:
    date = clock.today(),先 fetch 落 cache,把 cache fetched_at 改舊(>30min)後再
    fetch → HTTP 次數 +1(走 `_is_today && _is_stale` 分支)
  - F-P3-17 `test_fetch_chip_intraday_raises_on_upstream_failure`:raise_for_status 丟
    HTTPStatusError → pytest.raises(httpx.HTTPError)(對齊 chip_history 同款測試慣例)
  - F-P3-18 `test_chip_routes.py` default-date case:assert call.args[1] ==
    routes.chip._today()(鎖 clock 路徑,不只驗簽名長度)
  - F-P3-16 `chip-bubble-svg.test.tsx`:quiet day(全 trades ≤ VOLUME_THRESHOLD)+
    selectedBroker + intradayPoints → polyline 存在且 out-of-range 點被 clip
    (鎖 fallback Y 軸來源 = broker 自身資料;若無 fallback 該情境根本是 HintSvg)
  - F-P3-19 `useChipIntraday.test.ts`:rerender date 改變 → 以新 date 重抓
- **Step R1(🔵)** F-P3-9:STROKE "#7c6f55" → `chip-theme.ts` `CHIP.intradayLine`,
  intraday-line-svg 改 import(測試斷言值不變)
- **Step R2(🔵)** F-P3-13/14 + F-P3-8/8b(同檔 chip-bubble-svg.tsx 一個 commit):
  外層 guard 改 `{intradayPoints && <IntradayLineLayer/>}`(`[]` truthy → 子元件
  自 guard 回 null,DOM 輸出等價)、`chartWidth={cW}`(cW === width−PADDING.left−right)、
  z-order 註解改一致版 `grid → time-line → close-dashed → bubbles`
- **Step R3(🔵)** F-P3-15:SESSION_START_MIN / SESSION_RANGE_MIN 去 export +
  刪 tautology assertion(常數對外使用僅該 assertion,grep 已證)
- **Step R4(🔵)** F-P3-10:`git mv` intraday-line-svg.tsx → chip-intraday-line-svg.tsx
  (含測試檔同名 rename),`interface Props` → `export interface IntradayLineLayerProps`,
  更新唯二 importer(chip-bubble-svg.tsx + 測試檔)

每步 diff < 100 行;非大型,無 reviewer dispatch。

## E2E 判準

純內部 refactor(lib 純函式 / 命名 / 註解 / 測試)→ 豁免([no-e2e: internal refactor]);
Phase 7 以 equity e2e spec 實跑當行為不變證據。
