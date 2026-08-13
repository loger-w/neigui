# design — 泡泡圖多日聚合視圖 + 截圖 PNG 下載

版本 v2(2026-08-13)。對應 brainstorm.md SC-1〜SC-8。

Changelog:
- v1:初版。
- v2:design review round 1(15 findings 全 accepted)修復 —
  §1:actual_days 改「成功 fetch 日數」(R2)、聚合 key 兩階段 id 正規化(R8)、
  測試檔位置偏離明記 + brainstorm 指令 amendment(R12)、測試 8 補 actual_days(R2);
  §2:api.ts 片段對齊 chipBrokersWindow 可編譯形狀(R9);
  §3:aria-label 改「泡泡圖設為 N 日」+ selector scoping(R3)、多日文案分流(R7)、
  SC-5 聚合資料 vitest case(R4)、工具欄寬度預算與 fallback(R15);
  §4:serializeSvg 寫入 root font-size(R5)、多日窗口標註 text(R14)、
  失敗提示 role=status(R10)、revoke 延後(R13);
  §5:fixture 事實更正 + E43 倍數 assertion + contract test 強化(R1)、
  E44 補內容檢查(R13);
  §6:前端效能量測與 preset 降檔決策規則(R6)、payload 量測指令 PowerShell 化
  + 門檻口徑(R11)、1280px header 截圖(R15)。
- v3:round 2 限縮輪(0 P0 / 4 P1 / 7 P2 全 accepted)—
  §1:actual_days 排除空 trades 日 + 對應測試(R17)、contract test 補
  trading_dates / days=3 鑑別(R21);
  §3:「幾日」呈現單一來源 = days prop(R22)、preset 鈕補 pointer-coarse 觸控
  高度 + selectors.ts exact 化(R25)、popover 文案測試落點(R26);
  §4:annotation 座標與字串同 badge 源(R23)、no-op 路徑也給提示 +
  screenshotError 清除點(R24);
  §6:payload 量法改 UTF-8 bytes + 釘 anchor 日(R16)、效能量測可重現化
  (R19)、降檔完整 checklist(R20)、窄視窗截圖(R25)。
  brainstorm 同步:e2e 歸屬節 fixture 事實 amendment(R18)、SC-5 文案例外
  amendment(R26)。

## 0. 架構總覽

兩個獨立子功能,共用同一個 view:

1. **多日聚合(SC-1〜SC-6)**:後端照抄 `fetch_brokers_window` 樣板新增
   `fetch_bubble_window`(trading_calendar 取 N 交易日 → fan-out 既有
   `fetch_chip_bubble`(逐日各自 cache)→ 純函式聚合 → self-cache)。前端
   `useChipBubble` 加 `days` 參數分流端點;`ChipBubbleView` 加天數選擇 + 累計
   badge。**payload trades shape 不變 → 圖表 / 明細 / 統計 / volume profile
   下游資料管線零改動**(文案有 days 分流,見 §3,R7)。
2. **截圖(SC-7〜SC-8)**:純前端 `lib/bubble-screenshot.ts`(serialize SVG →
   canvas 2x → PNG blob → download),`ChipBubbleView` 工具欄加鈕。無新依賴。

資料流(多日):

```
ChipBubbleView(days selector)
  → App.tsx bubbleDays state
    → useChipBubble(symbol, date, days)
      days === 1 → api.chipBubble        → GET /api/chip/{s}/bubble        (現況,零變化)
      days  >  1 → api.chipBubbleWindow  → GET /api/chip/{s}/bubble_window?date&days
                                             → fetch_bubble_window
                                               → get_trading_days(end, n=days)
                                               → gather(fetch_chip_bubble × N)   # 逐日 cache 重用
                                               → _aggregate_bubble_window(純函式)
                                               → self-cache {s}_{d}_w{N}_bubblew
```

## 1. Backend — SC-1 / SC-2

### 檔案

