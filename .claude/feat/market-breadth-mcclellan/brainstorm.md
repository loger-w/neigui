# Brainstorm — market-monitor-v2 P2 McClellan Oscillator + AD Line

**Date**: 2026-07-01
**Type**: /feat(接 P1 universe filter,執行 spec.md §6.3)
**Scope**: M(3 檔 + 加新 FinMind TaiwanStockPrice window usage) — 不升 L(無 hot path / 鑑權 / 加密 / 金流)

## Canonical source

| 角色 | 路徑 |
|---|---|
| 規格(P0 brainstorm 等價) | `docs/specs/market-monitor-v2/spec.md`(§3 SC-4 / §6.3 / §8 breadth payload) |
| 計劃(P1 design 等價) | `docs/specs/market-monitor-v2/plan.md`(Phase 2) |
| 驗證證據 | `docs/specs/market-monitor-v2/verification.md`(P2 §5.2 追加) |

## 成功條件(SC-N 編號 + 驗證方式)

抓自 spec.md §3 SC-4 + plan.md Phase 2 TDD 6 條 + 「完成條件」:

| SC | 描述 | 驗證方式 |
|---|---|---|
| SC-1 | 純函式 `compute_ad_line(daily_counts)` 累計正確:`AD Line[t] = AD Line[t-1] + (up[t] - down[t])` | unit test 1(`test_compute_ad_line_accumulates`) |
| SC-2 | 純函式 `compute_rana` + `compute_mcclellan` 正確:`RANA = (up-down)/(up+down)`,`McClellan = 19-EMA(RANA) - 39-EMA(RANA)`,手算驗證 | unit test 2(`test_compute_rana_bounded`, `test_compute_mcclellan_matches_hand_calc`) |
| SC-3 | 訊號偵測:`thrust_dot`(McClellan 越過 ±100)、`centerline_cross`(穿越 0)、`divergence_dot`(TAIEX 新高但 McClellan 沒新高)三種,只回 dot label 不寫文案 | unit test 3(`test_thrust_dot_above_plus_100`, `test_centerline_cross_up`, `test_divergence_detect_bearish`) |
| SC-4 | orchestrator `compute_breadth(end_date, universe, lookback_days=60)` 拿 FinMind daily prices + TAIEX close 序列 → BreadthResult(spec §8 shape) | unit test 2(`test_compute_breadth_shape`, `test_compute_breadth_uses_injected_universe`) |
| SC-5 | Edge case:universe 為空 → 明確 raise `ValueError("universe_empty")`;TAIEX fetch 失敗 → BreadthResult 仍回但 `divergence_dot=None` | unit test 2(`test_compute_breadth_empty_universe_raises`, `test_compute_breadth_taiex_fetch_fail_divergence_null`) |
| SC-6 | 整合:`services/finmind_realtime.py` snapshot payload 追加 `breadth` 欄位,舊 4 panel(gainers/losers/amount/volume_ratio)+ `universe_size`/`excluded_count` 完全不動 | integration test 1(`test_snapshot_payload_adds_breadth`)+ 既有 P1 全綠 |

## Edge cases

1. **universe 為空** → `raise ValueError("universe_empty")`(SC-5 覆蓋)
2. **新上市股某日無 daily row** → 該股當日 skip(從當日 up/down count 排除),不 crash
3. **加權指數 fetch fail**(httpx.HTTPError)→ breadth 仍回但 `divergence_dot=None` + `logger.warning`(SC-5 覆蓋)
4. **lookback 內遇連假** → trading day sparse,以 FinMind 實際回傳的 date 為準(不填 NaN 空日)
5. **EMA warm-up 不足**(daily_counts 天數 < 39)→ mcclellan_series 前 38 點值為 None(或 skip),thrust_dot=None
6. **RANA 分母為 0**(某日 up==0 && down==0,罕見連假前後)→ RANA[t]=0.0 而非 NaN
7. **Divergence 演算法窗口不明**(spec §6.3 未定)→ **[amendment 2026-07-01: Phase 1 review F4 revision]** 決策:採 StockCharts ChartSchool McClellan divergence 慣例 `window=20`(rolling max/min),`window` 抽參數但 default=20。**舊決策(scrapped)**:「近 lookback_days 內 TAIEX close 新高的最後 3 個交易日 vs McClellan 同期間新高最後 3 個 → 若 TAIEX 新高而 McClellan 未新高 → `bearish`」— 過度精細,20-day rolling max 更 robust,理由見 design.md §8.4
8. **TAIEX stock_id 未定**(0001 vs TAIEX)→ 先試 `TAIEX`,404/空 → fallback `0001`,兩者皆失敗 → SC-5 path

## Out of scope(留 P3/V2.5)

- Frontend `MarketBreadthPanel.tsx`(spec.md Phase 5)
- Sector breadth heatmap / sector amount share(spec.md §6.2/§6.4,plan.md Phase 3-4)
- McClellan ±100 thrust 閾值 backtest 校準(spec.md §9 known gap,V2.5)
- 舊 leaderboards `gainers/losers` 移除決策(1 release 觀察期)

## S/M/L 判定 = **M**

- 動的檔 3 個(1 service + 1 test + 1 integration)
- 加新 FinMind dataset window usage(TaiwanStockPrice without data_id + 全 universe date range) — 算「加新資料流」
- API contract add-only(`breadth` 新欄位,舊欄位不動)
- **不**在 hot path / 不碰鑑權 / 加密 / 金流 → **不升 L**

→ Phase 1/2 各 1 輪 review(M 分流);Phase 4 review 完整跑(多 lens fan-out per goal spec)

## Known gap(記 state.json)

- **G1**:McClellan ±100 thrust 閾值是美股 ~3000 issues 校準,台股 ~1000 issues 可能不準 → 標 known gap 記 spec §9,V2.5 補 backtest 校準
- **G2**:加權指數 stock_id 在 FinMind 為 `TAIEX` 或 `0001`,implementation 期間 probe 確認;若 token expired 無法 probe → 兩者都試作 fallback strategy(不寫死)
