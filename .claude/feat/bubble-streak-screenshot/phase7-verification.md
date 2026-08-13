# phase7-verification — feat/bubble-streak-screenshot

2026-08-13。HEAD 281fe84。逐 SC 對照 brainstorm.md(含 amendments)重讀後填寫;
證據皆本日 fresh(automated-verification-round-1.json / real-env-verification-round-1.json)。

| SC | 實作(檔:行) | 測試(名 + pass) | real-env 證據 | regression 抽樣 |
|---|---|---|---|---|
| SC-1 端點 | backend/services/finmind.py:803(fetch_bubble_window)、2482(_aggregate_bubble_window);routes/chip.py:114 | tests/test_bubble_window.py 29 passed(shape / 422 邊界 / 503 / 部分失敗 / 空日 actual_days / 聚合純函式含混合 id 案例 A/B/C);tests_e2e/test_api_chip.py 7 passed(contract:×5 倍數 + trading_dates + days=3 鑑別) | evidence/SC-1_api-edges-and-payload.md(happy 200 shape、422×2、/bubble 零改動) | /bubble 4,095 rows 4 keys 不變 |
| SC-2 cache 契約 | finmind.py:803-880(cache key `_bubblew` / `_CACHE_VERSION_BUBBLE_W` / `_r{refresh}` dedup / partial 不寫永久 cache / OSError guard) | test_bubble_window.py 內 cache hit / refresh bypass / today TTL 兩態 / 併發 dedup(mutation-verified)/ partial-refetch / OSError → 29 passed 之列 | 冷 fan-out 20.7s → warm 即回(量測於 payload 表) | brokers_window cache 測試 58 passed(Task A 時複核) |
| SC-3 資料層 | frontend/src/lib/api.ts:200(chipBubbleWindow);hooks/useChipBubble.ts:9(days=1 default 分流);lib/chip-data.ts(ChipBubbleWindowData) | api.test.ts + useChipBubble.test.ts 30 passed(URL / refresh / 分流 / windowMeta 三態) | 真實 API 呼叫記錄:console 全 200(real-env JSON) | 既有 useChipBubble 4 條測試零改動綠 |
| SC-4 UI 天數選擇(amendment:統計行右端) | ChipBubbleView.tsx:1024(BubbleDaysSelector)、786(bubble-window-badge);App.tsx(bubbleDays state + intraday gate + refresh gate) | ChipBubbleView.test.tsx + App.test.tsx 該組 104 passed(selector / onDaysChange / badge 三態 + 載入視窗期 / 文案分流 / intraday gate / 不重置 / windowDays 隔離 lock) | screenshots/SC-4_1day.png、SC-4_5day.png、SC-4_1280px.png、SC-4_mobile.png + **user 過目(收尾清單)** | E39 solo 三連點回綠(equity 70P) |
| SC-5 下游吃聚合 | 零邏輯改動(trades 直通管線);文案例外三處 + chip-bubble-svg emptyHint days 分流(review fix) | ChipBubbleView.test.tsx 聚合列數 / totals 案;vitest 全案 1091 passed(既有測試零紅) | 5 日「近 5 日共 817 個分點」+ 右欄明細有料(SC-4_5day.png);3481×20日 818 分點渲染正常 | REG_single-day-select.png(單日選取/統計) |
| SC-6 e2e 多日 | e2e/specs/equity.spec.ts:434(E43) | e2e 70 passed;E43 倍數 assertion(100→500 張)+ mutation 驗紅記錄(progress.md) | —(e2e 即真 browser 資料級) | 全套 70 passed 含既有 E1-E42 |
| SC-7 截圖鈕(amendment:多日 PNG 帶窗口標註 + 失敗提示) | frontend/src/lib/bubble-screenshot.ts:16/32(filename / serializeSvg + PADDING 導出座標);ChipBubbleView.tsx(handleScreenshot + screenshotNotice 自癒) | bubble-screenshot.test.ts(filename 兩態 / xmlns / font-size 20px / annotation 兩態)+ ChipBubbleView.test.tsx(鈕存在性 / reject 提示 / 尺寸 0 no-op 提示 / notice 自癒)→ vitest 1091 之列 | evidence/SC-7_download.png(270,976B)+ SC-7_download_w5.png(354,411B,_w5 檔名);開圖內容核對正確;notice 缺席 + **user 過目(收尾清單)** | console 無新增 error |
| SC-8 e2e 截圖 | equity.spec.ts:475(E44)、493(E45 多日/annotation 分支) | e2e 70 passed;E44/E45 download + size>0;mutation 驗紅記錄 | —(e2e 即真 browser) | — |

## 附帶 gate

- 效能(design §6.4):最長 long task **48.8ms** < 1000ms → preset 維持 [1,3,5,10,20],降檔 checklist 未觸發。
- Payload(edge 7):**超標**(20 日 18.1MB / 10 日 12.8MB > 10MB)→ 依 design §6.3 拍板路徑記 `docs/next-time.md`(slim 化;降檔救不了故不動 preset);gzip wire ~2MB 當下可用。此為 design 預載的「超標 → next-time」分支,非 FAIL。
- 1280px 中欄文字折行(P2 視覺保留)— 功能無損,入 next-time 候選(見收尾)。

## 失敗分流

無 FAIL 項。無 rollbacks(state.json rollbacks = [])。