- Modify `backend/services/finmind.py`:
  - `_CACHE_VERSION_BUBBLE_W = 1`(緊鄰 `_CACHE_VERSION_BW`,獨立 bump 面)
  - `fetch_bubble_window(self, symbol, date_str, days, refresh=False) -> dict`
  - `_do_fetch_bubble_window(self, symbol, date_str, days, refresh, cache_key) -> dict`
  - module-level 純函式 `_aggregate_bubble_window(symbol, date_str, days, trading_dates, bubbles) -> dict`
- Modify `backend/routes/chip.py`:新 route。
- Create `backend/tests/test_bubble_window.py`(結構抄 `test_brokers_window.py`)。
  **[R12 偏離明記]** brainstorm SC-1/SC-2 原寫 `tests/test_chip_routes.py`,採新檔
  對齊 brokers_window 的獨立測試檔慣例;brainstorm 已補 amendment 同步指令。
- Modify `backend/tests_e2e/test_api_chip.py`:contract shape + 聚合倍數 test。

### fetch_bubble_window(逐行對齊 brokers_window 樣板,finmind.py:714-795)

```python
cache_key = f"{symbol}_{date_str}_w{days}_bubblew"
if not refresh:
    cached = self._read_cache_v(cache_key, _CACHE_VERSION_BUBBLE_W)
    if cached is not None:
        if not self._is_today(date_str) or not self._is_stale(cached):
            return cached
return await self._run_once(
    f"bubble_window_{cache_key}_r{int(refresh)}",
    lambda: self._do_fetch_bubble_window(symbol, date_str, days, refresh, cache_key),
)
```

`_do_fetch_bubble_window`:
- `get_trading_days(end, n=days)` 空 → `raise ValueError("bubble_window_unavailable")`
- `trading_dates = [d.isoformat() for d in reversed(recent)]`(ascending)
- `asyncio.gather(*[self.fetch_chip_bubble(symbol, d, refresh) for d in trading_dates], return_exceptions=True)`
  - **[設計理由]** 用 gather 不用 TaskGroup:與 brokers_window 同語意 —
    「部分日失敗仍出貨」,非「任一失敗整包放棄」;finmind-conventions 的
    TaskGroup 條款針對後者。
- `bubbles = [b for b in results if isinstance(b, dict)]`;空 →
  `raise ValueError("bubble_window_unavailable")`(既有 ValueError→503
  `{"detail":{"error":code}}` 機制承接,同 brokers_window;
  test_brokers_window.py:622 樣板)
- `_aggregate_bubble_window(...)` → cache 寫 `try/except OSError: logger.warning`

### _aggregate_bubble_window(純函式)

輸入 `bubbles: list[dict]`(各日 fetch_chip_bubble payload,已 ascending)。

**[R8] 兩階段 key 正規化**(broker_id 可為 ""(fetch_chip_bubble:261 的
`r.get(..., "")`);同一分點「某日缺 id、另日有 id」不得分裂成兩列):

```python
# pass 1:name → 最新非空 broker_id 對映(ascending 掃,後日蓋前日)
name_to_id: dict[str, str] = {}
for b in bubbles:
    for t in b["trades"]:
        if t["broker_id"]:
            name_to_id[t["broker"]] = t["broker_id"]

# pass 2:key = (正規化 id, price);id 全程缺席才退 name
acc: dict[tuple[str, float], dict] = {}
for b in bubbles:
    for t in b["trades"]:
        norm_id = t["broker_id"] or name_to_id.get(t["broker"], "")
        key = (norm_id or t["broker"], t["price"])
        slot = acc.get(key)
        if slot is None:
            acc[key] = {**t, "broker_id": norm_id}
        else:
            slot["buy"] += t["buy"]
            slot["sell"] += t["sell"]
            slot["broker"] = t["broker"]      # 後日名稱蓋前日(分點改名取最新)
```

- 輸出 `trades = list(acc.values())`,排序 `(price, -(buy+sell))`(deterministic,
  方便測試 assert;前端自行重排不依賴此序)。
- payload:`{symbol, date: date_str, window_days: days, trading_dates,
  actual_days, fetched_at: clock.now().isoformat(timespec="seconds"), trades}`
  — **ChipBubbleData 超集**(SC-1)。
