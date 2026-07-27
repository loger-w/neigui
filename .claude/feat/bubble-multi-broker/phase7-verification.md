# Phase 7 verification — bubble-multi-broker

驗證基準 HEAD:8e46aab(Phase 5 全套於此 HEAD 跑綠:vitest 980 / pytest 687 /
ruff clean / build ✓ / e2e 60 passed)。

| SC | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據路徑 | regression 抽樣對象 |
|---|---|---|---|---|
| SC-1 多選 toggle(三入口、上限 6) | ChipBubbleView.tsx:62,122(MAX/toggleBroker);BrokerSearch.tsx:24,181(onPick/preventDefault) | ChipBubbleView.test.tsx「多選 chips 與合併統計」「上限 6 + limitNotice」「泡泡 / 明細列入口 toggle」「同名不同 id 入口精準性」describes(51 tests 全綠內含);BrokerSearch.test.tsx 13/13 | evidence/SC-1_SC-2_SC-3_SC-4_multi-select-2330.png + SC-1_edge_limit-6-notice.png + SC-1_jump-to-overview-2brokers.png(array 契約) | 既有 F2 sort headers 7 tests 綠;e2e E23/E24 綠 |
| SC-2 圖面 union filter + 外框色 | chip-bubble-svg.tsx:115(BROKER_PALETTE),131(selectedBrokers),512(ringStroke) | chip-bubble-svg.test.tsx「多選分點外框色 (SC-2)」5 tests(stroke=PALETTE[0]/[2] 正向 assertion;35/35 全綠) | 同上多選截圖(藍/黃 ring 可指認、fill 紅買綠賣不變) | F11 axes-stable 4 tests 綠;F2 quiet-day fallback 2 tests 綠 |
| SC-3 Legend chips | ChipBubbleView.tsx:396(chip),421(清除全部),433(notice 文案) | ChipBubbleView.test.tsx chips 移除/清除全部/配色不變式 cases 綠 | 多選截圖(chips 色點+×+清除全部可指認);清除全部回 814 分點(real-env round JSON case 5) | 換股 reset effect 由既有 symbol-change test 綠 |
| SC-4 明細/統計合併 | chip-data.ts:209,346(集合版);ChipBubbleView.tsx:175(colorById),1007(row dot) | chip-data.test.ts 41/41(multi-id merge 手算);ChipBubbleView 合併統計 151萬/810萬 assertion 綠 | 多選截圖:買5,824=3,348+2,476 手算合併 ✓、明細兩分點列+色點 | brush 區間計數 3 tests 綠 |
| SC-5 單選回歸 | chip-bubble-svg.tsx:512(N≤1 現行 stroke 分支) | 既有 A2/A3/A5/BB-1/CH-1/brush describes 全綠(該變 assertion 已事前標記於 PLAN);e2e E23/E24/E29/E32/E33 綠 | evidence/SC-5_SC-6_focus-replaces-single-select.png(單選無 ring、現行文案) | e2e 全套 60 passed(含泡泡圖全部既有 E#) |
| SC-6 focusRequest 取代 / blocklist 保留其餘 | ChipBubbleView.tsx focusRequest effect(取代)+ handleBlockAdd(filter) | ChipBubbleView.test.tsx「focusRequest 取代 / blocklist 保留其餘」3 tests + badge 嚴格單選 test 綠 | SC-5_SC-6 截圖(2 分點被取代為元大) | CH-1 既有 3 tests(聚焦/排除清單自動移除/無成交 badge)綠 |
| SC-7 e2e | e2e/specs/equity.spec.ts:429(E38) | E38 綠(全套 60 passed,cache 清過;R1 真瀏覽器「下拉保持開啟」assertion 含在內) | subsumed by Phase 5: equity.spec E38(本 SC 本身即 e2e 交付物;真實環境另有上列真截圖,無轉譯頂替疑慮) | E34 既知 SymbolSearch 負載 flake,單跑綠(next-time.md 既有記錄) |

Edge cases:1(上限 6+提示)real-env + vitest ✓;2(消失分點不失效)vitest ✓;
3(配色不變式)vitest ✓;4(無成交 badge 嚴格單選)vitest ✓;5(mobile sheet 標題)vitest ✓。

結論:7/7 SC 全 PASS,無 FAIL 分流。
