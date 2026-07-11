# Phase 7 — Goal 核對表(重讀 brainstorm.md SC,fresh 驗證 @ HEAD a12b773)

Fresh gate(本輪實跑):backend `pytest -q` 627 passed / `ruff` 0 / vitest 695 passed / build ✓ / e2e 30 passed(冷 cache ×2 + 暖 ×1)。

| SC | 實作檔案:行號 | 自動化測試 + pass count | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 tab+換標的 | frontend/src/App.tsx:66,376-386,447-460(Tab type/按鈕/hidden+lazy);hooks/useWarrants.ts:13(queryKey 含 stockId) | useWarrants.test.ts 4 tests;App.test.tsx mock 掛載;e2e E8(30 passed 內) | evidence/SC-1_SC-2_warrant-tab-table-2330.png(真資料 1114 檔) | 籌碼總覽/泡泡圖 tab 不受影響(e2e E3) |
| SC-2 全欄位表格+差槓比排序 | services/warrant_pricing.py(BS/IV);warrants.py:333-406(快照欄位);warrant_quotes.py:169-249(盤中欄位);WarrantSelector.tsx:31-56(HEADERS)、lib/warrant-utils.ts:88(sort null 沉底) | test_warrant_pricing.py 17(Hull 數值鎖);test_warrants_service.py 24;test_warrant_quotes.py 17(數值鎖對 pricing);WarrantSelector.test.tsx header/排序 2 tests;e2e E8 資料級 | 同上截圖(全欄位有值、asc 排序可見);quotes API:iv 841/1114、差槓比 812/1114 | 定價模組零依賴不影響既有 |
| SC-3 輪詢啟停+最後更新 | lib/warrant-utils.ts:6,116-152(QUOTES_REFETCH_MS/isMarketOpen/quotesRefetchInterval);useWarrantQuotes.ts:16-17;warrant_quotes.py cooldown | warrant-utils.test.ts isMarketOpen 5 邊界 + interval 兩分支;useWarrantQuotes.test.ts 4;test_warrant_quotes.py cooldown 3 | 真 MIS 盤後回 07-09 13:30 快照(盤後也能選實證);cooldown 第二發 0.58s 未重打 | api.ts noCache 不影響既有 caller(api.test.ts 既有 cache 測試綠) |
| SC-4 篩選器 | lib/warrant-utils.ts:36-75(filterWarrants);WarrantSelector.tsx 篩選列 | warrant-utils.test.ts 7 filter tests;WarrantSelector.test.tsx 認售 toggle;e2e E9 | evidence/SC-4_filter-put-only.png(1114→193 檔) | — |
| SC-5 中性標色+無方向文案 | WarrantSelector.tsx:58-64(MISPRICING_CLASS 零色相)、badge 同 | WarrantSelector.test.tsx:負向文案 assert + badge testid + className 不含 accent/bull/bear(紅先行) | computed style 實測:badge #ede4d3/#4a4234(ink/line,零 bull 色相) | — |
| SC-6 分點展開 | services/warrant_brokers.py;finmind.py fetch_warrant_trading_daily_report;useWarrantBrokers.ts;WarrantSelector.tsx RowPair 展開 | test_warrant_brokers.py 7;useWarrantBrokers.test.ts 3;WarrantSelector.test.tsx 展開 2(含同名分點);e2e E11 | evidence/SC-6_broker-expand.png(真 FinMind,資料日=07-09 T-1) | FinMind 既有 endpoints 不動(627 pytest 綠) |
| SC-7 空狀態 | warrants.py get_underlying_warrants(空 list 200);WarrantSelector.tsx 空狀態分支 | test_warrants_service.py unknown_underlying;WarrantSelector.test.tsx 空狀態;test_api_warrants.py 2412 | subsumed by Phase 5: e2e E10(真實市場幾乎全標的有權證,fake fixture 驗 UI) | — |
| SC-8 refresh/cache 慣例 | warrants.py(latest 檔名/backoff/空回不覆寫);routes/warrants.py(400/502/finmind_error 分流) | test_warrants_service.py cache 7 tests;test_warrants_routes.py 8;test_api_warrants.py 5 | bad_symbol 400 實測;refresh passthrough 由 route 測試鎖;快照 cache 命中 0.23s | daytrade_fee 同構語意不動 |
| SC-9 完成 gate | — | 本表頂部 fresh gate 全綠 | 截圖 3 張入 docs/specs/warrant-selector/screenshots/(已 commit 053bb00) | e2e 全套 30 passed 覆蓋四 mode |

結論:9/9 SC 有實作+測試+證據,無 N/A、無「應該可以」。Phase 7 PASS。