- **[R2+R17] `actual_days = sum(1 for b in bubbles if b["trades"])`(有資料的
  日數)** — 採 brainstorm Edge 1 完整語意:「fetch 失敗**或空 trades**」皆不計
  (fetch_chip_bubble 對停牌 / 無資料日回 200 + trades:[],不 raise —
  finmind.py:254-268;空日比 HTTP 失敗常見得多)。**顯式偏離** ChipBrokersWindow
  的 `len(trading_dates)` 語意。`trading_dates` 仍為 calendar 嘗試日(除錯可對照)。

### Route(chip.py,插在 brokers_window 後)

```python
@router.get("/api/chip/{symbol}/bubble_window")
async def get_chip_bubble_window(
    symbol: str,
    request: Request,
    date: str = Query(default=""),
    days: int = Query(default=5, ge=2, le=20),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    return await run_with_disconnect(
        request, get_finmind().fetch_bubble_window(symbol, d, days, refresh)
    )
```

- `ge=2`:days=1 前端不打此端點(brainstorm 拍板);`le=20` payload 上限。
- 越界 FastAPI 自動 422(SC-1)。

### 測試(test_bubble_window.py;conftest 既有基建,不重寫 singleton reset)

純函式組:
1. 兩日同 (id, price) → buy/sell 加總、名稱取後日。
2. 空 broker_id 退 name 聚合;兩個不同名空 id 分點不誤併。
3. **[R8] 混合 id**:同名分點 day1 id=""、day2 id="9600" → 單一列,
   broker_id="9600",buy/sell 為兩日和。
4. 單日輸入 = 原樣 passthrough(值不變)。
5. 輸出 shape:window_days / trading_dates / actual_days / fetched_at 欄位齊。

route / service 組(monkeypatch `fetch_chip_bubble` + `get_trading_days`):
6. happy path shape + 200。
7. days=1 → 422;days=21 → 422。
8. 全日失敗 → 503 `bubble_window_unavailable`。
9. **[R2] 部分日失敗(5 日 1 失敗)→ 200,聚合只含成功日,`actual_days == 4`**。
9b. **[R17] 空 trades 日(5 日中 2 日回 `{"trades": []}`)→ 200,trades 為其餘
    3 日聚合,`actual_days == 3`**。
10. cache hit:第二次呼叫不再打 fetch_chip_bubble(過去日);refresh=True bypass。
11. cache 寫 OSError → 仍回 200(monkeypatch `_write_cache_v` raise)。

contract test(tests_e2e/test_api_chip.py):FAKE 下
- `GET /api/chip/2330/bubble_window?date=2026-06-26&days=5` → 200,top-level
  keys 齊、`trades[0]` 欄位齊、`window_days == 5`。
- **[R1] 聚合倍數**:同 symbol/date 打 `/bubble` 取單日 `trades[0].buy`,
  斷 window 版同 (broker_id, price) 列的 buy == 單日 × 5(fixture 11 日同值,
  5 日窗口全落在覆蓋內)。
- **[R21] 同質 fixture 鑑別力補強**(×5 分不出「取錯窗口日」「days 被寫死」):
  斷 `trading_dates == ["2026-06-22","2026-06-23","2026-06-24","2026-06-25","2026-06-26"]`
  且 `actual_days == 5`;另打 `days=3` 斷 `window_days == 3` 且同列 buy == 單日 ×3。

## 2. Frontend 資料層 — SC-3

### 檔案

- Modify `frontend/src/lib/chip-data.ts`:
  ```ts
  export interface ChipBubbleWindowData extends ChipBubbleData {
    window_days: number;
    trading_dates: string[];
    actual_days: number;
  }
  ```
- Modify `frontend/src/lib/api.ts` — **[R9] 逐字對齊 chipBrokersWindow
  (api.ts:212-218)形狀**(params 是 `Record<string, string>`、
  `RequestOptions` 第 4 參數):
  ```ts
  chipBubbleWindow: (
    symbol: string,
    date: string,
    days: number,
    refresh?: boolean,
    options?: RequestOptions,
  ): Promise<ChipBubbleWindowData> => {
    const params: Record<string, string> = { date, days: String(days) };
    if (refresh) params.refresh = "true";
    return get(`${BASE}/chip/${symbol}/bubble_window`, params, options);
  },
  ```
  (實作時以 api.ts 內 chipBrokersWindow 實際簽名為準逐字對齊,含 get 的參數順序。)
