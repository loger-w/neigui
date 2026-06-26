# brainstorm — txo-chip-framework (MVP1)

> /feat Phase 0 artifact。**v3 2026-06-26**:Phase 1 round 2 review 後再修(詳見 `design-review-round-2.json` + design.md v3)。Round 2 確認 round 1 P0/P1 全修;v2 修改本身引入 26 new findings(1 P0 / 12 P1 / 13 P2)。本檔同步 v3 變更:
> - SC-3 lookback 改 250 td(N8);per_contract weekly 顯示 warning + 建議切 all_months(N5)
> - SC-7 新增 low_power warning catalog;next_day_stats schema unify(F17)
> - SC-8 改 permutation test p-value(非 bootstrap, N2);feature_transformation 預設 raw_flow,SC-0 probe 後 lock(N3)
> - SC-10b 改在 OptionsChipPanel.test.tsx 用 vi.spyOn 測,不走 DevTools MCP / MSW(F12)
> - SC-11 warning 字串改 ISO 日期 + 單一 consolidated warmup warning(F14)+ 新增 R8/R9/R10 對應 warnings

## 來源
- 研究檔:`compass_artifact_wf-73a978b0...md`(2025 Q1-Q2)
- 2026-06-25 deep-research 校準(workflow `wqm7dpah3`)
- 2026-06-26 Phase 1 round 1 review(`design-review-round-1.json`)

## Scope:**L**(完整 Phase 1/2 各 max 3 輪 review)

## MVP1 邊界
- ✅ 日級資料管線 + 4 個指標(Max Pain / OI Wall / PCR / 三大法人)
- ✅ 每指標歷史 hit rate(反身性對沖)
- ✅ 4 個獨立 endpoint + 共用 TaiwanOptionDaily window fetch
- ⏸ GEX / IV / Skew / VIX / Tick / 多指標共振 / Refresh debounce → MVP2/3

## 反身性對沖設計準則(貫穿)
1. UI 無方向性文案(無「做多/做空/賣選」)
2. 每指標 hit rate / next-day stats / correlation 常顯
3. PCR 引用 Lo & Liu 2025,但策略 thresholds 可調,只給 stat 不給 P&L
4. 不過度浪漫化(無 Sharpe、無 P&L 曲線)

## 成功條件(SC-N) — v2

### SC-0 — FinMind dataset schema probe(新增 F1-testability)
**內容**:在 Phase 2 第一步、進入 parser 實作前,以實作用 `.env FINMIND_TOKEN` 對 5 個 dataset 各做一次真實 fetch,把 sample row 落盤至 `backend/tests/fixtures/options_chip/probe/`:
- `TaiwanOptionDaily`
- `TaiwanOptionInstitutionalInvestors`
- `TaiwanOptionInstitutionalInvestorsAfterHours`
- `TaiwanOptionFinalSettlementPrice`
- `TaiwanFuturesDaily`(已用過,但確認 trading_calendar 推算欄位)
Probe script `tests/fixtures/options_chip/probe.py` 也 commit。所有後續 parser fixture 依據 probe 落盤資料的真實欄位名建構。
**驗證方式**:
- `backend/tests/fixtures/options_chip/probe/` 包含 5 個 JSON 檔
- `probe.py` 可 reproducible run(讀 .env、 single FinMind call/dataset)
- 之後任何 `parse_*` test 看到 fixture 欄位名與 probe JSON 一致

### SC-1 — Max Pain 計算(F1+F2+F14 修正)
**內容**:對選定 contract,**candidate K = union(call OI > 0 strikes, put OI > 0 strikes)**(F1),**strict contract_date filter**(F2)。`total_loss_ntd = loss_oi_points × 50`(F14, NTD 含乘數)。UI 顯示 Max Pain 數值 + 與 spot 乖離 % + total_loss_ntd 千分位格式。
**驗證方式**:
- 自動化:`pytest backend/tests/test_finmind_options.py::test_parse_max_pain_basic` `_union_strikes_asymmetric_otm` `_strict_contract_filter` `_total_loss_includes_multiplier_50` —— **max_pain 整數精度比對**;**total_loss_ntd 相對 tol 1e-6**(F9-testability)
- real-env:DevTools MCP 截圖 Max Pain 卡片顯示 + 乖離 % + total_loss_ntd 含千分位

