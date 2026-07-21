# change-spec.md — mod/batch-ui-update

> 規格來源:user 2026-07-21 /auto 原文(逐項條列,視為預核准文件);4 個方向性抉擇已於 2026-07-21 AskUserQuestion 拍板:
> (Q1) 理論價改造 = **綜合評分欄**;(Q2) 流通在外 = **本輪擱置**(記 next-time);(Q3) 認購/認售 = **紅 call / 綠 put 台股慣例**;(Q4) 引波刪除 = **只刪展開圖,IV 欄位保留**。
> 其餘實作選擇依 /auto 契約標 `[auto-default]`。現況地圖見同目錄 `current-state.md`。

## 0. 成功條件(SC)

### 籌碼總攬(CH)
- **CH-1** 前 15 大買賣超/交易量的每個分點列有「泡泡圖」動作鈕:點擊 → 切到泡泡圖 tab 且該分點自動成為泡泡圖選中分點(等同在泡泡圖搜尋選中該分點的狀態)。驗收:vitest(callback 傳遞)+ e2e(點鈕 → bubble tab 顯示該分點聚焦)。
  - 與 BB-1 交互(R6):聚焦分點若在排除清單 → **自動自排除清單移除**(顯式意圖優先於舊設定,持久生效)`[auto-default | reason: 臨時解除需額外 state,移除語意最可預測]`,且移除時顯示繁中提示「已自過濾清單移除〈分點名〉」(R10,vitest 鎖提示文字);聚焦分點當日無成交 → 維持選中 + 顯示「該分點當日無成交」空狀態(vitest 兩 case 均鎖)。
- **CH-2** windowDays > 1 時:(a) K 線左上 HUD 顯示**窗範圍聚合**:開(窗首日開盤)/ 高(窗內最高)/ 低(窗內最低)/ 收(窗末日收盤)/ 漲跌與 %(窗末收 vs 窗前一日收;無窗前日則 vs 窗首開)/ 量(窗內加總);(b) 主力/外資/投信/自營商/融資融券/分點 各子圖 label 列顯示窗內加總值(融資融券顯示融資增減+融券增減加總,分點顯示選中分點窗內淨額加總)。windowDays = 1 時 HUD 維持單日值。驗收:vitest 手算對照 + e2e 數值 assertion。
- **CH-3** (a) 拖曳 K 線 pan 時不觸發文字選取(chart 區塊 `select-none`);(b) HUD 不再顯示日期;(c) 滑鼠移到主力/外資/投信/自營商/融資融券/分點子圖上時十字軸(竪線)跟隨(事件掛整疊容器,不限 K 線區)。驗收:vitest(handler 掛載層級)+ e2e(hover 子圖出十字軸)。
- **CH-4** 右欄上部瘦身:(a) 刪「當日 YYYY-MM-DD | 過去N日加總」日期 header 列;(b) 刪「三大法人」標題,主力/外資/投信/自營商 以同一 4 欄 grid 呈現(label+值);(c) 刪「融資融券」標題,保留其數值列。下方前 15 大列表可視高度因此增加。驗收:vitest(標題/日期不存在 + 4 欄 label 存在)+ e2e 既有 assertion 調整。

### 泡泡圖(BB)
- **BB-1** 新增「過濾清單」:可搜尋分點加入排除清單;被排除分點不出現在泡泡、分點列表與統計;清單可逐一移除/全清;**全域生效(跨個股)且 localStorage 持久化**(key `neigui.bubble-broker-blocklist.v1`)`[auto-default: 全域+持久化 | reason: 過濾的動機是「永遠不想看到的雜訊分點」,依個股記憶不符動機]`。驗收:vitest(過濾邏輯 + 持久化)+ e2e(排除後泡泡消失)。

### 個股自選清單(WL)
- **WL-1** equity mode 左側新增自選清單 sidebar:可把當前個股加入清單、可建立/刪除分組、股票可歸入分組、點擊清單項切換該個股。localStorage `neigui.watchlist.v1`。桌面固定 sidebar 可收合;mobile 摺疊為 header 下拉區塊 `[auto-default: 桌面 sidebar + 可收合;v1 分組 = 建立/刪除/歸組,不做拖曳排序 | reason: 最小可用集]`。驗收:vitest(CRUD + 持久化 + 點擊切股)+ e2e(加入→點擊→切股)。

