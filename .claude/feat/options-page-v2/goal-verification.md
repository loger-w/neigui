# options-page-v2 — Phase 7 結構化證據表

> Fresh 驗證(2026-07-07 19:20,head da76107):backend pytest **515 passed** + ruff clean;
> frontend vitest **626 passed** + build 綠(19:14,chip 修後);e2e **24 passed, 2 skipped**;
> @live **3 passed**(真 FinMind)。逐 SC:

| SC | 實作檔案:行號 | 自動化測試名 + pass | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 靜態牆價外 | `backend/services/finmind_options.py:579`(`_pick_static_wall`)+ `:626`(`parse_oi_walls`)+ `services/finmind.py` caller(R1 spot None) | `test_parse_oi_walls_static_call_wall_otm_only` / `_put_wall_otm_only` / `_no_otm_candidate_returns_none_with_warning` / `_band_width_non_negative` / `_spot_none_returns_all_walls_none_only_no_spot_warning` / `test_fetch_oi_walls_spot_missing_passes_none_not_zero`(mutation-verified)— 515 綠內 | 真 FinMind:call 49500 ≥ spot 45775 ≥ put 45000、band 9.83%(real-env-verification-round-1.json) | max_pain / pcr 路由測試照綠(同 suite) |
| SC-2 動態牆淨增倉 | 同檔 `:602`(`_pick_dynamic_wall`)+ net_increase_for_side | `test_parse_oi_walls_dynamic_net_increase_first_last_diff` / `_all_nonpositive_returns_none` / `_new_listing_strike_full_increase`(payload 改名 assert 含於 first_last_diff) | 真資料動態雙牆有值(49500/46000);FAKE 單日 fixture 正確回 no_net_increase warning | `test_parse_oi_walls_partial_window_for_young_weekly` 照綠 |
| SC-3 hit rate 側別 | 同檔 `:723`(`parse_oi_walls_hit_rate`) | `test_parse_oi_walls_hit_rate_otm_restricted_uses_t1_close` / `_drops_samples_without_close` / `_t_minus_1`(該變改寫) | 剔除數 UI 透出(CR3;OIWallsCard 測試) | `test_parse_max_pain_hit_rate_uses_t_minus_1` 照綠 |
| SC-4 散戶小台 | `backend/services/finmind_futures.py:50` + `routes/options.py:234` | `test_parse_retail_mtx_*` 8 條(含 probe fixture drift gate)+ `test_retail_mtx_happy/_no_trading_day/_missing_inst_days_warning/_finmind_error_502` + tests_e2e contract | 真資料 ratio +16.6%、series 20、dropped 0;溫度計格截圖 SC-6_7_8 | oi_large_traders 路由測試照綠 |
| SC-5 外資期貨 | `finmind_futures.py:136` + `routes/options.py:248` | `test_parse_foreign_futures_*` 3 條 + 路由 2 條 + tests_e2e contract + @live L2 | 真資料 net −80,042;外資格對照行截圖 | 同上 |
| SC-6 結論列 | `frontend/src/lib/options-conclusion.ts` + `components/OptionsConclusionBar.tsx` | `options-conclusion.test.ts` 17 條(全落區 + null 分支 + 禁方向性)+ `OptionsConclusionBar.test.tsx` 3 條 | 截圖 SC-6_7_8:「TX 45,775 位於支撐 45,000 與壓力 49,500 之間,偏下緣;Max Pain 46,300 在現價上方 1.1%」 | e2e O2 anti-tautology 綠 |
| SC-7 區間地圖 | `frontend/src/lib/options-range-svg.tsx` + `components/OptionsRangeMap.tsx` | `options-range-svg.test.tsx` 12 條(權威牆/翻色正向/視窗/合成列/toggle)+ `OptionsRangeMap.test.tsx` 4 條(as_of 防禦) | 截圖 SC-6_7_8 + SC-7_volume-toggle + SC-7_chip-contrast-fixed;▼ 於 46,300、現價列 45,775 | e2e O3/O6 綠;MiniBar/Sparkline 測試照綠 |
| SC-8 溫度計 | `components/OptionsThermometerRow.tsx` + hooks `useRetailMtx/useForeignFutures/useOptionsChip` | 判讀句純函式 4 組 + component 6 條 + hooks 9 條(happy/error/noTradingDay/refresh) | 截圖:外資 −9,513(delta 等效)+ 期貨對照、前十大 −15,958 + 週選註記、PCR P12 偏低、散戶 +16.6%;mobile 375 overflow=0(SC-8_mobile-375.png) | e2e O1/O5 綠 |
| SC-9 進階收合 | `components/OptionsAdvancedPanel.tsx` + `OptionsNetTable.tsx` | `OptionsAdvancedPanel.test.tsx`(hidden 預設 + 展開 + SC-10b failure isolation 遷入)+ `OptionsNetTable.test.tsx` 5 條 | 截圖 SC-9_10:四卡 + NET 對照 + 說明 + 週選註記;首屏無診斷數字 | e2e O4 綠;InstitutionalCard 日夜盤照舊 |
| SC-10 Max Pain 呈現 | `components/OptionsMaxPainCard.tsx` + `OptionsInfoHint.tsx` | `OptionsMaxPainCard.test.tsx` 3 條(距現價/spot 缺省略/診斷不在首屏)| 截圖 SC-9_10:「46,300 距現價上方 1.1%」+ ? popover;四詞 InfoHint(Max Pain/OI 牆/PCR/delta 等效)皆在 DOM(snapshot uid 1_38/1_456/1_471/1_476) | — |
| SC-11 changelog | `frontend/src/lib/changelog.ts`(v0.23.0,7 條) | `changelog.test.ts` 14 綠(版本釘更新) | 頁面 badge v0.23.0(截圖右上) | changelog invariants 全綠 |

## Edge cases 對照

| Edge | 證據 |
|---|---|
| 1 單側無價外 OI | pytest `_no_otm_candidate_returns_none_with_warning` + conclusion `單側無 call 牆` 測試 |
| 2 spot 恰在牆上 | conclusion `spot 恰等於壓力算區間內` 測試 |
| 3 PCR 資料不足 | ThermometerRow `PCR 資料不足不擋其他格` 測試 |
| 4 MTX 法人缺 | parser `drops_days_without_inst_rows` + route `missing_inst_days_warning` + tile error「—」測試 |
| 5 spot 缺 | parser spot_none 測試 + fetch 層 mutation-verified 測試 |
| 6 無交易日 | e2e NTD1 綠(subsumed by Phase 5) |

## 判定

**全綠,無 N/A、無 infra_fail**。/auto 退出條件「頁面獲取 API 正常使用、console 無 error」由 real-env round 1 證實(console 0 error / 0 red warning)。
備註:SC-5 payload 欄位名 `net_oi`(brainstorm 草稿寫 `foreign_net_oi`,design v1-v3 兩輪 review 定案為 current 巢狀 shape,非漏做);SC-1 warning 分側 `_call/_put`(design R1 定案)。
