# next-time.md — 全專案順手事項 backlog(單一收集點)

> 各流程(/feat /bug /mod /refactor /perf)的「順手想改但不在本次 scope」統一寫這裡,commit 前 cat 一次。
> 2026-07-06 起集中於此(原散落 docs/specs/*/next-time.md 三檔已併入);subagent 模式下由 main agent dispatch 前代查。
> 條目做完就刪;defer 的條目要帶「觸發重評估的條件」。

---

## From harness 強制層 v3 第一期(2026-07-06)

- **[harness] block-no-verify.py / safety-hooks.py 的 matcher 只有 Bash**:PowerShell 工具是繞過面(harness-push-gate.py 已覆蓋 `Bash|PowerShell`,舊兩個 hook 待補 matcher + tool_name 支援;PowerShell 語法的 pattern 也要重驗,如 `--%` stop-parsing token)

## From harness review(2026-07-06,12-agent 體檢;token 減負六項已於 mod/harness-token-slim 落地)

- **[harness P0] Batch 1 強制層**(順序敏感):阻擋 hook 先補 pytest → PowerShell matcher + pattern 擴充(與上一條同件)→ 自我保護 hook(PreToolUse Write|Edit 守 hooks/settings/harness.json/.git/hooks/**agents/**,`ask` 不 deny;shell 面 pattern 同批補)→ pre_push fail-closed(git tracked 但缺檔 / 空 verify 需顯式 flag)→ `permissions.deny` 加 `Read(.env)`(Read 工具讀 .env 目前無人攔)
- **[harness P1] Batch 2 一行級修正包**(auto-verify 移除 `ruff check --fix` 與 harness.json ruff 插槽已於 2026-07-07 契約掃描落地):鐵則 G 改「預設 + command 可覆寫」+ mod.md Phase 3 刪「同 /feat 慣例」誤導句、perf.md Phase 1 補 auto-verify 呼叫、feat.md Phase 6 infra_fail 已改引用(done)、4 agent location schema 統一 {file, section?} + 其餘三 agent 補 round≥2 cross-round 條款
- **[harness P2] Batch 3 剩餘**:`scripts/sync-harness-mirror.py`(--check/--fix,消 README cp 塊 + 文字清單漏列雙源)、Phase 6 deferred 證據追蹤(state.json `deferred_evidence` + harness-context 注入)、/chore 輕量入口(一頁內:升級 / 補測試 / docs / 研究腳本 + 分支政策)
- **[harness P2] Batch 4 第二期**:`derive_phase_from_artifacts` advisory(附進 stop-audit block reason,不 auto-patch)、final_merge_sha 向 git log 驗真、SubagentStop spike(payload 可判 agent 身分?)後才立案 schema 機驗、條件式 e2e 進機讀 gate **需 user 裁決**(撞 pre_push「e2e 不在此跑」已拍板決策)

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
