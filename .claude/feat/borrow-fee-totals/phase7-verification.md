# Phase 7 verification — borrow-fee-totals

驗證基準 HEAD:e7848c7(Phase 5 全套於此 HEAD 跑綠:pytest 689 / ruff clean /
vitest 985 / build ✓ / e2e 61 passed)。brainstorm.md 重讀核對,SC 逐條:

| SC | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據路徑 | regression 抽樣對象 |
|---|---|---|---|---|
| SC-1 payload month_shares | backend/services/daytrade_fee.py:255-258 | test_month_shares_sums_all_rows_including_same_day + test_month_shares_keys_match_month_counts(pytest 689 全綠內);route passthrough + tests_e2e contract 8046==17000 | curl probe:month_shares 存在,2344=1,043,000(real-env round JSON case 3) | 既有 get_day 8 tests(回退鏈/NTD/partial/404)綠 |
| SC-2 選股 summary UI | frontend/src/components/BorrowFeePage.tsx:92(testid)+ derived 區 | BorrowFeePage.test.tsx「選股加總 summary」5 tests(17/17 全綠) | evidence/SC-2_SC-3_stock-summary-2344.png(filter 下方、繁中文案、ink 階層) | 既有 page 7 tests + 篩選 5 tests 綠 |
| SC-3 同日多筆合計 | 同 SC-1(backend 全列相加)+ BorrowFeePage dayTotal reduce | vitest 本日 8,000 = 3,000+5,000 手算;pytest 17,000 = 2,000+12,000+3,000 | 截圖:2344 本日 12,000 = 7,000+3,000+1,000+1,000(4 列真資料) | month_counts 語意測試(同日算 1 次)綠 — 次數/股數雙軌不互污 |
| SC-4 e2e BF4 | e2e/specs/borrow-fee.spec.ts:57 | BF4 綠(全套 61 passed;fixture 值以 scratchpad script 重算非 design 預估) | subsumed by Phase 5: borrow-fee.spec BF4(本 SC 即 e2e 交付物;UI 另有上列真截圖) | BF1/BF2/BF3 綠 |
| SC-5 regression | BorrowFeePage.tsx(未選股不 render 分支) | 既有 BorrowFeePage 12 tests 綠;skew /「—」無次數段 case 綠(Phase 4 F1 鎖) | real-env:清除選股 → summary 消失、全表 91 rows 恢復;NTD badge / 排序 / 標色不變 | e2e 全套 61 passed |

Edge cases:1(同日多筆)pytest+vitest+real-env ✓;2(今日無列 0 股/月照顯)vitest ✓;
3(缺 key「—」無次數段)vitest ✓(Phase 4 F1 補 skew 反向鎖);4(partial 低估 no-op)
既有 partial tests 綠、summary 無新文案 ✓。

結論:5/5 SC 全 PASS,無 FAIL 分流。