### 分點反查移位(NAV)
- **NAV-1** 分點反查自 equity tabs 移除,成為 ModeSwitch 上與「券差」相鄰的獨立 mode(順序:個股/選擇權/大盤/券差/分點反查 `[auto-default: 排券差右側 | reason: user 說「放到券差旁邊」]`)。既有「點分點反查結果 → 跳 equity overview 帶入個股+預選分點」行為保留(跨 mode 跳轉)。驗收:vitest(ModeSwitch)+ e2e N#(mode 切換 + 跨 mode 跳轉)。

### 權證(WA)
- **WA-1** 刪除引波展開:表格列不再有 +/− 展開;`WarrantIvHistory` 元件、`useWarrantIvHistory`、`api.warrantIvHistory`、backend `GET /api/warrants/{warrant_id}/iv-history` route 及對應測試全刪。**保留**:`services/warrant_iv_history.py`(iv_drift 欄與 IV 管線依賴)、表格 IV / IV百分位 / IV趨勢欄。
- **WA-2** 新增「評分」欄(綜合可買性):同標的權證集內多因子合成 0-100,因子與權重 `[auto-default]`:估價差(便宜加分,35%)、價差比(窄加分,25%)、實質槓桿(高加分,20%)、剩餘天數(20%,≤21 日重罰對齊 EXIT_CLIFF_DAYS)。演算法定序(R7):**每因子先做同標的橫斷面 percentile(0-100,方向統一為高=好)→ 依權重加權合成 → 四捨五入**;percentile 公式(R11)= `(rank−1)/(n−1)×100`,n=1 → 定值 50,tie 取平均 rank;剩餘天數 ≤21 者該因子 percentile 直接記 0(懸崖罰)。任一因子缺 → 該檔評分 null 顯示「—」;重設型 null;**null 一律排在排序末端(升冪降冪皆同)**。**預設排序改為評分 desc**(原 slr)。純前端 `lib/warrant-score.ts` 純函式 + 手算單元測試(含 null/邊界)。UI:數值 + 水平迷你 bar,分數帶顏色深淺(accent 濃度),tooltip 說明因子。
- **WA-3** 類型欄認購=紅(bull)/認售=綠(bear)台股多空慣例配色(user 拍板覆寫先前中性色決策;僅 WarrantSelector 類型欄,WarrantFlowPanel 維持現狀入白名單)。驗收:vitest 正向 assertion 鎖色(對齊專案「顏色 binding 加 data-testid + 正向 assertion」慣例)。
- **WA-4** 理論價 tooltip 註明基準:「以昨日收盤五檔中價反解 IV 計算」`[auto-default | reason: 回應 user 對基準的疑問,呈現層自我說明]`。

### 權證分點(WF)
- **WF-1** 刪除外部淨額時序圖(含補建缺日 CTA)整鏈:`WarrantFlowNetHistory` + `useWarrantFlowHistory` + `api.warrantFlowHistory` + `lib/warrant-flow-history-svg.tsx` + backend route `GET /api/warrants/{stock_id}/flow/history` + `services/warrant_flow_history.py` + 全部對應測試。`warrant_flow.py`(主面板)不動。

