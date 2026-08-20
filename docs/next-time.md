# next-time.md — 全專案順手事項 backlog(單一收集點)

> 各流程(/feat /bug /mod /refactor /perf)的「順手想改但不在本次 scope」統一寫這裡,commit 前 cat 一次。
> 2026-07-06 起集中於此(原散落 docs/specs/*/next-time.md 三檔已併入);subagent 模式下由 main agent dispatch 前代查。
> 條目做完就刪;defer 的條目要帶「觸發重評估的條件」。

---

## From /feat bubble-streak-screenshot(2026-08-13)

- **bubble_window payload slim 化**:高量股(3481)days=20 未壓縮 18.1MB / 206k rows、
  days=10 仍 12.8MB — 超過 design 門檻 10MB(gzip 後 wire ~2MB 級,當下可用)。
  preset 降檔救不了(10 日仍超標),正解 = payload slim(候選:trades 改 columnar
  arrays(欄名不逐 row 重複,估 -60%)/ 後端依 (price) 截 top-N broker)。
  觸發重評估:user 抱怨多日切換慢、或行動網路場景反映、或第二個大 payload 端點出現時。
- **1280px 泡泡圖 header 中欄文字折行**(P2 視覺,功能無損):lg grid 中欄在 1280 寬
  只剩 ~79px,「點泡泡或搜尋分點加入比較」與「近 N 日共 X 個分點」各折 2 行,header
  106px(vs 1440 的 82px);圖區仍有 63% 視高。候選 = 中欄文字在窄寬時縮短 / preset
  鈕再緊湊。觸發重評估:user 在 1280 級螢幕反映 header 佔高、或下次動 bubble header 佈局時。

## From 🔴 fix(backend) clock 時區修復(2026-08-11)

- (原「+08:00 時區常數兩份」條目已於 2026-08-20 收割刪除:`trading_session.TPE_TZ = clock.TAIPEI` 別名,定義只剩一份)

## From react-doctor 掃描(2026-08-11;error ×5 + 安全 warning 批已同日修畢,49→61 分,餘下列)

> 2026-08-20 重掃:**62 分,0 error / 74 warning**,主體與下列裁定一致。前次未列的小類(待裁,皆非 bug):`js-combine-iterations ×4`(WarrantSelector:47/70、WatchlistSidebar:284、chip-bubble-daymarks-svg:166)、`no-reset-all-state-on-prop-change ×2`(WarrantFlowPanel:44、RangeSelector:54)、`rerender-state-only-in-handlers`(WarrantColumnMenu:17)、`no-derived-useState`(WatchlistSidebar:54)、`useSessionState.ts:38` 被算進 pass-data-to-parent(hook 設計本意,判誤報)。`no-adjust-state-on-prop-change` 從 13 → 17(新增 BorrowFeeStockFilter:38 / BrokerSearch:131 / WarrantFlowPanel:44 / ChipBubbleView:469)。

- **ChipBubbleView prop→state 同步鏈**(no-adjust-state-on-prop-change ×13 集中 118–170 行 + no-derived-state ×2 + no-effect-chain):symbol reset effect + focusRequest effect 的既有設計,行為有測試鎖住;重構屬 /refactor 級(state 派生化 or key-based remount)。觸發:該區再出 stale-state bug、或 ChipBubbleView 下次大改時一併評。
- **effect 回推資料給 parent**(`BrokerSearch.tsx:135` / `ChipKlineChart.tsx:258`,no-pass-data-to-parent 系):反轉資料流 anti-pattern,改法 = state 提升或 callback 在事件點直呼。觸發:任一處要加新回推欄位時先還債。
- **ChipBrokersPanel 巢狀互動列**(html-no-nested-interactive,~132 行):整列 role=button + 內層看泡泡圖鈕 + checkbox 三方事件模型,靠 stopPropagation 守 double-toggle 且有 e2e(equity.spec.ts broker-row-bubble-btn)鎖行為;2026-08-11 批評估後判改 sibling 結構風險不成比例,保留。觸發:該列事件模型下次重構時一併。
- 其餘殘留 warning 判**不追**(2026-08-11 拍板):giant-component / only-export-components(SVG renderer lib 檔誤報)、bubble overlay click 無鍵盤 handler(hitTest 無鍵盤語意,combobox 已是替代路徑)、index-as-key ×4(逐條查無穩定唯一 id,index 即語意身分)、no-autofocus / prefer-html-dialog(刻意 UX)。再掃分數波動先對照本節,不重開。

## From /mod borrow-fee-layout(2026-07-28)

- (原「券差統計表 row 點擊帶入單檔篩選」條目已由 mod/borrow-fee-polish 解決刪除,2026-07-28:user 主動要求,statRow click/Enter/Space → setSelectedStock,combobox echo 自動同步)
- **券差統計表加市場 badge / 費率 / 次數欄或欄頭排序**:本次依原句只做 代號/名稱/張數 固定排序。觸發重評估:user 要求更多維度時。
- **本月維度全市場統計表**(month_shares 全集):目前只有當日;payload 已有資料。觸發重評估:user 要月累計 overview 時。

## From /mod batch-ui-polish(2026-07-21)

- **E25/E10 型負載 flake — 殘餘面收斂到 SymbolSearch option 步**(2026-07-21 收割更新):badge 時序 race 已由 chore/next-time-harvest-0721 根治(route 固定 1500ms delay 改事件同步 gate,badge 可見窗不再受機器負載影響;無負載 repeat×5 綠)。今日兩紅實際失敗點都在 `getByRole("option")` 15s 0 筆 — 發生於並行跑全套 gate 的高負載窗,無負載即綠,與 E10 既有「SymbolSearch dropdown 高負載」記錄同根。2026-08-20 無負載 `equity.spec.ts --repeat-each=5` 215 passed 全綠,結論不變。觸發重評估:非自造負載情境下再紅時,查 `/api/symbols/all` query 在 vite dev proxy 高負載下的 resolve 時序(app 層 prefetch 或 spec 層等 dropdown loading 態收斂)。
- **自選歸組選單長清單底部裁切**(Phase 5 review P2-2):watchlist-assign-menu absolute top-full 在 overflow 容器內,底部項目選單被裁;短清單常態不受影響。觸發重評估:user 回報或清單普遍 >15 檔時,改 bottom-full 翻轉或 portal 定位。

- **自選分組 rename**:管理分組面板只有建立/刪除;rename 需資料層新函式(watchlist.ts 無)+ UI。觸發重評估:user 抱怨改名要刪掉重建時。
- (原「BrokerSearch 選取契約改以 broker_id 為 key」條目已由 feat/bubble-multi-broker 解決刪除,2026-07-27:selection 域重構為多選時一併改 id key — 聚合 / onPick / 下拉已選標記全走 broker_id,同名不同 id 分列)
- **權證分點頁點股票跳 equity**:四頁中唯一沒有跳轉鏈的頁(user 本輪未要求)。觸發重評估:user 提出。

## From /feat broker-daily-flows(2026-07-21)

> 2026-07-21 user 指示:以下兩條 + `_run_once` 複本組已獨立成 `docs/specs/broker-flows-followups/spec.md`(F-1/F-2/F-3),由新 session 處理;做完刪本節條目 + 對應 spec 節。

- (原「[→ spec F-1] 新開分點 24h cache 窗內查無」條目已由 mod/broker-directory-refresh 解決刪除,2026-07-21:`get_daily_flows(refresh=True)` 目錄一併強制重抓,dedup key `broker_directory_r{0,1}`;search_traders 不長 refresh 面)
- (原「[→ spec F-2] 分點搜尋 50 筆上限無截斷提示」條目已由 mod/trader-search-truncation 解決刪除,2026-07-21:shape 改 `{hits, total}`(user 拍板 (a)),dropdown 尾端非 option 提示列;本節三條全數收割,spec `broker-flows-followups` 全部結案)

## From /mod chip-major-lazy-window Phase 2 probe(2026-07-16)

- (原「prd cancel 鏈斷在 Vercel rewrite 層」條目已由 fix/prd-cancel-propagation 解決刪除,2026-07-17:prd 正式域名直連 Railway,abort 直達;cancel-chain skill 第五環已翻新)
- (原「prd ~0.7-1.2 req/s 常駐 FinMind 消耗」條目已由 /bug prd-idle-finmind-drain 結案刪除,2026-07-17:誤歸因 — 實為殭屍 fan-out(已修)+ 瀏覽/probe 活動;零活動時 user_count 實測連續 57 分鐘平零,app 無常駐 FinMind 迴圈;tick_snapshot / user_info 均不計入配額,判讀方法沉澱至 skill `finmind-conventions`)
- (原「EOD retry 放大器」條目已由 fix/eod-retry-backoff 解決刪除,2026-07-20:失敗 task 保留佔位 + `_EOD_RETRY_BACKOFF_SEC` 60s 冷卻窗口,窗口內請求重用失敗結果不重觸發;`failure_not_pinned` 契約修訂為「窗口過期後重算」。402 情境未在 prd 實證,由確定性測試鎖行為)
- **EOD backoff 佔位 entry 的微量殘留**(fix/eod-retry-backoff 拍板接受):失敗 task 保留在 `_eod_background` + `_eod_backoff_until` 至下一請求替換;若當日失敗後再無同 key 請求,entry 殘留至 process 重啟(每日至多數個 dict entry)。觸發重評估:長跑 server 記憶體被質疑、或第三個模組級 registry 需要統一清理策略時
- **「失敗即刪 → 高頻重觸發」同構檢查**:`routes/symbols.py::_load_task`(失敗後下一請求重試,無 backoff)同結構但無 15s poll 放大器,係數低不修。觸發重評估:任何高頻 poll 的前端 hook 接上 symbols 或其他「失敗自刪」task registry 時

## From /perf options-market-load(2026-07-20)

- **窗外孤兒 txo_daily_* 殘檔 + cache 目錄整體無 retention**:raw→slim 遷移只涵蓋當前 250 日 window;更舊 raw 檔永不被讀也不被刪。**2026-08-20 本機量測**:目錄共 22,589 檔 / 498MB — 檔數由 20,719 個 `<symbol>_<date>_major.json`(合計僅 1.5MB)撐起,體積由 210 個 `<symbol>_<date>_bubble.json`(225MB)撐起;txo_daily 孤兒 33 檔 27MB、txo_slim 250 檔 21MB。檔數已破 5k(`_cleanup_flow_caches` iterdir 條目的觸發門檻同時成立,但實測 6 個 flow 檔、冷聚合頻率低,仍不值得節流)。觸發重評估:prd 磁碟被質疑、或第三個 per-day prefix 需統一 retention 時(參考 warrant_flow `_cleanup_flow_caches` 樣板;bubble per-day 是第一優先)
- **pcr per-day 預聚合 / window in-memory memo**(S1+S2 達標後不做):再往下砍要動 parse 函式簽名或吃記憶體。觸發重評估:prd 實測 stale wall 仍 >2s、或 window 拉長超過 250 日時
- **review P2×2(0 P0/P1,接受入庫)**:(1) 歷史日若被永凍為「有 rows 但全零 OI」(僅單次早晨到訪且當日不再被訪問才會發生),slim 下該日從 hit_rate 的 `oi_by_trading_day` 消失 → t_minus_1 回溯改抓 T-2(raw 版是 parse 回 None 丟樣本)— 兩者皆既有降級路徑,差異限單一 hit_rate 樣本;觸發重評估:hit_rate 數字被質疑、或加「全零日 sentinel」慣例時。(2) 已於 2026-08-20 補 `test_fetch_strike_volume_concurrent_refresh_does_not_dedup_into_non_refresh`(mutation 拔 `_r{}` 實測轉紅)

## From /bug prd-cancel-propagation(2026-07-17)

- **prd 域名判定寫死 `neigui.vercel.app`**(`frontend/src/lib/api-base.ts`):未來若綁自訂網域,PRD_HOSTNAME 沒同步會**靜默**回退 rewrite 路徑 — 站能用但殭屍 fan-out 回歸,不易察覺。觸發:綁任何新網域時同步 api-base.ts + vercel.json
- **preview deploy(`neigui-git-*.vercel.app`)無 cancel 傳導**(設計取捨):preview origin 不在 CORS 名單,走 rewrite fallback。要修的話 backend CORS 改 `allow_origin_regex` 收 neigui preview pattern。觸發:preview 環境重度使用、或在 preview 上排查配額異常時

## From /feat warrant-iv-drift(2026-07-11)

- **IV drift「rising」側受市場 vol regime 混淆**(2026-07-11 真實 60 日校準:市場整體 IV 上行 → rel 右尾肥,常數 0.30 下 rising 仍標 10.3%;declining 側 1.2% 選擇性 OK):要更乾淨需 cross-sectional de-mean(rel 減去全市場中位數),屬 detect 演算法 design amend。觸發重評估:user 反映 rising 標記太多、或市場轉入 IV 下行 regime 換 declining 側爆量時

- (原「forceRefreshRef pattern 第 20 個複本門檻」條目已由 refactor/force-refresh-query 收割刪除,2026-07-17:18 個 hook 收斂到 `useForceRefreshQuery`,排除 useBrokerHistory / useChipData 兩個異形樣板)
- (原「forceRefresh 旗標時序 race」條目已由 fix/force-refresh-race 解決刪除,2026-07-17:helper 與 useChipData 收 cancel-before-refetch,紅測試實證 in-flight dedupe 機制;**useBrokerHistory 第 3 修點為誤報** — diagnostic 實證竊取窗口是 sub-microtask,使用者事件不可達,不修)
- (原「e2e E10 負載型 flake」條目已由 feat/warrant-flow-net-history 收割,2026-07-18:同日再紅 ×2(全套紅/單獨綠)觸發重評估條件 → option timeout 放寬至 15s;Enter 路徑原已採用。再紅升級方向 = 查 SymbolSearch dropdown 在高負載下的重渲染節流)
- (原「tests/test_finmind_realtime.py 在機器高負載下 flaky」條目已由 fix/test-finmind-realtime-flake 解決刪除,2026-07-19:root cause 非 timeout 數值本身 — 負載超時只是第一張骨牌,真凶是模組級 task registry(finmind_realtime._inflight/_eod_background、market_breadth._inflight、market_universe._inflight)跨 event loop 殘留,pytest-asyncio teardown 不 cancel pending task → 同 key 連環炸 8-19 個。修法 = conftest autouse 清 registry + 殺掉 C3b prices prefetch 漏網真實網路呼叫(檔跑速 21.9s→2.6s)+ 兩個 cancel 測試改事件同步;高負載模擬(雙全套並行 ×2 輪 + 單檔 ×10)全綠,反向驗證紅測試如期紅回)

## From /feat warrant-broker-flow(2026-07-14)

- (原「equity tab 鈕樣板第 4 份複本」條目已由 feat/broker-daily-flows 收割刪除,2026-07-21:第 5 tab 觸發,EQUITY_TABS config + map 落地(commit a6eaf76);hidden div 內容各異維持列舉)
- (原「backend 候選日回退 + inflight dedup + date 驗證複本組」條目已由 refactor/run-once-dedup 收割刪除,2026-07-21:實收 9 份模組級 `_run_once` + FinMindClient method 版(spec F-3 點名 5 份,實測 10 份)收斂至 `utils/concurrency.run_once`,各模組保留薄 wrapper 名(測試與 warrant_flow_history 跨模組直呼依賴);date 驗證 3 處收斂至 `utils/validation.parse_date_param`,錯誤碼/嚴格度以參數保留。**候選日回退複本(`_candidate_dates` broker_flows/warrant_flow 同構)未收** — 簽名不同(date 起點 vs param 解析)且僅 2 份,未達收斂門檻;觸發:第 3 份出現時)
- **flow 對映用「當下快照」查歷史候選日**:權證在 (d, 快照 as_of] 間到期下市 → 該權證當日成交不入統計、計入 unmapped_count(訊號在但不歸屬)。預設查詢(d = 快照 as_of)零影響;顯式舊 date / 深度回退才失真。修法 = 快照歷史化(per-date terms archive),v1 out of scope。觸發重評估:user 用顯式 date 查歷史流向、或 unmapped_count 異常飆高時
- **`_cleanup_flow_caches` 每次冷聚合跑一次全目錄 iterdir**:目前冷聚合本身 200 req 網路成本 >> 1 次 iterdir,不值得節流;cache 目錄檔案數若破萬再加 last-cleanup 時戳門檻。觸發重評估:chip cache 目錄檔案數 >5k 或 real-env 量到 cleanup 佔時
- (原「[需 user 拍板] flow 淨買賣超欄恆退化」條目已由 mod/warrant-flow-external-net 解決刪除,2026-07-18:拍板 (b) 外部淨額口徑 = −(發行商造市 HO seat net),12 家 alias 白名單 + seat 精確名對映,無法對映 → null;probe 實證 27/27 單一命中)
- (原「中信/元富/兆豐 HO seat 精確名未經真實樣本驗證」R-1 條目已由 fix/warrant-ho-alias-verify 實測收割,2026-07-18:中國信託 6160 / 兆豐 7000 與推定相符零改動;元富因 2026-04-06 併入台新證券(存續),HO 實為 9B00「台新證券」→ alias 補「台新」,real-env 三家 external_net 皆非 null。已知殘餘邊角(review P2 接受):顯式 date < 2026-04-06 查歷史時,元富 brand 權證上的台新外部 seat 會被誤歸 HO — 該路徑本已因「當下快照對映歷史候選日」條標記失真,不另做日期條件 alias)
- **flow warm 路徑每次查詢付 1 個 T+0 dump request(~2s,44k rows)**:自適應設計的常數成本;若嫌慢,候選 = 當日空 dump 短 TTL(如 30 分)cache。觸發重評估:user 抱怨 tab 切換慢、或午後高頻使用場景出現

## From /mod batch-ui-update(2026-07-21)

- (原「分點搜尋 combobox 的 a11y 缺口」條目已由 chore/next-time-harvest-0721 收割刪除,2026-07-21:aria-activedescendant + role=combobox 全套 + 截斷文案鏡射 sr-only `role="status"`;vitest 4 條 + e2e E37 鍵盤導航真 browser 驗證,changelog 0.40.1)
- (原「`warrant_flow._run_once` 薄 wrapper 保留前提已消失」條目已由 chore/next-time-harvest-0721 收割刪除,2026-07-21:內聯回 `run_once(_inflight, ...)` 直呼,wrapper 與閒置 typing import 一併移除)
- **權證流通在外比率資料源調查結論**(Q2 拍板本輪擱置):TWSE OpenAPI(t187ap37_L 僅發行單位數量、t187ap42_L 僅成交值/張)與 TPEx OpenAPI(tpex_warrant 有 Original/FollowOn/Cancellation 累計,仍為發行面)**皆無每日流通在外(扣發行人庫存)**;真實來源 = MOPS 發行人每日申報(無公開批次 JSON)或券商權證網(元大 warrantwin 等,非官方源)。觸發重評估:user 再提流通在外需求時,先評 MOPS scraping 穩定性 vs 券商網 ToS

## From /refactor run-once-dedup(2026-07-21)

- **date query 驗證嚴格度/錯誤碼字面統一(/mod 候選)**:`parse_date_param` 現以參數保留三處歷史差異。2026-08-20 FAKE 環境實打對照(`20260721` / `2026-13-01` / `2026-7-1` / `abc`):warrants flow 全 400 `bad_date`;daytrade-fee 後三者 400 `bad_date`、**`20260721` 原 503 洩漏 ValueError 字串 → 已修**(route 驗完丟原始字串給 service,`target[:7]` 切壞;改傳正規化 isoformat,現 200 as_of 2026-07-21);broker daily-flows 後三者 400 `invalid_date`、`20260721` 正常進 service(start 以 parsed date 算,無切片)。統一(全 strict + 單一錯誤碼)= 對外行為改動,要同步前端 `lib/api.ts` 與 contract tests。觸發重評估:任一 date 參數 endpoint 新增時、或前端要對 date 錯誤做特化文案時

## From /mod warrant-iv-redesign(2026-07-16)

- (原「drift label 中文對映第 2 份複本」條目已於 2026-07-21 標 moot 移除 [auto-default: 判 moot | reason: WarrantIvHistory.tsx 已不存在(warrant-iv-redesign 後續改版移除),全 repo 僅剩 warrant-columns.tsx `DRIFT_TEXT` 單一份,無複本可合併])

## From /mod warrant-selector-table(2026-07-16)

- **原生 `<select>` 樣式第 2 份複本**(OptionsHeader.tsx 合約下拉 vs WarrantSelector.tsx 發行商下拉,border-line/bg-bg/cursor-pointer 同構、細節微異):第三份 select 出現時抽共用 className util 或 ui/select 元件。觸發重評估:第三個原生 select 出現時

## From /mod warrant-ux-feedback(2026-07-15)

- (原「Popover 面板骨架第 2 份複本」條目已於 2026-08-20 標 moot 移除:`ui/PopoverPanel.tsx` 已存在且 BrokerFilterPopover / WarrantColumnMenu / BubbleBlocklistPopover 三者皆用,條件早已成立並完成)
- **number spinner 隱藏 CSS 第 2 份複本**(RangeSelector / ui/NumberField 的 `[appearance:textfield]` 三連 class):第三份出現時抽共用 className util。觸發重評估:第三處要隱藏原生 spinner 時

## From /feat daytrade-borrow-fee(2026-07-11)

- **「重新整理」按鈕 JSX 三份重複**(App.tsx / OptionsHeader.tsx / BorrowFeePage.tsx,含 SVG spinner + aria-busy + className 逐行同構):抽共用 `RefreshButton` 元件。觸發重評估:第四個複本出現、或改按鈕樣式/a11y 屬性時

## From /mod borrow-fee-stock-filter(2026-07-11)

- **combobox pattern 已 4 份**(SymbolSearch / BorrowFeeStockFilter / BrokerSearch / BrokerFlowsPanel,2026-08-20 grep `role="listbox"`):「第三個出現」門檻已成立,但抽共用是 M 級 /refactor(四者鍵盤語意、截斷提示列、aria-activedescendant 各異,e2e E37 鎖 BrokerSearch),非順手活。觸發:下次動任一 combobox 行為時以 /refactor 立案,或第 5 個出現時必做

## From brainstorm 券差查詢 / 權證選擇器(2026-07-08)

- **券差表點代號跳 equity 分析**:券差 tab 的 stock_id 可連到 equity mode 該股籌碼頁(跨 mode 導航目前無先例,需設計 mode+symbol 的 state 傳遞)。(2026-07-21 重評估 [auto-default: 維持 defer | reason: 觸發條件(券差 /feat 完成)已成立,但跨 mode 導航是 user-visible 新功能,需 UX 設計拍板 + e2e,不屬順手收割範圍];與「權證分點頁點股票跳 equity」同批處理較划算。觸發重評估:user 提出任一跨 mode 跳轉需求時)
- **TWSE MI_INDEX `type=0999` 牛熊證與認售 type 枚舉**若 S-1 spike 發現牛熊證需求自然浮現,v2 再評(TPEx 對應 wcb/wxy 端點已知)。觸發重評估:user 提到牛熊證時

## From harness review(2026-07-06,12-agent 體檢;2026-07-19 全批拍板收割)

2026-07-19 一次拍板做/緩/砍並落地:**已做** = 自我保護 hook(protect-harness.py,ask 不 deny,Write|Edit + shell 雙面)、pre_push fail-closed 補洞(tracked 缺檔 / 空 verify 需 `allow_empty_verify`)、mod.md Phase 3 刪誤導句、4 agent location schema 統一 `{file, section?}` + cross-round 條款補齊、`scripts/sync-harness-mirror.py`(--check/--fix,首跑即揪出 5 個舊漂移檔)、/chore 輕量入口。**已被先前工作順路做掉** = 鐵則 G 覆寫條款、perf.md Phase 1 auto-verify、feat.md Phase 6 infra_fail。**砍** = 條件式 e2e 進機讀 gate(A 案拍板:e2e 歸屬是語意判斷機器判不了,維持 pre_push 不跑 e2e;殘餘風險由 /chore 檔第 3 步「e2e 判準檢查」補)。剩餘:

(剩餘 5 條(1 待 user 動手 + 4 緩)已於 2026-07-27 user 指示清理 — backlog 只留近期工程 /
review 產生項。4 條 [緩] 各帶「事故再發」觸發條件,再發時依 git 歷史重立案;
`permissions.deny` 加 `Read(**/.env)` 一併撤列管 — 要做仍是一分鐘,deny JSON 見 git 歷史本節。)

## From /feat options-page-v2(2026-07-07)

- (原「`parse_institutional` 的 `day_change` 欄位恆 0」條目已由 chore/next-time-harvest 解決刪除,2026-07-20:紅測試(欄位不得存在)先行,backend parser + options-types.ts InstitutionalSide + 兩側測試 fixture 同步移除;前端自 options-page-v2 起即零讀取者)
- (原「`finmind_realtime._run_once` 測試層跨 event loop 污染」條目已由 fix/test-finmind-realtime-flake 解決刪除,2026-07-19;其「_inflight 自清 fixture 分散 5 處集中 conftest」留尾巴亦由 chore/next-time-harvest 收割,2026-07-20:實收 8 模組(warrant*/daytrade_fee/industry_chain/warrant_flow 含 setattr({}) 回魂 pattern 一併消除),「新增模組級 task registry 必掛進 conftest fixture」規則已寫進 conftest docstring)
- **fmtSigned 已 3 份、三種格式**(2026-08-20 grep 觸發成立):OptionsNetTable `+12,345` / `−12,345`(Unicode minus、0 → "0")、options-range-svg ≥1000 縮寫 `+12.3k`、**ChipKlineChart.tsx:363 區域 arrow** `+12,345` / `-12,345`(ASCII 負號、0 → "0" 無號、`en-US` locale)。合併必動至少一邊顯示(負號字元 / 縮寫)= mod 不是 refactor;需先拍板:統一負號字元(Unicode vs ASCII)與是否縮寫,再抽 `lib/format.ts` 帶 `{abbrev}` 參數。觸發:user 拍板格式、或第 4 份出現時(其餘 4 條 P2 reuse 已由該分支收割:fmtPct → lib/options-format、距現價 → maxPainDistance、futures 聚合 → institutions 參數、RangeMapSvg hoist)

## From /perf cold-start(2026-07-07)

- (原「`routes/symbols.py::load_symbols` 未走 FinMind 接入慣例」條目已由 chore/next-time-harvest-0721 收割刪除,2026-07-21:改走 per-module `get_finmind()` wrap + `client._get`(TokenBucket / singleton 隨之生效),FAKE 與 production 共用 parse 抽 `_dedup_rows`;新 seam characterization 測試 ×2 鎖住既有契約)

(原「From /mod chip-bubble-intraday-overlay」P2/P3 整段已由 refactor/chip-bubble-p3-harvest 收割刪除,2026-07-19:F-P3-8/9/10/13/14/15 + F-P2-4 + F-P3-16~19 全收;F-P3-20 moot — useChipIntraday 已於 force-refresh-query 收割改寫,forceRefreshRef 不存在)

## From /mod bubble-chip-ux(2026-07-02)

Defer 的 3 個 review finding(皆 PLAUSIBLE — pushed back,各帶重評估條件):

- **Brush band `<rect>` dedup**(`chip-bubble-svg.tsx` L738-763):drag phase vs persistent phase 兩塊語意明確,合併 helper 需多帶 flag。**觸發重評估:加第三個 phase(如 hover-preview)時**
- **Header 3-level 巢狀 ternary**(`ChipBubbleView.tsx` L213-235):三分支 flat,抽 component 只是搬複雜度。**觸發重評估:分支超過 4 個時**
- **Broker totals 4 span 重複結構**(`ChipBubbleView.tsx` L234-250):穩定欄位,config+map 引入間接性。**觸發重評估:加第 5 欄或 responsive 隱藏欄位時**

其他:
- (原「E2E spec 補充」條目已由 chore/bubble-chip-ux-e2e 補課刪除,2026-07-20:E23-E29 七條齊上 — A2 跳轉鏈 / A3 totals 手算資料級 / A5 loading badge(route delay)/ B2+B3 anti-CLS 常駐 / B1 整列可點 + checkbox 不 double-toggle(sr-only force,E18 前例)/ A1 brush 拖曳端到端;fixture 手算基準 3 分點 × 買100/賣80 @1100)
- (原「Visual baseline 更新」條目已由 e2e-update-snapshots workflow(PR #47)收割刪除,2026-07-20:equity-2330 收 C4 幾何 + options-top 收 options-page-v2 漂移 + V4-V6 響應式三張首生成,變更圖已人眼比對。當時 workflow 開 PR 被 repo 設定擋、手動代開 PR #47;2026-07-20 user 已開啟 Actions「create and approve pull requests」權限(default token 維持 read),下次跑該 workflow 應恢復自動開 PR — 若又 failure 在 create-pull-request 步驟,先查 `gh api repos/loger-w/neigui/actions/permissions/workflow`)

## From /perf snapshot-hot-path(2026-07-02)

- **增量 fetch 消滅每日冷啟動**:日期翻頁 → cache key 變 → 全 window 128 次 FinMind 重抓;可重用昨日 window 檔補缺日(需重設計 cache key)。先評估:冷啟動只有每日第一個 request 付,已不卡其他 endpoint
- **recompute 期間單 component aggregation 殘餘 ~0.9s loop stall**(每日一次):若要壓,extract/aggregate 純函式 to_thread(純 Python 在 thread 每 5ms 讓 GIL)。CP 值低,擱置
- **orjson**:若 parse 還要更快(4.2s → ~1s)換 `orjson.loads` per chunk。目前不值得加 dep
- `_read_cache`/`_write_cache`(單文件版)服務小檔 — 若小檔長成大檔,套 chunked 樣板

## From /bug sector-override-phantom(2026-07-02)

- (原「fixtures/TaiwanStockInfo.json 含不存在的『金融保險業』category」條目已由 chore/next-time-harvest 解決刪除,2026-07-20:2412 校正為真實「通信網路業」,功能性 e2e 50 passed;V3/V6 visual baseline 因 heatmap 分組改變待 e2e-update-snapshots workflow 重生)

## From /bug mcclellan-scaling(2026-07-02)

(整節已於 2026-07-20 標 moot 移除 [auto-default: 判 moot | reason: McClellan 功能已由 mod/market-today-only 今日三卡改版整組退役,backend/frontend 零殘留;spec §6.3 公式文字與 thrust 閾值校準均指向已不存在的功能]。market-monitor-v2 spec 該節保留為歷史文件不修)

## From /feat market-page-v2-frontend(2026-07-02,P5)

- (原「populated e2e fixture(D-3 遞延)」條目已由 chore/populated-market-e2e-fixture 收割刪除,2026-07-20:TaiwanStockPrice universe 窗口 + TAIEX fixture(`scripts/gen-market-e2e-fixtures.py` 生成,手算基準 McClellan 10.0 / vol ratio 2.50 hot / share 60.0%)+ TaiwanStockInfo 解除 skip_store 入 _store(原 snapshot 全空根因)+ fake fallback 補 data_id 過濾語意;M2/M3 un-skip + 新 M9 資料級,e2e 50 passed 0 skipped)
(「今日量(萬張)語意張力」與「spec §7 layout 圖 + §6.2 色票文字同步」兩條已於 2026-07-20 標 moot 移除 [auto-default: 判 moot | reason: mod/market-today-only 改版後前端已無「今日量」「最近交易日」字串,量比 panel 整組退役;spec §7 layout 與 §6.2 所指版面已被今日三卡取代兩輪,活規格在 .claude/mod/market-today-only/change-spec.md,同步目標(design.md v3)本身已過時]。market-monitor-v2 spec 保留為歷史文件不修)

## From /perf warrant-api-load(2026-07-15,Phase 2 順帶發現)

- (原「iv backfill weekday empty 疑似 transient」條目已由 fix/iv-backfill-empty-vs-holiday 解決刪除,2026-07-16:單邊空不寫殘檔 + 非交易日 marker TTL 7 天;07-10 實為颱風假、真 bug 是 06-08/07-02 殘檔,已刪除重補)
- (原 /feat warrant-selector「冷 build 63s」條目已由本 /perf 解決刪除:量測揭示 IV 反解僅 0.5s,主因是 TWSE MI_INDEX 未命中重算 + fetch 序列化;S1-S5 落地後使用者可見冷首開 0.6s)

## From /bug iv-backfill-empty-vs-holiday(2026-07-16)

- (原「TPEx 權證 IV 歷史實質全空」條目已由 fix/tpex-warrant-iv-empty 解決刪除,2026-07-17:root cause = wn1430 `se=EW` 是不含權證的股票表(權證表 se=WW)+ daily R3 窗口檔 immutable 無自癒;修 se=WW + 兩線無 TPEx 殘檔自癒,64 殘檔實測重建)
- **版本不符的 iv-history 日檔 backfill 不重建**(fix/tpex-warrant-iv-empty 維持舊行為,scope 紀律):`_backfill` 對 `_cache_version` 不符檔視同完整跳過,讀取端(R18)視同缺檔 → bump 版本後舊檔永占檔名、該日永缺。觸發重評估:下次 bump `warrant_iv_history._CACHE_VERSION` 時(屆時把「版本不符 → 視同缺檔重建」納入)
- (原「daily 路徑同病:單邊空 snapshot → immutable 殘檔」條目已由 fix/warrants-snapshot-partial-empty 解決刪除,2026-07-17:build 端移植 R15 樣板 — 單邊空 retry 空側一次、仍單邊視同該日無資料回退前一日;既存殘檔掃描實證零殘留,免清算)
- **archive 端 kind 平衡守衛未加**(fix/warrants-snapshot-partial-empty 拍板不加,scope 紀律):build 端修復後單邊 snapshot 無生成路徑,守衛會迫使 ~10 個 call-only 最小 fixture 測試連鎖改動。觸發重評估:未來出現第二條 snapshot 供給路徑、或 terms-join 造成單 kind snapshot 實例時
- **「empty == 非交易日」假設的其他複本(輕量組)**:warrant_flow `_candidate_dates` 的「上游空回 → 跳過」推斷不落永久檔(每請求重評),transient 空回只造成單次錯回退(2026-07-20 註:market_breadth 複本已隨檔刪除)。觸發重評估:flow 缺日被質疑時
- (原「repo 根目錄 untracked node_modules」條目已由 chore/backlog-a3-cleanup 解決刪除,2026-07-18:實為根目錄誤跑 vitest 的 `.vite` cache 殘留(僅 1 檔)非 npm install;已刪 + .gitignore 補 `/node_modules/` 根層防再犯)

## From /mod warrant-selector-enhance(2026-07-14)

- **元大公布造市委買波動率逐檔抽樣比對未執行**:IV 反解 pipeline 沿 warrant-iv-drift 已驗證的 warrant_pricing.implied_vol,本輪未重驗外部真值;要做需 scrape 元大權證網逐檔頁。觸發:iv-drift 數字被質疑時(2026-07-15 註:發行商排行已整組移除,排行相關動機消滅)

## From /mod issuer-rank-strata(2026-07-14)

- (原「test_finmind_realtime.py 負載型 flake」條目已由 fix/test-finmind-realtime-flake 解決刪除,2026-07-19:與 07-11 條目同根因,詳見該節收割註記 — 跨 event loop registry 污染 + 漏網真實網路 prefetch)
- (2026-07-15 清理:排行 v3 候選、declining 窗兩條隨發行商引擎全刪而 moot 移除;selector 分點欄全 0 困惑條目隨欄位刪除移除;篩選列 name 屬性已於 mod/warrant-ux-feedback 收割)

## From /mod broker-label-search-only-id(2026-07-22)

- (原「BrokerSearch highlightMatch 對去dash label 的高亮缺口」條目已由 fix/broker-search-highlight-dash 解決刪除,2026-07-28:normalizeBrokerQuery 雙邊對齊 + char-level index map 回推原始區間,vitest 紅先行 ×2 鎖住;real-env 驗證時發現 prod 該路徑實不可達,見下條)
- (原「BrokerSearch filter 對 query 不去 dash → dash query 在 prod 全空」條目已於 2026-08-20 收割刪除:filter 雙邊 normalizeBrokerQuery,紅測試 fixture 改 prod 真實 shape(raw name 無 dash),changelog 0.49.1)

## 2026-07-26 harness /feat 改版的後續(user 指示本輪只動 /feat)
- (原「/mod /bug /perf /refactor 同步 2026-07-26 實證改版」條目已由 2026-07-27 四 command 同步批解決刪除:round JSON 落檔義務落 review-protocol C 節 + mod.md Phase 5;/mod Phase 3 輪數採 /feat 07-26 制(預設 1 輪 + P0 限縮加輪 — 無 /mod 側 JSON 實證,落檔義務同批補上、日後可實證覆核);graphify query 接入 mod Phase 1 / bug Phase 2 / refactor Phase 5。詳 RATIONALE /mod 節)
- (原「/auto 表的 /feat 建議行更新」條目已於 2026-07-27 銷帳 — 實查 auto.md 建議表現況即目標狀態:S 級「Phase 8.5 完成」退出條件在 + 07-27 停等註、L 級「Phase 0 對齊價值高」註記在;07-26/07-27 兩批改版已順路完成)
- (原「dispositions.json 過期 rows」條目已由 2026-07-27 收件匣 C1(15e14f8)解決刪除:6 條 rows 更新為 07-26 後繼詞彙,verify-dispositions n=0;封批復審逐條驗過新 check 字串鎖住原機制)
- **Harness 攢批句能見度**(2026-07-27 封批復審裁量):攢批強制句落點 chore.md 步驟 1 + REVIEW-close 檔頭 + RATIONALE 三處,不走 /chore 的 harness session 可能看不到;候選 = user CLAUDE.md 檔頭 note block 補半行(代價:常駐 bytes vs 9.5× cache 失效)。觸發重評估:出現一次「非緊急 harness 修補未攢批、逐日零星 commit」的實例時。
- graphify docs 語意層:**2026-07-27 評估後結案不建**。量測:docs/ 140 檔 ~631k tok(其中 docs/specs 歷史文件占 ~328k、docs/harness ~99k)+ .claude/skills ~16k — LLM 抽取一次性成本高,且 harness docs 本週 5 commit 的改動頻率會讓語意層立即過期(--update 重抽成本每批復發);harness 文件已有 RATIONALE / 交接檔 / next-time 密集交叉引用,grep 導航實測夠用,歷史 specs 語意圖化價值低。graph 維持 code-only(381 檔,3227 nodes;640 dangling edges 為 AST 對外部 import 正常樣態)。觸發重評估:grep 導航實際答不了跨文件關係問題、或 docs 進入低頻改動期時
- (原「/mod 改版時一併修 07-26 掃描 P1×2 + P2 清單」條目已由 2026-07-27 四 command 同步批解決刪除:inline 完工自查 checklist 已刪、輪數三檔兩說已統一;scratchpad P2 清單實存並清點 — #10 #11 #13 #14 #17 #21 #23 本批修,#18 #19 #20 moot(skill 複製後引用有效),餘均已由先前批次修)
- (原「評估 sync-harness-mirror 是否納入 6 支複製 skill」條目已於 2026-07-27 user 拍板 C2 解決刪除:6 支改寫件納入 mirror(各目錄 *.md,19 檔入鏡);grilling / grill-me 原文照抄件刻意不納 — 災難還原重抓 raw 即可)
- (原「/mod 一併補 e2e 意圖對齊三槓桿」條目已由 2026-07-27 四 command 同步批解決刪除:mod.md Phase 2 補「畫面可指認」表述、Phase 8 補收尾 UI 驗收點、Phase 5 補白名單對照必讀;subsumed 限縮本就免補)
- (原「/mod 一併議 grilling 分流接入」條目已由 2026-07-27 四 command 同步批解決刪除:mod.md Phase 2 補分流句(判準複用 feat-phase0-2 判準節、/auto 不豁免、判定記錄落 change-spec.md);auto.md 例外句 / 必停清單 / 建議表同步擴 /mod;load-manifest mod-M 補條件條目)
- (原「四 command 同步批完成後提醒 user 開 CLAUDE.md 瘦身輪」條目已於 2026-07-27 同日執行刪除:§2 → 新 skill backend-conventions、§3 + 分點名稱細節 → frontend-conventions、§1 壓縮;14,015 → 10,354 bytes(−26.1%),量法 `Path('CLAUDE.md').stat().st_size` 前後對照)

## From /mod bubble-chart-ux-polish(2026-07-28)

- **BrokerSearch 下拉 買/賣欄固定 44px 大數字溢位**:grid-cols-[12px_1fr_50px_44px_44px],≥6 位數(含千分位)會擠壓相鄰欄。user 未點名,獨立小修。觸發:下拉數字視覺被反映時
- **單看時「查看於籌碼總覽」鈕暫隱** — 若要補「單看單跳」(查看該分點於籌碼總覽),入口與 payload(activeSolo.id)已就緒,只差 UI 決策。觸發:user 在單看中找跳轉鈕時
- **hover tooltip 補該分點當日總買賣超**(brainstorm 拍板未採選項 B,單看模式已覆蓋主需求)。觸發:user 反映 hover 就想看總量、不想點擊時
- (原「solo 空集時 price bar 回落全體聚合」條目已於 2026-08-20 收割刪除:activeSolo 時不 fallback 顯零值,price bar 容器加 `data-testid="bubble-price-bar"`,vitest 以同 symbol rerender 模擬 refetch 鎖住)

## From /bug broker-net-bar-today-missing(2026-08-18)

- **secid_agg 缺「最後交易日」的非當天情境**:修復只補 `clock.today()`;若 FinMind
  `taiwan_stock_trading_daily_report_secid_agg` 的發布是「T+1 交易日」而非「隔日早上」,
  週末 / 假日看盤時前一交易日的分點柱仍會缺。**probe 已工具化 `backend/scripts/probe_secid.py`**
  (2026-08-20,`python -m scripts.probe_secid`,逐日對照 price vs secid_agg,結尾直接判
  「補 today 足夠 / 應改補最後 candle 日」);週四 16:49 實跑 price 有 08-20、secid 停 08-19
  (當日 EOD lag,已覆蓋)。**待 2026-08-22(六)早上跑一次**看週五是否入庫,再決定改不改。
  觸發:週六 probe 結果顯示落後、或 user 反映週末看不到週五的分點柱。

## From /bug cross-mode-symbol-name(2026-08-19)

- **market / borrow 的 `onSymbolPick(stockId)` 簽名沒有 name 通道**:App 已用股票目錄補名
  (單點修),但 MarketBreadthPanel / MarketSectorRotation / MarketVolumeRatioPanel /
  BorrowFeePage 的列資料其實都帶 name;若日後目錄端點(/api/symbols/all)不可用或要省那一
  次請求,可改為五個 caller 直接透傳 name。觸發:目錄請求被反映多餘、或非 equity 冷啟動要瘦身時。

## From /mod kline-date-bubble-days-ux(2026-08-19)

- (原「BorrowFeePage 重新整理鈕 spinner 變寬」條目已於 2026-08-20 收割刪除:套 App.tsx 常駐插槽,vitest 鎖兩態;但見上方「頂欄鈕 1280 常態換行」— 同樣板在頂欄有副作用,券差頁待視覺確認)
- **泡泡圖 header 中欄在 1280 + 自選側欄下僅 ~90px**:chips / 統計行多行換行、selector 溢出(pre-existing,R15 事故同型);可考慮 <1400px 時搜尋欄 360px → 280px 或把天數 selector 移右工具欄。觸發:1280 螢幕開側欄看泡泡圖被反映擠壓時。
- **多日泡泡圖每日標示只有開 / 收**:高 / 低與成交量未標(out of scope);`/bubble_window` 無逐日成交 meta,`actual_days < window_days` 時無法淡化無成交欄(change-spec §8 edge 8)。觸發:user 要每日高低或「實際 X 日」欄位區分時。
- **K 線 sel-cursor 日期 chip 被右上 zoom HUD 遮半截**(1600 寬實測「2026-08-19」被「90 日」HUD 蓋住,pre-existing)。觸發:動 K 線 HUD 時順手。
- (原「`e2e-update-snapshots` workflow 超時」條目已於 2026-08-20 收割刪除:根因非 Chromium 下載(兩次皆命中 cache)而是 `--with-deps` 內 `apt-get update` 撞 azure mirror 無回應 14 分鐘;兩 workflow 改每次嘗試 150s + 3 次重試、cache key 改 lockfile hash。順帶揪出 CI pytest 自 08-11 起必紅:5 條 freshness 測試用裸 now/today,UTC 下差 8h 判 stale,已改 `services.clock`。重生 workflow 成功開 **PR #75**(equity-2330 desktop / mobile 兩張),**未 merge,待 user 人眼**:新圖除預期的日期軸外,1280 寬**頂欄「重新整理」鈕常態掉到第二行** — 見下條)
- **頂欄「重新整理」鈕在 1280 寬常態換行**(2026-08-20 比對 PR #75 新舊 baseline 發現):`05f12d1` 的 spinner 常駐插槽讓鈕恆寬 +20px,1280 視窗(e2e 預設)下頂欄 flex-wrap 從「載入時才換行」變「永遠換行」,tabs 與圖區常態下移 42px — 原修復把間歇位移換成常態位移。候選:插槽改 `absolute` 疊在文字上不佔寬、或 1280 下壓縮天數 preset 組 / 搜尋欄寬。券差頁 2026-08-20 套了同插槽(#18 收割),元素少應不換行,驗視覺時一併看。觸發:merge PR #75 前必決。
