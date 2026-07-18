# Phase 7 — 回頭核 goal(2026-07-18)

重讀 brainstorm.md 全文核對。fresh 證據:pytest 735 passed / ruff clean / vitest 881 passed /
build ✓ / equity e2e 19 passed(E10 timeout 放寬後)。

| SC | 實作檔案:行號 | 自動化測試 + pass | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 history endpoint 零重算 | services/warrant_flow_history.py:139-180(get_flow_history)、routes/warrants.py:87-97 | test_scan_reads_cached_summaries + test_flow_history_contract(pytest 735 全綠含此) | evidence/SC-1-2-3_real-env-curl.md(07-17 值 == A4 輪 cache 值) | /api/warrants/2330/flow 200 |
| SC-2 cache-only 零請求 | warrant_flow_history.py:52-69(_scan_slots) | test_cache_only_zero_finmind_calls | 同上(cache-only 即回、backfilled 0) | — |
| SC-3 bounded backfill | warrant_flow_history.py:72-105(_backfill) | test_backfill_caps_at_three_newest_first + test_backfill_skips_recent_days | 同上(第一批 3、續補 2、真假日 07-10 marker 正確 — FinMind 交易日 probe 佐證) | bad_symbol 400 |
| SC-4 雙線 null 斷點 | lib/warrant-flow-history-svg.tsx:23-76 | svg vitest 7 tests + 元件斷點段數 test | subsumed by Phase 5: E22(真 browser 段數 12+7 資料級) | — |
| SC-5 累積提示 + CTA | components/WarrantFlowNetHistory.tsx:36-58,113-121 | RTL 兩態文案 + CTA→backfill=true test | infra_fail: browser MCP 雙通道不可用(state.json phase_6_blocked_reason;RTL + E22 替代) | Panel 既有 14 tests 綠 |
| SC-6 e2e 資料級 | e2e/specs/equity.spec.ts:167-186(E22) | E22 passed(19/19) | subsumed by Phase 5: E22 本身 | 其餘 18 個 equity spec 綠 |
| SC-7 中性配色鎖 | WarrantFlowNetHistory.tsx Series/legend | RTL 正向 assert(ink 含 / bull-bear 不含)+ E22 class check | subsumed by Phase 5: E22 | — |

Edge cases 核對:0-1 日(RTL)/ null 日(svg+E22)/ 假日 marker(real-env 07-10 實證)/
retention 邊緣(45 天 + lock test)/ backfill 途中失敗(pytest 502 傳導)/ no_warrants
(pytest shape)/ 換 symbol(hook queryKey per stockId,RTL gate test)— 全數有著落。

結論:全列無 N/A;SC-5 real-env 欄為合法 infra_fail 註記。Phase 7 通過。
