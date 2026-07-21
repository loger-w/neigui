# /mod batch-ui-polish — Phase 1 現況表

Baseline(2026-07-21, branch mod/batch-ui-polish 自 main 33052a8):
- frontend vitest:94 files / 897 passed
- backend pytest:682 passed, 1 skipped;ruff clean
- frontend build:綠(tsc -b + vite)

九項改動對應現況(來源:4 個 Explore agent 報告):

## Item 1|自選清單 / 群組

- 資料層 `frontend/src/lib/watchlist.ts`:`Watchlist { groups: {id,name}[], items: {symbol,name,groupId}[] }`,localStorage `neigui.watchlist.v1`。CRUD 純函式:loadWatchlist / saveWatchlist / addStock(**已支援第 4 參數 groupId,UI 未用**)/ removeStock / createGroup / deleteGroup(股票退回 null)/ assignGroup。
- UI 唯一 caller `frontend/src/components/WatchlistSidebar.tsx`(App.tsx L357-363 桌面 / L446-453 手機):
  - 新增群組:底部 form(L153-174,testid watchlist-group-input / watchlist-create-group)
  - 加入自選:「＋ 加入 {symbol}」鈕(L110-122,testid watchlist-add-current)→ addStock 不帶 groupId(一律進未分組)
  - 指定群組:每項 hover 才浮現的 `w-4 opacity-0` 原生 `<select>`(L80-96)— 可發現性極差,即 user 抱怨的「怪且不好看」按鈕
  - 股票數量:手機摺疊標頭 L189-191、桌面展開標頭 L235-237(`watchlist.items.length`)
  - 桌面固定寬 `w-[210px]`(L231),可收合 `w-8`;**無拖曳調寬**(既有樣板:App `chip_panel_width` localStorage 有 panel 調寬先例)
- 測試:`lib/watchlist.test.ts`(CRUD)、`components/WatchlistSidebar.test.tsx`(加入/pick/建組→歸組→刪組/收合)、e2e `equity.spec.ts` E34(add/pick/persist,無群組 selector)

## Item 2|K 線 & 法人區字級

- 字級機制 `frontend/src/lib/chip-theme.ts`:`svgLabelFont(width)` L18-20 = `width<500 ? "0.8125rem" : "1.375rem"`;`svgLegendFont(width)` L23-25 = `width<500 ? "0.75rem" : "1.25rem"`
- 使用點(R2 補全):`lib/chip-kline-svg.tsx` OHLC info row L514(labelFont)、MA/BB legend L535/538/545(legendFont);`lib/chip-inst-bar-svg.tsx` InstBarSvg L117 + 空資料 L61、MarginLineSvg L254 + 空資料 L182(labelFont);`lib/chip-broker-agg-svg.tsx` L76 分點合計 bar 標籤(labelFont)
- 無任何測試 assert font size(chip-svg.test.ts 只測幾何);改字級不會紅測試

## Item 3|籌碼分點面板(ChipBrokersPanel.tsx)

- net 模式 header 兩份:買超上方 L404-413、賣超上方 L441-450(`# / 分點 / 淨買賣 / 買均 / 賣均 / 買張 / 賣張`);volume 模式 header L476-485(含當沖率)
- 序號:BrokerRow L117 `{rank}`,caller 傳 i+1(L419-423 / L455-459 / L486-494)
- 測試:ChipBrokersPanel.test.tsx

## Item 4|Market 頁 layout(MarketPage.tsx)

- 上排三卡 grid L67-74 `lg:grid-cols-[4fr_2fr_6fr]`:MarketIndexStrength(4fr)/ MarketCapTiers(2fr)/ MarketSectorRotation(6fr)
- 下排 L76-90 `lg:grid-cols-[2fr_3fr] border-t`:MarketBreadthPanel(漲跌家數)/ MarketVolumeRatioPanel(量比排行)
- MarketIndexStrength body(L156-167)`flex flex-col gap-3`,可 append 區塊
- e2e:market.spec.ts M7(1440x900 無 scroll)、M10(漲跌家數+量比排行資料級)、visual snapshots market-top-*.png

