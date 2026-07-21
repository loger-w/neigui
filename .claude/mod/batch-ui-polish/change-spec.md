# /mod batch-ui-polish — change-spec

規格來源:user prompt(2026-07-21 /auto 啟動訊息,九項逐條描述)= user 撰寫規格,依 /auto 契約視為預核准;方向性以外的實作選擇標 `[auto-default]`。
規模:**L 級**(≥10 檔、跨 equity/market/flows 三 mode)。

---

## A. 成功條件(SC)

- **SC-1 自選清單重設計**(WatchlistSidebar):
  - a. 桌面 sidebar 可用拖曳把手左右調寬,寬度 clamp(min 180px / max 320px),persist localStorage `[auto-default: 調寬解讀「左右拖曳+最大限度」| reason: 垂直清單的「左右拖曳+上限」語意只有調寬成立;沿用 App chip_panel_width 既有樣板]`
  - b. 加入自選一步到位:主鈕「加入自選」(進未分組)+ 群組快選(直接 `addStock(symbol, name, groupId)`,資料層第 4 參數既存未用)
  - c. 群組統一管理:單一「管理群組」入口(popover/收合區),含新增 + 刪除;取代散落的底部建立 form
  - d. 個股移組控制改為可見的選單鈕(Radix dropdown 樣式),取代 hover 才浮現的 `w-4 opacity-0` 原生 select
  - e. 「股票數量」自手機摺疊標頭與桌面展開標頭移除
- **SC-2 字級縮小**:`chip-theme.ts` 桌面檔位 `svgLabelFont` 1.375rem→1rem、`svgLegendFont` 1.25rem→0.875rem;mobile(<500)檔位不動 `[auto-default: 縮至 16px/14px | reason: 22px overlay 文字明顯過大;16px 是圖表 overlay 常規]`
- **SC-3 籌碼面板精簡**(ChipBrokersPanel,net 模式):賣超上方 sticky header 整列移除(保留「賣超」分隔帶);買超 header 保留但移除「#」欄;BrokerRow 序號數字移除(net + volume 模式一致)
- **SC-4 大盤單頁**(MarketPage):漲跌家數(MarketBreadthPanel)移入大盤強弱卡內部下方;量比排行移到族群輪動右邊;下排 `market-breadth-row` grid 移除;1440x900 無垂直捲動(M7 既有 assertion 由白名單升為本項 SC)
- **SC-5 族群輪動**:成員列可點/Enter 跳個股(接 onSymbolPick,行為對齊量比排行列);「過熱/冷清」flag tag 移除,**但族群列的量比數值(formatRatio span)保留**(R9:user 訴求是 tag,非數值)
- **SC-6 量比排行排序**:移除「依量比排序/依漲跌幅排序」toggle;改為點「量比/漲跌/成交額」欄位標題排序(降序,active 欄位高亮 + aria-sort)`[auto-default: 降序單向 | reason: 排行語意天然降序,維持與既有行為一致]`
- **SC-7 分點名稱統一**:分點顯示一律 `{broker_id} {去dash名稱}`(例「9801 元大松江」);共用 formatter `lib/broker-name.ts`;搜尋比對接受 id 與名稱。顯示點全枚舉(R1/R12):籌碼面板 BrokerRow(含 aria-label/title/hover tooltip)、chip-selected-bar 已選 pill、BrokerFilterPopover、chip-broker-agg-svg 分點標籤、泡泡圖 TradeList/header/tooltip/BrokerSearch、權證分點 BranchColumn(含 aria-label)、分點反查 badge/dropdown/query 回填/selectedEcho
- **SC-8 返回狀態保留**:分點反查的已選分點、market 的族群鑽取展開/漲跌停清單/量比門檻與排序,在切走 mode 再切回後保留(sessionStorage-backed state,**不動 mode ternary**)`[auto-default: sessionStorage 方案 | reason: e2e N4 + 文件沉澱明鎖「ternary 不能改 hidden div」;sessionStorage 讓 unmount 契約與狀態保留同時成立]`
- **SC-9 常用分點儲存**:分點反查頁可將分點加入/移除常用(localStorage `neigui.saved-brokers.v1`),常用分點一鍵帶入查詢;樣板 `bubble-blocklist.ts`

## B. 不能破壞的既有行為白名單