- Modify `frontend/src/hooks/useChipBubble.ts`:
  ```ts
  export function useChipBubble(symbol: string, date: string, days: number = 1) {
    const { data, isFetching, error, refresh } = useForceRefreshQuery<ChipBubbleData | ChipBubbleWindowData>({
      queryKey: ["chip-bubble", symbol, date, days],
      queryFn: async (force, { signal }) =>
        days > 1
          ? api.chipBubbleWindow(symbol, date, days, force, { signal })
          : api.chipBubble(symbol, date, force, { signal }),
      enabled: symbol !== "",
    });
    return {
      data: data ?? null,
      windowMeta:
        data && days > 1 && "window_days" in data
          ? { windowDays: data.window_days, actualDays: data.actual_days }
          : null,
      loading: isFetching, error: error ? error.message : null, refresh,
    };
  }
  ```
  - `days` 進 queryKey → 切天數自動 refetch + 各天數獨立 cache。
  - 既有 caller(App.tsx 單處)不帶 days → default 1,行為 bit-for-bit(白名單 1/2)。

### 測試

- `api.test.ts`:URL 含 `/bubble_window?date=...&days=5`;refresh 帶 `refresh=true`。
- `useChipBubble.test.ts`:days 省略 → 呼叫 `api.chipBubble`(既有測試不動);
  days=5 → 呼叫 `chipBubbleWindow` + `windowMeta` 曝光;days=1 → windowMeta null。

## 3. Frontend UI — SC-4 / SC-5

### 檔案

- Modify `frontend/src/App.tsx`(equity 區):
  - `const [bubbleDays, setBubbleDays] = useState<number>(1);`
  - `useChipBubble(tab === "bubble" ? symbol : "", date, bubbleDays)`
  - **分時線 gate**:`useChipIntraday(tab === "bubble" && bubbleDays === 1 ? symbol : "", date)`
    — days>1 直接不 fetch(省請求),view 端 `intradayPoints` 自然為 null。
  - `<ChipBubbleView ... days={bubbleDays} onDaysChange={setBubbleDays}
    windowMeta={bubbleHook.windowMeta} />`
  - 換 symbol 不重置 bubbleDays(視角偏好非資料 state;對齊 windowDays 不隨
    symbol 重置的現況)。