## Item 5|族群輪動(MarketSectorRotation.tsx)

- Props 只有 `{data, loading}`(L7),**MarketPage 未傳 onSymbolPick**;成員列 tr(L96-105)純顯示無 onClick
- tag:`VolRatioBadge` L20-40(hot=過熱 / cold=冷清,判定 volRatioFlag L13-18),掛在 GroupStatsRow L42-51(族群列,非個股列)
- 測試:MarketSectorRotation.test.tsx

## Item 6|量比排行(MarketVolumeRatioPanel.tsx)

- 切換:兩顆相連 button(L65-83)`依量比排序 / 依漲跌幅排序`,useState sortKey(L20)
- 排序 L38-46 降序;欄位 thead L92-98:代號/名稱、市場、漲跌、量比、成交額;列可點跳個股(onSymbolPick,L102-114)
- 測試:MarketVolumeRatioPanel.test.tsx

## Item 7|分點名稱格式

- **根因:兩個 FinMind dataset 名稱格式不同,前端零加工、無共用 formatter**:
  - `taiwan_stock_trading_daily_report` 的 `securities_trader`(無「-」,如「元大松江」)→ chip 面板(ChipBrokersPanel BrokerRow L122)、泡泡圖(ChipBubbleView TradeList L866 / tooltip L211 / header L345、BrokerSearch L166-168)、權證分點(WarrantFlowPanel BranchColumn L275-277)
  - `TaiwanSecuritiesTraderInfo` 的 `securities_trader`(帶「-」,如「元大-松江」)→ 分點反查(BrokerFlowsPanel L133/L160-164/L63,顯示 `{id} {name}`)
- selection 契約全程以 broker_id 為 key(App.tsx L155-161 註解);chip top_brokers / bubble trades 是否帶 id 需實作時確認欄位
- 目標格式:`{id} {去dash名}` = 「9801 元大松江」

## Item 8|Mode 切換 state 保留

- 根因:App.tsx mode 是 4-way ternary(L354/573/585/595/605),**離開即 unmount**,註解明言避免多頁同時抓資料
- flows(BrokerFlowsPanel,L573-584):query/selected 等全內部 useState → 切走全重置
- market(MarketPage):expanded/drill(SectorRotation L115/117)、target(Breadth L56)、threshold/sortKey(VolumeRatio L19-20)→ 同樣重置
- 對比:equity 內 tab 用 `hidden` 保留 DOM(L462/525/544/557),資料抓取靠 active prop / enabled gate
- 既有 gate:MarketPage `isActive`(gates useMarketSnapshot polling 2500ms)、BrokerFlowsPanel `active`(目前恆 true)
- 跳轉機制已存在:handleFlowStockPick(App L293-301)、handleSymbolPick(L284-288)

## Item 9|常用分點儲存

- 現況:無。最近似樣板 = `lib/bubble-blocklist.ts`(localStorage `neigui.bubble-broker-blocklist.v1`,存 `{id,name}[]`,load/save/add/remove 純函式 + 測試)

## 涉及測試檔總表

vitest:watchlist.test.ts、WatchlistSidebar.test.tsx、ChipBrokersPanel.test.tsx、ChipBubbleView.test.tsx、BrokerSearch.test.tsx、WarrantFlowPanel.test.tsx、BrokerFlowsPanel.test.tsx、MarketPage.test.tsx、MarketBreadthPanel.test.tsx、MarketVolumeRatioPanel.test.tsx、MarketSectorRotation.test.tsx、MarketIndexStrength.test.tsx、App.test.tsx
e2e:equity.spec.ts(E34)、market.spec.ts(M1/M4/M7/M8/M9/M10)、navigation.spec.ts、visual.spec.ts snapshots(market-top-*)
backend:不動(全部改動為前端;item 7 採前端 formatter 方案時 backend 零改)
