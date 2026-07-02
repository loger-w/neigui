# market-page-v2-frontend — Design v3

> Changelog:
> v3 2026-07-02 — review round 2 全 4 條 accepted:量測型 panel <lg 固定高度 h-64 lg:h-full(R2-1)/ share_delta 有號值域修正(R2-2)/ known_gaps 現值註解修正(R2-3)/ §15 row9 交叉引用修正(R2-4)。
> v2 2026-07-02 — review round 1 全 7 條 accepted 落地:chart 尺寸來源 + jsdom 測試前置(R1-1)/ pct·Δ 換算公式(R1-2)/ 無 scroll 量測定義(R1-3)/ fixture 改直接 import evidence(R1-4)/ signal strip 槽位取代同錨 dot(R1-5)/ heatmap cell 渲染載體定案 HTML button(R1-6)/ lg:h-full(R1-7)。
> v1 2026-07-02 初版。
> 規格上游:`docs/specs/market-monitor-v2/prompts-next-sessions.md` ④ + `.claude/feat/market-page-v2-frontend/brainstorm.md`(12 SC)。
> Payload 契約以 `docs/specs/market-monitor-v2/evidence/snapshot_full_2026-07-02_post-fixes.json` 為準(已實測:44 sectors / mcclellan_series 128 筆含 38 null 暖機 / known_gaps=[] / eod_as_of="2026-07-02" / universe_size=1917 / excluded_count={etf:347,warrant:67,watch_list:57})。

## 1. 架構總覽

資料流(單向,零新資料源):

```
useMarketSnapshot(不動,SC-2)
  └─ data: MarketSnapshot(型別補全後新欄位自動流下,SC-1)
       └─ MarketPage(🔴 layout 重組,SC-9)
            ├─ MarketHeader(不動)
            ├─ error banner(既有 last-good,不動)
            ├─ MarketUniverseBanner(🟢 SC-8)
            ├─ 新主視圖 3 欄 grid(1440x900 無 scroll)
            │    ├─ MarketBreadthPanel(🟢 SC-4)── lib/breadth-svg.tsx(🟢 SC-3)
            │    ├─ MarketSectorBreadthHeatmap(🟢 SC-5)── lib/sector-breadth-svg.tsx(🟢 SC-5)
            │    └─ 右欄 stack:MarketSectorAmountShare(🟢 SC-6)+ MarketSectorVolRatio(🟢 SC-7)
            └─ 經典檢視折疊區(預設展開,hidden 收合)
                 ├─ MarketHeatmap(不動)
                 └─ MarketLeaderboard(不動)
```

所有新 panel 都是純 presentational component:props in → DOM out,無自己的 fetch / effect。SVG 計算全部抽 `lib/*-svg.tsx` 純函式(chip-svg 樣板),元件只掛 DOM。

## 2. SC-1:lib/market-types.ts 契約補全

```ts
export type ExcludedCount = { etf: number; warrant: number; watch_list: number };

export type BreadthPoint = { date: string; value: number | null };

export type Breadth = {
  ad_line_value: number | null;
  mcclellan_oscillator: number | null;          // 契約事實 4:可 null
  ad_line_series: BreadthPoint[];               // 契約事實 6:window-relative 累計
  mcclellan_series: BreadthPoint[];             // 前 ~38 筆 value=null(EMA 暖機)
  thrust_dot: "above_plus_100" | "below_minus_100" | null;
  centerline_cross: "above" | "below" | null;
  divergence_dot: "bearish" | "bullish" | null; // 最後一根 bar scalar(契約事實 5)
  known_gaps: string[];                         // 可含 "taiex_unavailable"(契約事實 3);post-fixes evidence 現值 [] — taiex 降級分支由 component test 手造 props 覆蓋(R2-3)
};

export type SectorBreadthRow = { sector: string; members: number; above_ma20: number; pct: number };
export type SectorVolumeRatioRow = {
  sector: string; today_vol_lots: number; vol_ratio: number | null; flag: "hot" | "cold" | null;
};
export type SectorAmountShareRow = { sector: string; today_share: number; share_delta_20ma: number | null };

export type MarketSnapshot = {
  /* 既有欄位不動:as_of / last_tick / is_trading_session / stale / lag_seconds / sectors / leaderboards */
  universe_size: number;                        // 契約事實 12(evidence 恆在,type required)
  excluded_count: ExcludedCount;
  eod_as_of: string | null;                     // 契約事實 0
  breadth: Breadth | null;                      // 契約事實 2:四欄獨立降級全 | null
  sector_breadth: SectorBreadthRow[] | null;    // null=降級;[]=無符合 sector
  sector_volume_ratio: SectorVolumeRatioRow[] | null;
  sector_amount_share: SectorAmountShareRow[] | null;
};
```

