# Phase 7 — 回頭核 goal(daytrade-borrow-fee)

重讀 brainstorm.md 後逐 SC 核對;驗證輸出全部為本 phase fresh 執行(2026-07-11,HEAD be407b1):
pytest **544 passed, 1 skipped** + ruff **All checks passed** + vitest **655 passed / 69 files** + build **✓ 1.44s** + e2e **26 passed / 2 skipped(22.4s,AI 實跑)**。

| SC | 實作檔案:行號 | 自動化測試 + pass count | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 | ModeSwitch.tsx:3,14(Mode+MODES)、App.tsx:62-66,~478(lazy + 4-way ternary) | e2e N1 四 mode 迴圈 + N4 borrow unmount 步 + BF2 reload 持久化(26 passed 內);vitest App.test 3 新 case + ModeSwitch.test 7 case | `SC-1_SC-2_SC-3_borrow-mode-real-data.png`(四顆 tab、券差 active) | N4 同測 equity/options/market unmount 鏈 |
| SC-2 | services/daytrade_fee.py:245(get_day)、routes/daytrade_fee.py:20、DaytradeFeeTable.tsx | pytest test_get_day_merges_markets_sorted_fee_desc 等 8 測 + tests_e2e contract 2 測;vitest DaytradeFeeTable 6 測;e2e BF1 資料級 | 同上截圖(真實 as_of 07-09,上市/上櫃合併、7% 置頂) | options / equity mode 渲染截圖(real-env round-1 JSON) |
| SC-3 | borrow-fee.ts:22 + daytrade_fee.py:27(threshold ×2)、DaytradeFeeTable.tsx(fee-high) | pytest test_fee_highlight_threshold_value + vitest 同名鎖;vitest fee-high testid + 方向文案 null(table+page 兩層) | 同上截圖(7.00% accent 標色、其餘原色) | — |
| SC-4 | daytrade_fee.py:245-268(回退鏈 + no_trading_day + partial) | pytest 回退三態 + flag 4 測 + partial 3 測;vitest hook noTradingDay + page badge | **真實非交易日態**(週六自然觸發):badge「非交易日,顯示最近可得日」入鏡 | curl /api/daytrade-fee payload 核對 |
| SC-5 | borrow-fee-utils.ts(sortRows)、DaytradeFeeTable.tsx(handleSort/aria-sort) | vitest sortRows 5 測 + 元件排序互動 2 測 | `SC-5_sort-by-shares-desc.png`(68,000 置頂 + ▼ 指示) | — |
| SC-6 | daytrade_fee.py:212(fetch_month cache 語意)、193(_fetch_and_store) | pytest cache/refresh/stale/不朽/P0-1 兩道保護 6 測 | subsumed by pytest(brainstorm 驗證方式即 pytest);UI refresh 鈕實測可點 | — |
| SC-7 | daytrade_fee.py:84,100(normalize ×2) | pytest 髒點 3 測(民國兩格式/padding/千分位/%/leading-space key/壞 row) | 真實 payload 過同一 parser(real-env 表格數字正確即 parser 實證) | — |
| SC-8 | changelog.ts:42-53(v0.24.0 entry) | vitest changelog.test 14 passed(版本釘 + date 單調 + scope enum) | 截圖右上 v0.24.0 badge 入鏡 | — |
| SC-9 | — | 本節頂部 fresh 全套輸出 | 截圖已入 docs/specs/daytrade-borrow-fee/screenshots/(2 張) | — |

Edge cases 覆蓋核對:#1 stat!=OK(pytest)/ #2 partial(pytest 3 測 + UI 註記字串)/ #3 ETF(00631L 真實入鏡)/ #4 7% 不 clamp(真實入鏡)/ #5 同股多筆 + 月次數去重(pytest 2 測 + 南亞科真實入鏡)/ #6 TLS(custom ssl context 真環境 286 rows 實證,`verify=False` 未使用)。

判定:**全 SC pass,無回退**。sc_cycle_counts 維持全零。
