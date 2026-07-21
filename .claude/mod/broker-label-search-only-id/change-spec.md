# Change Spec — mod/broker-label-search-only-id

規格來源:user 2026-07-22 指示(三點:搜尋框才顯編號 / 泡泡圖搜尋加寬 / 輸入去 dash 名稱要能命中)→ 視為預核准,無方向性抉擇。

## 成功條件(可驗收)
- SC-1:非搜尋顯示點(current-state.md 表列「去 id」各點)只顯「去dash名稱」;名稱缺(null/空)時 fallback 顯 broker_id。驗收:vitest 對應 assertion + DevTools 截圖。
- SC-2:搜尋框情境(BrokerSearch input echo + dropdown;BrokerFlowsPanel input echo + listbox)維持「id 去dash名」。驗收:既有 BrokerSearch.test / BrokerFlowsPanel echo 測試維持綠。
- SC-3:分點反查搜尋輸入「凱基信義」(無 dash)命中目錄名「凱基-信義」;輸入「凱基-信義」仍命中(backend search_traders)。驗收:backend pytest 紅→綠。
- SC-4:前端三處 client filter(BrokerSearch / BubbleBlocklistPopover / BrokerFilterPopover)同樣 dash-insensitive(query 與名稱雙邊去 dash 比對)。驗收:vitest 紅→綠。
- SC-5:泡泡圖 BrokerSearch 容器 `max-w-[280px]` → `max-w-[360px]`。驗收:截圖對照。`[auto-default: 360px | reason: 加寬 ~30%,同列仍容納分點計數/跳轉鈕,flex-wrap 天然降級]`

## 不能破壞的既有行為白名單
- W1:BrokerSearch pick 後 onChange 回**原始名稱**(含 dash)為 key;BrokerFlowsPanel selection 以 broker_id 為 key —— 顯示改動不碰 selection / API / callback 契約。
- W2:搜尋框 echo 格式不變(`9201A 凱基台北` / `9600 富邦`),e2e N4:101/123 鎖住。
- W3:id 搜尋語意不變(backend id casefold 前綴;client id substring)。
- W4:原始含 dash 名稱查詢仍命中(舊使用習慣不退化)。
- W5:名稱缺時顯示 fallback 為 id(ChipBrokersPanel pill idToName miss 路徑)。
- W6:E30 分點反查全流程(搜尋→選→雙表→跳轉)、E# 權證明細展開流程行為不變(僅 aria-label 文案去 id)。
- W7:BrokerFlowsPanel combobox a11y 契約(role/aria-activedescendant/truncation live region)不變。
- W8:blocklist / filter popover 的 add/remove/toggle 以 id 為 key 不變。

## Backward compat / migration
純顯示層 + 比對放寬(舊查詢字串仍命中,W3/W4),無 API shape、無持久化 schema 改動(saved-brokers / blocklist 存 {id, name} 原樣)。無 migration。

## Out of scope
- BrokerSearch highlightMatch 在「query 含 dash 對去dash label」時 highlight 不著色(比對命中、僅無高亮)→ P2 記 next-time。
- 其他 mode(options/market)無分點顯示點,不動。

---

## Diff 級 spec(三類分開)

### 🔵 無(不做順手重構)

### 🔴 行為改動 A:非搜尋顯示點去 id
1. `lib/broker-name.ts`:新增 `formatBrokerName(id, name)` — 去 dash trim 後名稱,空則回 id。`formatBrokerLabel` 保留(搜尋框用),docstring 更新兩者分工。
2. `BrokerFlowsPanel.tsx`:209(badge)、284/288(常用 chips)→ formatBrokerName;搜尋 echo(45/71/96)與 listbox(175)不動。
3. `BubbleBlocklistPopover.tsx`:123/125/147/149/155 → formatBrokerName。
4. `ChipBubbleView.tsx`:119(提示)、145 labelFor、225(tooltip)、360(連結)→ formatBrokerName。
5. `ChipBrokersPanel.tsx`:77 label、371 pill → formatBrokerName。
6. `BrokerFilterPopover.tsx`:112 → formatBrokerName。
7. `WarrantFlowPanel.tsx`:273/278/280 → formatBrokerName。
8. `saved-brokers.ts:5` 註解措辭同步。
9. e2e `equity.spec.ts:209/(收合同列)`:`展開 920A 凱基台北` → `展開 凱基台北`。