### 大盤(MK)
- **MK-1** 大盤強弱卡加「扣除台積電」列:加權指數扣除 2330 貢獻後的漲跌點數與 %(backend `index_strength.twse` 加 `ex_tsmc_change_points` / `ex_tsmc_change_rate`,additive;僅加權,上櫃無此列)。驗收:backend 手算測試 + vitest 顯示。
- **MK-2** 「拉抬 X pp」加說明:hint(?)icon + tooltip:「pp = 百分點;指數漲跌率與全市場個股中位數漲跌率的差,>0 表示權值股拉抬指數」。`[auto-default: 沿用 OptionsInfoHint 樣式做 hint | reason: 已有樣板]`
- **MK-3** 族群輪動:主/副族群**整列點擊即展開/收合**(不限箭頭);展開主族群 → 副族群列;展開副族群 → 該副族群個股表**巢狀內嵌其下**;無副族群的主族群展開直接內嵌個股表。底部 MembersPanel 移除。sector_members API 不變。驗收:vitest(整列 click 展開 + 巢狀渲染)+ e2e M#。
- **MK-4** 經典檢視整刪:折疊區 + `MarketHeatmap` + `MarketLeaderboard` 元件與測試刪除;backend snapshot payload 的 `sectors` / `leaderboards` 停算停傳(🔴 對外 shape 變更,自家前端為唯一 consumer)。
- **MK-5** 新增「漲跌家數」panel:上市/上櫃分欄,各列 漲停/上漲/平盤/下跌/跌停 家數;點擊漲停/跌停 bucket 展開該清單(代號/名稱/漲跌幅),點個股跳 equity(沿用 heatmap 的 onSymbolPick 行為)。漲停判定(R4 修訂)= backend 以 **`prev_close = close − change_price`**(tick snapshot 既有精確欄位,不用 change_rate 反推)× 1.1 / 0.9 依證券檔位 tick 規則向內取價,比較採 **tick 級容差(|close − limit| < 該價位半個 tick)** `[auto-default: 精確 tick 規則而非 9.8% 近似 | reason: 可測、假陽性低]`。compute_breadth 手算測試含 tick 邊界 case;universe row 需確認 `change_price` 有貫穿管線(沒有則於聚合層補傳)。
- **MK-6** 新增「量比排行」panel(經典檢視的量比功能保留品):門檻輸入(預設 量比 ≥ 1.5,可調)`[auto-default]`,符合門檻的**全部**個股列出(內部滾動),欄位:代號/名稱/市場/漲跌幅/量比/成交額,可切「量比 / 漲跌幅」排序,點列跳 equity。
- **MK-7** backend snapshot 新增 `breadth` 節供 MK-5/6:`{twse: {limit_up, up, flat, down, limit_down}, tpex: {...}, rows: [{stock_id, name, market, change_rate, volume_ratio, amount, limit_up, limit_down}]}`(rows = 全 universe 有 change_rate 者;gzip 下體積可接受)`[auto-default: 全量 rows 給前端做門檻/排序 | reason: 門檻可調 + 全列需求,後端預切會反覆往返]`。

## 1. 不能破壞的既有行為白名單

1. K 線縮放(visibleDays)、pan、hover 價格標籤、MA/BB overlay、range band 灰帶照舊。
2. BrokerRow 點列 = toggle 選取進 K 線分點聚合(CH-1 的新鈕不得吃掉整列 click)。
3. 泡泡圖既有互動:BrokerSearch 單選、brush 價格區間、`onJumpToOverview` 反向跳轉、換股重置選取(排除清單例外:跨股持久)。
4. equity 其餘 tabs(overview/bubble/warrants/warrant-flow)與 SymbolSearch、windowDays/panelWidth 持久化照舊。
5. mode 持久化(localStorage `mode`)照舊;既有四 mode 行為不變;options / borrow 頁零改動。
6. WarrantSelector:篩選、欄位選單(顯示/隱藏/排序偏好 localStorage)、既有 17 欄渲染與排序(除預設排序鍵改評分)、近到期標記照舊。**評分欄需註冊進欄位偏好系統且舊 prefs(localStorage 無 score 條目)load 後自動含 score 欄**(prefs merge 邏輯)。
7. iv_drift 欄照常有值(service 保留驗證)。
8. WarrantFlowPanel 主面板(當日分點買賣超、標的層級切換、refresh)照舊,含其中性 call/put 標籤配色。
9. 大盤三卡(強弱/分層/輪動)既有數值與降級行為照舊;polling、universe banner、refresh 照舊。
10. sector_members API contract 不變(MK-3 只動前端互動)。
11. FastAPI error contract(`detail.error`)與各既有 endpoint(除明刪的兩條 route)不變。
12. BrokerFlowsPanel 功能本體(搜尋分點、日流向表、點股跳轉)不變 — 只搬位置。

## 2. Backward compat / migration