### SC-2 — OI Wall(F6+F16)
**內容**:
- **Static walls**:per side max OI strike,**tie-break = closest to spot**(F16)
- **Dynamic walls**:過去 `delta_window` 個**交易日**(F9: trading days)的 **cumulative ΔOI 加總**(F6),取絕對值最大,tie-break = closest to spot;若 `days_since_listing < delta_window` → `partial_window=true`,delta_window_used = days_since_listing
- UI:static 實心 marker,dynamic 虛線 marker(視覺區隔)
**驗證方式**:
- 自動化:`test_parse_oi_walls_static_tie_break_by_spot` `_dynamic_cumulative_delta` `_partial_window_for_young_weekly`
- real-env:截圖 4 marker 同時呈現,週合約剛上市(< 5 trading days)時 `partial_window` badge 出現

### SC-3 — PCR walk-forward percentile + region(v3:N5+N8 修)
**內容**:
- 未平倉 PCR(`Σ Put OI / Σ Call OI`)— scope = `per_contract` | `all_months`(default)
- **Walk-forward percentile**:對歷史每個 t,percentile_t 用 `[t - lookback, t-1]` **嚴格過去**視窗算,`kind="mean"`
- **Lookback 預設 250 trading days**(N8 修,原 90;確保 walk-forward warmup 後仍有每 region ≥ 70 樣本)
- Thresholds 可調(`high_pct=70 / low_pct=30`)透過 query param 暴露
- **per_contract + weekly contract**(N5):returns 200 + payload `data_quality_warnings = ["per_contract_pcr_unsupported_for_weekly_consider_all_months"]` + `region=null`;UI 顯示「週合約資料不足,建議改全月份模式」按鈕
- UI:分位 bar + region chip(bg-bull/15 high, bg-ink/5 neutral, bg-bear/15 low — 台股慣例)
- **禁方向性文案**:無「做多/做空/賣選/滿倉」字眼
**驗證方式**:
- 自動化:`test_parse_pcr_history_per_contract_vs_all_months`、`test_parse_pcr_walk_forward_no_lookahead`(對抗測試:構造一個刻意的「未來日值極端」的序列,驗 percentile_t 不被未來污染)、`_percentile_tie_break_kind_mean`
- 路由測試(F8+F17-testability):`test_pcr_route_missing_contract_for_per_contract_scope_400`、`test_pcr_route_contract_not_applicable_for_all_months_400`、`test_pcr_route_scope_per_contract_with_invalid_contract_400`
- 元件測試(F10-testability):`OptionsPCRCard.test.tsx` `expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull()`
- real-env:截圖 region chip 配色台股慣例

### SC-4 — 三大法人(F3-integration + F12)
**內容**:
- `foreign` / **`dealer`(自營,F3-integration)** / `trust`,**不用 `prop`**
- 日盤(`TaiwanOptionInstitutionalInvestors`)+ 夜盤(`AfterHours`)
- `NIGHT_SESSION_AVAILABLE_FROM = 2021-10-13`(F12 constant);date < 該值時 `after_hours = null`,warning="night_session_not_available_pre_2021"
- UI:三家並列卡片,外資 `bg-accent/10` + 加粗。`<div hidden={!expanded}>` 展開日夜拆分(F10-integration)
**驗證方式**:
- 自動化:`test_parse_institutional_uses_dealer_not_prop`、`test_parse_institutional_after_hours_none_pre_2021_10`
- 元件測試:`OptionsInstitutionalCard.test.tsx` 驗 session toggle 用 `hidden` attribute
- real-env:截圖 3 家 + 外資 highlight + 展開狀態

### SC-5 — Max Pain 歷史 hit rate(F3 critical 修正)
**內容**:過去 N=20 個已結算合約(週/月混算),對每結算合約:
- `t = settlement_date`, `t_minus_1 = 結算前一交易日`(F3:避免 look-ahead)
- `max_pain_at_t_minus_1 = parse_max_pain(oi_by_trading_day[t_minus_1], contract_date)`
- `settlement_price = TaiwanOptionFinalSettlementPrice[contract_date]`
- `deviation_pct = (settlement - max_pain) / settlement`
- 若 `settlement_price` 缺(F10)→ 該樣本剔除,`latest_settlement_pending=true`
- UI:小直方圖 + median |deviation| + ±1% 命中率 + ±2% 命中率
**驗證方式**:
- 自動化:`test_parse_max_pain_hit_rate_uses_t_minus_1`(刻意構造 t-day Max Pain 與 t-1 大幅不同的 fixture,驗 hit_rate 用的是 t-1)、`_excludes_pending_settlement`
- real-env:截圖 hit rate 圖在 Max Pain 卡片底部