- Modify `frontend/src/components/ChipBubbleView.tsx`:
  - Props 加 `days: number; onDaysChange: (d: number) => void;
    windowMeta: { windowDays: number; actualDays: number } | null;`
  - **天數選擇**:新內部元件 `BubbleDaysSelector`(本檔內,同 PriceRangeInputPanel
    先例)— preset 按鈕 `[1, 3, 5, 10, 20]`,無自由輸入(後端 le=20;RangeSelector
    的 1-60 input 面不適用,不動共用元件 — 白名單風險最小)。視覺對齊
    RangeSelector chip:`aria-pressed` + active `text-ink border-accent
    bg-accent/[0.08]` / inactive `text-ink-dim hover:text-ink`,外層
    `role="group" aria-label="泡泡圖天數視窗"`,`data-testid="bubble-days-selector"`。
    **[R3] 按鈕 `aria-label="泡泡圖設為 N 日"`** — RangeSelector 已占用
    `設為 N 日` 且 equity 總覽分頁以 `hidden` 留在 DOM,1/10/20 三值會 strict-mode
    衝突;**所有 vitest / e2e 對天數鈕的定位一律先 scope 到
    `bubble-days-selector` 再取 button**。
    **[R25a] 反向防撞**:Playwright getByRole name 預設子字串比對,「泡泡圖設為
    10 日」包含既有 `ROLES.windowDays10.name = "設為 10 日"`(e2e/helpers/
    selectors.ts)— 本輪順手給 selectors.ts 的 windowDays* 加 `exact: true`
    (test-infra fix,body 註 `test-infra-fix`)。
    尺寸 `px-2 py-0.5 text-xs` + **[R25b] `pointer-coarse:min-h-11`**(對齊同
    工具欄既有鈕的觸控高度慣例)。放工具欄列最左(BubbleBlocklistPopover 左邊)。
  - **[R15] 工具欄寬度預算**:第三 grid 欄(auto)新增 ≈ 5×26px(preset)+
    40px(截圖)≈ 170px;lg 斷點中欄 minmax(0,1fr) 承壓。驗證義務:§6 補
    1280px 寬截圖,斷 header 兩行內、統計行完整可見;**fallback(若換行/壓縮
    不可讀)= selector 移中欄統計行右端**,實作時擇定後記 progress.md。
  - **累計 badge**(圖區 absolute top-2 left-2,z-30,樣式對齊 loading badge):
    `windowMeta !== null` 時顯 `data-testid="bubble-window-badge"`:
    `近 {windowDays} 個交易日累計` + `actualDays < windowDays` 時追加
    `(實際 {actualDays} 日)`。`pointer-events-none`,不擋泡泡互動。
    (「實際 X 日」觸發面 = fetch 部分失敗 / 歷史不足;vitest 鎖,real-env 不強求。)
  - **[R7] 多日文案分流**(SC-5 的「零改動」限資料管線,不含 user 可見文案;
    brainstorm SC-5 已補文案例外 amendment(R26)):
    **[R22] 「幾日」呈現的單一來源 = `days` prop**(即時反映使用者選擇;
    windowMeta 只負責 badge 顯示與「(實際 X 日)」註記 — 載入視窗期
    (days=5、windowMeta 尚 null)bubbleData 為 null,截圖鈕不渲染,檔名
    不一致情境結構性不存在):
    - L570 未選取計數:days=1 → `今日共 N 個分點`(不變);days>1 →
      `近 {days} 日共 N 個分點`(brushRange 時「此區間」前綴照舊)。
    - L677 聚焦無成交 badge:days=1 → `該分點當日無成交`(不變);days>1 →
      `該分點近 {days} 日無成交`。
    - `BubbleBlocklistPopover.tsx:112` 搜尋空態 `無符合的當日分點` → 改中性
      `無符合的分點`(兩模式皆正確,popover 不需知道 days)。**[R26] 目前無
      測試鎖該字串 → 「先紅」= 新建 `BubbleBlocklistPopover.test.tsx` 鎖新文案
      (紅)→ 改字串(綠);🔴 行為 commit**。
    - 既有 3 條「今日共」vitest(ChipBubbleView.test.tsx:229/1017/1778)在
      days 預設 1 下維持綠(props 未傳 days 時 default 1)。
  - 下游資料管線零改動(SC-5):`bubbleData.trades` 進既有 `visibleTrades` 管線,
    聚合資料自然流到泡泡 / 明細 / 統計 / brush / volume profile。
- 既有行為保護:days 切換**不**清 selected / brush(brainstorm 白名單 4 —
  symbol reset effect deps 僅 [symbol],不加 days)。

### 測試(ChipBubbleView.test.tsx 增量)

1. selector 渲染 5 個 preset、active 態 aria-pressed(scope 到 bubble-days-selector)。
2. 點「泡泡圖設為 5 日」→ `onDaysChange(5)`。
3. `windowMeta={windowDays:5, actualDays:3}` → badge 文字含「近 5 個交易日累計」
   「實際 3 日」;windowMeta null → badge 不存在;actualDays==windowDays → 無
   「實際」字樣;**[R22] `days=5 + windowMeta=null`(載入視窗期)→ 無 badge、
   不 crash、截圖鈕不渲染(bubbleData null)**。
4. days 切換不影響 selected(render props 變更後 chip 仍在)。
5. **[R4] 聚合資料流**:餵聚合 trades(3 分點 × 各 1 價位,量 = 單日 5 倍)+
   `days=5, windowMeta` → 右欄明細列數 = 聚合列數、列上張數顯聚合值
   (fmtVol 500);選取單一分點 → `bubble-broker-totals` 買/賣張 = 聚合量。
