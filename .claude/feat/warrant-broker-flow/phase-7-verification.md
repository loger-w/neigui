# Phase 7 — SC 結構化證據表(2026-07-14,HEAD 0f925f6)

Fresh 驗證(本 phase 實跑):backend `pytest tests/test_warrant_flow.py tests_e2e/test_api_warrants.py` = **36 passed**;frontend 4 檔 vitest = **31 passed**。全套(Phase 5,同 code HEAD):pytest 702 / vitest 755 / build ✓ / e2e 35 passed。

| SC | 實作檔案:行號 | 自動化測試 + pass count | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 切 tab 才載入 + 進度文案 | App.tsx:70(Tab type)、:382-392(tab 鈕)、:496-509(hidden+lazy);useWarrantFlow.ts:16(enabled gate);WarrantFlowPanel.tsx:57(進度文案) | useWarrantFlow.test.ts ×5 + App.test.tsx tab test + Panel SC-1 test(31 passed 內)+ e2e E14 ✓ | DevTools 實操:進度文案於 a11y snapshot 捕獲;subsumed by Phase 5 e2e E14 | 既有 tab E8-E13 全綠(e2e 35 passed);App mode 切換 6 tests 綠 |
| SC-2 badge + 四數字 | WarrantFlowPanel.tsx FlowBody header(flow-date-badge)+ summary 區(flow-summary) | Panel「SC-2」test 綠 | screenshots/SC-2_SC-3_wide-summary-top15.png(資料日 07-13 + 1.57億/92萬 四格) | 同截圖驗頂部 nav / 搜尋列未變形 |
| SC-3 兩欄 top15 + 展開 + 疊直 | WarrantFlowPanel.tsx BranchColumn(bar + barRatio)+ expandedBroker state;useContainerSize < 640 疊直 | Panel「SC-3」test(展開/收合)+ warrant-flow-data.test barRatio ×3 + e2e E14(展開資料級)✓ | wide png + SC-3_broker-expanded-detail.png + SC-3_narrow-stacked.png(560px 疊直) | 泡泡圖/總覽 tab 切換 e2e E3 綠 |
| SC-4 明細表金額降序五欄 | warrant_flow.py::_aggregate(warrant_rows sort)+ Panel flow-warrant-table | pytest test_aggregation_values(降序 assert)+ Panel「SC-4」test 綠 | wide png(589→532→529 萬 降序可視) | pytest 聚合鎖同測驗 branch 排序未動 |
| SC-5 色彩紀律 | WarrantFlowPanel.tsx netClass(bull/bear)+ KIND_CLASS(中性) | Panel「SC-5」:bull/bear 正向 class assert + kind badge not-match /accent\|bull\|bear/ + 方向性文案 queryByText null,綠 | wide png:買超欄紅 bar/金額、賣超欄綠、認購 badge 中性框 | WarrantSelector kind badge 測試(755 內)未破 |
| SC-6 cap 200 + truncated 插值 | warrant_flow.py:31 FLOW_CAP=200 + :378 truncated/analyzed;Panel 插值註記 | pytest test_cap_truncated(201→analyzed 200)+ Panel SC-6 ×2 綠 | 真資料 485 檔 > 200 → 「僅統計成交金額前 200 檔權證」實顯於 wide png | pytest cap 測試同驗 fan-out 呼叫數=200 |
| SC-7 空狀態兩文案 | warrant_flow.py::_empty_payload + Panel no_warrants/no_volume 分支 | pytest test_empty_no_warrants / test_empty_no_volume + Panel SC-7A/7B + contract test_flow_no_warrants_empty,全綠 | subsumed by Phase 5:vitest 兩文案 + FAKE contract(2412) | contract 同檔 test_warrants_empty_underlying(既有)綠 |
| SC-8 回退/cache/refresh/flag | warrant_flow.py::_candidate_dates/_fetch_price_day/probe/get_flow;routes/warrants.py /flow | pytest 測項 4/6/7/9/10(回退×2、cache/refresh、空dump、flag×3、probe 節省)+ NTD2 + contract flow shape/bad_date,36 passed 內 | curl:warm 2.43s(cache 命中+T+0 探測)/ refresh=true 9.45s 全量重燒 201 req;NTD2 subsumed | 既有 /api/warrants/* contract 6 tests 綠(030012 brokers 未受 price 欄影響) |
| SC-9 完成 gate | — | pytest 702 / ruff 0 / vitest 755 / build exit 0 / e2e 35 passed(automated-verification.md) | 截圖 ×3 已 commit(0f925f6) | — |

無 N/A、無「應該可以」;subsumed 欄皆註明來源 spec#。
**帶出項(不擋 Done)**:RE-1 per-warrant net 恆零(spec §3 已加註,替代口徑候選在 next-time,user 於 PR 檢視點拍板)。