### SC-6 — OI Wall 歷史 hit rate(F3)
**內容**:過去 N 個已結算合約,以 t-1 的 [Put Wall, Call Wall] 為區間,看 settlement_price 是否落在其中。同樣 T-1 邏輯。
**驗證方式**:
- 自動化:`test_parse_oi_walls_hit_rate_t_minus_1`
- real-env:截圖 hit rate panel

### SC-7 — PCR 次日 TX 報酬統計(v3:F17+N8+N9 修)
**內容**:**這不是 backtest**。對過去 lookback 日,依當日 walk-forward region 分組,計算次日 TX_close 報酬的 **mean / std / hit_positive(正報酬比率) / samples**(samples 移到 region 內,F17)。
- **N8**:若任一 region samples < 30 → `data_quality_warnings += ["pcr_stats_low_power_{region_name}"]`
- **N9**:若 (region samples - with_next_return) / region samples > 5% → `data_quality_warnings += ["next_day_stats_dropped_samples_5pct"]`
**驗證方式**:
- 自動化:`test_parse_pcr_next_day_stats_no_pnl_no_sharpe` / `_payload_schema_exact`(F17 positive key-set assertion) / `_emits_low_power_warning_when_samples_lt_30` / `_handles_missing_tx_returns_t_plus_1`
- 元件測試:`OptionsPCRCard.test.tsx` 驗 UI 不顯示 P&L 曲線、不顯示 Sharpe
- real-env:截圖三 region 統計表 + low_power 時 warning 顯示