- **刪除的兩條 API route**(iv-history / flow/history)唯一 consumer 是自家前端,同批刪除 → 無外部相容問題。cache 殘檔(iv_history 日檔 / flow_history marker)不清(無讀取者、無害,倉庫已有 per-day cache 殘留慣例,見 next-time 孤兒殘檔條目)。
- **snapshot payload 刪 `sectors`/`leaderboards` 加 `breadth`**:前後端同批改,`market-types.ts` 同步;無版本化 API 消費者。
- **localStorage**:新 key 3 個(blocklist / watchlist / 既有 warrant-columns prefs 含新欄 merge);`mode` 新值 `flows` — 舊值全合法,無 migration。warrant-column-prefs 已有版本化 merge 機制,沿用。
- **mode 初始化加合法值白名單**(R5):`localStorage.getItem("mode")` 讀出的值不在合法集合 → fallback `"equity"`。(R9 修辭校正:本批被 revert 時白名單也一起消失,`flows` 殘值仍會讓舊前端落 borrow 頁 — 影響僅首次開頁落錯 mode、一次點擊可復原,**接受**;白名單真正防的是未來新 mode 的同型問題。)
- 全部刪除均 git 可逆(上一條揭露的 localStorage 殘留為已知可接受例外)。

## 3. Out of scope(本輪不做)

- 流通在外比率(Q2 拍板擱置;資料源調查結論記 next-time)。
- WarrantFlowPanel 的 call/put 配色(維持中性,白名單 8)。
- 泡泡圖過濾清單的「依個股」模式;自選清單拖曳排序/匯入匯出。
- 族群輪動資料層(仍走現行 sector_members lazy query;不做預載)。
- 漲停判定的 ETF/處置股特殊檔位(tick 規則按普通股;誤差記 spec 註記)。
- 手機版自選清單的完整體驗打磨(v1 摺疊區塊即可)。

## 4. E2E 歸屬(e2e-conventions 判準表)

| SC | spec 檔 | 動作 |
|---|---|---|
| CH-1/2/3/4 | `equity.spec.ts` E# | 改既有 E# assertion(HUD/右欄)+ 新 E#(泡泡鈕跳轉、子圖十字軸) |
| BB-1 | `equity.spec.ts` E# | 新 E#(排除分點 → 泡泡消失) |
| WL-1 | `equity.spec.ts` E# | 新 E#(加入自選 → 點擊切股) |
| NAV-1 | `navigation.spec.ts` N# | 改 N#(mode 清單)+ 新/改跨 mode 跳轉 assertion;equity spec 內 broker-flows tab 相關 selector 改 mode 路徑 |
| WA-1 | `equity.spec.ts` + `backend/tests_e2e` | 刪展開相關 assertion;backend e2e 刪 iv-history 測試、**保留 iv_drift 欄測試** |
| WA-2/3/4 | `equity.spec.ts` E# | 新 E#(評分欄存在+排序)、類型欄色 data-testid assertion 進 vitest(色值層級 e2e 不驗) |
| WF-1 | `equity.spec.ts` + `backend/tests_e2e` | 刪 net-history 相關 assertion/測試 |
| MK-1/2/3/5/6/7 | `market.spec.ts` M# + `backend/tests_e2e/test_api_market.py` | 刪 heatmap/leaderboard M# 與 4-tab payload 測試;新 M#(breadth 家數、量比門檻列表、輪動巢狀展開);fixture `TICK_ENRICH` 補 limit-up 樣本 — **需含 close/change_price 且與 change_rate 三欄自洽**(R12,例:prev_close=100 → close=110、change_price=10、change_rate=10.0;generator docstring 同步) |
| visual | `visual.spec.ts` V# | market / equity 版面大改 → baseline 需重生(走 e2e-update-snapshots workflow,PR 註明) |

## 5. Diff 級計畫(三類分開;Phase 4 順序 🔵 → 🔴 → 🟢)

### 🔵 R1 popover 骨架抽共用(next-time 第 3 份觸發條款)
- `frontend/src/components/ui/PopoverPanel.tsx`(新):Radix Root+Trigger+Portal+Content+scroll 列表+footer 骨架。
- `BrokerFilterPopover.tsx` / `WarrantColumnMenu.tsx` 改用之;兩者測試**不動且須全綠**(行為不變)。

### 🔴 B1 籌碼總攬(CH-2/3/4)
- `ChipKlineChart.tsx`:HUD 改窗聚合(刪日期);新 `lib/chip-window-agg.ts` 純函式(窗 OHLC/量/子圖加總,vitest 手算);子圖 label 加窗加總;mouse 事件上移至整疊容器;容器 `select-none`(拖曳中)。
- `ChipKlineChart.test.tsx`:HUD 日期 assertion 該紅 → 改;新增窗聚合/十字軸掛載測試。
- `ChipBrokersPanel.tsx`:刪日期 header、三大法人/融資融券標題;主力+法人 4 欄 grid。`ChipBrokersPanel.test.tsx` 對應改。
- e2e `equity.spec.ts` 對應 E# 改。

