# PLAN — 泡泡圖多日聚合視圖 + 截圖 PNG 下載

> **For agentic workers:** 依 task 順序實作;execution mode 由 /feat Phase 3 決定
> (M/L 級 dispatch,顯式 `model: opus`)。Commit tag 判準照 core-flow §4
> (`[red]` / `[green]` 配對、三類分離),**不自創 tag**。

**Goal:** 泡泡圖可切「近 N 個交易日累計」視圖(後端聚合端點),並可一鍵下載
圖表區 PNG。

**Architecture:** design.md v3(單一真相源;本 PLAN 只放落地粒度)。後端照抄
fetch_brokers_window 樣板;前端 hook 分流端點;截圖純前端 SVG→canvas。

**Tech stack:** FastAPI + httpx(既有)/ React 19 + TanStack Query(既有)。
零新依賴。

## Global constraints

- 鐵則 E(不 mock 真依賴讓測試過、不吞錯誤);backend-conventions(future
  annotations / type hints / logging)與 frontend-conventions / frontend-testing
  必讀後動工。
- days=1 路徑 bit-for-bit 不變(白名單 1/2);`/bubble` 端點 payload 零改動。
- 「幾日」呈現單一來源 = `days` prop(design R22)。
- e2e selector 一律 scope 到 `data-testid="bubble-days-selector"`(design R3)。

---

### Task A: Backend bubble_window(SC-1 / SC-2)

**Files:**
- Modify: `backend/services/finmind.py`(緊鄰 `_CACHE_VERSION_BW` 加
  `_CACHE_VERSION_BUBBLE_W = 1`;`fetch_brokers_window` 區塊後加三個成員,
  簽名與內容照 design §1 逐字)
- Modify: `backend/routes/chip.py`(brokers_window route 後插 design §1 route,
  `days: int = Query(default=5, ge=2, le=20)`)
- Create: `backend/tests/test_bubble_window.py`(結構抄 `tests/test_brokers_window.py`;
  design §1 測試 1-11 + 9b 全列,含 [R8] 混合 id、[R17] 空 trades 日
  `actual_days == 3`、[R2] 部分失敗 `actual_days == 4`)
- Modify: `backend/tests_e2e/test_api_chip.py`(FAKE contract:shape、
  buy == 單日 ×5、`trading_dates == [2026-06-22..26]`、`actual_days == 5`、
  days=3 → window_days==3 且 ×3 — design §1 [R1][R21])

**Interfaces(對外 API — 完整簽名):**
- `async def fetch_bubble_window(self, symbol: str, date_str: str, days: int, refresh: bool = False) -> dict`
- `def _aggregate_bubble_window(symbol: str, date_str: str, days: int, trading_dates: list[str], bubbles: list[dict]) -> dict`
  → `{symbol, date, window_days, trading_dates, actual_days, fetched_at, trades: [{broker, broker_id, price, buy, sell}]}`
  - actual_days = sum(1 for b in bubbles if b["trades"])(空日不計,design R17)
  - key 兩階段正規化(design R8 code block 逐字)
- Route: `GET /api/chip/{symbol}/bubble_window?date&days&refresh`;全日失敗 →
  ValueError("bubble_window_unavailable") → 503(既有機制)

**Steps:** (1) 寫 test_bubble_window.py + contract test → 跑紅 →
`🟢 test(chip): add failing tests for bubble_window SC-1/SC-2 [red]`;
(2) 實作 finmind.py + chip.py → `python -m pytest -q tests/test_bubble_window.py -x`
+ `python -m pytest -q tests_e2e/test_api_chip.py` 綠 →
`🟢 feat(chip): bubble_window N-day aggregate endpoint, implement SC-1/SC-2 [green]`
(body 註 red→green sha);(3) `ruff check .`。

### Task B: 前端資料層(SC-3)

**Files:**
- Modify: `frontend/src/lib/chip-data.ts`(`ChipBubbleWindowData extends
  ChipBubbleData`,design §2)
- Modify: `frontend/src/lib/api.ts`(`chipBubbleWindow` method,**逐字對齊
  `chipBrokersWindow`(api.ts:212-218)形狀**:params Record<string,string> /
  `days: String(days)` / `if (refresh) params.refresh = "true"` / RequestOptions)
- Modify: `frontend/src/hooks/useChipBubble.ts`(design §2 code block:days
  default 1、queryKey 帶 days、days>1 走 chipBubbleWindow、回傳加 windowMeta)
- Test: `frontend/src/lib/api.test.ts`(URL / refresh)、
  `frontend/src/hooks/useChipBubble.test.ts`(days 省略 → chipBubble;days=5 →
  chipBubbleWindow + windowMeta;days=1 → windowMeta null;mock 樣板照
  frontend-testing 的 vi.spyOn)

