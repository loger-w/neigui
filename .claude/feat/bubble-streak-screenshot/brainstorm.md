# brainstorm — 泡泡圖多日聚合視圖 + 截圖 PNG 下載

日期:2026-08-13。模式:/auto + /feat。branch `feat/bubble-streak-screenshot`。

## 分流判定

模糊 idea 起手(「連續天數」有兩讀法)→ 方向性抉擇經 AskUserQuestion 拍板後成形,
餘下皆實作選擇,依 /auto 契約標 `[auto-default]` 推進。

- **[user 拍板] 連續天數 = 泡泡圖多日聚合視圖**:泡泡圖可切「近 N 個交易日累計」,
  泡泡代表 N 日內該分點在該價位的累計買賣(非「連買/連賣天數 badge」,該讀法未選)。
- **[user 拍板] 截圖 = 圖表區 PNG 下載**:一鍵把泡泡圖 SVG 轉 PNG 下載,純前端,
  不加新依賴(非整視圖含右欄、非剪貼簿方案)。

## 資料事實(自查,不問 user)

- 單日 bubble:`fetch_chip_bubble`(finmind.py:226)= 單日 `taiwan_stock_trading_daily_report`
  → `{symbol, date, fetched_at, trades:[{broker, broker_id, price, buy, sell}]}`,
  per-day cache `{symbol}_{date}_bubble`。
- N 日聚合已有現成樣板:`fetch_brokers_window`(finmind.py:714)= trading_calendar 取
  N 交易日 → fan-out 逐日 fetch(各自 cache)→ 聚合 → self-cache
  `_w{days}_bw` + 獨立 `_CACHE_VERSION_BW` + inflight dedup(key 含 refresh)+
  全日失敗 503。**本 feature 後端照抄此樣板**。
- `trading_calendar` 有 FAKE 旁路(TX calendar fixture)→ e2e 可行(brokers_window
  e2e 已走通同路徑)。
- App.tsx:`useChipBubble(tab==="bubble" ? symbol : "", date)` mount 在 App(L195),
  已有 `RangeSelector` 元件與 `windowDays` state 樣板(該 state 屬 ChipBrokersPanel,
  泡泡天數需獨立 state)。
- `chip-bubble-svg.tsx` 全 inline style(零 className / CSS var 依賴)→ XMLSerializer
  序列化後樣式完整,SVG→canvas→PNG 可行;字型 `CHIP.font` 為 webfont,序列化進
  canvas 時 @font-face 不可得 → fallback 系統字型(known limitation,見 edge case)。

## 拍板決策(實作選擇,auto-default)

- [auto-default: 後端新端點 `GET /api/chip/{symbol}/bubble_window?date&days&refresh`,
  days ge=2 le=20;days=1 前端直接走既有 `/bubble` 端點不打新端點 | reason: 照抄
  brokers_window 樣板最小驚訝;le=20 控 payload(高量股 50k rows/日,聚合 dedupe
  (broker_id,price) 後仍隨窗口成長,20 日為可用性上限,payload 實測附 evidence)]
- [auto-default: 聚合 key = (broker_id, broker, price),buy/sell 加總;payload shape =
  ChipBubbleData 超集(加 window_days / trading_dates / actual_days)| reason: trades
  shape 不變 → 前端 BubbleChartSvg / 明細 / 統計 / volume profile 全部零改動直接吃]
- [auto-default: 天數選擇 UI = header 右工具欄 RangeSelector 樣板,選項 1/3/5/10/20 日,
  預設 1 日(= 現況單日);state 掛 App.tsx(hook 在 App mount),不持久化 | reason:
  對齊 ChipBrokersPanel windowDays 慣例;預設單日 = 零行為驚訝]
- [auto-default: days>1 時分時線隱藏(單日限定資料)、closePrice 參考線照顯(anchor 日
  收盤)、badge 顯「近 N 個交易日累計(實際 X 日)」| reason: 分時線在多日語意下誤導;
  actual_days 對齊 ChipBrokersWindow「(實際 X 日)」慣例]
- [auto-default: 截圖 = lib 純函式 `lib/bubble-screenshot.ts`(serialize SVG → canvas
  2x → toBlob → a[download])+ header 工具欄「截圖」鈕;檔名
  `bubble_{symbol}_{date}.png` / 多日 `bubble_{symbol}_{date}_w{N}.png`;canvas 底
  先鋪不透明頁面底色(自 container computed style 取)| reason: 無新依賴;2x 保清晰;
  SVG 透明底直轉會黑底/透明疊圖不可讀]