### SC-8 — 外資 next-day correlation(v3:N2+N3 修)
**內容**:過去 60 個交易日的 foreign Call/Put net **vs 次日 TX_close 報酬**,rolling Spearman window=60。
- **N2**:p-value 用 **permutation test**(shuffle tx_returns、recompute Spearman、p = (#perms |r_perm|>=|r_obs| + 1)/(N+1)),**不**是 bootstrap CI
- **N3**:`feature_transformation` 預設 `"raw_flow"`(直接用 foreign.call_net[t]),SC-0 probe 後確認資料是 daily flow 還是 cumulative position 再 lock;若後者改 `"first_difference"`
- `is_significant = (p_value < 0.10)`
- **只算 foreign**(F10-testability scope guard);dealer/trust 完全不進 correlation 計算
- UI:rolling 折線 + p-value;`is_significant=false` 視覺淡化 `opacity-50`
**驗證方式**:
- 自動化:`test_parse_institutional_correlation_60_day_rolling_with_permutation_p`、`_excludes_dealer_trust_from_correlation_payload`(fixture 含 dealer/trust 資料,assert correlation dict keys 不含 dealer/trust)、`_feature_transformation_raw_flow_default`、`_emits_correlation_sample_small_when_lt_30`
- real-env:截圖 correlation 折線 + p-value 顯示

### SC-9 — UI 整合到既有 OptionsPage(擴充模式)
**內容**:沿用 v1,Panel 放在 Header 下、Strip 上。
**驗證方式**:
- real-env:DevTools MCP 截圖版面層次
- 切合約 + 切日期前後截圖比對

### SC-10 — 失效模式 + Non-trading-day 兼容
**內容**:沿用 v1。
**驗證方式**:
- 自動化:`backend/tests/test_options_routes.py::test_*_failure_modes` 覆蓋 502 / timeout / missing data
- real-env:選週末 + 剛上市週合約截圖

### SC-10b — Failure isolation(v3:F12 修,降級為 RTL 測,不走 DevTools MCP)
**內容**:4 個 endpoint 任一失敗,**其他 3 個獨立顯示資料**。
**驗證方式**:
- 元件測試(**取代 v2 的 DevTools MCP / MSW**):`frontend/src/components/OptionsChipPanel.test.tsx` 使用既有 `vi.spyOn(optionsApi, X).mockRejectedValue()` pattern:
  ```typescript
  vi.spyOn(optionsApi, "pcr").mockRejectedValue(new ApiError(502, "upstream_unavailable"));
  vi.spyOn(optionsApi, "maxPain").mockResolvedValue(mockMaxPain);
  vi.spyOn(optionsApi, "oiWalls").mockResolvedValue(mockOIWalls);
  vi.spyOn(optionsApi, "institutional").mockResolvedValue(mockInst);
  render(<OptionsChipPanel ... />);
  // assert: PCR card error chip 出現
  // assert: 其他 3 卡片正常 render mock 資料
  ```
- 不再做 E2E DevTools MCP 版本(避免引入專案沒有的 MSW 依賴)

### SC-11 — Data quality warnings(v3+v4 修)
**內容**:所有 endpoint payload 帶 `data_quality_warnings: string[]`。Warning string format 固定(ISO date)。

**`latest_settlement_pending` 是 payload top-level boolean,不是 warning string**(v4 F24 釐清),從 warning catalog 移除。`partial_history_first_week` 由 `insufficient_data` flag 覆蓋(v4 F25 釐清),也撤出 catalog。

| Warning string | 觸發 |
|---|---|
| `pcr_walk_forward_warmup_skipped_first_{N}_days` | 單一 consolidated;N = 需被 skip 的天數 |
| `per_contract_pcr_unsupported_for_weekly_consider_all_months` | scope=per_contract + weekly contract |
| `pcr_stats_low_power_high` / `_neutral` / `_low` | next-day stats region samples < 30 |
| `next_day_stats_dropped_samples_5pct` | tx_returns[t+1] missing > 5% |
| `after_hours_partial_coverage` | Institutional lookback 跨 2021-10-13 |
| `correlation_sample_small` | Correlation < 30 effective samples |
| `dynamic_wall_partial_window` | OI Wall delta_window > days_since_listing(contract-level) |
| `dynamic_wall_partial_listing` | 任一候選 strike 在 window 起始日尚未上市(v4 N13)|
| `dynamic_wall_no_activity` | max activity == 0(v4 N13)|
| `lookback_exceeds_canonical_window` | 在 route 層 reject 400 前的 dev-debug warning(其實是 400 error code,不寫入 warnings)|

UI 在卡片底部顯示 warnings list(灰色,小字)。
**驗證方式**:
- 自動化:每個 parser 對應 fixture 觸發 warning → assert 字串完全相等(不是 substring)
- 元件測試:warning array 不為空時 `data-testid="warnings"` 區塊顯示
- real-env:截圖剛上市週合約看 `dynamic_wall_partial_window` warning

## Edge cases(v2 擴充,≥ 8)
1. **結算日當天**:資料未更新 → `latest_settlement_pending=true` 標示,該樣本剔除(SC-5/6/11)
2. **FinMind 502 / timeout / rate limit**:每 endpoint 各自獨立 error,前端 failure isolation(SC-10b)
3. **歷史資料不足**:`insufficient_data` flag + SC-11 warning
4. **OI 全為 0**:某履約價兩側都 0 → parse_max_pain 跳過(union 也排除)
5. **某 session 缺資料**:夜盤 endpoint 失敗 → 仍顯示日盤,夜盤 = null(F12)
6. **時區 / 結算時間**:用 FinMind 已標準化的 settlement_price,不重算
7. **剛上市週合約**:dynamic OI Wall `partial_window=true`;PCR per_contract 應改 all_months
8. **跨 NIGHT_SESSION_AVAILABLE_FROM 邊界**:Institutional lookback 跨 2021-10-13 → SC-11 warning
9. **PCR walk-forward 早期**:過去視窗 < 30 樣本 → SC-11 warning + region=null
10. **OI Wall tie**:多 strike 同 OI → tie-break by closest to spot(F16)

## Out of scope(沿用 v1)
- ❌ GEX / BS IV 反推 / Vanna / Charm / IV Skew / VIX(MVP2)
- ❌ 多指標共振 combined indicator(MVP2)
- ❌ 失效告警 active alert(MVP2,本 MVP 只顯示 stat 讓 user 判讀)
- ❌ 即時 Tick / HIRO(MVP3)
- ❌ Refresh stampede debounce(MVP2,R7)
- ❌ 自動下單(永遠不做)

## Cycle-count tracking
所有 SC 的回退計數 → 參見 `state.json.sc_cycle_counts`(本檔不重複)