- sector 一律 plain `string`(集合日變動,契約事實 9),跨表 join 用 sector 名。
- **fixture lock test**:`lib/market-types.test.ts` 直接 `import fix from "../../../docs/specs/market-monitor-v2/evidence/snapshot_full_2026-07-02_post-fixes.json"`(對齊 `options-contract.test.ts:3` 既有跨 root import pattern,R1-4;單源無 drift,檔名含日期已凍結)。runtime 驗證:14 個 top-level key 存在、四個新欄位 shape、enum 值域(thrust/cross/divergence/flag)、series 元素 shape、**數值欄位值域註記(R1-2/R2-2):pct / today_share ∈ [0,1] 小數;share_delta_20ma 是有號小數(量級 ~±0.01,evidence 27/44 筆為負)— contract test 對它只 assert `typeof number | null`,不 assert range**。JSON literal widening 使 tsc 層 lock 不可行(brainstorm amendment),runtime contract test 等效偵測 drift。

## 3. SC-2:useMarketSnapshot 零邏輯改動

不動任何一行邏輯。`data: MarketSnapshot | null` 整包透傳,型別補全後新欄位自動可用。驗證 = `git diff main -- frontend/src/hooks/useMarketSnapshot.ts` 為空 + 既有測試綠。若 Phase 2+ review 發現必須動 → backward-compat 硬約束下停下重新評估(escalate 回本 design)。

## 4. SC-3:lib/breadth-svg.tsx(純函式,無 React import)

McClellan 與 AD Line 各一張 mini line chart 的座標計算:

```ts
export type Segment = { points: string };            // SVG polyline points 串
export type DotPos = { x: number; y: number } | null;

// 取最後 60 個「交易日」(= series 尾端 60 筆;series 本身只含交易日)
export function sliceWindow(series: BreadthPoint[], n?: number): BreadthPoint[];  // n 預設 60

// null 值段落斷線:連續非 null 段各自成一條 polyline;單點段落回傳單點 segment(component 畫 circle)
export function buildSegments(series: BreadthPoint[], w: number, h: number, pad?: number): Segment[];

// y 值域:取 slice 後非 null min/max(含 0 軸強制入域 — McClellan 需 0 線);全 null → null
export function valueDomain(series: BreadthPoint[], includeZero: boolean): { min: number; max: number } | null;

// 0 線(centerline)的 y 座標;domain null → null
export function zeroLineY(series: BreadthPoint[], h: number, pad?: number): number | null;

```

(R1-5:原 `lastPointPos` 移除 — signal dot 改 signal strip 固定槽位,不錨圖上點,YAGNI。)

[P2-refine 2026-07-02(I1-1):Phase 2 spec 把 `Segment` 從 `{points: string}` 精緻化為 `{pts: {x,y}[]}` + 新增 `polylinePoints(seg)` helper 與 `BuildOpts`(pad + includeZero)— 單點段落需 raw 座標畫 `<circle>`,字串形式不夠用;McClellan 0 線需 includeZero domain。實作以 `implementation/lib-breadth-svg.md` 為準。]

單測(全在 `breadth-svg.test.ts`):null 斷線分 2 段 / 全 null 回 [] / 前 38 null 暖機 slice 後正常 / 60-slice / domain 含 0 / 單點段落。

## 5. SC-5:lib/sector-breadth-svg.tsx(純函式)

44-45 cells 不定數量 → 簡單 row-major grid(非 squarified — cells 等權,無面積語意):

```ts
export type CellRect = { sector: string; pct: number; x: number; y: number; w: number; h: number; bin: BreadthBin };
export type BreadthBin = "strong" | "mid" | "weak" | "cold";   // >70% / 50-70% / 30-50% / <30%

export function classifyBin(pct: number): BreadthBin;           // 邊界:0.7 exactly → mid;0.5 → weak;0.3 → cold(>、>= 邊界單測 lock)
export function layoutCells(rows: SectorBreadthRow[], w: number, h: number, gap?: number): CellRect[];
// cols = ceil(sqrt(n * w/h * cellAspect)) 之類簡單公式;n=0 → []
```