6. **[R7] 文案**:days=5 → 「近 5 日共 N 個分點」;days=1 → 「今日共」(既有
   3 條照舊);days=5 + 聚焦無成交分點 → 「近 5 日無成交」。

## 4. 截圖 — SC-7 / SC-8

### 檔案

- Create `frontend/src/lib/bubble-screenshot.ts`:
  ```ts
  /** 檔名:單日 bubble_{symbol}_{date}.png;多日 bubble_{symbol}_{date}_w{days}.png */
  export function bubbleScreenshotFilename(symbol: string, date: string, days: number): string;

  /** SVG element → standalone markup。
   *  [R5] clone 根 svg 顯式寫入 document root 的 computed font-size(px)—
   *  chip-bubble-svg 的 fontSize 全是 rem 字串(chip-theme svgLabelFont 註解:
   *  rem 隨大螢幕 root font-size 縮放),standalone 文件的 rem 基準是預設 16px,
   *  不寫入會在 ≥1920px 螢幕(root 112.5%/125%)產生字級不一致。
   *  [R14+R23] opts.annotation(days>1 時傳,字串與 badge 同源:
   *  「近 N 個交易日累計」+ actualDays < windowDays 時「(實際 X 日)」)→
   *  在 clone 內補一個 <text>,座標釘死 x = PADDING.left + 8、
   *  y = PADDING.top + 14(chart 內區左上,避開 x<=PADDING.left 的價位
   *  label 帶與第一條 grid;§6.2 對照時檢查未壓到軸標籤),fill 用 CHIP
   *  淡色、font 同 CHIP.font。PNG 自帶窗口資訊,不與檔名脫鉤。 */
  export function serializeSvg(svg: SVGSVGElement, opts?: { annotation?: string }): string;

  /** serialize → blob URL → Image → canvas(scale 2x、先鋪不透明 background)→ PNG Blob。
   *  jsdom 無 canvas/Image — 本函式 vitest 不覆蓋,e2e download + 真實下載檔驗(§6)。
   *  Image error / toBlob null → reject(caller catch)。 */
  export async function svgToPngBlob(
    svg: SVGSVGElement,
    opts: { scale?: number; background: string; annotation?: string },
  ): Promise<Blob>;

  /** a[download] click;[R13] revoke 延後(setTimeout 1000ms)+ 移除 anchor —
   *  同步 revoke 會在部分瀏覽器讓下載中止 / 0 byte。 */
  export function downloadBlob(blob: Blob, filename: string): void;
  ```
  - `serializeSvg`:clone node → `setAttribute("xmlns", "http://www.w3.org/2000/svg")`
    → width/height 從原 svg attr 取(BubbleChartSvg 收 px width/height props,attr
    恆在)→ `clone.style.fontSize = getComputedStyle(document.documentElement).fontSize`
    → annotation text(若有)→ `new XMLSerializer().serializeToString`。
    chip-bubble-svg 其餘樣式全 inline(已驗:零 className / CSS var);webfont
    fallback 系統字型為 known limitation(brainstorm edge 6)。