**Interfaces:**
- `chipBubbleWindow(symbol: string, date: string, days: number, refresh?: boolean, options?: RequestOptions): Promise<ChipBubbleWindowData>`
- `useChipBubble(symbol: string, date: string, days: number = 1)` →
  `{data, windowMeta: {windowDays, actualDays} | null, loading, error, refresh}`

**Steps:** 紅(新測試)→ `🟢 test(frontend): failing tests for bubble window
data layer SC-3 [red]` → 實作 → `npm test` 綠 → `🟢 feat(frontend): bubble
window api + hook days param, implement SC-3 [green]`。

### Task C: UI 天數選擇 + badge + 文案(SC-4 / SC-5)

**Files:**
- Modify: `frontend/src/App.tsx`(`bubbleDays` state;hook 帶 days;intraday
  gate `tab === "bubble" && bubbleDays === 1`;ChipBubbleView 傳
  days/onDaysChange/windowMeta;換 symbol 不重置 bubbleDays;
  **[impl-review R8] `refresh()` 同步 gate**:tab==="bubble" 分支改
  `bubbleHook.refresh(); if (bubbleDays === 1) intradayHook.refresh();` —
  days>1 時不對 disabled query 發 refresh(避免 `GET /api/chip//intraday`
  無效請求))
- Test: `frontend/src/App.test.tsx`(**[impl-review R4]** 新 case:
  (a) bubbleDays > 1 → useChipIntraday 收到 symbol "";(b) 換 symbol →
  bubbleDays 不重置;既有 vi.mock 樣板照用)
- Modify: `frontend/src/components/ChipBubbleView.tsx`:
  - **[impl-review R1] Props 一律 optional + 預設**(對齊既有 `loading?` /
    `focusRequest?` 風格,既有 30+ 測試 render 不需改):`days?: number`
    (元件內 default 1)、`onDaysChange?: (d: number) => void`(未提供 →
    不渲染 BubbleDaysSelector)、`windowMeta?: {...} | null`(default null)。
    App.tsx 恆傳三者。
  - Props + `BubbleDaysSelector`(本檔內部元件;preset [1,3,5,10,20];
    `data-testid="bubble-days-selector"`、group `aria-label="泡泡圖天數視窗"`、
    按鈕 `aria-label="泡泡圖設為 N 日"` + `aria-pressed`;樣式 design §3
    [R3][R25b] 含 `pointer-coarse:min-h-11`;放工具欄列最左)
  - 累計 badge(absolute top-2 left-2 z-30 pointer-events-none,
    `data-testid="bubble-window-badge"`,文字規則 design §3)
  - 文案 days 分流:「今日共 / 近 {days} 日共」「當日無成交 / 近 {days} 日無成交」
    (design §3 [R7][R22];symbol reset effect deps 不動)
- Modify: `frontend/src/components/BubbleBlocklistPopover.tsx`(L112 文案 →
  「無符合的分點」)+ Create: `frontend/src/components/BubbleBlocklistPopover.test.tsx`
  (鎖新文案;**🔴 行為 commit,先紅後綠,與 🟢 分開**)
- Test: `frontend/src/components/ChipBubbleView.test.tsx`(design §3 測試 1-6:
  selector / onDaysChange / badge 三態 + 載入視窗期 / selected 保留 / 聚合資料
  列數與 totals / 文案分流;全部 scope 到 testid)

**Interfaces(Consumes):** Task B 的 windowMeta shape;
`onDaysChange: (d: number) => void`。

**Steps:** (1) 🔴 popover 文案 **[impl-review R5] 兩 commit**:
`🔴 test(frontend): lock blocklist popover 空態文案 [red]`(新測試,紅)→
`🔴 fix(frontend): blocklist popover 空態文案改中性(多日模式適用)[green]`
(body 註 `red→green for <sha>`);兩者都在 🟢 UI commit 之前,不與 🟢 混;
(2) 🟢 UI:紅(ChipBubbleView 新測試)
→ `[red]` commit → 實作 App.tsx + ChipBubbleView → `npm test` 綠 →
`🟢 feat(frontend): bubble days selector + window badge + 文案分流, implement
SC-4/SC-5 [green]`。**UI 動工前呼叫 frontend-design + bencium-controlled-ux-designer
(user 指示)+ 讀 frontend-conventions。**

### Task D: 截圖(SC-7)

**Files:**
- Create: `frontend/src/lib/bubble-screenshot.ts`(design §4 四個 export 逐字;
  annotation `<text>` 座標字面值 x=64, y=26(= PADDING{left:56,top:12} + 8/14,
  PADDING 未 export,註解標來源);serializeSvg 寫入 root font-size,
  **[impl-review R9]** `const rootFont = getComputedStyle(document.documentElement).fontSize || "16px"`
  (jsdom 可能回空字串);downloadBlob revoke 延後 setTimeout 1000)