### 🔴 B2 分點反查移位(NAV-1)
- `App.tsx`:EQUITY_TABS 移除 broker-flows;mode 加 `flows`;BrokerFlowsPanel 掛 mode 層;onPickStock 跨 mode(setMode("equity") + 原邏輯);mode 初始化白名單驗證(R5)。
- `ModeSwitch.tsx` + test:加「分點反查」(券差旁)。
- e2e `navigation.spec.ts` / `equity.spec.ts` 對應改。

### 🔴 B3 權證刪展開 + 類型配色 + 預設排序(WA-1/3 + WA-2 的排序位)
- `WarrantSelector.tsx`:刪 expandedId/展開列;預設排序 → score。
- 刪:`WarrantIvHistory.tsx(+test)` / `useWarrantIvHistory.ts(+test)` / `api.warrantIvHistory` / `lib/warrant-iv-svg.ts(+test)`(僅該圖用,確認無他者)/ backend route `get_warrant_iv_history` + routes 測試該段 + e2e 對應。
- `warrant-columns.tsx`:kind 欄紅/綠 + data-testid;理論價 tooltip 文案(WA-4)。測試對應改。
- backend `tests_e2e/test_api_warrants.py`:刪 iv-history 呼叫,保 iv_drift。

### 🔴 B4 權證分點刪時序圖(WF-1)
- 刪:`WarrantFlowNetHistory.tsx(+test)` / `useWarrantFlowHistory.ts(+test)` / `api.warrantFlowHistory` / `lib/warrant-flow-history-svg.tsx(+test)` / backend route flow/history + `services/warrant_flow_history.py` + `tests/test_warrant_flow_history.py` + e2e 對應;`WarrantFlowPanel.tsx` 移除掛載點。
- R8 補:刪孤兒 fixture `backend/tests_e2e/fixtures/warrant_flow/history.json`;更新 `services/warrant_flow.py` L98/L375 兩處「warrant_flow_history 跨模組直呼」過期註解;run-once-dedup 保留 wrapper 公開名的前提消失 → 記 next-time。

### 🔴 B5 大盤經典檢視刪除 + 輪動互動(MK-3/4)
- `MarketPage.tsx`:刪折疊區;刪 `MarketHeatmap.tsx(+test)` / `MarketLeaderboard.tsx(+test)` / **`lib/heatmap-svg.tsx(+test)`(R1:唯一 caller 是 MarketHeatmap)**;`lib/market-format.ts` 引用 MarketLeaderboard 的註解順手更正(R1)。
- `MarketSectorRotation.tsx` + test:整列展開 + 巢狀個股內嵌,刪 MembersPanel 底部呈現(members lazy query 改掛在展開的副族群節點)。
- backend `finmind_realtime.fetch_market_snapshot` / `market.py` route:停算 sectors/leaderboards(相關 service 函式與測試刪或改);`test_api_market.py` 4-tab 測試該紅 → 刪。
- `market-types.ts` 同步。

### 🟢 G1 看泡泡圖鈕(CH-1)
- `ChipBrokersPanel.tsx` BrokerRow 加動作鈕(stopPropagation 保白名單 2);`App.tsx` handler:setTab("bubble") + `bubbleFocus` state(id+seq)傳 `ChipBubbleView`;ChipBubbleView 接 prop 聚焦(effect 設 selectedBrokerId)。新測試 + e2e。

### 🟢 G2 泡泡圖過濾清單(BB-1)
- `lib/bubble-blocklist.ts`(load/save/merge)+ 測試;`ChipBubbleView.tsx` 過濾 + 「過濾清單」popover(用 R1 PopoverPanel);測試 + e2e。

### 🟢 G3 自選清單(WL-1)
- `lib/watchlist.ts`(CRUD/持久化)+ 測試;`components/WatchlistSidebar.tsx` + 測試;`App.tsx` equity 版面接 sidebar(桌面 grid 左欄 + 收合;mobile 摺疊)。e2e。