- Modify `ChipBubbleView.tsx`:
  - 工具欄鈕(輸入區間左側):`bubbleData !== null` 才渲染,
    `data-testid="bubble-screenshot"`,文字「截圖」,樣式同「輸入區間」鈕。
  - **[R10] handler 顯式 try/catch + 失敗提示**(沿用 limitNotice 的
    `role="status"` 黃字樣板;新 state `screenshotError: boolean`,下一次成功
    截圖 / 換股清除):
    ```ts
    const handleScreenshot = useCallback(async () => {
      const svg = bubbleRef.current?.querySelector("svg");
      if (!svg || !bubbleData) {
        // [R24] 有資料但 container 尺寸未回報(ResizeObserver 視窗期)也不靜默
        setScreenshotNotice("圖表尚未就緒,請稍候再試");
        return;
      }
      try {
        const background = getComputedStyle(document.body).backgroundColor;
        const blob = await svgToPngBlob(svg, {
          scale: 2,
          background,
          // [R22+R23] 字串與 badge 同源(days prop 主導,windowMeta 補實際日)
          annotation:
            days > 1
              ? `近 ${days} 個交易日累計` +
                (windowMeta && windowMeta.actualDays < windowMeta.windowDays
                  ? `(實際 ${windowMeta.actualDays} 日)`
                  : "")
              : undefined,
        });
        downloadBlob(blob, bubbleScreenshotFilename(symbol, bubbleData.date, days));
        setScreenshotNotice(null);
      } catch (err) {
        console.error("bubble screenshot failed", err);
        setScreenshotNotice("截圖失敗,請重試");   // role=status 黃字,同 limitNotice 樣板
      }
    }, [bubbleData, symbol, days, windowMeta]);
    ```
  - background 取 body computed(頁面深色底單一來源,不 hardcode hex)。
  - **[R24] `screenshotNotice: string | null` 清除點**:成功截圖時清 +
    既有 symbol reset effect **body** 內加 `setScreenshotNotice(null)`
    (deps 仍僅 [symbol],白名單 4 不動)。

### 測試

- Create `frontend/src/lib/bubble-screenshot.test.ts`:
  1. filename:days=1 → `bubble_2330_2026-08-13.png`;days=5 → `..._w5.png`。
  2. serializeSvg:輸出含 `xmlns=`、width/height attr、子節點 markup、
     **[R5] 根 svg style 帶 font-size(px 值)**;annotation 傳入 → 輸出含該
     `<text>` 與文字;未傳 → 無。(jsdom 可跑 — 純 DOM,無 canvas。)
- ChipBubbleView.test.tsx:鈕存在性(bubbleData null → 無鈕);點擊 → mock
  `svgToPngBlob`/`downloadBlob`(vi.spyOn module)被呼叫、檔名正確;
  **[R10] svgToPngBlob mock reject → 「截圖失敗」role=status 提示出現**;
  serializeSvg annotation 帶「(實際 X 日)」variant(R23)。

## 5. e2e — SC-6 / SC-8

**[R1] fixture 事實(已快篩證實)**:
`taiwan_stock_trading_daily_report_2330_2026-06-12_2026-06-26.json` 覆蓋 11 個
交易日(06-12〜06-26),每日同樣 3 筆(BROKER001/002/003、price 1100.0、
buy 100000 股 = 100 張、sell 80000 股 = 80 張)。5 日窗口(06-22〜06-26)全落
在覆蓋內 → 聚合 = 同 3 個 key、buy 500 張 / sell 400 張。**倍數關係是聚合的
辨識訊號**;partial-window / actual_days 路徑 e2e 蓋不到,由 pytest 測試 9 承擔。

- `e2e/specs/equity.spec.ts`:
  - E43(多日):泡泡圖 tab → 先斷單日明細列顯 100 張(基準)→ scope 到
    `bubble-days-selector` click「泡泡圖設為 5 日」→ 斷:
    (a) `bubble-window-badge` 文字含「近 5 個交易日累計」;
    (b) 明細列(或 `bubble-broker-totals` 選取後)顯 **500 張 = 單日 ×5**;
    (c) svg circle 數 > 0。
    痛點註解:倍數 assertion 鎖「前端真的切了端點且後端真的加總」— badge +
    circle>0 在「沒切端點 / 聚合覆寫而非加總」兩種壞法下都會偽綠
    (options-page-v2 事故條款)。
  - E44(截圖):`page.waitForEvent("download")` + click `bubble-screenshot` →
    `suggestedFilename()` = `bubble_2330_2026-06-26.png`;
    **[R13] `download.path()` 檔案 size > 0**(PNG 真的產出)。
    痛點註解:jsdom 測不了 canvas 全鏈 — 這條是 svgToPngBlob 真實瀏覽器唯一
    自動化覆蓋;只驗檔名會放過 toBlob null / revoke 過早的 0-byte 檔。
- fixture:不新增。改 fixture 無,但跑前清 `e2e/.cache` 一次(保險)。
- backend contract test 見 §1(含倍數 assertion)。