- Modify: `frontend/src/components/ChipBubbleView.tsx`(「截圖」鈕
  `data-testid="bubble-screenshot"`(bubbleData 非 null 才渲染)+
  `handleScreenshot`(design §4 code block 為準,**[impl-review R3] svg 選擇器
  改 `querySelector<SVGSVGElement>("svg[width][height]")`** — 容器內 loading
  spinner 也是 svg(無 width/height attr),視窗期會誤抓;**[impl-review R7]
  state 名以 `screenshotNotice: string | null` 為準,design R10 段落殘留的
  `screenshotError: boolean` 作廢**)+ screenshotNotice(role=status 黃字,
  同 limitNotice 樣板;成功清 / symbol reset effect body 清))
- Test: `frontend/src/lib/bubble-screenshot.test.ts`(filename 兩態;
  serializeSvg xmlns / width/height / annotation 有無 + 「(實際 X 日)」variant;
  **[R9] font-size case:測試內設 `document.documentElement.style.fontSize = "20px"`
  → 斷輸出含 `font-size: 20px`**)、ChipBubbleView.test.tsx(鈕存在性 / 點擊
  呼叫 mock + 檔名 / reject → 提示;**[R3] 容器尺寸 0(useContainerSize mock
  {0,0})+ loading → 點截圖顯「圖表尚未就緒」且 svgToPngBlob 未被呼叫**)

**Interfaces:**
- `bubbleScreenshotFilename(symbol: string, date: string, days: number): string`
- `serializeSvg(svg: SVGSVGElement, opts?: { annotation?: string }): string`
- `svgToPngBlob(svg: SVGSVGElement, opts: { scale?: number; background: string; annotation?: string }): Promise<Blob>`
- `downloadBlob(blob: Blob, filename: string): void`

**Steps:** 紅 → `🟢 test(frontend): failing tests for bubble screenshot SC-7
[red]` → 實作 → 綠 → `🟢 feat(frontend): bubble chart PNG screenshot, implement
SC-7 [green]`。

### Task E: e2e + changelog(SC-6 / SC-8)

**Files:**
- Modify: `e2e/helpers/selectors.ts`(**[impl-review R2] windowDays* 的 name
  改 regex 錨定 `/^設為 10 日$/`、`/^設為 60 日$/`** — ROLES 是資料物件,
  加 `exact: true` 欄位呼叫端不會傳入 = no-op;regex 樣板同檔 mode switch
  已用,呼叫端(equity.spec.ts:76 / navigation.spec.ts:48)零改動即生效。
  獨立 commit,body 註 `test-infra-fix: 泡泡天數鈕 label 子字串防撞`)
- Modify: `e2e/specs/equity.spec.ts`:
  - E43(design §5:單日 100 張基準 → scope click「泡泡圖設為 5 日」→ badge
    含「近 5 個交易日累計」+ 明細 500 張 + circle 數 > 0;痛點註解照 design)
  - E44(`waitForEvent("download")` → suggestedFilename ===
    `bubble_2330_2026-06-26.png` + `download.path()` size > 0;痛點註解照 design)
- Modify: `frontend/src/lib/changelog.ts`(MINOR bump 新 entry:多日聚合 +
  截圖兩 item;**寫前讀 changelog-conventions**;同步產物不掛 TDD tag,
  `🟢 feat(frontend): changelog vX.Y.0`或併入收尾 chore — 依 changelog-conventions
  的 ship-event 合併規則)
- 跑前清 `e2e/.cache`。**[impl-review R6] commit 路徑定死單一條**:e2e spec 屬
  core-flow §4「補強型測試」→ 單 commit `🟢 test(e2e): E43/E44 bubble window +
  screenshot`,**不掛 TDD tag**,body 註
  `covered-by-implementation: <Task A-D green sha>`。**驗紅義務**:commit 前
  以暫時 mutation(E43 的 500 張改斷錯值 / E44 檔名改斷錯名)各跑一次確認
  spec 會紅,Edit 還原後跑綠,結果記 progress.md(防「後補 e2e 從未觀察到紅」
  假綠溫床)。

**Steps:** selectors 防撞 commit → E43/E44 spec → `npm test`(e2e)全綠。

---

## 驗收鏈(Task 完成後)

Phase 5:auto-verify 全套(pytest / ruff / vitest / build / e2e)。
Phase 6:design §6 真實環境 1-5(截圖 ×3 viewport、下載檔對照、payload 量測
UTF-8 bytes、long task 量測 + 降檔 checklist 待命、regression 抽 2)。
Phase 7:phase7-verification.md 表格。

## Self-review 紀錄

- Spec coverage:SC-1/2→A、SC-3→B、SC-4/5→C、SC-7→D、SC-6/8→E;R1-R26 全數
  已入 design v3 並由上列 task 承接。
- Placeholder scan:無 TBD;design code block 為單一真相源,PLAN 指回不重抄。
- Type consistency:windowMeta shape 在 B/C/D 三處一致
  `{windowDays, actualDays}`;filename fn 簽名 D 與 C handler 一致。