### 🟢 G4 權證評分欄(WA-2)
- `lib/warrant-score.ts` 純函式 + 手算測試;`warrant-columns.tsx` 註冊 score 欄(含 prefs merge 驗證);`WarrantSelector` 預設排序已於 B3 改。e2e E# 補。

### 🟢 G5 大盤 ex-TSMC + pp 說明 + breadth(MK-1/2/5/6/7)
- backend `market_today.py`:`compute_index_strength` 加 ex_tsmc 欄;新 `compute_breadth`(tick 規則 limit 判定,純函式手算測試);`finmind_realtime` 接 `breadth` 節;route/`test_market_today.py`/`test_api_market.py`/fixtures(`TICK_ENRICH` 補漲停樣本)。
- frontend:`MarketIndexStrength.tsx` ex-TSMC 列 + hint(MK-2);新 `MarketBreadthPanel.tsx(+test)` / `MarketVolumeRatioPanel.tsx(+test)`;`MarketPage.tsx` 版面(原經典檢視區位置);`market-types.ts`。e2e M# 新增。

### 收尾雜項
- `frontend/src/lib/changelog.ts`:0.39.0 MINOR 一條 entry(同 ship event 合併多 scope;寫前讀 changelog-conventions)。
- `docs/next-time.md`:流通在外資料源調查結論 + 順手衝動條目;popover 抽共用條目收割註記。
- visual baseline:PR 註明需跑 e2e-update-snapshots workflow 重生(V3/V6/market 相關)。

## 6. 既有測試紅綠預期(Phase 6 對照表)

- **該紅(🔴)**:ChipKlineChart(HUD 日期/內容)、ChipBrokersPanel(標題/日期)、ModeSwitch(mode 清單)、App/navigation 相關(broker-flows tab)、WarrantSelector(展開/預設排序)、warrant-columns(kind 色)、WarrantFlowPanel(掛載 net-history)、MarketPage(經典檢視預設展開/DOM 順序)、MarketSectorRotation(drill 互動)、backend test_market_today / test_market_routes / test_api_market(leaderboards/sectors)、**test_finmind_realtime.py(R2:import `_compute_leaderboards` + snapshot keys assertion 段該紅;universe filter / tick 段不該紅)**、test_warrants_routes(iv-history 段)、test_api_warrants(iv-history 段)、**market-types.test.ts(R3:sectors/leaderboards keys assertion → 改 breadth)、useMarketSnapshot.test.ts(R3:mock payload shape 同步,否則 TS build error)**。
- **整檔刪除**:WarrantIvHistory.test / useWarrantIvHistory.test / warrant-iv-svg.test / WarrantFlowNetHistory.test / useWarrantFlowHistory.test / warrant-flow-history-svg.test / test_warrant_flow_history.py / MarketHeatmap.test / MarketLeaderboard.test / **heatmap-svg.test(R1)**。
- **不該紅**:其餘全部 — 特別是 useChipData / useBrokerHistory / chip-svg 系列 / OptionsPage 全系 / BorrowFee 全系 / warrant_flow(主面板)/ warrant_iv_history service 測試 / finmind* 測試。

## 6.5 進度帳(session 交接用;**2026-07-21 session 2:全部完成**)

**Session 2 完成紀錄**:🟢 G2 BB-1(7eaabb6)→ 🟢 G1 CH-1(2a63309)→ 🟢 G3 WL-1(6e15037)→ 🟢 G4 WA-2(8018d08 + 🔴 8f456d2 預設排序)→ e2e triage 全綠 53/53 + changelog 0.39.0(340ab47)→ Phase 5 review P0 fix(c3d05ca)→ 真實環境驗證截圖 6 張(4f4924a)。e2e triage 兩教訓:CH-1 aria-label 含「泡泡圖」撞 tab 鈕 substring selector(改 exact RegExp);SVG 垂直線 bbox 寬 0 → toBeVisible 恆 hidden(改 toBeAttached+count)。visual baseline 重生走 e2e-update-snapshots workflow,PR 註明。

### 原 session 1 交接帳(已全數消化)

