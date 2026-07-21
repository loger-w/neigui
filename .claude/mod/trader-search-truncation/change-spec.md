# Change spec — mod/trader-search-truncation(spec F-2)

日期:2026-07-21。來源:`docs/specs/broker-flows-followups/spec.md` F-2;方向性抉擇 **(a) shape 改物件**由 user 於 AskUserQuestion 拍板(含 UI 提示文案 preview)。前置盤點:`current-state.md`(同目錄)。規模 M(跨 backend/frontend 契約),Phase 3 1 輪 reviewer。

## 成功條件(SC,對齊 spec F-2 驗收)

1. pytest:>50 命中 → `total` = 截斷前命中數、`hits` = 50 筆;≤50 → `total == len(hits)`,無提示欄位歧義(前端以 `total > hits.length` 判定,無獨立 truncated 欄位)。
2. vitest:dropdown 截斷提示「共 {total} 筆,僅列前 {hits.length},請輸入更精確關鍵字」(review R7:筆數插值不 hardcode 50)出現(total > hits)/不出現(total == hits)兩案 + **鍵盤導航不入提示列案**(review R4:ArrowDown 按到底 + Enter 仍選最後一個 hit)。
3. contract test `tests_e2e/test_api_broker.py::test_traders_search_by_name` 同步改 shape 斷言(`r.json()["hits"]` + `total >= 3`)。
4. 全套 gate 綠(harness.json 四項)+ **e2e 必跑不豁免**。覆寫 F-2 SC-4「需改斷言」字面(review R5)— grep 證據:E30(equity.spec.ts:188-213)只走 UI 點選、無 response shape 斷言 → 該改的斷言為空集合,照跑全套即驗收。

## 不能破壞的既有行為白名單

- 搜尋語意:id 前綴(casefold)/ 名稱 substring、上限 50 筆、純空白回空、目錄 None → 503 `broker_directory_unavailable`。
- Dropdown UX:鍵盤導航(↑↓ Enter Esc)只在 hits 內移動 — **提示列不是 option、不入導航、不可點選**;查無/錯誤/搜尋中三態文案不變。
- 選定分點 → flows 雙表 → 點列跳轉鏈(E30)完整。
- F-1 的目錄 refresh 行為與 `search_traders` 無 refresh 面。
- Hook 統一 shape:`{data, loading, error, refresh, ...extras}` — data 維持 `TraderHit[] | null`,`total` 為 extras。

## Backward compat / migration

前後端同 repo 同 deploy(Vercel + Railway 同 PR 上線),無外部 API consumer;shape 改動 = api.ts + hook + contract test 與 backend **同一個 🔴 commit 序列**內完成(CLAUDE.md §4 改契約同時改兩邊)。無資料 migration(回應 shape,無落地資料)。
Skew 窗口(review R2 修正描述):兩方向不對稱 — **舊 frontend + 新 backend = `hits.map is not a function` TypeError,equity 頁 crash**(無 error boundary);新 frontend + 舊 backend = benign(`payload.hits === undefined` → data null → 查無)。部署順序不可控(Vercel/Railway 各自 auto-deploy),crash 方向窗口 = 分鐘級且僅影響「窗口內正在搜尋分點」的 session,重整即復原;個人專案單 user,接受此風險(較 spec 初稿的「顯示查無」描述嚴重,已如實修正)。

## Diff 級(三類標記;Phase 4 順序 🔵→🔴→🟢)

無 🔵。

- 🔴 `backend/services/broker_flows.py::search_traders`:回 `{"hits": hits[:_SEARCH_LIMIT], "total": len(hits)}`;空白 query 回 `{"hits": [], "total": 0}`;503 路徑不變。
- 🔴 `backend/routes/broker.py`:`get_broker_traders` 回傳註記 `list[dict]` → `dict`。
- 🔴 `backend/tests/test_broker_flows.py` search 4 案改斷言(先紅):`hits["hits"][0]...` / caps_at_50 案改 `len(...["hits"]) == 50` **並加 `total == 60` 斷言**(review R3:total 驗證屬 🔴 shape 改,併此案不另開 🟢)/ 空白 `== {"hits": [], "total": 0}`。
- 🔴 `backend/tests/test_broker_routes.py` traders 案:**不會自然紅**(monkeypatch 掉 service 的純 passthrough,review R6)— mock 回傳同 commit 改 shape 消 drift,紅燈驗證不等它。
- 🔴 `backend/tests_e2e/test_api_broker.py::test_traders_search_by_name`:`body["hits"]` + `body["total"] >= 3`。
- 🔴 `frontend/src/lib/broker-flows-data.ts`:加 `TraderSearchPayload { hits: TraderHit[]; total: number }`。
- 🔴 `frontend/src/lib/api.ts::brokerTraders`:`Promise<TraderSearchPayload>`。
- 🔴 `frontend/src/hooks/useTraderSearch.ts`:`useQuery<TraderSearchPayload>`;回傳 `data = payload.hits`、加 `total`。
- 🔴 `frontend/src/hooks/useTraderSearch.test.ts`(4 處 mock)/ `BrokerFlowsPanel.test.tsx` **全部 4 處 resolvedValue mock**(review R1::41 tradersSpy、:60、:113 改 `{hits: [], total: 0}`、:143 獨立 HITS mock — :143 不改會 findByText timeout 紅;:122 reject 案不受影響):mock 改 `{hits: HITS, total: N}`。
- 🟢 `frontend/src/components/BrokerFlowsPanel.tsx`:dropdown `<ul>` 尾端 `total > hits.length` 時加提示列 `<li role="presentation">`,文案「共 {total} 筆,僅列前 {hits.length},請輸入更精確關鍵字」(review R7 插值);**`onMouseDown={(e) => e.preventDefault()}`**(review R4:防點提示列觸發 input blur 關 dropdown),無 onClick(不可選取)。
- 🟢 vitest 新 3 案(紅先行):提示出現 / 不出現 / 鍵盤導航不入提示列(review R4)。
- 🔴 `frontend/src/lib/changelog.ts`:0.38.2 PATCH?— **判定**:使用者可感 UX 改善(不再誤判「找不到」)→ fix / equity PATCH entry(寫前已讀 changelog-conventions)。
- e2e:E30 斷言預期零改動,跑全套(SC-4);`e2e/.cache` 不需清(fixture 未動)。

## Out of scope

- 搜尋分頁 / 後端排序改動。
- `_SEARCH_LIMIT` 數值調整。
- SymbolSearch 等其他 dropdown 的同構提示(如有需要記 next-time)。

## Phase 5 自評記錄

- 對抗式 review(medium):無 P0/P1;P2 x1(提示列螢幕閱讀器不可感,與既有 combobox aria-activedescendant 缺口同源)→ deferred 記 docs/next-time.md。
self_review_head: 6d2709592284f0bac45805df385a566213e373f8
