# Phase 7 — 回頭核 goal(2026-07-21;HEAD e5f39e5,code tree 乾淨 = Phase 5 全綠證據即現行 code)

重讀 brainstorm.md(非憑記憶)。原始 goal:「針對特定分點,找出他當日的買賣超股票以及買賣超分點」— user 拍板 A 案:排行 + 跳轉既有「該股主力分點」視圖(=「買賣超分點」落點)。

| SC | 實作檔案:行號 | 自動化測試 + pass count | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 反查 endpoint | backend/services/broker_flows.py:118(_aggregate_flows)/ :232(get_daily_flows);backend/routes/broker.py:22;backend/services/finmind.py:657(fetch_daily_report_by_trader) | test_broker_flows.py 聚合 6 案 + happy/名稱 join;test_broker_routes.py 透傳 4 案;tests_e2e/test_api_broker.py 手算基準 2 案(backend 計 700 passed) | evidence/SC-1_SC-2_daily-flows-real-9600.json(真 FinMind:1,012 檔、景碩 +1,699 張 / 11.8 億) | 既有 SecIdAgg 呼叫行為不變(test_fake_secid_agg_existing_call_shape_unchanged) |
| SC-2 回退鏈 | broker_flows.py:70(_candidate_dates)/ :268-294(loop + stale fallback) | 回退/全空 503/計數 ≤3/空不落 cache/stale fallback 共 6 案 | 同上 JSON:**實戰觸發** requested=07-21 → as_of=07-20、no_trading_day=true(週二 10:40 未上料) | NTD spec 既有 e2e 全綠(51 passed) |
| SC-3 目錄搜尋 | broker_flows.py:166(_get_directory_or_none)/ :199(search_traders);finmind.py:666 | search 4 案 + 空白 query + cache 24h + 503;contract test traders 2 案 | evidence/SC-3_traders-search-real.json(50 筆截斷生效,9600 富邦) | — |
| SC-4 分點反查 tab | frontend/src/components/BrokerFlowsPanel.tsx;App.tsx(EQUITY_TABS + hidden div);hooks/useBrokerDailyFlows.ts | BrokerFlowsPanel.test.tsx 11 案;useBrokerDailyFlows.test.ts 5 案;useTraderSearch.test.ts 4 案;App.test.tsx tab 案(vitest 計 889 passed) | evidence/SC-4_SC-6_broker-flows-tab-real-9600.png(真實資料雙表) | 既有 4 tab 切換測試綠;e2e E3/E8/E14 綠 |
| SC-5 跳轉預選 | App.tsx:265(handleFlowStockPick);BrokerFlowsPanel.tsx FlowTable onPickStock | App.test.tsx SC-5 lock(mutation-verified)+ Panel 回呼 2 案;e2e E30 跳轉斷言 | evidence/SC-5_jump-overview-preselected-9600.png(9600 chip 預選 + overlay +496 張 + 2330 K 線) | K 線/三大法人/主力分點面板/useBrokerHistory 舊鏈於截圖中實地正常 |
| SC-6 回退標註 | BrokerFlowsPanel.tsx(noTradingDay banner) | Panel no_trading_day 案 + hook noTradingDay 透傳案 | SC-4 截圖含「2026-07-21 尚無資料,顯示 2026-07-20」真實觸發 | — |
| SC-7 E2E | e2e/specs/equity.spec.ts E30;tests_e2e/test_api_broker.py;fixtures ×2 + MANIFEST | e2e 全套 **51 passed**(含 E30);MANIFEST 3 gate 綠 | subsumed by Phase 5: equity.spec E30(真 browser) | 全 spec 跑過 = universe fixture data_id fallback 汙染面驗證 |
| SC-8 配額 | broker_flows.py cache + _run_once + _CANDIDATE_DAYS=3 | mock 計數:全空 =3 / cache 命中 0 / 並發 dedup 1 / refresh bypass / 過去日無條件命中(lock) | 真實環境單查詢 warm 0 冷 1(候選日首發即中) | — |

自動化總量(Phase 5,HEAD e5f39e5 後跑):pytest 700 passed / ruff 0 / vitest 889 passed / build ✓ / e2e 51 passed。
Edge cases 1-5:單向空表(vitest「無賣超」案)/ 截斷註記(1136 檔案例真實截圖)/ 無效 id 404(real curl)/ 非普通股 0050 代號 fallback(E30 斷言)/ future clamp(pytest)— 全覆蓋。
Out of scope 未越界;執行約束(frontend-design + bencium skills 已於 Wave 3 前載入、per-module wrapper、clock.today、error contract)均落實。

**判定:全 SC 通過,無失敗分流。**