**已完成(每步 commit 時全套自動化綠:backend pytest+ruff、frontend vitest+build)**:
- 🔵 R1 popover 骨架抽共用(70b6636)
- 🔴 B1 籌碼總攬 CH-2/3/4(窗聚合 HUD/子圖加總/整疊十字軸/右欄瘦身;e2e E31)
- 🔴 B2 NAV-1 分點反查升格 mode + mode 白名單(30ebce4;e2e N1/N4)
- 🔴 B3 WA-1/3/4 引波展開整刪 + 紅call綠put + 理論價 tooltip(e2e E13 改鎖)
- 🔴 B4 WF-1 外部淨額時序整鏈刪(含 R8 fixture/註解;next-time 兩條已記)
- 🔴 B5 MK-3/4 輪動整列展開+巢狀個股、經典檢視整刪(e2e M1 改鎖、M2/M3/M5/M6 刪、V3/V6/N4 selector 改)
- 🟢 G5 MK-1/2/5/6/7 扣除台積電 + pp hint + breadth + 量比排行(e2e M10)

**剩餘(Phase 4 🟢 × 4 → Phase 5-8)**:
1. 🟢 G1 CH-1 看泡泡圖鈕(ChipBrokersPanel BrokerRow 動作鈕 stopPropagation;App bubbleFocus state(id+seq)→ ChipBubbleView 聚焦 prop;R6/R10 交互:聚焦分點在排除清單 → 自動移除 + 提示「已自過濾清單移除〈名〉」;當日無成交 → 空狀態)+ e2e
2. 🟢 G2 BB-1 泡泡圖過濾清單(lib/bubble-blocklist.ts localStorage `neigui.bubble-broker-blocklist.v1` 全域;popover 用 ui/PopoverPanel — 第 3 個 consumer)+ e2e
3. 🟢 G3 WL-1 自選清單(lib/watchlist.ts `neigui.watchlist.v1`;WatchlistSidebar 桌面左欄可收合、mobile 摺疊;分組建立/刪除/歸組)+ e2e
4. 🟢 G4 WA-2 評分欄(lib/warrant-score.ts:per-factor 橫斷面 percentile `(rank−1)/(n−1)×100`、n=1→50、tie 平均 rank、days_left≤21 該因子 0;權重 35/25/20/20;null 因子→score null 排序末端;WarrantSelector 預設排序改 score desc + 重製鈕同步;warrant-columns 註冊 + prefs merge)+ e2e
5. Phase 5 /code-review medium → receiving → `self_review_head` 記入本檔末尾
6. Phase 6 auto-verify 全套(含 e2e `cd e2e; npm test` — 本 session 未跑過整套 e2e,新 E31/E13/E22/M1/M10/N 系列與 fixture 假設未經真跑驗證,預期要 triage)
7. Phase 7 真實環境驗證(dev server + DevTools 截圖 → docs/specs/batch-ui-update/screenshots/)+ 白名單逐條
8. changelog 0.39.0(寫前讀 changelog-conventions)+ next-time 收割(popover 條目標已收)+ Phase 8 回頭核 + branch-lifecycle 收尾(push→PR→merge 全自動)

**注意**:e2e visual baseline(V3/V6/market/equity)需 e2e-update-snapshots workflow 重生,PR 註明。

## 7. Review 記錄

- Round 1(2026-07-21):P0×0 / P1×4 / P2×4,全數 accepted 併入 — R1 heatmap-svg 刪除鏈、R2 test_finmind_realtime 該紅、R3 market-types/useMarketSnapshot 該紅、R4 漲停判定改 change_price + tick 容差、R5 mode 白名單、R6 CH-1×BB-1 交互規則、R7 評分演算法定序 + null 排序、R8 warrant_flow fixture/註解殘留。
- Round 2(2026-07-21):**P0×0 / P1×0**(退出條件成立)/ P2×4 全數 accepted 併入 — R9 回退殘留敘述改實、R10 blocklist 自動移除加提示、R11 percentile n=1/tie 公式、R12 TICK_ENRICH 三欄自洽。R1-R8 除 R5 敘述(R9 校正)外均確認 resolved。
- Phase 5 code review(2026-07-21 session 2,sub-agent 對 G1-G4 diff):P0×1 accepted — bubbleFocus 跨 mode 卸載重放(元件層 remount 實驗證實;真環境未穩定觸發但機制存在)→ fix c3d05ca(mode 離開 equity / 換股即清)+ e2e E33 回歸鎖。其餘 BB-1/WL-1/WA-2 演算法、null 排序、白名單 2/3/4/6、effect 順序核對無誤。

self_review_head: 4f4924a