1. e2e E34:加入自選 → 換股 → 點清單項切回 → reload 持久(testid `watchlist-add-current` / `watchlist-item` 語意保留)
2. e2e N4:**mode ternary unmount 契約**(切 mode 元件真卸載;本次絕不引入 hidden-div keep-alive)
3. e2e M7:market 1440x900 無垂直捲動(改版後仍成立,且為 SC-4)
4. 跳轉鏈:handleFlowStockPick(跳 equity + 預選分點)、handleSymbolPick、看泡泡圖 / 回總覽鈕、bubbleFocus 生命週期(CH-1)
5. selection 契約以 `broker_id` 為 key(SC-7 只動顯示字串與比對,不動任何以 id 為 key 的 state/API)
6. net 模式「買超」header 與分隔帶、volume 模式 header(含當沖率)保留
7. 量比門檻 input(預設 1.5、過濾語意)不變
8. watchlist 資料層合約:`neigui.watchlist.v1` shape 不變、deleteGroup 股票退回未分組、addStock 去重
9. 台股配色 Bull=紅 / Bear=綠、semantic tokens
10. 手機版:watchlist 摺疊區、V4/V5 mobile layout 結構(字級 baseline 更新除外)
11. FastAPI / API 契約零改動(本次純前端)

## C. Backward compat / migration

- `neigui.watchlist.v1` shape 不變 → 無 migration。
- 新增 keys:localStorage `neigui.watchlist.width`、`neigui.saved-brokers.v1`;sessionStorage `neigui.session.*`(flows-selected / market-drill / market-expanded / market-breadth-target / market-vr-threshold / market-vr-sort)。舊資料不存在時全部走預設值,壞 JSON 靜默回預設(對齊 loadWatchlist 慣例)。
- e2e testid 相容:`watchlist-add-current`、`watchlist-item*`、market 各卡 root testid(含 breadth root、market-volume-ratio)保留;`market-breadth-row` 移除 — 唯一 caller 是 MarketPage.test.tsx(該紅),e2e M10 未引用(保持綠,R5)。

## D. Out of scope(寫進 docs/next-time.md 不動)

- 群組 rename、群組拖曳排序、自選清單項拖曳排序
- 權證分點頁「點股票跳 equity」(user 未要求)
- OptionsPage / BorrowFeePage 的返回狀態保留
- backend 分點名稱正規化(維持前端 formatter)
- BrokerSearch 選取契約改以 id 為 key(維持名稱 key,只改顯示/比對)

## E. E2E 歸屬(e2e-conventions 判準表)

| Item | 歸屬 | 動作 |
|---|---|---|
| SC-1 | equity.spec E# | 🟢 新 E#(**檔內下一未用號**,現況 E35 已被評分欄排序占用 → 取 E36 起):群組管理開啟 → 建組 → 群組快選直接入組 → 清單顯示於該組;E34 保持綠 |
| SC-2 | visual V1 | 🔴 baseline PNG 更新(`npm run test:update-snapshots`;V4 為 375px mobile 走 <500 檔位,不因 SC-2 動 — R11) |
| SC-3 | equity.spec / visual V1/V4 | 既有 E# 若 assert header/序號 → 🔴 改;V1 baseline 更新;V4 更新歸因 SC-1/SC-3(mobile 版面) |
| SC-4 | market.spec M7/M10 + visual V3/V6 | M7 **保持綠**;M10 **保持綠**(R5:M10 未引用 market-breadth-row,assert 的 breadth-twse/idx-ex-tsmc/market-volume-ratio/門檻 input 全在保留白名單 — M10 紅 = 回歸訊號非預期紅);V3/V6 baseline 更新 |
| SC-5 | market.spec M# | 🟢 新 M11 起(max+1 慣例,退役號 M2/M3/M5/M6 不復用 — R16):點 sector member → mode 切 equity;🔴 既有 spec 若 assert 過熱/冷清 → 移除 |
| SC-6 | market.spec M# | 🔴 既有 spec 若操作排序 toggle → 改點欄位標題(M10 不含此操作,不動);新增排序案例併入 M11 起編號 |
| SC-7 | equity/navigation spec | 🔴 既有 assert 分點名稱字串處同步改格式;E33 **保持綠**(hasText「分點001」為 substring 匹配,新格式仍含該子字串 — R7) |
| SC-8 | navigation.spec N# | 🟢 新 N5(檔內現況 N1-N4,下一未用號 N5 — R4):flows 選分點 → 切 market → 切回 flows 分點仍選定;market 鑽取展開 roundtrip 保留;N4 保持綠 |
| SC-9 | navigation.spec 同上 N# 或獨立 | 🟢 常用分點加入 → 重整後仍在 → 一鍵帶入 |

FAKE_FINMIND fixture:全部沿用既有(無新 dataset);改 fixture 無 → 不需清 `e2e/.cache`(若 e2e 紅再依 skill 清)。

