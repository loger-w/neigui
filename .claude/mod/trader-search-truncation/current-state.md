# Current state — mod/trader-search-truncation(spec F-2)

日期:2026-07-21。Baseline:backend 704 passed, 1 skipped / frontend 899 passed(main `20296b5`,F-1 剛 merge)。
方向拍板:**(a) shape 改物件 `{hits, total}`**(user 2026-07-21 AskUserQuestion 選定,spec 傾向案)。

## 現況鏈路(全 caller map,grep 全 repo)

| 層 | 位置 | 現況 |
|---|---|---|
| service | `backend/services/broker_flows.py::search_traders`(:186-200) | 回 `hits[:_SEARCH_LIMIT]` 裸陣列 `[{broker_id, broker_name}]`;空白 query 回 `[]`;目錄 None → 503 |
| route | `routes/broker.py:16-18` | `-> list[dict]` 直回 service 結果 |
| api client | `frontend/src/lib/api.ts:265-268` `brokerTraders` | `Promise<TraderHit[]>` |
| type | `frontend/src/lib/broker-flows-data.ts:24` `TraderHit` | `{broker_id, broker_name}`(不變) |
| hook | `frontend/src/hooks/useTraderSearch.ts` | `useQuery<TraderHit[]>`,回 `{data: TraderHit[]|null, loading, error, refresh}` |
| 元件 | `frontend/src/components/BrokerFlowsPanel.tsx:51` | `hits = search.data ?? []`;dropdown `<ul role=listbox>` render;鍵盤導航吃 `hits.length` |
| backend 測試 | `test_broker_flows.py` search 5 案(:335-373) | 斷言裸陣列(`hits[0]["broker_id"]`、`len(hits)==50`、`== []`) |
| route 測試 | `test_broker_routes.py:114` | `search_traders` monkeypatch 回裸 hits |
| hook 測試 | `useTraderSearch.test.ts` | `mockResolvedValue(HITS)`(裸陣列) |
| 元件測試 | `BrokerFlowsPanel.test.tsx:41` | `tradersSpy` mockResolvedValue(HITS 裸陣列) |
| contract | `tests_e2e/test_api_broker.py::test_traders_search_by_name`(:73-78) | `hits = r.json()`;`in hits`;`len >= 3` |
| e2e | `e2e/specs/equity.spec.ts` E30(:188-195) | 走 dropdown 點選(不斷言 response shape);SC-4:**不豁免**,需跑 e2e |

無其他 caller(`brokerTraders` 僅 BrokerFlowsPanel 經 useTraderSearch 用;無動態用法)。

## 現況 vs 目標

| 面向 | 現況 | 目標 |
|---|---|---|
| service 回傳 | `list[dict]`(截斷後) | `{"hits": [...≤50], "total": <截斷前命中數>}`;空白 query → `{"hits": [], "total": 0}` |
| route 註記 | `-> list[dict]` | `-> dict` |
| api client | `Promise<TraderHit[]>` | `Promise<TraderSearchPayload>`(新 type `{hits, total}`) |
| hook 回傳 | `data: TraderHit[] \| null` | 維持 `data: TraderHit[] \| null`(= payload.hits,元件改動最小)+ **extras `total: number \| null`**(hook 統一 shape 慣例) |
| dropdown | 50 筆靜默 | `total > hits.length` 時 listbox 尾端加非 option 提示列「共 N 筆,僅列前 50,請輸入更精確關鍵字」(不入鍵盤導航) |
| Backward compat | — | 前後端同 repo 同 deploy,無外部 consumer;無 migration。契約改動 = api.ts + hook + contract test 同 commit 改(CLAUDE.md §4「改契約同時改兩邊」) |

## 既有測試逐一標(該紅 / 不該紅)

**該紅(🔴 shape 改)**:backend search 5 案中斷言裸陣列的 4 案(id_prefix / name_substring / caps_at_50 / blank_query;directory_unavailable_503 只驗 exception 不紅)、contract `test_traders_search_by_name`、hook 測試 resolvedValue mock 案、`BrokerFlowsPanel.test.tsx` **:41 tradersSpy 與 :143 獨立 HITS mock**(review R1;:143 漏改會 findByText timeout 紅)。
**不會自然紅、但 mock 需同 commit 改 shape 消 drift**(review R6):`test_broker_routes.py` traders 案(monkeypatch 純 passthrough)、`BrokerFlowsPanel.test.tsx` :60/:113(`mockResolvedValue([])` — runtime `[].hits === undefined` 意外綠,但 tsc 型別 gate 可能紅)。
**不該紅**:其餘全部(flows 路徑、directory 快取、F-1 新測試、:122 reject 案、E30 e2e — dropdown 行為對 user 不變)。
