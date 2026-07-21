# current-state.md — mod/batch-ui-update Phase 1 現況地圖

> 2026-07-21。baseline 全綠:backend pytest 704 passed + ruff clean;frontend vitest 902 passed(96 檔);`npm run build` 過。
> 來源:4 個 Explore agent 地圖 + 主 agent 親驗(iv_drift 依賴、流通在外資料源 probe)。

---

## A. 籌碼總攬(equity mode overview tab)

### 元件結構
- `ChipKlineChart.tsx`(L66-554):K 線 + 6 子圖直向堆疊 — 主力買賣超 / 外資 / 投信 / 自營商(`InstBarSvg`)、融資融券(`MarginLineSvg`)、分點(N)(`BrokerAggBarSvg`,最後一格)。
- 資料:`useChipData()`(K 線 + 法人 + 融資)、`useBrokerHistory()`(分點序列)、`useChipBrokersWindow()`(右欄 N 日聚合)。
- renderer 在 `lib/chip-kline-svg.tsx` / `chip-inst-bar-svg.tsx` / `chip-broker-agg-svg.tsx`(純函式,獨立測試)。

### 天數(windowDays)現況
- state 在 `App.tsx` L111-118(localStorage `chip_window_days`,1-60,`RangeSelector` 控制)。
- 目前只影響:(1) K 線上的灰色 range band(`computeRangeBand`,`lib/chip-range-band.ts`);(2) 右欄 `useChipBrokersWindow` N 日聚合。
- **子圖(主力/外資/投信/自營商/融資融券/分點)不隨 windowDays 顯示範圍加總**;K 線左上角 HUD(`ChipKlineChart.tsx` L498-516)顯示 hover/selected 單日的「日期 + OHLC + 漲跌 + 量 + MA/BB 圖例」,無範圍聚合。

### 滑鼠互動現況
- crosshair:`hoverIndex` 竪線畫在 K 線 + 各子圖上,但 **mouse 事件只掛在 KlineChartSvg 內**(L278-293)— hover 子圖區塊不會出現十字軸。
- drag pan:`handlePointerDown` + document-level pointermove(L89-195),`cursor-grab`;**無 user-select 抑制** → 拖曳會選取文字。
- 日期顯示在 HUD 第一欄。

### 右欄(ChipBrokersPanel.tsx L208-504)
- 上而下:loading bar → **日期 header**(L236-256:`當日 YYYY-MM-DD | 過去N日加總`)→ **主力買賣超**(L262-266)→ **「三大法人」標題 + 外資/投信/自營商 3 欄**(L269-296)→ **「融資融券」標題 + 2 列**(L298-321)→ mode tabs(前15大買賣超/交易量)→ 選中分點條(h-9)→ 前 15 買賣超雙表(內部滾動,flex-1)。
- BrokerRow(L72-159):整列可點 = toggle 選取(加入 K 線分點聚合)。**無「看泡泡圖」入口**。
- 泡泡圖反向跳轉已存在:`ChipBubbleView.onJumpToOverview(brokerId|brokerId[])` → `App.handleJumpToOverview` 勾選分點 + 切 overview。**正向(overview → bubble 並聚焦某分點)不存在**;`ChipBubbleView` 的 `selectedBrokerId` 是內部 state(L53),無 initial prop。

## B. 泡泡圖(ChipBubbleView.tsx,498 行)

- hook:`useChipBubble()`(gate `tab==="bubble"`)+ `useChipIntraday()`。
- 現有篩選:BrokerSearch 單選分點、brush Y 軸價格區間(`brushRange`)。`rangeActiveForFilter = brushRange && !selectedBrokerId`。
- **無「排除分點」機制、無持久化**(換股即重置)。
- localStorage 全 repo 現況:`mode` / `chip_window_days` / `chip_panel_width` / `opt:contractId` / `neigui.warrant-columns.v1`(prefs helper 樣板在 `lib/warrant-column-prefs.ts`)。

## C. 導覽結構(App.tsx)

- mode 4-way ternary(L569):`equity` / `options` / `market` / `borrow`(券差 = BorrowFeePage,獨立 mode,ModeSwitch L320 切換)。
- equity tabs = `EQUITY_TABS` config(L82-88):overview / bubble / warrants / warrant-flow / **broker-flows(分點反查,BrokerFlowsPanel.tsx 330 行)**。
- BrokerFlowsPanel 的 `onPickStock` 會切回 overview + 設 symbol + 預選分點(App L265-272)— **跨 tab 依賴,搬去 mode 層需保留跨 mode 跳轉**。
- equity 左側**無 sidebar**;SymbolSearch 在 header(L335)。