- [auto-default: scope = L | reason: 跨前後端 ≥5 檔(finmind.py / chip.py / backend
  tests / api.ts / chip-data.ts / useChipBubble / App.tsx / ChipBubbleView / 新
  screenshot lib / e2e);對外 API 新端點。完整流程:design 1 輪 + PLAN 1 輪]

## 成功條件(SC gate)

- **SC-1(後端端點)**:`GET /api/chip/{symbol}/bubble_window?date&days&refresh` 回
  `{symbol, date, window_days, trading_dates, actual_days, fetched_at, trades}`;
  trades = N 交易日逐日 bubble 以 (broker_id, broker, price) 加總;全日失敗 →
  503 `{"detail":{"error":"bubble_window_unavailable"}}`;days 越界 → 422。
  驗證:`python -m pytest -q tests/test_bubble_window.py -x`
  [amendment 2026-08-13: design review R12 — 測試落新檔對齊 test_brokers_window
  慣例,驗證指令同步]。
- **SC-2(cache 契約)**:聚合結果 self-cache key `{symbol}_{date_str}_w{days}_bubblew`
  + 獨立 `_CACHE_VERSION_BUBBLE_W`;today TTL 30min、過去日永久;inflight dedup key 含
  `_r{int(refresh)}`;cache 寫失敗只 warning 不 500。驗證:
  `python -m pytest -q tests/test_bubble_window.py -x`(cache hit / refresh bypass /
  OSError guard 測試)[amendment 2026-08-13: 同 R12]。
- **SC-3(前端資料層)**:`api.chipBubbleWindow(symbol, date, days, refresh)` +
  `useChipBubble(symbol, date, days)`:days=1 走既有 `/bubble`(URL 零變化),days>1 走
  `/bubble_window`;hook 回傳加 `windowMeta: {windowDays, actualDays} | null`(單日 null)。
  驗證:`npm test`(api.test / useChipBubble.test 新 case)。
- **SC-4(UI 天數選擇,畫面可指認)**:泡泡圖 header 中欄統計行右端出現天數選擇
  (1日/3日/5日/10日/20日,active 態同 RangeSelector 慣例)
  [amendment 2026-08-13: design §3 R15 fallback 觸發 — 原「右工具欄」落點在 1280px
  壓爆中欄(e2e E39 紅),依預先拍板 fallback 移統計行右端,量測見 progress.md];
  選 3 日以上時圖區左上出現 badge 文字「近 N 個交易日累計(實際 X 日)」,且分時
  折線消失。驗證:vitest render + chrome-devtools 截圖
  `docs/specs/bubble-streak-screenshot/screenshots/` + user 過目。
- **SC-5(下游零改動吃聚合)**:days>1 時泡泡、右欄價位長條、買賣明細、統計行、
  brush、blocklist、volume profile 全部反映聚合 trades,元件檔零邏輯改動(僅
  props 透傳)。驗證:vitest 既有測試全綠 + ChipBubbleView 新 case(聚合資料下
  明細列數 = 聚合列數)。
  [amendment 2026-08-13: design review R7/R26 — 「零改動」限資料管線;user 可見
  文案例外:ChipBubbleView「今日共」「當日無成交」依 days 分流、
  BubbleBlocklistPopover 空態文案改中性「無符合的分點」(新建其測試檔先紅後綠)]。
- **SC-6(e2e)**:`e2e/specs/equity.spec.ts` 新 E#:泡泡圖 tab → 切 5 日 → svg 泡泡
  數 > 0 且 badge「近 5 個交易日累計」出現(資料級 assertion);backend
  `tests_e2e/test_api_chip*.py` 補 bubble_window contract shape。驗證:`e2e/` `npm test`。
- **SC-7(截圖鈕,畫面可指認)**:header 右工具欄出現「截圖」鈕(bubbleData 就緒才
  顯示);點擊 → 瀏覽器下載 `bubble_{symbol}_{date}.png`(多日帶 `_w{N}`),打開為
  不透明深色底、內容與當下泡泡圖一致(泡泡 / 軸 / 分時線 / 選中外框)、解析度 2x;
  多日模式 PNG 內含窗口標註文字「近 N 個交易日累計」[amendment 2026-08-13: design
  review R14 — 圖內標註,避免多日截圖被誤讀成單日];截圖失敗顯 role=status 提示
  不靜默 [amendment 2026-08-13: R10]。
  驗證:vitest(serialize/檔名純函式)+ e2e download 事件 + 真實下載檔對照截圖 +
  user 過目。
- **SC-8(e2e 截圖)**:equity.spec.ts 新 E#:點截圖鈕 → Playwright `download` 事件,
  `suggestedFilename()` 匹配 `bubble_<symbol>_<date>.png`。驗證:`e2e/` `npm test`。