---

## F. Diff 級 spec(Phase 3)

順序:🔵 → **基座 🟢(item 11 broker-name.ts、item 12 useSessionState — 🔴 的必要依賴,先行獨立 commit)** → 🔴 → 其餘 🟢(R13)。每 commit 依三類分離。

### 🔵 純重構(先行,測試不動仍綠)

1. **`lib/broker-name.ts`(新檔)+ 各顯示點接線前置**:僅建立 `formatBrokerLabel(id: string, name: string | null): string` = `${id} ${name?.replace(/-/g, "") ?? ""}`.trim() — 新純函式 + 單測屬 🟢,列在 🟢 節;此節無其他純重構項(不順手重排)。

(評估後本次無真正 🔵 項 — 不為湊類別而造;若 Phase 4 中發現需先抽函式才能改,再以 🔵 commit 補。)

### 🔴 行為改動(先改測試紅 → 實作綠)

2. **`frontend/src/lib/chip-theme.ts`**(SC-2):L18-20 `svgLabelFont` 桌面 1.375rem→1rem;L23-25 `svgLegendFont` 1.25rem→0.875rem。**全 caller 清單(R2)**:chip-kline-svg.tsx L514(OHLC row)/ L535/538/545(MA/BB legend)、chip-inst-bar-svg.tsx L117 + 空資料 L61(InstBar)/ L254 + 空資料 L182(MarginLine)、chip-broker-agg-svg.tsx L76(分點合計 bar)— **全部同縮(預期)** `[auto-default: 分點合計圖同縮 | reason: 同一畫面 overlay 字級一致性;拆函式排除反而製造混雜]`。chip-theme 字級單測鎖新值 = **本 🔴 commit 的 TDD 紅段**(R17,與行為改動同 commit 保 revert 原子性)。visual baseline V1 更新。
3. **`frontend/src/components/ChipBrokersPanel.tsx`**(SC-3):刪賣超 header L441-450;買超 header L404-413 與 volume header L476-485 刪 `#` span;BrokerRow 刪 rank span(L117)與 rank prop;三處 caller 移除 `i+1` 傳遞。**grid template 同步(R3)**:BrokerRow `cls`(L81-83)與 `netHeaderCols`/`volHeaderCols`(L229-232)的 `grid-cols-[22px_28px_1fr_...]` 中 28px 序號 track 全數移除(net/volume、含 `@[400px]` 變體共 8 處)。`ChipBrokersPanel.test.tsx` 中 assert 序號 / 賣超 header 的測試先改(該紅)。
4. **`frontend/src/components/MarketPage.tsx`**(SC-4):上排 grid 改 4 欄 `lg:grid-cols-[4fr_2fr_4fr_3fr]` `[auto-default: 欄比 | reason: 沿用原 4/2/6 節奏,rotation 讓寬給 volume]`;MarketBreadthPanel 以 children/slot 塞入 MarketIndexStrength 卡內底部;刪下排 grid(`market-breadth-row`)。
5. **`frontend/src/components/MarketIndexStrength.tsx`**(SC-4):接受 `breadthSlot?: ReactNode`(或 children),render 於 body 最末(ExTsmc/Contrib 之後,`border-t` 分隔)。
6. **`frontend/src/components/MarketBreadthPanel.tsx`**(SC-4):加 `embedded` 模式(去 section 外框/標題縮小),保留 CountsRow 與漲跌停展開清單行為 + root testid。
7. **`frontend/src/components/MarketSectorRotation.tsx` — 🔴 段**(SC-5 tag 移除):刪 `volRatioFlag` 判定與兩個 flag span(過熱/冷清),**保留 formatRatio(v) 量比數值 span**(R9);測試刪過熱/冷清 assertion(該紅)。
7b. **同檔 — 🟢 段**(SC-5 點擊跳轉,獨立 commit — R8):Props 加 `onSymbolPick`;MembersPanel 成員 tr 加 onClick/Enter(對齊 MarketVolumeRatioPanel L102-114);MarketPage 傳入;🟢 新增點擊測試(先紅)。
8. **`frontend/src/components/MarketVolumeRatioPanel.tsx`**(SC-6):刪 toggle buttons L65-83;sortKey 型別擴為 `"volume_ratio"|"change_rate"|"amount"`;th 量比/漲跌/成交額改 button(onClick 設 sortKey,`aria-sort`);排序邏輯補 amount 分支。既有 toggle 測試改寫(該紅)。
9. **SC-7 顯示點全面接 `formatBrokerLabel`**(枚舉含 R1/R6/R12 補列):
   - `ChipBrokersPanel.tsx`:BrokerRow 顯示 span L122 + aria-label(勾選 L114、泡泡鈕 L134)+ title L120 + hover tooltip L153 **全部同步 formatter**(R12,tooltip 本就是全名顯示處);chip-selected-bar 已選 pill(L368 idToName / L374)同步(R1)
   - `BrokerFilterPopover.tsx`:分點清單顯示同步(R1)
   - `lib/chip-broker-agg-svg.tsx`:分點標籤(L76 一帶)同步(R1;id 來源沿該檔資料列既有欄位,無則自 idToName 傳入)
   - `ChipBubbleView.tsx` TradeList L866(**TradeRow 無 broker_id — 以 visibleTrades name→id lookup 取得,檔內 L230/L301 已有同 pattern,不擴 TradeRow 型別、不動 chip-data 測試 — R14**)、header L345(selectedBrokerName derive 處)、tooltip(`chip-bubble-svg.tsx` L539/551 payload 加 id 或 payload.broker 改存 formatted 字串 — 實作時擇不動 onBubbleClick name-key 契約的作法)
   - `BrokerSearch.tsx`:AggBroker 聚合補 broker_id(trades 有);顯示與 highlightMatch 用 formatted label;filter 比對 id+name;`onChange` 仍回傳名稱(白名單 5 / out-of-scope);**value echo 回填 input 也走 formatter(name→id lookup),與 R6 的格式一致性精神對齊(R15)**
   - `WarrantFlowPanel.tsx` L272 aria-label / L276 顯示(b.broker_id + b.broker_name → formatter)
   - `BrokerFlowsPanel.tsx` L63 query 回填 / L133 dropdown / L160-164 badge / **L46 selectedEcho(R6:echo 與 setQuery 格式必須一致,否則 refocus 誤啟搜尋 — 補 echo-refocus 測試案例)** 全走 formatter
   - 各元件測試中名稱 / aria-label assertion 同步改(該紅)