## D. 權證(warrants tab)

- 表:`WarrantSelector.tsx` + 欄位 registry `lib/warrant-columns.tsx`(17 欄,預設排序差槓比 slr)。
- **展開機制**:代號欄 +/− → `expandedId` → 展開列渲染 `WarrantIvHistory`(IV 時序圖,`useWarrantIvHistory` 懶加載,route `GET /api/warrants/{warrant_id}/iv-history`)。
- **iv_drift 欄依賴鏈(親驗)**:`services/warrants.py` L591-599 讀取時 merge `warrant_iv_history` 的 drift_map;main.py lifespan 也掛 ivh。**刪 iv-history 不能刪 service**,只能刪前端展開 + `/iv-history` route + 對應測試;service(供 iv_drift + archive)保留。
- 認購/認售顯示:`warrant-columns.tsx` L89-109 — call 實底 ink/10%、put 框線,**全中性色無紅綠**。
- 理論價:`warrant_quotes.py` L169-221 — `bs_price(s_now, strike, t, r=0.016, iv_prev, kind)*ratio`;**iv_prev = 昨日 EOD 五檔中價反解 IV**(快照層算好);估價差 `(price-theo)/theo`,±10%(`MISPRICE_FAIR_BAND`)分 cheap/fair/expensive;重設型一律 null。前端顯示為理論價欄 + 估價差欄(中性色 tag)。
- **流通在外資料源 probe 結論(3 端點親測)**:TWSE t187ap37_L 只有「發行單位數量(仟單位)」;t187ap42_L 只有成交金額/張數;TPEx `tpex_warrant` 有 OriginalIssuedUnits/累計增發/累計註銷(仍是發行面)。**每日流通在外(扣發行人庫存)無官方批次 API**(真實來源 = MOPS 發行人每日申報,或券商權證網)。→ 資料源抉擇待 user 拍板。

## E. 權證分點(warrant-flow tab)

- `WarrantFlowPanel.tsx`(主面板,保留)+ `WarrantFlowNetHistory.tsx`(**外部淨額 20 日時序圖 + 缺日補建 CTA** — 本次刪除標的)。
- 刪除影響鏈:`useWarrantFlowHistory` → `api.warrantFlowHistory` → route `GET /api/warrants/{stock_id}/flow/history`(routes/warrants.py L77-85)→ `services/warrant_flow_history.py`(整個 service 只服務此圖)。前端 + route + service + 測試(`WarrantFlowNetHistory.test.tsx` / `useWarrantFlowHistory` 測試 / `test_warrant_flow_history.py` / e2e 對應)可整鏈刪;`warrant_flow.py`(主面板用)不動。
- `lib/warrant-flow-history-svg.tsx` 只服務此圖,可刪。

## F. 大盤(market mode)

