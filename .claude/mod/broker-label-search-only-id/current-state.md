# Phase 1 現況表 — mod/broker-label-search-only-id

## 動機(user 原話)
1. 「只需要在搜尋框裡面才需要顯示編號」— 分點顯示目前全面「id 去dash名」(SC-7,mod/batch-ui-polish),要改成只有搜尋框(含其 suggestion dropdown)顯示編號,其他顯示點只顯名稱。
2. 「泡泡圖的搜尋寬幫我再加寬一點」— BrokerSearch 容器 `max-w-[280px]`。
3. 「搜尋提示顯示『凱基信義』但要輸入『凱基-信義』才會有」— 顯示層去 dash、比對層吃原始含 dash 名稱,照著顯示打字 miss。

## 現況:formatBrokerLabel 全部 caller(grep 完整)

| 檔案:行 | 情境 | 分類 |
|---|---|---|
| `BrokerSearch.tsx:43,95` | 泡泡圖搜尋 combobox:input echo + dropdown label | 搜尋框 → **保留 id** |
| `BrokerFlowsPanel.tsx:45,71,96,175` | 分點反查搜尋:initialEcho / selectedEcho / pickTrader echo / listbox option | 搜尋框 → **保留 id** |
| `BrokerFlowsPanel.tsx:209` | 選定分點 badge | 非搜尋 → 去 id |
| `BrokerFlowsPanel.tsx:284,288` | 常用分點 chips + aria-label | 非搜尋 → 去 id |
| `BubbleBlocklistPopover.tsx:123,125` | 過濾清單候選列(title + 文字) | 非搜尋 → 去 id |
| `BubbleBlocklistPopover.tsx:147,149,155` | 已排除列(title + 文字 + aria-label) | 非搜尋 → 去 id |
| `ChipBubbleView.tsx:119` | 「已自過濾清單移除〈…〉」提示 | 非搜尋 → 去 id |
| `ChipBubbleView.tsx:145 (labelFor)` | 右欄 TradeList 明細列(:889) | 非搜尋 → 去 id |
| `ChipBubbleView.tsx:225` | 泡泡 hover tooltip | 非搜尋 → 去 id |
| `ChipBubbleView.tsx:360` | 「查看 X 於籌碼總覽」連結 | 非搜尋 → 去 id |
| `ChipBrokersPanel.tsx:77 (label)` | top15 列顯示/aria/tooltip(:116,121,123,135,154) | 非搜尋 → 去 id |
| `ChipBrokersPanel.tsx:371` | 已選分點 pills + aria-label | 非搜尋 → 去 id |
| `BrokerFilterPopover.tsx:112` | 篩選 popover 清單列(checkbox aria/title/文字) | 非搜尋 → 去 id |
| `WarrantFlowPanel.tsx:273,278,280` | 權證分點列 aria-label/title/文字 | 非搜尋 → 去 id |

動態用法:無(無 template string / reflection 引用 formatBrokerLabel)。
`saved-brokers.ts:5` 註解引用 → 同步措辭。

## 現況:搜尋比對(dash bug 根因)

| 位置 | 比對邏輯 | dash 問題 |
|---|---|---|
| backend `broker_flows.py::search_traders:200` | `bid.casefold().startswith(needle) or needle in name.casefold()` | **有** — name 為目錄原始含 dash(「凱基-信義」),顯示層去 dash → 照顯示打字 miss(user 回報主案發點) |
| `BrokerSearch.tsx:109-120` | `b.broker`(原始)或 `b.label`(id+去dash)includes | 間接已覆蓋(label 含去dash 名),但 query 含 dash 時反而 miss label |
| `BubbleBlocklistPopover.tsx:41` | `b.name`(原始)或 `b.id` includes | **有** — 名稱含 dash 時照顯示打字 miss |
| `BrokerFilterPopover.tsx:26-30` | `b.name`(原始)或 `b.broker_id` includes | **有**(同上;top_brokers 名稱多無 dash,防禦性一致化) |

## Baseline
- frontend vitest:98 檔 945 tests 全綠(2026-07-22)
- backend pytest:684 passed 1 skipped;ruff 全綠

## 既有測試受影響(該紅 🔴 清單,Phase 4 對照)
- `BrokerFlowsPanel.test.tsx`:284-286(badge)、300(chip)、313-318 fixture、331(aria 自常用移除)→ 去 id 該紅改;echo 類(255、318 input value)**不該紅**
- `ChipBrokersPanel.test.tsx`:92(title LONG2)、111、113 → 該紅改
- `ChipBubbleView.test.tsx`:239(header 連結 AL1 Alpha)、246-267(TradeList 列)→ 該紅改
- `BrokerFilterPopover.test.tsx`:105(B1 Bravo)→ 該紅改
- `WarrantFlowPanel.test.tsx`:158、161、164、168(id 前綴)→ 該紅改
- `BrokerSearch.test.tsx`:全部 **不該紅**(搜尋框保留 id)
- e2e `equity.spec.ts:209`:`展開 920A 凱基台北` → 該紅改(去 id);205/211 containText 不受影響
- e2e E30/N4(搜尋 echo「9600 富邦」)**不該紅**

## E2E 判準(e2e-conventions 表)
equity mode UI 行為改動 → `equity.spec.ts` E# 對應 assertion 修改;搜尋 dash-insensitive 屬 backend service 行為 → backend pytest 補紅測試;無新 spec 檔需求(既有 E30 流程覆蓋搜尋鏈,fill 用「富邦」無 dash 不受影響)。