10. **`frontend/src/components/WatchlistSidebar.tsx` — 🔴 段**(SC-1 c/d/e,R8 拆分):移組 select → 可見 dropdown 選單鈕;底部建立 form 移入「管理群組」popover(含刪除);移除兩處數量(L189-191/L235-237)。`WatchlistSidebar.test.tsx` 對 select/建立 form 的互動 assertion 先改(該紅);testid `watchlist-add-current`/`watchlist-group-input`/`watchlist-create-group` 語意保留(位置可移)。
10b. **同檔 — 🟢 段**(SC-1 a/b,獨立 commit):調寬把手 + clamp(180-320)+ persist `neigui.watchlist.width`;加入自選主鈕旁群組快選(`addStock` 第 4 參數);🟢 測試先紅。**實作前先呼叫 `frontend-design` + `bencium-controlled-ux-designer`**(user 指示,UIUX 決策以 /auto 契約 auto-default 記錄)。

### 🟢 新功能(紅測試先行)

11. **`frontend/src/lib/broker-name.ts` + `broker-name.test.ts`**(SC-7 基座):formatter 純函式 + 邊界測試(null name / 帶 dash / 多 dash / 空 id)。
12. **`frontend/src/hooks/useSessionState.ts` + 測試**(SC-8 基座):`useSessionState<T>(key, initial, opts?)` — sessionStorage JSON persist,壞 JSON 回 initial;支援 Set 序列化(serialize/deserialize opts)。**測試隔離(R10)**:hook 測試與四個接線元件測試檔一律 `afterEach` 清 sessionStorage(jsdom 同檔共享、RTL cleanup 不清 storage)。
13. **SC-8 接線**:`BrokerFlowsPanel` selected(+回填 query 顯示字);`MarketSectorRotation` expanded/drill;`MarketBreadthPanel` target;`MarketVolumeRatioPanel` threshold/sortKey → 各改用 useSessionState。各元件測試補「remount 後狀態保留」案例。
14. **`frontend/src/lib/saved-brokers.ts` + 測試 + BrokerFlowsPanel UI**(SC-9):load/save/add/remove(樣板 bubble-blocklist);UI = 選定徽章旁星號 toggle + 常用分點 chips 列(點選即帶入查詢,等同 dropdown pick)。
15. **e2e**:E36(群組直加入,取檔內下一未用號)、M#(sector member 跳轉 / 排序標題,下一未用號)、N5(SC-8 roundtrip + SC-9 persist);visual baseline `npm run test:update-snapshots`(M10 不動 — R5)。
16. **changelog `frontend/src/lib/changelog.ts`**:MINOR bump(新功能+UX 大改同 ship event 合併一 entry;寫 entry 前讀 `changelog-conventions`)。

