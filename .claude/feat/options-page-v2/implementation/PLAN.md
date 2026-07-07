# options-page-v2 — Implementation PLAN(condensed)

> Phase 2 artifact | 上游:design.md v3 | mode=condensed(state.json)
> goal_efficiency_mode=true → Phase 3 wave batch commit,`[waveN]` tag,body 列涵蓋 SC。
> 前端 UI wave 開工前必呼叫 `frontend-design` + `bencium-controlled-ux-designer`。

## Wave 對映

| Wave | 內容 | SC | commit 類 |
|---|---|---|---|
| W0 | probe MTX/TX dataset + pytest fixtures + e2e FAKE fixtures + MANIFEST | SC-4/5 前置 | 🟢(fixture only) |
| W1 | Backend 計算修正(oi_walls 三修 + strike_volume 兩修)+ 測試 | SC-1/2/3 + §1.4 | 🔴 |
| W2 | Backend 新資料(futures parser + fetch + routes + series 擴充)+ 測試 | SC-4/5 + §2.4 | 🟢 |
| W3 | Frontend 基建(types / api / hooks / conclusion lib)+ 測試 | SC-6 前置 + SC-8 前置 | 🟢 |
| W4 | Frontend UI(range-svg + 六元件 + OptionsPage 重排 + 刪三舊元件)+ 測試 | SC-6~10 | 🟢 + 🔴(刪舊) |
| W5 | e2e(O# 改寫 / L# / V# baseline)+ changelog | SC-11 + e2e 歸屬表 | 🟢 |

## W0:Probe + fixtures

> Review round 1(`impl-review-round-1.json`)7 條修入:R1 W3 該變清單補 frontend、R2 hook 測試、R3 route warning 測試、R4 selectors.ts、R5 新掛牌分支測試、R6 PCR 文案對齊、R7 probe 位置。

### `backend/tests/fixtures/futures/probe.py`(NEW,一次性;R7 修:沿 options_chip/probe.py 擺放慣例)
- 沿 `tests/fixtures/options_chip/probe.py` pattern:Bearer header(不是 ?token=)打 `TaiwanFuturesDaily`(data_id=MTX)+ `TaiwanFuturesInstitutionalInvestors`(data_id=MTX、TX)各 1 日,sanitize 後落 `backend/tests/fixtures/futures/*.json`。
- 驗欄位:法人名稱欄位與值域(外資/自營商/投信 對映)、long/short OI 欄位名、MTX 總 OI 欄位。**欄位與 design §2.1 假設不符 → 停,回 Phase 2 修簽名**(design KR-2)。
- Token 過期 → infra_fail fallback:hand-built fixtures + parser docstring 標 `# field_name_unverified_pending_probe`,Phase 6 前必真驗。

### e2e fixtures:`backend/tests_e2e/fixtures/` + `MANIFEST.json`
> [phase-3 補註] e2e fixtures + MANIFEST 條目**移到 W2 同 commit**:`test_manifest_keys_match_real_get_call_shapes` gate 要求 dataset 名出現在 services/finmind*.py 的 `_get`,W2 fetch 落地前加條目必紅。fixture 檔已由 probe 產出、暫存 scratchpad,W2 搬回。
- 新增 MTX TaiwanFuturesDaily + TaiwanFuturesInstitutionalInvestors(MTX/TX)fixture 檔,**同 commit** 加 MANIFEST 條目(filename→{dataset, data_id});`test_fake_finmind_manifest.py` 3 gate 會抓 drift。
- 基準日對齊現行 fixture 2026-06-26(Fri);寫死日期前 `python -c "...strftime('%A')"` 驗星期。

## W1:Backend 計算修正(🔴)

### `backend/services/finmind_options.py`
- `_pick_static_wall(oi_map, spot: float | None, side: str) -> dict | None`:side 過濾(call→`K>=spot` / put→`K<=spot`)→ 空候選 None;max OI + closest-to-spot tie-break 不變。
- `parse_oi_walls(..., spot: float | None)`:入口 `spot is None` → 四牆 None + `band_width_pct=None` + warnings=`["oi_walls_no_spot"]` 直接 return;側別空候選 → `static_wall_no_otm_candidate_{call|put}`;dynamic 改 `net_increase(K)=oi_end−oi_start` 取最大正值(`_pick_dynamic_wall(net_increase_map, spot: float)`,全≤0 → None + `dynamic_wall_no_net_increase`);欄位 `window_activity_oi`→`window_net_increase_oi`;刪 `dynamic_wall_no_activity`;`band_width_pct` 有值恆 ≥0。
- `parse_oi_walls_hit_rate`:樣本需 t-1 close 且雙側牆非 None,否則剔除;`dropped_no_close: int` 入回傳 + warning 固定字串 `hit_rate_samples_dropped_no_close`;刪 anchor=0.0 fallback。
- `parse_strike_volume`:保留規則改 `volume>0 OR oi>0`;`today` 改「最近有 OI 的日子」fallback(與 fetch_oi_walls F7 同準則:該日任一 strike OI>0);`oi_change` 相對前一個「有 OI 日」。
- 常數:`_CACHE_VERSION_OPTIONS_CHIP` 1→2;新增 `_CACHE_VERSION_STRIKE_VOL = 2`(strike_volume 專用;`_CACHE_VERSION_OPTIONS` 不動,spot/oi_lt 不波及)。

### `backend/services/finmind.py`
- `fetch_oi_walls`:1497 `float(spot_payload.get("spot") or 0.0)` → `spot_raw = spot_payload.get("spot"); spot_val = float(spot_raw) if spot_raw is not None else None`。
- `fetch_strike_volume`:cache key 改用 `_CACHE_VERSION_STRIKE_VOL`。

### 該變 assertion 清單(既有測試,紅前先標)
- `tests/test_finmind_options.py`:`test_parse_oi_walls_static_tie_break_by_spot`(全域 max → OTM 限制)、`_dynamic_uses_activity_not_telescoping_delta`(activity → net increase,改名)、`parse_strike_volume` 系列(volume==0 drop → 保留 oi>0;today 選日)、hit rate 系列(anchor fallback 刪除)。
- `tests/test_options_routes.py`:oi_walls payload 欄位名 + warnings。
- `tests_e2e/test_api_options.py`:oi_walls / strike_volume schema assertion。

### 新增失敗測試(對應 SC)
- SC-1:`test_parse_oi_walls_static_call_wall_otm_only` / `_put_wall_otm_only` / `_no_otm_candidate_returns_none_with_warning` / `_band_width_non_negative`
- SC-1(route):`test_oi_walls_spot_missing_returns_null_walls_only_no_spot_warning`(assert 無 `static_wall_no_otm_candidate_*`)
- SC-2:`test_parse_oi_walls_dynamic_net_increase_first_last_diff` / `_all_nonpositive_returns_none` / `_payload_field_renamed` / `_new_listing_strike_full_increase`(R5 修:oi_start 缺 → 全額增倉 + partial_window)
- SC-3:`test_parse_oi_walls_hit_rate_otm_restricted_uses_t1_close` / `_drops_samples_without_close_fixed_warning`
- §1.4:`test_parse_strike_volume_keeps_zero_volume_positive_oi` / `_today_falls_back_to_last_oi_day`

## W2:Backend 新資料(🟢)

### `backend/services/finmind_futures.py`(NEW)
- `_CACHE_VERSION_FUTURES = 1`;`from __future__ import annotations`;純函式零 I/O。
- `parse_retail_mtx(rows_total: list[dict], rows_inst: list[dict]) -> dict`:per-day total_oi = `trading_session=="position"` 且 `contract_date` 匹配 `^\d{6}(W\d)?$`(**含週合約**、排除價差 — probe 證實法人資料為商品層級涵蓋全部到期月;after_market rows OI 恆 0)加總;inst 三法人 long/short 合計(欄位 `institutional_investors` / `long|short_open_interest_balance_volume`,probe 已驗);retail_long/short = total − inst;`ratio=(rl−rs)/total_oi`;日資格:total_oi==0 **或**該日無任何法人 rows **或** retail_long/short < 0(口徑不符偵測,另記 warning `retail_mtx_negative_retail`)→ 整日 drop 計 `dropped_days`;回傳 `{current:{retail_long,retail_short,ratio}, series:[{date,ratio}](≤20), as_of_date, dropped_days, data_quality_warnings}`(dropped>0 → `retail_mtx_days_dropped`)。probe 證據:`probe-futures-2026-07-07.md`。
- `parse_foreign_futures(rows_inst: list[dict]) -> dict`:外資 rows only;`{current:{long_oi,short_oi,net_oi}, series:[{date,net_oi}](≤20), as_of_date, data_quality_warnings}`。

### `backend/services/finmind.py`
- `fetch_retail_mtx(date_str, refresh)` / `fetch_foreign_futures(date_str, refresh)`:range query(start=end−40d)、TokenBucket、`_run_once`、cache key `retail_mtx_{end}` / `foreign_futures_{end}` version=`_CACHE_VERSION_FUTURES`。
- `fetch_institutional`:payload 加 `series:[{date,foreign_total_net}]`(rows_day call+put 全側 per-date 聚合,新迴圈;**不**動 foreign_history/correlation);slice 末 20。
- `fetch_pcr`:payload 加 `series:[{date,pcr}]`(pcr_history 末 20)。

### `backend/routes/options.py`
- `GET /api/options/retail_mtx` / `GET /api/options/foreign_futures`(`date`/`refresh` query;`run_with_disconnect` + `_is_stale_for_requested` → no_trading_day;無 contract 參數)。

### 測試
- `tests/test_finmind_futures.py`(NEW):parser happy / 缺法人日 drop / total_oi=0 / series 長度 / 欄位名對 probe fixture。
- `tests/test_options_routes.py`:`test_retail_mtx_happy/_502/_no_trading_day`、`test_retail_mtx_missing_inst_days_warning`(R3 修:assert `dropped_days>0` + 固定字串 `retail_mtx_days_dropped`)、`test_foreign_futures_happy/...`;institutional/pcr series 欄位測試。
- `tests_e2e/test_api_options.py`:兩新 endpoint contract shape。

## W3:Frontend 基建(🟢)

### `frontend/src/lib/options-types.ts`
- `OIWallDynamic.window_activity_oi` → `window_net_increase_oi`;`band_width_pct: number | null`;`OptionsOIWallsHitRate` 加 `dropped_no_close: number`;`OptionsInstitutional` / `OptionsPCR` 加 `series`;NEW `OptionsRetailMtx` / `OptionsForeignFutures`。

### `frontend/src/lib/options-api.ts`
- `retailMtx(date, opts)` / `foreignFutures(date, opts)`(沿既有 `__apiGet` + signal 直傳)。

### `frontend/src/lib/options-conclusion.ts`(NEW)+ `options-conclusion.test.ts`
- `buildConclusion(i: {spot: number|null, putWall: number|null, callWall: number|null, maxPain: number|null}): string[]`。
- 位置句:雙牆齊 → 三等分「偏下緣/中段/偏上緣」;`spot > callWall`(嚴格)→「已越過壓力」;`spot < putWall` →「已跌破支撐」;等值算區間內邊緣;單側缺 →「上方/下方無明顯 OI 牆」;spot 缺 → 無位置句。
- Max Pain 句:`|spot−maxPain|/spot < 0.0005` →「與現價幾乎重合」否則「在現價上/下方 x.x%」;缺 → 省。
- 測試:全分支 + 禁方向性文案(輸出 join 後 `/做多|做空|賣選|滿倉/` 不匹配)。

### hooks:`useRetailMtx.ts` / `useForeignFutures.ts`(NEW)、`useOptionsChip.ts`(Modify)
- TanStack `useQuery` + `{data,loading,error,refresh,noTradingDay}` 標準 shape(樣板=useMaxPain);useOptionsChip 聚合加 `retail` / `ff`,refreshAll / anyNoTradingDay 納入。
- 測試(R2 修):`useRetailMtx.test.ts` / `useForeignFutures.test.ts`(happy / error / noTradingDay,樣板=useOptionsStrikeVolume.test.ts)+ `useOptionsChip.test.ts` 聚合擴充(refreshAll 觸發新 hook、anyNoTradingDay 含新 hook)。

### W3 該變 assertion(R1 修)
- types 改名 `window_activity_oi` → `window_net_increase_oi` 會壞:`OptionsChipPanel.test.tsx`(object literal 寫死舊欄位)、其他引用舊欄位的既有測試(W3 開工時 grep `window_activity_oi` 全清)。處置:**W3 同 commit** 更新這些尚存檔案的 fixture 欄位名(W4 才刪的檔不能留到 W4,避免中間 wave tsc 紅)。

## W4:Frontend UI(🟢 + 刪舊 🔴)— 開工前先呼叫 frontend-design + bencium-controlled-ux-designer

### `frontend/src/lib/options-range-svg.tsx`(NEW)+ test
- `RangeMapSvg({rows, metric, spot, walls, maxPain, width})` 純渲染;縱向 strike 軸沿 ladder 慣例。
- 視窗:spot 上下各 20 檔,牆/Max Pain 窗外則擴窗,其餘截尾;牆 strike 缺 bar 仍畫標記;**配色翻轉**(基底 StrikeLadder 是反色遺留):call bar/牆 = bear 綠、put = bull 紅,`data-testid="wall-call"` / `"wall-put"` 正向 assertion。
- `options-svg.tsx`:刪 StrikeLadder + maxOIStrike,留 MiniBar/Sparkline;`options-svg.test.tsx` 對應測試遷 `options-range-svg.test.tsx`。

### 元件(NEW ×5 + Modify ×2 + Delete ×3)
- `OptionsConclusionBar.tsx`:吃 buildConclusion 輸出;句空 → 「結論生成資料不足」;test 含禁文案 assertion。
- `OptionsRangeMap.tsx`:wrapper + OI/成交量 toggle(useState,預設 oi)+ `sv.as_of_date !== ow.as_of_date` → 隱藏牆 + 「牆資料基準日不同」註記。
- `OptionsThermometerRow.tsx`:四格 config-driven;判讀句純函式 `buildTileReading()` 同檔 export;外資格第二行期貨對照;「較昨日」= series 末兩點差;fallback 文案(R6 修,對齊 design edge 表):PCR 格資料不足 →「資料不足」,其餘格 error/缺資料 →「—」;Sparkline 沿用 options-svg。
- `OptionsAdvancedPanel.tsx`:收合(`hidden` attribute);內容 = 四卡 + `OptionsNetTable` + 日夜盤(自 InstitutionalCard 現況)+ hit rate 剔除數。
- `OptionsNetTable.tsx`:NET 四組(當日 net + 20D 變化)+ 特定法人 vs 全交易人說明段。
- `OptionsMaxPainCard.tsx`(Modify):加 spot prop → 「距現價 ±x.x%」;賣方總賠付/履約價數/call-only 移 tooltip。
- `components/ui/tooltip.tsx`(NEW,若 ui/ 無):Radix tooltip;四術語白話解釋(繁中 ≤2 句)。
- `OptionsPage.tsx`(Modify):§0 新結構;刪 `OptionsChipPanel` / `OptionsLargeTradersStrip` / `OptionsStrikeLadder` 三檔與其 test(assertion 遷 AdvancedPanel/NetTable/RangeMap 測試)。

## W5:e2e + changelog(🟢)

### `e2e/specs/options.spec.ts`
- O1 → 結論列 + 溫度計四格 visible;O2 → RangeMap + AdvancedPanel 展開;O3 → RangeMap 牆 testid 非空 + 色 class 正向斷言;O4 → refresh;O5 → 375px 無水平溢出。每 test 帶 `// 痛點:` 註解;selector 對 page snapshot。
- `live-contract.spec.ts`:L# 兩新 endpoint schema(`@live`,本機 `npm run test:live`,CI 不跑)。
- `visual.spec.ts`:V# baseline 重拍(`npm run test:update-snapshots`)。
- `no-trading-day.spec.ts`:確認 selector 沒壞(行為不變)。
- `e2e/helpers/selectors.ts`(R4 修):刪 `optionsStrikeLadder` / `optionsLargeTradersStrip` 兩個失效 TESTIDS;新增結論列 / RangeMap / ThermometerRow / AdvancedPanel testid 常數(與 W4 元件 data-testid 對齊)。

### `frontend/src/lib/changelog.ts`
- MINOR bump 新 VersionEntry(寫前讀 `changelog-conventions` skill;含 UX 重排 + 兩新指標 + OI 牆修正)。

## 驗證指令(Phase 5 對照)
- backend:`python -m pytest -q` + `ruff check .`
- frontend:`npm test` + `npm run build`
- e2e:`npm test`(FAKE);`npm run test:live`(L#,本機)
