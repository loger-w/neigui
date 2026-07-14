# next-time.md — 全專案順手事項 backlog(單一收集點)

> 各流程(/feat /bug /mod /refactor /perf)的「順手想改但不在本次 scope」統一寫這裡,commit 前 cat 一次。
> 2026-07-06 起集中於此(原散落 docs/specs/*/next-time.md 三檔已併入);subagent 模式下由 main agent dispatch 前代查。
> 條目做完就刪;defer 的條目要帶「觸發重評估的條件」。

---

## From /feat warrant-iv-drift(2026-07-11)

- **IV drift「rising」側受市場 vol regime 混淆**(2026-07-11 真實 60 日校準:市場整體 IV 上行 → rel 右尾肥,常數 0.30 下 rising 仍標 10.3%;declining 側 1.2% 選擇性 OK):要更乾淨需 cross-sectional de-mean(rel 減去全市場中位數),屬 detect 演算法 design amend。觸發重評估:user 反映 rising 標記太多、或市場轉入 IV 下行 regime 換 declining 側爆量時

- **forceRefreshRef pattern 已複製到第 20 個 hook — 門檻已觸發**(2026-07-14 useWarrantFlow 為第 20 個;原訂「第 20 個出現時重評估」):建議開專屬 /refactor 抽共用 `useForceRefreshQuery` helper(順帶收斂 code-review 指出的 ref 時序 race:refresh 旗標可能被非 refresh 的 in-flight fetch 提前消費 — pattern 級,20 個 hook 同病)。觸發重評估:已觸發,下次 /refactor 排程時收割
- **tests/test_finmind_realtime.py 在機器高負載下 flaky**(真實 asyncio 短 sleep 0.02s + wait_for timeout=1.0;2026-07-11 全套跑兩輪各紅 15/8 個、單檔跑與後續全套皆綠):改假鐘或放寬 timeout。觸發重評估:CI 或平常開發再看到該檔紅時

## From /feat warrant-broker-flow(2026-07-14)

- **equity tab 鈕樣板第 4 份複本**(App.tsx overview/bubble/warrants/warrant-flow 四個 button + hidden div 逐字同構):抽 tab config array + map render。觸發重評估:第 5 個 equity tab 出現、或改 tab 共通樣式/a11y 時
- **backend「候選日回退 + inflight dedup + date 驗證」三組近親複本**:`_run_once` 第 3 份(warrants/market_breadth/warrant_flow,行為已分歧 — refcount vs 無)、`_candidate_dates` 第 2 份(warrant_brokers 起點 today−1/5 天 vs warrant_flow today/10 天)、date query 驗證 2 處不同步(routes/warrants regex+fromisoformat vs routes/daytrade_fee 僅 fromisoformat)。抽共用時三組一起收。觸發重評估:任一組要出第 3+ 份複本、或修其中一份的 bug 時
- **flow 對映用「當下快照」查歷史候選日**:權證在 (d, 快照 as_of] 間到期下市 → 該權證當日成交不入統計、計入 unmapped_count(訊號在但不歸屬)。預設查詢(d = 快照 as_of)零影響;顯式舊 date / 深度回退才失真。修法 = 快照歷史化(per-date terms archive),v1 out of scope。觸發重評估:user 用顯式 date 查歷史流向、或 unmapped_count 異常飆高時
- **`_cleanup_flow_caches` 每次冷聚合跑一次全目錄 iterdir**:目前冷聚合本身 200 req 網路成本 >> 1 次 iterdir,不值得節流;cache 目錄檔案數若破萬再加 last-cleanup 時戳門檻。觸發重評估:chip cache 目錄檔案數 >5k 或 real-env 量到 cleanup 佔時
- **[需 user 拍板] flow 明細表「淨買賣超」欄與 summary 買/賣對恆退化(RE-1 守恆恆等式)**:全分點報表下單權證跨全分點 net ≡ 0、每 kind 買==賣(2330 實測精確 0.0)。候選替代口徑:(a) per-warrant「分點淨流動」= Σ 正 net(= Σ|負 net|,量測換手集中度);(b) 發行商造市 seat 反向 net(散戶/主力 vs 造市商,需權證名 → 發行商 seat 對映 heuristic);(c) 砍欄位、summary 改「認購/認售成交額」兩數字。動口徑 = 對外契約 + SC 改寫 → /mod 流程。觸發:user 看到 v1 UI 全零欄位時
- **flow warm 路徑每次查詢付 1 個 T+0 dump request(~2s,44k rows)**:自適應設計的常數成本;若嫌慢,候選 = 當日空 dump 短 TTL(如 30 分)cache。觸發重評估:user 抱怨 tab 切換慢、或午後高頻使用場景出現

## From /feat daytrade-borrow-fee(2026-07-11)

- **「重新整理」按鈕 JSX 三份重複**(App.tsx / OptionsHeader.tsx / BorrowFeePage.tsx,含 SVG spinner + aria-busy + className 逐行同構):抽共用 `RefreshButton` 元件。觸發重評估:第四個複本出現、或改按鈕樣式/a11y 屬性時

## From /mod borrow-fee-stock-filter(2026-07-11)

- **combobox pattern 第二份複本**(SymbolSearch 全市場版 vs BorrowFeeStockFilter 當日名單版,下拉/鍵盤/blur-timer 同構):第三處需要時抽共用 combobox。觸發重評估:第三個 combobox 出現時

## From brainstorm 券差查詢 / 權證選擇器(2026-07-08)

- **券差表點代號跳 equity 分析**:券差 tab 的 stock_id 可連到 equity mode 該股籌碼頁(跨 mode 導航目前無先例,需設計 mode+symbol 的 state 傳遞)。觸發重評估:券差查詢 /feat 完成後
- **TWSE MI_INDEX `type=0999` 牛熊證與認售 type 枚舉**若 S-1 spike 發現牛熊證需求自然浮現,v2 再評(TPEx 對應 wcb/wxy 端點已知)。觸發重評估:user 提到牛熊證時

## From harness review(2026-07-06,12-agent 體檢;token 減負六項已於 mod/harness-token-slim 落地)

- **[harness P0] Batch 1 強制層剩餘**(阻擋 hook pytest、PowerShell matcher + tool_name + PS pattern 已於 2026-07-07 落地):自我保護 hook(PreToolUse Write|Edit 守 hooks/settings/harness.json/.git/hooks/**agents/**,`ask` 不 deny;shell 面 pattern 同批補)→ pre_push fail-closed(git tracked 但缺檔 / 空 verify 需顯式 flag)→ **`permissions.deny` 加 `Read(**/.env)` 需 user 手動**(2026-07-07 classifier 擋 Claude 改 permissions 自身;user 在 `~/.claude/settings.json` 的 permissions 加 `"deny": ["Read(**/.env)", "Read(**/.env.*)"]` 即可)
- **[harness P1] Batch 2 一行級修正包**(auto-verify 移除 `ruff check --fix` 與 harness.json ruff 插槽已於 2026-07-07 契約掃描落地):鐵則 G 改「預設 + command 可覆寫」+ mod.md Phase 3 刪「同 /feat 慣例」誤導句、perf.md Phase 1 補 auto-verify 呼叫、feat.md Phase 6 infra_fail 已改引用(done)、4 agent location schema 統一 {file, section?} + 其餘三 agent 補 round≥2 cross-round 條款
- **[harness P2] Batch 3 剩餘**:`scripts/sync-harness-mirror.py`(--check/--fix,消 README cp 塊 + 文字清單漏列雙源)、Phase 6 deferred 證據追蹤(state.json `deferred_evidence` + harness-context 注入)、/chore 輕量入口(一頁內:升級 / 補測試 / docs / 研究腳本 + 分支政策)
- **[harness P2] Batch 4 第二期**:`derive_phase_from_artifacts` advisory(附進 stop-audit block reason,不 auto-patch)、final_merge_sha 向 git log 驗真、SubagentStop spike(payload 可判 agent 身分?)後才立案 schema 機驗、條件式 e2e 進機讀 gate **需 user 裁決**(撞 pre_push「e2e 不在此跑」已拍板決策)

## From /feat options-page-v2(2026-07-07)

- **`parse_institutional` 的 `day_change` 欄位恆 0**(註解宣稱 caller 回填但從未發生;design.md KR-1):前端已改用 series 末兩點差,該欄位成死欄位 — 下次動 institutional payload 時移除(連動 options-types.ts + 測試)。觸發重評估:動 fetch_institutional 或 InstitutionalSide 型別時
- **`finmind_realtime._run_once` 測試層跨 event loop 污染**:asyncio_mode=auto 每測試新 loop,前一測試 wait_for timeout 留下的 pending shielded task 卡在模組級 inflight cache → 後續測試 `got Future attached to a different loop` 連環炸(2026-07-07 pre-push 負載下實測,單獨重跑即綠)。修法候選:conftest autouse fixture 清 `_INFLIGHT` cache。觸發重評估:test_finmind_realtime 再 flake 或動 _run_once 時
- **Phase 4 code-review P2 reuse 批次**(5 條,留待 /refactor):fmtSigned(options-range-svg vs OptionsNetTable,行為微異)、fmtPct ×3 卡片重複、距現價 % 計算(options-conclusion vs OptionsMaxPainCard,含 0.0005 門檻)、finmind_futures `_inst_by_date` vs parse_foreign_futures 聚合重複(可加 institutions 參數收斂)、RangeMapSvg spot 插入迴圈沿襲 StrikeLadder 舊寫法(loop-invariant 可 hoist)。觸發重評估:動任一相關檔或開 options 專屬 /refactor 時

## From /perf cold-start(2026-07-07)

- **`routes/symbols.py::load_symbols` 未走 FinMind 接入慣例**:直接裸 httpx 呼叫,沒過 `FinMindClient._get` / TokenBucket / per-module `get_finmind()` wrap(conventions 制定前的既有債)。觸發重評估:下次動 symbols route 或 FinMind 客戶端重構時,順路收編

## From /mod chip-bubble-intraday-overlay(2026-06-29)

Phase 5 code review(workflow `wc2wlfiym`)未處理的 P2/P3,留待下次 /refactor:

### 視覺 / 主題集中
- **F-P3-9** `intraday-line-svg.tsx:15-16` `STROKE = "#7c6f55"` → 移到 `chip-theme.ts` 加 `CHIP.intradayLine`,集中色票
- **F-P3-8/8b** `chip-bubble-svg.tsx:429` 註解 z-order 改成一致版:`grid → time-line → close-dashed → bubbles`

### 命名 / 微簡化
- **F-P3-14** `chip-bubble-svg.tsx:437` `chartWidth={width - PADDING.left - PADDING.right}` → `chartWidth={cW}`
- **F-P3-15** `intraday-line-svg.tsx:12-13` `SESSION_START_MIN` / `SESSION_RANGE_MIN` 去 `export`,test 移除常數 tautology assertion
- **F-P3-10** `intraday-line-svg.tsx` rename → `chip-intraday-line-svg.tsx`,`interface Props` → `export interface IntradayLineLayerProps`
- **F-P3-13** `chip-bubble-svg.tsx:430` 外層改 `{intradayPoints && <IntradayLineLayer ... />}`(子元件自己 guard)

### 測試補強
- **F-P2-4** `test_finmind.py` 補 `test_fetch_chip_intraday_today_cache_refetches_when_stale`
- **F-P3-16** `chip-bubble-svg.test.tsx` 加 `selectedBroker + intradayPoints` combined-case 鎖 fallback Y 軸來源
- **F-P3-17** `test_finmind.py` 加 `test_fetch_chip_intraday_raises_on_upstream_failure`
- **F-P3-18** `test_chip_routes.py:151-158` default-date case 強化:鎖 `_today()` 路徑
- **F-P3-19** `useChipIntraday.test.ts` 加 date-change rerender 測試
- **F-P3-20** `useChipIntraday.test.ts` 加 `forceRefreshRef` reset 測試

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

## From /feat warrant-selector(2026-07-11)

- **權證篩選列 input 加 name 屬性**:DevTools a11y issue 級提示(form field should have id or name)×10,aria-label 已有無功能影響。觸發重評估:下次動 WarrantSelector 篩選列時
- **權證快照冷 build 實測 63s(2330 首請求,全市場 ~36k 檔 IV 反解)**:每日一次可接受,但可考慮 (a) 啟動預熱 task(lifespan kickoff 背景 build)或 (b) IV 反解 thread offload。觸發重評估:user 抱怨早盤首開慢、或加第二個吃快照的功能時

## From /mod warrant-selector-enhance(2026-07-14)

- **元大公布造市委買波動率逐檔抽樣比對未執行**:IV 反解 pipeline 沿 warrant-iv-drift 已驗證的 warrant_pricing.implied_vol,本輪未重驗外部真值;要做需 scrape 元大權證網逐檔頁。觸發:iv-drift 或排行數字被質疑時
- **權證分點報表 T+1 未上料日 net_value 全 0**:selector 分點欄與分點 tab 同 payload(一致),但「全 0」與「無資料」使用者難區分;可考慮 payload 帶報表日 flag 顯示「報表未出」。觸發:user 反映分點欄全 0 困惑時

## From /mod issuer-rank-strata(2026-07-14)

- **發行商排行 v3 候選:層內控制標的波動度**:v2 分層(moneyness×天期)已移除組合結構混淆,但未控制標的波動度 — 發行組合偏熱門高波動標的會結構性墊高 bid-IV std。元大 v2 仍 back(層內 iv pctl 0.49-0.62、同層 std 1.4-2.5×層中位),是否由此 residual 造成需 per-underlying 控制(如層內先對標的 demean)才能分辨。觸發:user 質疑排行與元大隱波不降口碑矛盾時
- **declining 維度 10 日窗無鑑別度**:全市場 declining 僅 0.76%(126/16,645)→ 全體 declining_score ≈0.5,composite 2/7 權重形同虛設;可考慮拉長 drift 窗(60 日 archive 已在)或改連續 slope 分位取代 binary。觸發:下次動排行 composite 口徑時
- **test_finmind_realtime.py 負載型 flake**:全套跑偶發 19 fail(timing 敏感),單檔重跑綠(2026-07-14 auto-verify 實證,同 2026-07-07/07-11 模式)。觸發:pre-push/CI 再紅同檔時考慮加 timing margin
