# change-spec — 權證展開列 IV 顯示重設計

2026-07-16。分支 `mod/warrant-iv-redesign`(worktree,base origin/main 5553262)。
Phase 1 現況見同目錄 `current-state.md`。規模:L(≥5 檔,含 backend payload 擴充)。

## 0. 元大權證網參照研究(Phase 1.5 截圖,同目錄 png)

| 觀察面向 | 元大做法(歷史線圖 IV.aspx,樣本 030573 台積電統一68購01) |
|---|---|
| 圖型 | 雙軸日線疊圖:左軸權證價格(藍),右軸波動度 %(買價隱波綠 / 賣價隱波深黃 / HV 1M紅 3M橘 6M紫,checkbox 疊加) |
| BIV/SIV 對照 | BIV 是主角(發行商承諾線,預設勾);SIV 帶向上尖刺較 noisy,預設不勾 |
| 「貴不貴」 | IV 與標的 HV 疊同一 % 軸(實測 IV 55-63% vs HV 21-42%,一眼看穿) |
| 位階呈現 | 「隱波不降大公開」頁:承諾委買波動率水平線圖(2 個月窗)+ 全商品調降檔數統計表 |
| 時間軸粒度 | 權證整存續期,日資料 + 月 tick(YYYY/MM) |
| 對照價 | 疊「權證自身價格」非標的價(行銷自家權證導向) |

採納:HV 同軸對照(收斂為 HV20 一條)、BIV 主角層級、日資料粒度。
不採:雙軸單圖(刻度誤讀風險,改上下分欄共 x 軸)、權證自身價(改標的收盤,
服務「標的漲但 IV 被調降」的偵測目標)、整存續期(資料窗就是 60 日檔)。

## 1. 成功條件(可驗收)

- SC-1 響應式:展開列圖表寬度跟隨表格容器寬(useContainerSize),視窗兩種寬度
  (≥1400px / ~900px)實測截圖圖寬不同且無橫向溢出。量法:devtools MCP resize + 截圖。
- SC-2 位階(問題 a):摘要列同時呈現「最新買價IV x.x%(取最新非 null;全 null → —)」
  「自身 60 日位階 P__」「同標的位階 P__(quotes 未到 → —)」
  「BIV−HV20 差 +/-x.x pp(HV 算不出 → 不顯示該項)」。
- SC-3 對照標的價(問題 b):上下兩 panel 共 x 軸(上 IV %、下標的收盤),同日垂直對齊
  (幾何測試:同 index 兩 panel x 座標相等)。
- SC-4 降波證據(問題 c):label ∈ {declining, rising} **且 slope_bid != null 且
  trendLine 非 null** 時,BIV 上疊趨勢線(data-series="trend",斜率 = backend
  slope_bid);摘要列依 §6 WarrantIvHistory 顯示規則陳述(slope_bid null 時退化為
  僅 label 文字);stable/insufficient 不畫。
- SC-5 中性鐵則:無方向性/指控性文案(元件測試鎖 `queryByText(/做多|做空|賣選|滿倉|惡意/)`
  為 null);IV 線 className 不含 accent/bull/bear(regression lock)。
- SC-6 既有行為白名單(§2)全保留 + 測試全綠(該紅清單外零紅)。

## 2. 不能破壞的既有行為白名單

1. 展開列 lazy:未展開不打 `/iv-history`;`useWarrantIvHistory(null)` disabled。
2. loading(`載入引波歷史...`)/ error(顯示 error.message)/ 空序列(`無歷史引波資料`)
   三態繁中文案不變。
3. 缺值日斷線語意:null 之後下一有效點 M 重起,不插值。
4. `歷史 IV 以現行條款近似` 註記:僅 terms_approx_dates 非空時顯示。
5. 表格不動:iv_drift 欄 / DRIFT_TEXT / 其他欄位零改動;e2e E12 不紅。
   (WarrantSelector.tsx 只允許展開列傳 prop 的一行級接線。)
6. backend 三條供給線(daily archive / backfill / lazy read)、cache 版本、
   drift 計算(warrant_iv_drift.py)零行為改動;`/iv-history` 既有欄位語意不變(只加欄)。
7. hook 對外 shape `{data, loading, error, refresh}` 不變;refresh 帶 `?refresh=true` 不變。
8. e2e E13 的鏈路覆蓋等級不降(chart testid + bid path 資料級斷言保留,允許擴充)。

## 3. Backward compat / migration

- API payload **只加欄位**(`series[].underlying_close`):無版本 bump 需要,舊 client
  (無)不受影響;`_CACHE_VERSION` 不動(日檔 shape 未變,變的是組裝輸出)。
- `warrant-iv-svg.ts` 是前端內部 lib,唯一 caller 是本次一起改的元件 → 合約重寫無外溢。
- 無資料 migration。可逆性:revert commit 即回舊 UI,backend 加欄位對舊前端無害。

## 4. Out of scope(寫進 next-time,不動)