## Edge cases(≥3)

1. **窗口內部分日無資料**(停牌 / 新上市 / fixture 缺日):該日 fetch 失敗或空 trades
   → 聚合只含有資料日,`actual_days` = 成功日數,badge 顯「實際 X 日」;全部失敗 →
   503 `bubble_window_unavailable`。
2. **days=1 零回歸**:不打新端點、URL / payload / UI 與現況 bit-for-bit 相同;分時線
   照顯、無 badge。
3. **anchor 日非交易日**(週末查詢):trading_calendar 取 ≤ anchor 的最近 N 交易日
   (對齊 brokers_window 現行為),不另發 no_trading_day flag。
4. **截圖時無資料 / loading 中**:鈕不渲染(`bubbleData` null 時整個工具欄項缺席),
   不會產出空白 PNG。
5. **聚合值與泡泡門檻**:BubbleChartSvg 的 threshold / top-100 slice 照舊作用於聚合值
   (多日累計讓長尾分點過門檻是預期語意,非 bug)。
6. **webfont fallback**:序列化 SVG 進 canvas 時 Inter Tight 不可得 → 系統字型;泡泡
   幾何 / 顏色不受影響(known limitation,不阻擋)。
7. **高量股 × 20 日 payload**:聚合 dedupe 後仍可能數十萬 rows;le=20 上限 + 實測
   3481 類個股 20 日 payload 大小附 evidence;若 > 10MB 記 next-time 評估 slim 化,
   不在本輪擋。

## 不能破壞的既有行為白名單

1. days=1(預設)單日泡泡圖:選取 / 單看 solo / brush / blocklist / focusRequest /
   搜尋 dismiss guard / 明細虛擬列表 / volume profile 全部不變。
2. `/api/chip/{symbol}/bubble` 既有端點 payload 零改動。
3. ChipBrokersPanel 的 windowDays(總覽 N 日)與泡泡天數互不影響(獨立 state)。
4. 換 symbol 重置選取等既有 reset 邏輯不變;天數切換**不**清選取(同資料源刷新語意,
   對齊 date 變更不清選取的現況)。
5. 泡泡圖 tab 的 lazy 載入 gate(`tab === "bubble"` 才 fetch)維持。

## Out of scope

- 「連買 / 連賣連續天數」badge(另一讀法,未選;日後要做可吃 broker_history)。
- 多日模式分時線(單日限定,window 模式隱藏)。
- 截圖含右欄明細 / header 統計、剪貼簿複製、其他頁面截圖。
- bubble_window payload slim 化 / 壓縮(edge 7 觸發才進 next-time)。
- 天數選擇持久化(localStorage / useSessionState)。

## 執行約束(前輪 bubble 系列掃描)

- 泡泡買紅(bull)賣綠?— 本專案 buy=accent、sell=bear token,新 UI 不得引入方向性
  配色衝突;資料標籤非互動態禁 accent(frontend-conventions 鐵則)。
- F11 axes-stable:選取切換不重排軸;天數切換屬資料源變更,軸隨聚合資料重算是預期。
- volume profile 恆用全量 trades(bubble-volume-profile SC-3)— 多日模式下 = 聚合全量。
- e2e 一律資料級 assertion,禁 visibility-only(options-page-v2 事故);痛點註解強制。
- e2e fixture 改動後清 `e2e/.cache`;新 fixture 必同 commit 上 MANIFEST(若需補日)。
- UI 實作開工前呼叫 frontend-design + bencium-controlled-ux-designer(user 指示,memory)。

## e2e 歸屬結論(e2e-conventions 判準表)

- equity mode UI 新功能 → `equity.spec.ts` 加 E#(SC-6 / SC-8)。
- 新 backend endpoint → `backend/tests_e2e/test_api_*.py` contract test 必補(SC-6)。
- FAKE fixture:bubble_window fan-out 逐日打 `taiwan_stock_trading_daily_report`。
  [amendment 2026-08-13: design review R1/R18 快篩實證 — 既有 fixture
  `taiwan_stock_trading_daily_report_2330_2026-06-12_2026-06-26.json` 覆蓋 11 個
  交易日(每日同 3 筆:buy 100 張 / sell 80 張 / price 1100),5 日窗口全命中 →
  e2e 驗「聚合倍數」(單日 100 張 vs 5 日 500 張);partial-window / actual_days
  路徑 e2e 蓋不到,由 `tests/test_bubble_window.py` 承擔]。不需新 fixture,
  不動 MANIFEST。