(R1-6:檔名維持上游 prompt 命名 `sector-breadth-svg.tsx`,但本檔是**純 layout 計算**,不產出 SVG 元素 — 渲染載體見 §7。)

**色票定案表(brainstorm 遺留,spec 的 ink-accent 不存在)**:

| bin | 條件 | cell class | 文字 |
|---|---|---|---|
| strong | pct > 0.7 | `bg-accent/70` | `text-ink` |
| mid | 0.5 < pct ≤ 0.7 | `bg-accent/35` | `text-ink` |
| weak | 0.3 < pct ≤ 0.5 | `bg-line-strong/50` | `text-ink-muted` |
| cold | pct ≤ 0.3 | `bg-bg-deep` | `text-ink-dim` |

嚴禁 bull/bear token。bin → class 對映放 component,`data-fill-bin={bin}` 供測試(對齊 MarketHeatmap `data-fill-bin` 慣例)。

## 6. SC-4:MarketBreadthPanel

Props:`{ breadth: Breadth | null; eodAsOf: string | null; loaded: boolean }`

- **尺寸來源(R1-1)**:`useContainerSize(containerRef)` 量 chart 區 w/h(MarketHeatmap.tsx:12-13 樣板),兩張 mini chart 各分上下半高。**量測容器 `h-64 lg:h-full`(R2-1:<lg 無 intrinsic height,固定高度交頁容器捲動)**。
- 標題「市場廣度」+ 日期標籤:`eodAsOf` 非 null →「資料至 {eodAsOf}」;null →「最近交易日」(SC-10b)。
- 上半:McClellan mini chart(polyline segments + 0 線 dashed)+ 當前值(`mcclellan_oscillator`,null → "—",`toFixed(1)`)。
- 下半:AD Line mini chart + 註記「窗口相對累計」(契約事實 6,不呈現絕對值語意)。
- **Signal strip(R1-5,取代圖上錨點 dot;只標不寫方向字,SC-10a)**:chart 下方一列三個固定槽位,無重疊可能:
  - 槽 1「±100」:`thrust_dot` 非 null → accent 實心圓 `data-testid="breadth-thrust-dot"` + `data-value={thrust_dot}`;null → 槽位灰空心(inactive)
  - 槽 2「0 線」:`centerline_cross` 非 null → ink 實心圓 `data-testid="breadth-centerline-dot"` + `data-value`;null → inactive
  - 槽 3「背離」:`known_gaps` 含 `taiex_unavailable` → 槽位顯示「TAIEX 資料缺」;否則 `divergence_dot` 非 null → ink-muted 實心圓 `data-testid="breadth-divergence-dot"` + `data-value`;null → inactive
  - 槽位標籤(±100 / 0 線 / 背離)是閾值/名詞,非方向文案
- 三態:`!loaded` → skeleton;`breadth === null` →「資料暫缺」(`data-state="unavailable"`);有資料 → 圖。
- root `data-testid="market-breadth-panel"`。ink 色階:McClellan line `stroke` ink、AD line ink-dim。

## 7. SC-5:MarketSectorBreadthHeatmap

Props:`{ rows: SectorBreadthRow[] | null; eodAsOf: string | null; loaded: boolean; onSectorClick: (sector: string) => void }`

- **尺寸來源(R1-1)**:`useContainerSize(containerRef)` 量 w/h → `layoutCells`。**量測容器 `h-64 lg:h-full`(R2-1)**。
- **渲染載體定案(R1-6)**:`relative` container + 依 CellRect x/y/w/h **絕對定位的 HTML `<button>`**(非 `<svg>` 內 — button 不是合法 SVG 子元素;a11y focus 優先)。每 cell 顯示 sector 名 + `(pct*100).toFixed(0)%`(R1-2),`data-testid={"sb-cell-" + sector}`、`data-fill-bin`。
- click → `onSectorClick(sector)`(concept-drill 接點;本輪 MarketPage 傳 no-op)。
- 三態:skeleton / null「資料暫缺」/ `[]`「無符合資料」(`data-state="empty"`)。
- 近似重複名照實渲染(out of scope 決策)。root `data-testid="market-sector-breadth-heatmap"`。