### 既有測試預期紅名單(該紅)

- `ChipBrokersPanel.test.tsx`(序號/賣超 header/名稱格式)
- `WatchlistSidebar.test.tsx`(select→dropdown、建立 form 移位、數量移除)
- `MarketSectorRotation.test.tsx`(過熱/冷清)
- `MarketVolumeRatioPanel.test.tsx`(toggle→th 排序)
- `MarketPage.test.tsx`(breadth-row 結構)
- `ChipBubbleView.test.tsx` / `BrokerSearch.test.tsx` / `WarrantFlowPanel.test.tsx` / `BrokerFlowsPanel.test.tsx` / `BrokerFilterPopover.test.tsx`(名稱格式 / aria-label assertion)
- `MarketBreadthPanel.test.tsx`:僅若 assert section 外框/標題結構的案例該紅(embedded 化);CountsRow/展開清單行為案例不該紅(逐案判,R7)
- e2e:visual V1/V3/V4/V6 baselines(V4 歸因 SC-1/SC-3 — R11)
- **不該紅(R5/R7 補全)**:watchlist.test.ts(資料層)、App.test.tsx(跳轉/unmount)、MarketIndexStrength.test.tsx(slot 為新增 prop,既有案例不動)、MarketColdLoad / MarketUniverseBanner / MarketCapTiers / useMarketSnapshot / market-api / market-format / market-types 測試、e2e N4、E33(substring 匹配)、E34、M1、M4、M7、**M10**、M8、M9、V2、V5、backend 全部

### 執行期修訂記錄(Phase 4)

- **R1 部分不成立**:`chip-broker-agg-svg.tsx` L76 的 label 實為「分點 (N)」聚合標籤(ChipKlineChart L605 傳入),非分點名稱 — 該檔無 SC-7 接線點,rejected with evidence。BubbleBlocklistPopover(R1 未列)實有分點名顯示,已補接。
- **M9 該紅更正**:M9 L113 assert `data-flag="hot"` 屬 SC-5 tag 移除的該紅點(spec E2E 表 SC-5 列優先於 R7 的「M9 不該紅」歸類)— 改為 assert 量比數值 `1.67x` + `[data-flag]` count 0。
- **e2e 編號落點**:E36(群組快選)、M11(成員列跳轉)、M12(欄位標題排序)、N5(SC-8 roundtrip)、N6(SC-9 常用分點)。
- **SC-7 fixture 副作用**:vitest fixture 名稱含英文 dash(Buyer-0)也被 formatter 去 dash(Buyer0)— 真實資料 dash 僅出現在 directory 分隔語意,接受;相關 assertion 已同步。
- **e2e 名稱格式該紅實收**:E14(展開 aria 帶 id)、E23(查看連結)、E28(勾選 aria)、E32(同批重跑即綠,無 spec 改動)。

### 不確定點(實作時驗證,偏離即回 spec 修訂)

- ChipBubbleView selectedBrokerName 的 derive 路徑與 tooltip DOM 寫入點(L211)以 id 取得方式 →(已解:payload 加 brokerId)
- MarketIndexStrength 卡在塞入 breadth 後 1440x900 高度是否仍無捲動 →(已驗:real-env gridBottom=900,M7 綠)
- flows e2e 具體落檔 →(已解:navigation.spec N5/N6)

### Phase 5-7 收斂記錄

- Phase 5 review(general-purpose reviewer,medium):0 P0/P1、2 P2 — P2-1(BrokerSearch echo 洗輸入)已修(4677364);P2-2(歸組選單長清單底部裁切)accepted 記 next-time。
- Phase 6 自動化:pytest 682 / ruff 0 / tsc 0 / vitest 940 / build 綠;e2e 58 passed(E10/E25 全套紅單獨綠 = 負載型 flake,記 next-time);visual baselines Win32 skip → push 後 GitHub e2e-update-snapshots workflow。
- Phase 7 真實環境:市場單頁量化驗證(無頁捲動 / breadth 內嵌 / 0 tag)、SC-5 成員跳轉、SC-8 flows+market roundtrip(含帶 dash 分點 echo guard)、SC-9 星號+chips、SC-1 管理/歸組/調寬(210→290 持久化)、白名單 8 刪組退回實證;console 0 errors。截圖 docs/specs/batch-ui-polish/screenshots/。

self_review_head: 467736496071f5e7d206e52027e9f2336670b83c
