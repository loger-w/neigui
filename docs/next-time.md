# next-time.md — 全專案順手事項 backlog(單一收集點)

> 各流程(/feat /bug /mod /refactor /perf)的「順手想改但不在本次 scope」統一寫這裡,commit 前 cat 一次。
> 2026-07-06 起集中於此(原散落 docs/specs/*/next-time.md 三檔已併入);subagent 模式下由 main agent dispatch 前代查。
> 條目做完就刪;defer 的條目要帶「觸發重評估的條件」。

---

## From /mod chip-major-lazy-window Phase 2 probe(2026-07-16)

- (原「prd cancel 鏈斷在 Vercel rewrite 層」條目已由 fix/prd-cancel-propagation 解決刪除,2026-07-17:prd 正式域名直連 Railway,abort 直達;cancel-chain skill 第五環已翻新)
- (原「prd ~0.7-1.2 req/s 常駐 FinMind 消耗」條目已由 /bug prd-idle-finmind-drain 結案刪除,2026-07-17:誤歸因 — 實為殭屍 fan-out(已修)+ 瀏覽/probe 活動;零活動時 user_count 實測連續 57 分鐘平零,app 無常駐 FinMind 迴圈;tick_snapshot / user_info 均不計入配額,判讀方法沉澱至 skill `finmind-conventions`)
- **[設計風險,未實證] 大盤 tab 開著 + 配額耗盡 = EOD retry 放大器**:`eod_pending` 時前端每 15s poll,每次 poll 會重觸發失敗的 EOD 背景計算(`_ensure_eod_task` done_callback 自移除 → 下一請求重試);402 期間失敗日不落 cache → 每輪重抓,以配額再生速率持續燒、把 user_count 釘在上限。修法候選:EOD task 失敗後加 backoff 標記(如 60s 內不重觸發)。觸發:prd 再現「配額貼上限 + 大盤分頁開著」情境時實證並修

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

- **equity tab 鈕樣板第 4 份複本**(App.tsx overview/bubble/warrants/warrant-flow 四個 button + hidden div 逐字同構):抽 tab config array + map render。觸發重評估:第 5 個 equity tab 出現、或改 tab 共通樣式/a11y 時
- **backend「候選日回退 + inflight dedup + date 驗證」複本組**:`_run_once` 第 3 份(warrants/market_breadth/warrant_flow,行為已分歧 — refcount vs 無)、date query 驗證 2 處不同步(routes/warrants regex+fromisoformat vs routes/daytrade_fee 僅 fromisoformat)。抽共用時一起收。(2026-07-16 註:原列 `_candidate_dates` 第 2 份複本已隨 warrant_brokers.py 刪除而收斂為單份,自本條移除)觸發重評估:任一組要出第 3+ 份複本、或修其中一份的 bug 時
- **flow 對映用「當下快照」查歷史候選日**:權證在 (d, 快照 as_of] 間到期下市 → 該權證當日成交不入統計、計入 unmapped_count(訊號在但不歸屬)。預設查詢(d = 快照 as_of)零影響;顯式舊 date / 深度回退才失真。修法 = 快照歷史化(per-date terms archive),v1 out of scope。觸發重評估:user 用顯式 date 查歷史流向、或 unmapped_count 異常飆高時
- **`_cleanup_flow_caches` 每次冷聚合跑一次全目錄 iterdir**:目前冷聚合本身 200 req 網路成本 >> 1 次 iterdir,不值得節流;cache 目錄檔案數若破萬再加 last-cleanup 時戳門檻。觸發重評估:chip cache 目錄檔案數 >5k 或 real-env 量到 cleanup 佔時
- (原「[需 user 拍板] flow 淨買賣超欄恆退化」條目已由 mod/warrant-flow-external-net 解決刪除,2026-07-18:拍板 (b) 外部淨額口徑 = −(發行商造市 HO seat net),12 家 alias 白名單 + seat 精確名對映,無法對映 → null;probe 實證 27/27 單一命中)
- (原「中信/元富/兆豐 HO seat 精確名未經真實樣本驗證」R-1 條目已由 fix/warrant-ho-alias-verify 實測收割,2026-07-18:中國信託 6160 / 兆豐 7000 與推定相符零改動;元富因 2026-04-06 併入台新證券(存續),HO 實為 9B00「台新證券」→ alias 補「台新」,real-env 三家 external_net 皆非 null。已知殘餘邊角(review P2 接受):顯式 date < 2026-04-06 查歷史時,元富 brand 權證上的台新外部 seat 會被誤歸 HO — 該路徑本已因「當下快照對映歷史候選日」條標記失真,不另做日期條件 alias)
- **flow warm 路徑每次查詢付 1 個 T+0 dump request(~2s,44k rows)**:自適應設計的常數成本;若嫌慢,候選 = 當日空 dump 短 TTL(如 30 分)cache。觸發重評估:user 抱怨 tab 切換慢、或午後高頻使用場景出現

## From /mod warrant-iv-redesign(2026-07-16)

- **drift label 中文對映第 2 份複本**(warrant-columns.tsx `DRIFT_TEXT`(僅 declining/rising)vs WarrantIvHistory.tsx `DRIFT_LABEL`(全四態)):本批次 warrant-columns.tsx 禁動(另 session 剛收尾)故未合併;下次動任一份時抽到 lib/warrant-data.ts 旁單一對映。觸發重評估:改任一份文案、或第三個 consumer 出現時

## From /mod warrant-selector-table(2026-07-16)

- **原生 `<select>` 樣式第 2 份複本**(OptionsHeader.tsx 合約下拉 vs WarrantSelector.tsx 發行商下拉,border-line/bg-bg/cursor-pointer 同構、細節微異):第三份 select 出現時抽共用 className util 或 ui/select 元件。觸發重評估:第三個原生 select 出現時

## From /mod warrant-ux-feedback(2026-07-15)

- **Popover 面板骨架第 2 份複本**(BrokerFilterPopover / WarrantColumnMenu:Root+Trigger+Portal+Content+scroll 列表+footer 同構):第三份 popover 出現時抽共用 wrapper。觸發重評估:第三個 popover 面板出現時
- **number spinner 隱藏 CSS 第 2 份複本**(RangeSelector / ui/NumberField 的 `[appearance:textfield]` 三連 class):第三份出現時抽共用 className util。觸發重評估:第三處要隱藏原生 spinner 時

## From /feat daytrade-borrow-fee(2026-07-11)

- **「重新整理」按鈕 JSX 三份重複**(App.tsx / OptionsHeader.tsx / BorrowFeePage.tsx,含 SVG spinner + aria-busy + className 逐行同構):抽共用 `RefreshButton` 元件。觸發重評估:第四個複本出現、或改按鈕樣式/a11y 屬性時

## From /mod borrow-fee-stock-filter(2026-07-11)

- **combobox pattern 第二份複本**(SymbolSearch 全市場版 vs BorrowFeeStockFilter 當日名單版,下拉/鍵盤/blur-timer 同構):第三處需要時抽共用 combobox。觸發重評估:第三個 combobox 出現時

## From brainstorm 券差查詢 / 權證選擇器(2026-07-08)

- **券差表點代號跳 equity 分析**:券差 tab 的 stock_id 可連到 equity mode 該股籌碼頁(跨 mode 導航目前無先例,需設計 mode+symbol 的 state 傳遞)。觸發重評估:券差查詢 /feat 完成後
- **TWSE MI_INDEX `type=0999` 牛熊證與認售 type 枚舉**若 S-1 spike 發現牛熊證需求自然浮現,v2 再評(TPEx 對應 wcb/wxy 端點已知)。觸發重評估:user 提到牛熊證時

## From harness review(2026-07-06,12-agent 體檢;2026-07-19 全批拍板收割)

2026-07-19 一次拍板做/緩/砍並落地:**已做** = 自我保護 hook(protect-harness.py,ask 不 deny,Write|Edit + shell 雙面)、pre_push fail-closed 補洞(tracked 缺檔 / 空 verify 需 `allow_empty_verify`)、mod.md Phase 3 刪誤導句、4 agent location schema 統一 `{file, section?}` + cross-round 條款補齊、`scripts/sync-harness-mirror.py`(--check/--fix,首跑即揪出 5 個舊漂移檔)、/chore 輕量入口。**已被先前工作順路做掉** = 鐵則 G 覆寫條款、perf.md Phase 1 auto-verify、feat.md Phase 6 infra_fail。**砍** = 條件式 e2e 進機讀 gate(A 案拍板:e2e 歸屬是語意判斷機器判不了,維持 pre_push 不跑 e2e;殘餘風險由 /chore 檔第 3 步「e2e 判準檢查」補)。剩餘:

- **[待 user 動手] `permissions.deny` 加 `Read(**/.env)`**:classifier 擋 Claude 改 permissions 自身;user 在 `~/.claude/settings.json` 的 permissions 加 `"deny": ["Read(**/.env)", "Read(**/.env.*)"]` 即可(確切 JSON 已於 2026-07-19 session 提供)
- **[緩] Phase 6 deferred 證據追蹤**(state.json `deferred_evidence` + harness-context 注入)。觸發重評估:再次發生 deferred 證據漏補事故
- **[緩] `derive_phase_from_artifacts` advisory**(附進 stop-audit block reason,不 auto-patch)。觸發重評估:state.json phase 標記與 artifact 實況錯亂再發
- **[緩] final_merge_sha 向 git log 驗真**。觸發重評估:state.json 出現對不上 git log 的 final_merge_sha
- **[緩] SubagentStop spike**(payload 可判 agent 身分?)後才立案 schema 機驗。觸發重評估:出現需要審計 subagent 行為的實際需求

## From /feat options-page-v2(2026-07-07)

- **`parse_institutional` 的 `day_change` 欄位恆 0**(註解宣稱 caller 回填但從未發生;design.md KR-1):前端已改用 series 末兩點差,該欄位成死欄位 — 下次動 institutional payload 時移除(連動 options-types.ts + 測試)。觸發重評估:動 fetch_institutional 或 InstitutionalSide 型別時
- (原「`finmind_realtime._run_once` 測試層跨 event loop 污染」條目已由 fix/test-finmind-realtime-flake 解決刪除,2026-07-19:即 flake 條目的真凶,conftest autouse `_reset_realtime_task_registries` 清 finmind_realtime._inflight/_eod_background + market_breadth/market_universe._inflight;紅測試 pair(pollution setup + immune)鎖 regression。留尾巴:warrant*/daytrade_fee 各測試檔的 _inflight 自清 fixture 分散 5 處可集中進 conftest 同一 fixture(純 refactor);**新增模組級 task registry 時必須掛進該 conftest fixture**)
- **fmtSigned 兩份行為真不同,不可直接合併**(refactor/options-p2-reuse 2026-07-19 拍板踢出:OptionsNetTable 版全數字 `+12,345`、options-range-svg 版 ≥1000 縮寫 `+12.3k`,合併必動一邊顯示 = mod 不是 refactor)。要合併需先拍板統一成哪種顯示(或帶 abbrev 參數合併,兩 call site 各帶模式)。觸發重評估:第三份 fmtSigned 出現、或想統一 OI± 顯示格式時(其餘 4 條 P2 reuse 已由該分支收割:fmtPct → lib/options-format、距現價 → maxPainDistance、futures 聚合 → institutions 參數、RangeMapSvg hoist)

## From /perf cold-start(2026-07-07)

- **`routes/symbols.py::load_symbols` 未走 FinMind 接入慣例**:直接裸 httpx 呼叫,沒過 `FinMindClient._get` / TokenBucket / per-module `get_finmind()` wrap(conventions 制定前的既有債)。觸發重評估:下次動 symbols route 或 FinMind 客戶端重構時,順路收編

(原「From /mod chip-bubble-intraday-overlay」P2/P3 整段已由 refactor/chip-bubble-p3-harvest 收割刪除,2026-07-19:F-P3-8/9/10/13/14/15 + F-P2-4 + F-P3-16~19 全收;F-P3-20 moot — useChipIntraday 已於 force-refresh-query 收割改寫,forceRefreshRef 不存在)

## From /mod bubble-chip-ux(2026-07-02)

Defer 的 3 個 review finding(皆 PLAUSIBLE — pushed back,各帶重評估條件):

- **Brush band `<rect>` dedup**(`chip-bubble-svg.tsx` L738-763):drag phase vs persistent phase 兩塊語意明確,合併 helper 需多帶 flag。**觸發重評估:加第三個 phase(如 hover-preview)時**
- **Header 3-level 巢狀 ternary**(`ChipBubbleView.tsx` L213-235):三分支 flat,抽 component 只是搬複雜度。**觸發重評估:分支超過 4 個時**
- **Broker totals 4 span 重複結構**(`ChipBubbleView.tsx` L234-250):穩定欄位,config+map 引入間接性。**觸發重評估:加第 5 欄或 responsive 隱藏欄位時**

其他:
- **E2E spec 補充**:A1 brush / A2 button / A3 totals / A5 loading / B1 row click / B2 chip bar / B3 broker row 是 equity mode UI 改動,依 e2e 判準表要加 E# spec(當時 port 佔用未跑,需 mini-mod 補)
- **Visual baseline 更新**:C4 讓未選狀態 K 線縮 4.4%;若 visual.spec.ts 有 equity baseline 需 `npm run test:update-snapshots`

## From /perf snapshot-hot-path(2026-07-02)

- **增量 fetch 消滅每日冷啟動**:日期翻頁 → cache key 變 → 全 window 128 次 FinMind 重抓;可重用昨日 window 檔補缺日(需重設計 cache key)。先評估:冷啟動只有每日第一個 request 付,已不卡其他 endpoint
- **recompute 期間單 component aggregation 殘餘 ~0.9s loop stall**(每日一次):若要壓,extract/aggregate 純函式 to_thread(純 Python 在 thread 每 5ms 讓 GIL)。CP 值低,擱置
- **orjson**:若 parse 還要更快(4.2s → ~1s)換 `orjson.loads` per chunk。目前不值得加 dep
- `_read_cache`/`_write_cache`(單文件版)服務小檔 — 若小檔長成大檔,套 chunked 樣板

## From /bug sector-override-phantom(2026-07-02)

- **`tests_e2e/fixtures/TaiwanStockInfo.json` 含不存在的「金融保險業」category**(掛在 2412):下次 rotate fixture 時校正為真實 category 字串(連動 e2e baseline,獨立處理)
- `tests/test_sector_aggregation.py:142` 手編 sector_map 用「金融保險業」當任意 label — cosmetic,rotate 時順手改

## From /bug mcclellan-scaling(2026-07-02)

- **spec.md §6.3 公式文字漏 `× 1000`**(Ratio-Adjusted / StockCharts 慣例):code 已修並有測試鎖,spec 文字下次動 docs 時同步補
- KG 維持:±100 thrust 閾值台股 ~1000 issues 未校準(V2.5 backtest 校準)

## From /feat market-page-v2-frontend(2026-07-02,P5)

- **populated e2e fixture(D-3 遞延)**:FAKE_FINMIND 缺全市場 TaiwanStockPrice window + TAIEX fixture,四個 EOD 欄位在 e2e 下必 null;要鎖 populated 渲染需補 MANIFEST + 全市場 window fixture,順便解 M2/M3 skip
- **「今日量(萬張)」vs eod null「最近交易日」語意張力**:若要解,欄名改「當日量(萬張)」等中性詞,動 spec §6.5 一起改
- **spec §7 layout 圖 + §6.2 色票文字未更新**:實作以 design.md v3 為準,下次動 spec 時同步

## From /perf warrant-api-load(2026-07-15,Phase 2 順帶發現)

- (原「iv backfill weekday empty 疑似 transient」條目已由 fix/iv-backfill-empty-vs-holiday 解決刪除,2026-07-16:單邊空不寫殘檔 + 非交易日 marker TTL 7 天;07-10 實為颱風假、真 bug 是 06-08/07-02 殘檔,已刪除重補)
- (原 /feat warrant-selector「冷 build 63s」條目已由本 /perf 解決刪除:量測揭示 IV 反解僅 0.5s,主因是 TWSE MI_INDEX 未命中重算 + fetch 序列化;S1-S5 落地後使用者可見冷首開 0.6s)

## From /bug iv-backfill-empty-vs-holiday(2026-07-16)

- (原「TPEx 權證 IV 歷史實質全空」條目已由 fix/tpex-warrant-iv-empty 解決刪除,2026-07-17:root cause = wn1430 `se=EW` 是不含權證的股票表(權證表 se=WW)+ daily R3 窗口檔 immutable 無自癒;修 se=WW + 兩線無 TPEx 殘檔自癒,64 殘檔實測重建)
- **版本不符的 iv-history 日檔 backfill 不重建**(fix/tpex-warrant-iv-empty 維持舊行為,scope 紀律):`_backfill` 對 `_cache_version` 不符檔視同完整跳過,讀取端(R18)視同缺檔 → bump 版本後舊檔永占檔名、該日永缺。觸發重評估:下次 bump `warrant_iv_history._CACHE_VERSION` 時(屆時把「版本不符 → 視同缺檔重建」納入)
- (原「daily 路徑同病:單邊空 snapshot → immutable 殘檔」條目已由 fix/warrants-snapshot-partial-empty 解決刪除,2026-07-17:build 端移植 R15 樣板 — 單邊空 retry 空側一次、仍單邊視同該日無資料回退前一日;既存殘檔掃描實證零殘留,免清算)
- **archive 端 kind 平衡守衛未加**(fix/warrants-snapshot-partial-empty 拍板不加,scope 紀律):build 端修復後單邊 snapshot 無生成路徑,守衛會迫使 ~10 個 call-only 最小 fixture 測試連鎖改動。觸發重評估:未來出現第二條 snapshot 供給路徑、或 terms-join 造成單 kind snapshot 實例時
- **「empty == 非交易日」假設的其他複本(輕量組)**:warrant_flow `_candidate_dates`、market_breadth per-day 的「上游空回 → 跳過」推斷不落永久檔(每請求重評),transient 空回只造成單次錯回退。觸發重評估:flow/breadth 缺日被質疑時
- (原「repo 根目錄 untracked node_modules」條目已由 chore/backlog-a3-cleanup 解決刪除,2026-07-18:實為根目錄誤跑 vitest 的 `.vite` cache 殘留(僅 1 檔)非 npm install;已刪 + .gitignore 補 `/node_modules/` 根層防再犯)

## From /mod warrant-selector-enhance(2026-07-14)

- **元大公布造市委買波動率逐檔抽樣比對未執行**:IV 反解 pipeline 沿 warrant-iv-drift 已驗證的 warrant_pricing.implied_vol,本輪未重驗外部真值;要做需 scrape 元大權證網逐檔頁。觸發:iv-drift 數字被質疑時(2026-07-15 註:發行商排行已整組移除,排行相關動機消滅)

## From /mod issuer-rank-strata(2026-07-14)

- (原「test_finmind_realtime.py 負載型 flake」條目已由 fix/test-finmind-realtime-flake 解決刪除,2026-07-19:與 07-11 條目同根因,詳見該節收割註記 — 跨 event loop registry 污染 + 漏網真實網路 prefetch)
- (2026-07-15 清理:排行 v3 候選、declining 窗兩條隨發行商引擎全刪而 moot 移除;selector 分點欄全 0 困惑條目隨欄位刪除移除;篩選列 name 屬性已於 mod/warrant-ux-feedback 收割)