## 8. SC-6:MarketSectorAmountShare

Props:`{ rows: SectorAmountShareRow[] | null; eodAsOf: string | null; loaded: boolean }`

- 表格:sector / 今日占比(`(today_share*100).toFixed(1)%`)/ Δ20MA(**百分點:`(share_delta_20ma*100).toFixed(2)`,> 0 前綴 `+`、< 0 由 toFixed 自帶 `-`、0 無前綴;R1-2 — 原值是 0-1 小數,evidence 實值 0.0016 → 顯示 "+0.16"**)。
- **照後端序渲染不重排**(契約事實 10;測試 lock 順序 = props 順序)。
- Δ 色:> 0 → `text-accent`;< 0 → `text-ink-muted`;null → `text-ink-dim` "—"。0 → ink-muted(非 accent;邊界單測)。
- 標題「族群資金流向」;不寫「占大盤」絕對語意 — 欄名用「成交占比」。root `data-testid="market-sector-amount-share"`(I3-3)、row `data-testid={"sas-row-" + sector}`。三態同上。內部 `overflow-y-auto`。

## 9. SC-7:MarketSectorVolRatio

Props:`{ rows: SectorVolumeRatioRow[] | null; eodAsOf: string | null; loaded: boolean }`

- 表格:sector / 今日量(萬張,`(today_vol_lots/10000).toFixed(1)`)/ 量比(`vol_ratio.toFixed(2)`,null → "—")。
- `flag` 直接渲染:`"hot"` → accent dot、`"cold"` → ink-dim dot、null → 無 dot(`data-flag` attr 供測試)。**前端不重算 1.5/0.7**。
- 標題「族群量能」。root `data-testid="market-sector-vol-ratio"`(I3-3)、row `data-testid={"svr-row-" + sector}`。三態同上。

## 10. SC-8:MarketUniverseBanner

Props:`{ universeSize: number; excludedCount: ExcludedCount; stale: boolean } | 由 MarketPage 在 data 為 null 時整條不 render`

- 文案:`已過濾 ETF / 權證 / 處置股 共 {etf+warrant+watch_list} 檔 · 納入 {universe_size} 檔(以本次掃描範圍為準)`
  - D-1 裁決:「處置股」精確措辭;**無分項數字**(測試 lock:`queryByText(/ETF 347|347 檔.*ETF/)` null — 具體 assert 文案全文 equality 即可)。
- `stale=true` → 尾綴「 · 資料停滯,顯示最近成功結果」。
- root `data-testid="market-universe-banner"`,單行 `text-xs text-ink-muted` bar(對齊 error banner 高度風格)。
- data 未載入(MarketPage `!data`)→ 不 render(banner 數字必然齊備,型別 required)。

## 11. SC-9:MarketPage layout 重組(🔴)

```tsx
<div className="flex flex-col h-full">
  <MarketHeader ... />                              {/* 不動 */}
  {error && <div role="alert">...</div>}            {/* 既有 last-good banner,不動 */}
  {data && <MarketUniverseBanner ... />}
  <div className="flex-1 overflow-y-auto min-h-0">  {/* 頁 scroll 容器 */}
    <div className="lg:h-full grid grid-cols-1 lg:grid-cols-[3fr_4fr_3fr]">   {/* R1-7:h-full 只在 lg 生效;<lg 量測型 panel 自帶 h-64(R2-1),表格 panel 取自然高度交頁容器捲動(R3-1);新主視圖 = 容器 100% 高 → 1440x900 無 scroll 即見全部 */}
      <MarketBreadthPanel breadth={data?.breadth ?? null} eodAsOf={data?.eod_as_of ?? null} loaded={!!data} />
      <MarketSectorBreadthHeatmap rows={data?.sector_breadth ?? null} ... onSectorClick={noop} />
      <div className="flex flex-col min-h-0">
        <MarketSectorAmountShare rows={data?.sector_amount_share ?? null} ... />   {/* flex-1 內部 scroll */}
        <MarketSectorVolRatio rows={data?.sector_volume_ratio ?? null} ... />      {/* flex-1 內部 scroll */}
      </div>
    </div>
    <section>                                        {/* 經典檢視:主視圖下方,fold 之下 */}
      <button type="button" data-testid="market-classic-toggle" aria-expanded={classicOpen} onClick={toggle}>經典檢視</button>   {/* 普通 button,非 Radix(§9 lesson);testid I3-3 */}
      <div hidden={!classicOpen} className="h-[560px] grid grid-cols-1 lg:grid-cols-[7fr_3fr]">
        <MarketHeatmap sectors={data?.sectors ?? []} onSymbolPick={onSymbolPick} />
        <MarketLeaderboard leaderboards={data?.leaderboards ?? null} onSymbolPick={onSymbolPick} />
      </div>
    </section>
  </div>
</div>
```