- `MarketPage.tsx`:三卡 grid(IndexStrength 4fr / CapTiers 2fr / SectorRotation 6fr)+ **「經典檢視」折疊區(L76-101,`classicOpen` 預設 true)= MarketHeatmap + MarketLeaderboard(4 tabs:漲跌幅雙排 / 大量單 / 量比,各 top30,`_LEADERBOARD_SIZE=30`)**。
- 「拉抬 X pp」:`MarketIndexStrength.tsx` L7-14 `spreadLabel()`;spread = `index_change_rate − median_change_rate`(backend `market_today.py` compute_index_strength),>0 顯示「權值拉抬(+X.XXpp)」,<0「中小強於指數(−X.XXpp)」。pp = percentage point。
- 台積電列:`TsmcRow`(L43-58)顯示 2330 漲跌 + 對加權貢獻點數(contrib_points,backend `_market_contrib_entries` L33-74:`prev_close_index × (mv × chg%) / total_mv`)。**「扣除台積電後指數漲跌」無現成欄位,可由 index change − 2330 contrib 推得(backend 加欄位)**。
- 族群輪動:`MarketSectorRotation.tsx` — 主族群列「整行可點 = drill(底部 MembersPanel)+ 箭頭鈕 = 展開副族群」;副族群點擊 = drill;**個股清單在卡片底部 MembersPanel(max-h-48),非巢狀內嵌**。members 走 `GET /api/market/sector_members`(lazy useQuery)。
- snapshot payload:`universe rows` 有每檔 `change_rate`(百分比數值)+ `type_map`(twse/tpex)+ name/mv map。**漲停判定無現成欄位**(可由 change_rate 推近似,或由 prev_close 推精確漲停價需 tick 規則)。
- 測試:MarketPage.test.tsx 鎖「經典檢視預設展開 + DOM 順序」(刪除 = 該紅);backend `test_market_today.py` / `test_market_routes.py` / e2e `test_api_market.py`(leaderboard 4-tab payload shape)。e2e specs `market.spec.ts`(M#)。

## G. 對 caller 影響總表(現況 → 目標草案)

| # | 區塊 | 現況 | 目標 | 類型 | backward compat |
|---|---|---|---|---|---|
| 1 | 籌碼總攬 BrokerRow | 點列 = toggle 選取 | 加「看泡泡圖」動作 → 切 bubble tab + 聚焦該分點 | 🟢 | ChipBubbleView 需加 initial broker prop |
| 2 | windowDays | 只動 range band + 右欄 | 子圖各自加窗內加總顯示;HUD 改窗範圍 開高低收/漲跌/量 | 🔴 | HUD 內容契約變,測試該紅 |
| 3 | drag/crosshair | 拖曳會選字;子圖無十字軸;HUD 有日期 | select-none;子圖 hover 出十字軸;HUD 刪日期 | 🔴 | ChipKlineChart 測試部分該紅 |
| 4 | 右欄上部 | 日期 header + 三大法人標題 + 融資融券標題 | 刪日期列/兩標題;主力+外資+投信+自營商 同層顯示 | 🔴 | ChipBrokersPanel 測試該紅 |
| 5 | 泡泡圖 | 無排除清單 | 分點過濾清單(排除)+ 持久化 | 🟢 | 無 |
| 6 | 個股 | 無自選清單 | 左側自選清單 + 分組(localStorage) | 🟢 | 無 |
| 7 | 分點反查 | equity 第 5 tab | 移到 mode 層(券差旁) | 🔴 | onPickStock 跨 mode 跳轉需保留;EQUITY_TABS/e2e/navigation 測試該紅 |
| 8 | 權證引波 | 展開列 IV 圖 | 刪展開 + WarrantIvHistory + hook + /iv-history route;**iv_drift 欄與 service 保留** | 🔴 | route 刪除 = 對外 API 移除(僅自家前端用) |
| 9 | 流通在外比率 | 無 | 資料源待拍板(官方無批次 API) | 🟢 | — |
| 10 | call/put 區分 | 中性色 | 顏色明顯化(台股慣例 call 紅/put 綠?)| 🔴 | 與既有「零紅綠」設計決策衝突,由 user 指示覆寫 |
| 11 | 理論價/估價差 | 昨日 IV BS 價 + ±10% tag | 呈現改造方向待拍板 | ? | — |
| 12 | 權證分點時序圖 | WarrantFlowNetHistory + backfill 鏈 | 整鏈刪(前端+route+service+測試) | 🔴 | 對外 API 移除(僅自家前端用) |
| 13 | 大盤扣台積電 | 無欄位 | backend index_strength 加 ex-2330 點數/% | 🟢 | payload additive |
| 14 | 拉抬 pp | 文案無解釋 | 說明 + 文案/tooltip 改善 | 🔵/🟢 | — |
| 15 | 族群輪動 | 整列點=drill、箭頭=展開、members 在底部 | 整列點=展開;副族群展開後個股巢狀內嵌 | 🔴 | sector_members API 不變,前端互動重構;測試該紅 |
| 16 | 經典檢視 | 折疊區 heatmap+leaderboard | 整個刪除;量比功能獨立保留(可依量比/漲跌幅排序、符合條件全列) | 🔴 | backend leaderboards payload 可縮;MarketPage/Heatmap/Leaderboard 測試該紅或刪 |
| 17 | 漲跌幅分布 | 無 | 上市/上櫃分開:漲停/上漲/下跌/跌停家數 + 清單 | 🟢 | snapshot payload additive |

## H. 既有債(next-time.md 相關條目,本次順路確認)

- popover 骨架第 2 份複本(BrokerFilterPopover / WarrantColumnMenu)— **泡泡圖過濾清單若做成 popover 即第 3 份 → 觸發抽共用 wrapper 的重評估**。
- drift label 中文對映複本(warrant-columns DRIFT_TEXT vs WarrantIvHistory DRIFT_LABEL)— 刪 WarrantIvHistory 自然消滅一份。
- combobox 第 3 份複本門檻(SymbolSearch / BorrowFeeStockFilter)— 自選清單若需搜尋加入,注意此門檻。