- 表格三檔(warrant-columns.tsx / warrant-utils.ts)任何改動。
- 逐日數值明細表、hover tooltip/crosshair 互動、時間窗切換(60 日固定)。
- 3M/6M HV(60 日窗算不滿)、權證自身價格線、backend 算 HV/位階/擬合。
- iv_percentile 的 EOD 版(現為盤中 quotes 衍生,樣本 <5 為 null 的語意照舊)。

## 5. E2E 判準結論(e2e-conventions 判準表)

equity mode UI 改既有行為 → `e2e/specs/equity.spec.ts` **E13 改 assertion**
(🔴):保留 chart testid + bid path `^M...L` 斷言,擴充:價格 panel path
(`data-series="price"`)存在且 d 非空(資料級)。fixture / MANIFEST 不動
(iv_history.json 已含 `s`)。E12 不動。visual spec 不動(V# 只鎖 mode 級 layout)。

## 6. Diff 級 spec(Phase 3;三類動作標記)

### backend/services/warrant_iv_history.py — 🟢
- `_get_underlying_series.build()`:每日掃 `wids` 取第一個非 null `s` →
  `s_by_date: list[float | None]`(與 `dates` 對齊)存入 entry(key `"s_list"`)。
- `get_iv_history()`:series 每點加 `"underlying_close": s_list[i]`。
- 不動:archive / backfill / drift / LRU / inflight 任何邏輯。
- **Known gap(R7,接受)**:wids 來自現行快照,60 日窗早期日檔若該標的現行權證
  全未上市(已下市權證才有 s),該日 underlying_close 留 None → 價格 panel 斷線。
  與 by_wid 現行語意一致,不擴掃全檔(uid→wid 反查成本不值);傳導:HV20 因
  斷檔重積在該段自然 null,摘要 HV 項不顯示 — 行為已定義,不是 bug。

### backend/tests/test_warrant_iv_history.py — 🔴(1 條)+ 🟢
- 🔴 `test_series_axis_fills_missing_dates` L259 整 dict 相等 → 補
  `"underlying_close": None`(該日無檔)並新增有值日的斷言(L258-260 一帶)。
- 🟢 新 test:underlying_close 取自日檔 `s`;同標的多權證時任一非 null `s` 生效;
  該日檔缺 `s`(全 null)→ None。

### backend/tests_e2e/test_api_warrants.py — 🟢
- iv-history 契約 test 補 `underlying_close` key 存在 + 型別斷言。

### frontend/src/lib/warrant-data.ts — 🟢
- `WarrantIvPoint` 加 `underlying_close: number | null`(**必填**,R1 定案:寧可
  tsc 逼所有手造 fixture 補欄位,不留 optional 讓缺欄 silent 流進幾何層)。
- 連動:`WarrantSelector.test.tsx` 的 mock series 補欄位(見該紅清單)。

### frontend/src/lib/warrant-iv-svg.ts — 🔴(合約重寫)
- 刪 `computeIvChart` / `IvChartGeom`,新:
  - `computeHv20(series): (number | null)[]`:對 underlying_close 的 log return
    年化(√252)。口徑寫死:**20 個 log return = 21 個連續有效收盤;不足 21 → null**
    (斷檔重積,R3 定案)。
  - `computeIvPercentile(series): number | null`:**最新非 null** iv_bid 在全窗非 null
    iv_bid 的分位(0-100);全空 → null。
  - `trendLine(series, slope): {intercept} | null`:**斜率直接用 backend `drift.slope_bid`
    (Theil-Sen),不做前端 OLS**(R4 定案:避免線與摘要數字兩個估計量打架);
    截距 = median(y_i − slope·x_i)(Theil-Sen 標準截距,x = series index 含洞);
    bid 有效點 <2 → null。
  - `computeIvHistoryChart(series, width, trendSlope): IvHistoryChartGeom | null`:
    `{ ivPanel: {bidPath, askPath, hvPath, trendPath, yTicks, height},
       pricePanel: {pricePath, yTicks, height, top},
       xTicks, pad, width }`;trendPath 僅 `trendSlope != null` 時計算
    (caller 依 R2 條件決定傳入與否);共用 x 映射;缺值斷線沿 buildPath。
    空 series / 全 null → null(元件走「無歷史引波資料」)。
- 字級:SVG 內 fontSize 一律 rem 字串(frontend-conventions)。

### frontend/src/lib/warrant-iv-svg.test.ts — 🔴(重寫)
- 舊 computeIvChart 測試刪除,新測試:HV20(不足 21 → null / 斷檔重積 / 已知數值
  手算對照)、percentile(單調序列 / 全 null)、trendLine(截距 = median(y−slope·x)
  手算對照 / bid 有效點 <2 → null / 含洞 x 語意)、computeIvHistoryChart
  (兩 panel 同 index x 相等 = SC-3、斷線 M 重起、空回 null、trendSlope null 時無
  trendPath / 非 null 時有)。

### frontend/src/components/WarrantIvHistory.tsx — 🔴(重設計)
- Props:`{ warrantId: string; ivPercentile?: number | null }`。
- 恆存 wrapper `<div ref>`(三態共用)+ `useContainerSize`;width = max(320, cw)。
- 版面:標題+圖例(買價IV 實線 ink / 賣價IV 虛線 ink-muted / HV20 點線 ink-dim /
  標的收盤 ink-muted;全繁中)→ 摘要列(SC-2 + SC-4 陳述)→ 單一 `<svg>` 上下
  panel(`data-testid="warrant-iv-chart"` 保留;path data-side=bid/ask 保留,
  新 path `data-series="hv20" | "trend" | "price"`)。
- drift 資訊源:payload.drift(label/slope_bid/n_valid)。**R2 定案的顯示規則**:
  - label 文案:declining `長期遞減` / rising `長期遞增` / stable `平穩` /
    insufficient `樣本不足`。
  - 斜率片段 `· 買價IV 斜率 {slope_bid*100:+.2f} pp/日` **僅 slope_bid != null 時附加**
    (label 可因 ask 側單獨成立而 slope_bid 為 null — flatten_drift 既有行為)。
  - 樣本片段 `· 有效樣本 {n_valid} 日`(n_valid 為雙側 max,spec 明示不綁 bid 側)。
  - **trend 線條件 = label ∈ {declining, rising} 且 slope_bid != null 且
    trendLine 非 null**;三者缺一不畫(SC-4 措辭以此為準)。
  - 「最新買價IV」取**最新非 null** iv_bid(與 percentile 口徑一致);全 null → 該項
    顯示 `—`(R6:TPEx 落後日缺值是常態路徑)。

### frontend/src/components/WarrantIvHistory.test.tsx — 🔴(部分)+ 🟢
- 不該紅:loading / error / 空序列 / 近似註記兩條(文案與條件未變)。
- 🔴 `正常渲染`:mock payload 補 underlying_close;斷言擴為 bid/ask/price 三 path。
- 🟢 新:摘要列數字(含 ivPercentile 傳入與未傳 → —)、中性鎖(SC-5 regex null +
  className 不含 accent|bull|bear)、declining 有 trend path / stable 無、
  useContainerSize 多態 regression(MarketColdLoad 樣板:polyfill RO + stub
  getBoundingClientRect,loading→data rerender 後 svg width 跟容器)。

### frontend/src/components/WarrantSelector.tsx — 🔴(一行級接線)
- 展開列 `<WarrantIvHistory warrantId={r.warrant_id} ivPercentile={r.iv_percentile ?? null} />`。

### frontend/src/hooks/useWarrantIvHistory.ts — 不動(型別自動擴充)
### frontend/src/hooks/useWarrantIvHistory.test.ts — 不動(預期不紅)

### frontend/src/lib/changelog.ts — 🟢
- 0.33.0 entry(kind feature / scope equity;text 依 changelog-conventions,寫前必讀)。
- `changelog.test.ts:83` pin `0.32.0` **確定該紅**(R5),同 commit 更新為 0.33.0。

### e2e/specs/equity.spec.ts — 🔴(E13)
- 見 §5。

### 既有測試該紅清單(全數列舉)
| 測試 | 為何該紅 |
|---|---|
| backend test_series_axis_fills_missing_dates | series 點加 key,整 dict 相等斷言 |
| frontend WarrantIvHistory「正常渲染」 | DOM 結構重設計 |
| frontend warrant-iv-svg.test.ts 全檔 | lib 合約重寫 |
| frontend WarrantSelector.test.tsx(mock 手造 series 點,R1)| `underlying_close` 必填欄位 → tsc 紅(`npm run build` gate);mock 補欄位 |
| frontend changelog.test.ts:83(pin 0.32.0)| 0.33.0 entry |
| e2e E13 | 斷言擴充 |
**此清單外任何紅 = 打到不該動的,回 spec 檢討。**

## 7. Commit 切分(Phase 4,順序 🔵→🔴→🟢)

1. 🔵 無(無前置重構需要)。
2. 🟢 backend:payload 加 underlying_close + 測試(backend 先行,前端才有資料可接;
   該紅的 L259 dict 斷言在同 commit 內修——屬同一行為變更的合約更新)。
   ※ 三類分離的邊界說明:此 commit 對 API 是加欄位(🟢),對整 dict 斷言是必然
   連動,標 🟢 主導。
3. 🔴 frontend:lib 合約重寫 + 元件重設計 + WarrantSelector 接線 + 元件/lib 測試
   + e2e E13(先改測試紅 → 實作綠,TDD)。**含 warrant-data.ts 加欄與
   WarrantSelector.test.tsx mock 補欄位**(R2-2:型別加欄是本 commit 合約重寫的
   直接前提,tsc 連動修必須同 commit,標 🔴 主導的型別連動 — 同 §7.2 邊界說明模式)。
4. 🟢 changelog 0.33.0 + pin 測試更新。

## 8. 流程備忘

- Phase 4 開工先走 `frontend-design` + `bencium-controlled-ux-designer`(user 既定指示,
  視覺細節以其產出為準,但不得違反 §1 SC-5 中性鐵則與 token 慣例)。
- changelog entry 寫前讀 `changelog-conventions`。
- 驗證:auto-verify 全綠 + devtools MCP 兩寬度截圖(SC-1)+ 白名單逐條。

self_review_head: 59abe9b