- **無 scroll 量測語意(R1-3 鎖死)**:1440x900 下量**新主視圖 grid 元素本身** — `grid.getBoundingClientRect().bottom ≤ window.innerHeight` 且 `grid.scrollHeight ≤ grid.clientHeight`;**不量頁 scroll 容器**(經典檢視在 fold 下,頁容器 scrollHeight 必 > viewport,屬預期)。經典檢視捲動可達(D-2:預設展開 `classicOpen=true`,M1 e2e 兩 testid attach & visible)。
- 順序:error banner → universe banner → 主視圖(prompt 拍板)。
- 頁級 error 分支(`error && !data`)不動 — **不 key 在四個新欄位**(契約事實 2)。
- 經典檢視高度固定 `h-[560px]`:舊元件依賴確定高度(`h-full` + treemap 量測)。
- state:`classicOpen` 用 `useState(true)`(不持久化 — YAGNI,V2.5 再看)。

## 12. SC-10:呈現紀律(橫切,全元件)

- 方向性文案 lock:每個新 component test 檔含 `expect(screen.queryByText(/做多|做空|滿倉|減碼|加碼|看多|看空/)).toBeNull()`。
- 日期標示統一由 panel 各自渲染「資料至 …」/「最近交易日」(共用小 helper `eodLabel(eodAsOf: string | null): string` 放 `lib/market-format.ts`?→ **不另開檔**,3 行 helper 放各 panel 重複成本低,但 4 panel 重複 → 抽到 `lib/breadth-svg.tsx` 不合理;放 `components/marketEodLabel.ts`?→ 過度。**定案:抽 `lib/market-format.ts`**:`eodLabel()` + `lotsToWan()` + `pctText()` + `signedPctPoints()` 四個純函式,單測一檔 [P2-refine(I1-3):Δ 換算含 +/− 前綴與 null 分支,獨立單測價值高於 inline,R1-2/R2-2 規則集中一處])。
- skeleton 判斷:`loaded`(= `!!data`)prop,不用 `loading`(polling 下 isFetching 恆 true)。
- 「即時」lag pill 不適用新 panel:新 panel 不接 lag_seconds,header 不動即符合。

## 13. SC-11:e2e / contract 測試設計

- `backend/tests_e2e/test_api_market.py` 追加 `test_market_snapshot_v2_keys`:assert `universe_size` / `excluded_count` / `breadth` / `sector_breadth` / `sector_volume_ratio` / `sector_amount_share` in body(值允許 null;FAKE fixture 下四欄預期 null)。
- `e2e/specs/market.spec.ts` 新增(FAKE fixture 下四欄 null → 走「資料暫缺」態):
  - M4:5 個新 root testid visible(banner + 4 panels)+ 無 crash(頁面無 error 分支)
  - M5:經典檢視預設展開,`market-heatmap` / `market-leaderboard` 仍 visible(M1 防回歸的顯性版)
  - M6:折疊 button click → 兩舊 testid hidden;再 click → visible(hidden attribute 慣例)
  - 每 test 上方 `// 痛點:` 註解(§9 慣例)
- `e2e/helpers/selectors.ts` 追加 5 個新 testid 常數。
- `live-contract.spec.ts` L3 追加四欄 property 存在 assert(真打,值可 null 可 object);known_gaps shape 驗證。
- `visual.spec.ts` V3 baseline:layout 大改 → `cd e2e && npm run test:update-snapshots` 重生 baseline(Phase 5 執行)。
- populated fixture 不做(D-3,next-time.md)。

## 14. SC-12:changelog + 收尾

- `changelog.ts` index 0 插入:

```ts
{
  version: "0.19.0",
  date: "<Phase 6 完成日>",
  highlights: "大盤掃描全面改版:市場廣度、族群參與度、資金流向",
  changes: [
    { kind: "feature", scope: "global", text: "大盤掃描新增市場廣度指標與訊號標記" },
    { kind: "feature", scope: "global", text: "大盤掃描新增族群參與度分布圖,可看各族群強弱" },
    { kind: "feature", scope: "global", text: "大盤掃描新增族群資金流向與量能對照表" },
    { kind: "feature", scope: "global", text: "大盤掃描標示已過濾 ETF / 權證 / 處置股" },
    { kind: "feature", scope: "global", text: "原有大盤畫面保留於「經典檢視」區塊" },
  ],
}
```

  (user-facing 措辭,無工程術語;金融術語僅保留與 UI 標籤一致者。)
- 截圖 ≥ 5 → `docs/specs/market-monitor-v2/screenshots/`;verification.md 補 P5 段;CLAUDE.md §9 ≥ 2 lesson。

## 15. Edge cases 對應(brainstorm 1-10)

| Edge | 設計章節 |
|---|---|
| 1 breadth=null | §6 三態 |
| 2 list=[] | §7/§8/§9 三態 empty |
| 3 暖機 null 斷線 | §4 buildSegments |
| 4 taiex_unavailable | §6 divergence 降級 |
| 5 eod_as_of=null | §12 eodLabel |
| 6 三表 sector 不等長 | 各表獨立渲染,join 只發生在 onSectorClick 字串(§7) |
| 7 vol_ratio/flag null | §9 |
| 8 share_delta null | §8 |
| 9 scalar dot 最後 bar | §6 signal strip 固定槽位(scalar 即最新 bar 狀態,不錨圖上座標) |
| 10 近似重複名 | §7 照實渲染 |

## 16. 測試盤點(≥15 vitest)

market-types(1 contract)+ market-format(4)+ breadth-svg(6)+ sector-breadth-svg(4 含邊界)+ MarketBreadthPanel(5)+ MarketSectorBreadthHeatmap(4)+ MarketSectorAmountShare(4)+ MarketSectorVolRatio(4)+ MarketUniverseBanner(3)+ MarketPage(4)≈ 38 tests。

**Component test 前置慣例(R1-1,照 MarketHeatmap.test.tsx 樣板)**:用到 `useContainerSize` 的元件(BreadthPanel / SectorBreadthHeatmap)測試檔一律:
1. polyfill `ResizeObserver`(jsdom 無)
2. `vi.mock("../hooks/useContainerSize")` 回固定 `{ width: 800, height: 600 }`
否則 0×0 渲染空白全紅。其餘紀律:無 jest-dom / 無 user-event(`toBeTruthy` / `textContent` / `fireEvent`)、RTL 檔頂 `/** @vitest-environment jsdom */` + `afterEach(cleanup)`。

## Phase 6 real-env fix amendment(2026-07-02,SC-9 回退 (b))

- [P6-fix SC-9] §11 root 高度鏈修正:App root 是 `flex flex-col`(mode nav `shrink-0` + page),MarketPage root 原 `h-full` 作為 flex item = 100% 容器高(900px)而非剩餘空間 → 主視圖下溢 39px(= nav 高)被 App `overflow-hidden` 裁切,1440x900 量測 grid bottom 939 > 900。修正:root `flex flex-col h-full` → `flex flex-col flex-1 min-h-0`(對齊 App.tsx:269 equity 分支 `flex-1` pattern)。round-2 review 的高度鏈推導(「MarketPage h-full flex item」)在 App 層有誤 — `h-full` 與 `flex-1` 對 flex item 語意不同。e2e M7 量測 spec 鎖 regression。

## Phase 4 fix amendments(2026-07-02)

- [P4-fix CR1-10/11] §6/§7 的 `useContainerSize` ref 掛「恆存 wrapper」(loading/unavailable/data 三態都 mount),非 data 分支內 — hook effect 不重跑,條件掛載會讓冷載入永遠 0×0。新增 `MarketColdLoad.test.tsx`(真 hook + stub getBoundingClientRect)鎖 regression。
- [P4-fix CR1-13] §8 Δ 顏色改由與顯示同源的 `Number((v*100).toFixed(2))` 判定(±0.00003 → "0.00" + ink-muted)。
- [P4-fix CR1-0/3] 四 panel loading div 加 `role="status"` + `aria-label="載入中"`;signal 槽 active dot `aria-label="<label> 訊號觸發"`、inactive `aria-hidden`。

## Known Risks

(無 accepted P0 未解)