該紅測試(先改 assertion 紅 → 改實作綠):current-state.md「該紅清單」全列。
新測試:`broker-name.test.ts` 補 formatBrokerName(去dash / null fallback / 空名 fallback)。
不該紅:BrokerSearch.test 全部、BrokerFlowsPanel echo/listbox 類、e2e E30/N4。

`[auto-default: BrokerFilterPopover 與 BubbleBlocklistPopover 候選列歸「非搜尋」去 id | reason: user 措辭「搜尋框裡面」取窄義 = 輸入框 echo + combobox suggestion;popover 清單是內容列表,id 搜尋仍可命中只是不顯示,可逆純顯示]`

### 🔴 行為改動 B:搜尋比對 dash-insensitive
1. backend `services/broker_flows.py::search_traders`:name 比對雙邊去 dash — `needle_name = needle.replace("-", "")`、`needle_name in name.casefold().replace("-", "")`;id 前綴比對維持原 needle。
2. `lib/broker-name.ts`:新增 `normalizeBrokerQuery(s)` = lowercase + 去 dash + trim(前端共用)。
3. `BrokerSearch.tsx` filtered:名稱比對改 normalize 雙邊(id 經 label 覆蓋維持)。
4. `BubbleBlocklistPopover.tsx` candidates filter:name 比對 normalize 雙邊;id 比對維持。
5. `BrokerFilterPopover.tsx` filtered:同上。

新紅測試先行:
- backend `tests/test_broker_flows.py`:search「凱基信義」中目錄「凱基-信義」;「凱基-信義」仍中;id 前綴不變。
- `BrokerSearch.test.tsx`:輸入「凱基台北」(無 dash)出現 9201A;輸入「凱基-台」仍出現。
- `BubbleBlocklistPopover` / `BrokerFilterPopover` 對應各 1 條。
該紅:無(純放寬,既有全綠)。

### 🔴 行為改動 C:泡泡圖搜尋加寬
`BrokerSearch.tsx:156` `max-w-[280px]` → `max-w-[360px]`。無測試鎖寬度;截圖驗證。

### Changelog
`frontend/src/lib/changelog.ts` 新 entry(寫前讀 changelog-conventions):顯示去重 + 搜尋修正 + 加寬同 ship event 合併一條。

## Review round 1 補正(change-spec-reviewer,6 P1 + 1 P2 全 accept,行號已核實)
- R1:該紅補 `ChipBrokersPanel.test.tsx:75`(tooltip `LONG1 …` 去 id)。
- R2:該紅補 `ChipBubbleView.test.tsx:805`(提示〈AL1 Alpha〉→〈Alpha〉)。
- R3:e2e 該紅補 `equity.spec.ts:406`(E23 `查看 BROKER001 分點001` → `查看 分點001`);W6 涵蓋 E23(流程不變僅文案去 id)。
- R4:e2e 該紅補 `navigation.spec.ts:121`(N6 chip exact name `9600 富邦` → `富邦`);N5 `:93/:101` 與 N6 `:113/:114/:123`(listbox option + echo)明標**不該紅**。
- R5:dash 全刪後空字串 guard — backend `needle_name` 為空時跳過名稱分支(僅 id 前綴);前端 normalize 後空同規則。backend 補 `search_traders("-")` 邊界紅測試(不得全表命中)。
- R6:BrokerFlowsPanel.test 精修 — `:284` 該紅(badge)、`:285-287` **不該紅**(echo,W2);`:312-313` 該紅(chip name → `富邦`)、`:318` **不該紅**(echo);`:331` 該紅(aria → `自常用移除 富邦`)。
- R7:BrokerSearch 現行 label 比對已覆蓋無 dash 查詢 → **B 範圍縮減:BrokerSearch 比對不動**(scope 紀律),僅補一條綠色 regression lock(無 dash 輸入命中含 dash 分點);dash-insensitive 實改僅 backend + BubbleBlocklistPopover + BrokerFilterPopover。

## Commit 序列(Phase 4,順序 🔴A → 🔴B → 🔴C)
1. 🔴 fix(frontend): 分點顯示只在搜尋框帶編號 — formatBrokerName 分工 + 顯示點替換 + e2e aria 同步
2. 🔴 fix(chip): 分點搜尋 dash-insensitive — 照顯示字樣輸入即可命中(backend + 前端三 filter)
3. 🔴 fix(frontend): 泡泡圖分點搜尋框加寬 280→360 + changelog

self_review_head: 7692cb826f66edf940d223a4094ed61f38c47f0c