## 6. 驗證計畫(auto-verify + 真實環境)

- 自動化:`pytest -q` + `ruff check .`(backend)、`npm test` + `npm run build`
  (frontend)、`npm test`(e2e — 本輪屬「需要 e2e」類型,必跑)。
- 真實環境:dev server 起 → chrome-devtools MCP:
  1. SC-4 截圖:選 5 日,badge + 泡泡呈現,存
     `docs/specs/bubble-streak-screenshot/screenshots/`;
     **[R15] 另拍 1280px 寬 viewport:header ≤ 2 行、統計行完整可見**
     (不符 → fallback:selector 移中欄統計行右端,回 §3 改);
     **[R25b] 再拍 ≤430px 窄視窗:工具欄不炸行、preset 鈕可點**。
  2. SC-7:實點截圖鈕,下載檔打開對照(不透明底、內容一致、含窗口標註
     (多日)且標註未壓到軸標籤(R23)、2x 尺寸 = container 寬高 ×2)—
     檔案入 evidence/。
  3. **[R11+R16] payload 量測(高量股 3481,days=20,anchor 釘最近已收盤
     交易日)**,PowerShell:
     ```powershell
     $r = Invoke-WebRequest -UseBasicParsing "http://localhost:8000/api/chip/3481/bubble_window?date=<最近已收盤交易日>&days=20"
     [System.Text.Encoding]::UTF8.GetByteCount($r.Content)   # UTF-8 未壓縮 bytes ← 門檻對這個數字
     ($r.Content | ConvertFrom-Json).trades.Count            # trades 筆數一併記錄
     ```
     (`Content.Length` 是 UTF-16 char 數,中文分點名會系統性低估,禁用。)
     門檻:**UTF-8 未壓縮 ≤ 10MB**(gzip middleware 另存在,不入門檻);超標 →
     next-time 記 slim 化並評估 preset 降檔。
  4. **[R6+R19] 前端效能量測(同 3481,days=20,步驟寫死)**:
     (a) 記 `trades.Count`(同 §6.3);(b) DevTools Performance 錄製,操作
     序列固定:「切 20 日 → 等泡泡渲染 → 點『張數』表頭排序 1 次 → 點單一
     分點 1 次」;(c) 量該錄製中 interaction 觸發的**最長 long task(ms)**。
     門檻:**最長 long task < 1000ms**。evidence = trace 截圖 + 數字入
     screenshots/ 或 progress.md。(定性體感可另記,不作 gate。)
     **不過門檻 → 本輪內建降檔,[R20] 完整 checklist**:§3 preset 陣列改
     [1,3,5,10]、chip.py `le=10`、§1 測試 7 邊界改 days=11 → 422、§6.3 量測
     改用新上限重跑、brainstorm 拍板決策 + SC-1/SC-4 補 amendment、
     progress.md 記決策與量測數字。
  5. 未改功能抽 2:單日模式選取/明細、ChipBrokersPanel windowDays。

## 7. 邊界與風險

- **payload 上限**:le=20 + dedupe;實測補證據(§6.3),門檻超標降檔規則見 §6.4。
- **前端全量計算路徑**(R6):`aggregateByPrice` / `buildTradeRows` / BrokerSearch
  索引皆 O(n log n) 全量,20 日聚合 rows 數可能數倍於單日 —— §6.4 量測是 gate,
  降檔是本輪內建 fallback,非 next-time。
- **FinMind 配額**:20 日冷載入 = 20 req(逐日 cache 重用後 warm ≈ 0);遠低於
  history/major 的 360 req/檔,不動 rate 設計。
- **同 (id, price) 名稱變體**:latest-wins;混合 id 由兩階段正規化吸收(R8)。
- **days 切換瞬間**:TanStack 換 queryKey → data undefined → 既有 loading badge
  顯示(bubbleHook.loading 已接);selected 保留 — 聚合後該分點可能無成交,
  chip 仍顯(name 存 state 的既有設計本來就涵蓋)。
- **screenshot 記憶體**:2x canvas(典型 1400×800 → 2800×1600)≈ 18MB 暫存,
  單次操作可接受。
