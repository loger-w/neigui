# Phase 7 — 回頭核 goal(2026-07-11,HEAD fresh 驗證)

重讀 brainstorm.md SC-1〜SC-8 逐條對證據。fresh gates @ HEAD:pytest 674 passed(exit 0)/ ruff clean / vitest 730 passed / build exit 0 / e2e 33 passed。

| SC-N | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據路徑 | regression 抽樣對象 |
|---|---|---|---|---|
| SC-1 每日 archive | services/warrant_iv_history.py:212(archive_from_snapshot)、:249(ensure_post_build_task)、warrants.py:461(_build_and_store hook) | test_warrant_iv_history.py TestArchive ×7(含冪等/R3/R8/R7/R21)— 25 檔全綠 | real-env-verification-round-1.json check#1(真實 snapshot 觸發 post-build,archive 檔 2026-07-09 存在) | 既有快照 build:test_warrants_service 全綠(674 總數內) |
| SC-2 60 日 backfill | services/warrant_iv_history.py:471(ensure_backfill_task)、:497(_backfill) | TestBackfill ×4(跳既有/非交易日 retry/today-1/FinMind 缺口/ETF 過濾) | 真實 backfill 60 檔(2026-04-15→07-09),颱風/端午正確跳過;evidence/SC-3_threshold-calibration.txt | FinMind 既有 client:test_finmind.py 全綠 |
| SC-3 drift 純函式 | services/warrant_iv_drift.py:1-100 | test_warrant_iv_drift.py ×12(五合成 case + 洞不壓縮 + 攤平) | 門檻真實校準 evidence/SC-3_threshold-calibration.txt(n=26,248;0.30 定案);rebuild 實測 ~25s < 60s 降階線 | — |
| SC-4 snapshot merge | services/warrants.py:507(get_underlying_warrants merge) | test_warrants_routes.py::test_warrants_rows_carry_iv_drift(R10 mutation-verified)+ tests_e2e contract | curl /api/warrants/2330:1,114 檔全列帶 iv_drift(11 declining) | warrants shape 既有 tests + E8 e2e |
| SC-5 iv-history endpoint | routes/warrants.py:57;services/warrant_iv_history.py:394(get_iv_history) | routes ×5(200/404/400/502/空 archive 200)+ tests_e2e ×2 | evidence/SC-5_iv-history-happy-051343.json + curl 400/404 log | /quotes /brokers 路由:既有 routes tests 全綠 |
| SC-6 全表 drift 欄 | components/WarrantSelector.tsx:70(HEADERS)、:437(cell) | WarrantSelector.test.tsx IV趨勢 ×2(label 對映 + 文案鎖)— 730 總數內 | evidence/SC-6_iv-drift-column-6442.png(長期遞減/長期遞增真實呈現) | 既有表格欄:E8/E9 e2e 綠 |
| SC-7 展開區時序圖 | components/WarrantIvHistory.tsx、lib/warrant-iv-svg.ts、hooks/useWarrantIvHistory.ts | WarrantIvHistory ×6 + warrant-iv-svg ×5 + hook ×3 | evidence/SC-7_iv-chart-expanded-080847.png(60 日雙線 + 斷線 + 近似註記;console 0 errors) | 既有分點展開:E11 e2e 綠 + 截圖內分點表正常 |
| SC-8 e2e | e2e/specs/equity.spec.ts E12/E13 | e2e 33 passed(fresh @ HEAD,含 E12/E13) | subsumed by Phase 5(真 browser + FAKE backend 全鏈) | 全 spec 33 passed(E1-E13/O/M/N/NTD/L) |

判定:**8/8 SC 通過**,無 N/A、無「應該可以」。sc_cycle_counts 全程零回退(稀疏記帳,state.json 無 SC 條目)。

補記(非 SC 缺口):drift 門檻校準(0.15→0.30)為 design §5 明文預留的實作期校準,已以 [auto-default] 落檔;rising 側 vol regime 混淆為 known limitation 記 docs/next-time.md。
