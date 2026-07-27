# Design v1 — 泡泡圖多選分點(bubble-multi-broker)

> Changelog:
> - v1(2026-07-27):初版。
> - v3(2026-07-27):Phase 4 code review 修正 — F1:TradeRow 增 broker_id、
>   `onBubbleClick` 契約擴為 `(broker, brokerId?)`(§3「契約不動」句就此收回)—
>   泡泡 / 明細列入口按實際點擊 id toggle,name lookup 僅留 fallback;
>   F2:colorByName → colorById(同名不同 id 配色不互蓋);
>   MAX_SELECTED_BROKERS 改 = BROKER_PALETTE.length(單一 source of truth)。
> - v2(2026-07-27):Phase 1 review 修正 — R1 下拉 preventDefault 保焦點;R2 明定
>   N ≥ 1 後加選唯一入口為搜尋下拉(SC-1 語意 reconcile,brainstorm 同步 amendment);
>   R3 空狀態文案維持現行無角括號;R4 limitNotice 於所有清除/取代路徑一併清;
>   R5 selectedNames 直接自 state 導出;R6 §1 傳遞型別修正;R7 mobile sheet effect
>   多選化 + N 歸 0 行為明定。

**Goal**:`ChipBubbleView` 的分點選取由單值(`selectedBrokerId: string | null`)改為
有序多選(上限 6),圖面 union filter + per-broker 外框色,明細 / 統計合併,
Legend chips 承載選取狀態。

**Tech stack**:既有 React 19 + TS + Tailwind + 手寫 SVG(不加依賴)。App.tsx 零改動。

---

## 1. 資料模型與選取 state(SC-1)

`ChipBubbleView` 內:

```ts
interface SelectedBroker {
  id: string;      // FinMind securities_trader_id(選取契約 key,對齊 App.tsx)
  name: string;    // 原始分點名(顯示走 lib/broker-name.ts formatter)
  colorIdx: number; // 0-5,配色 slot,選取存續期間不變
}
const MAX_SELECTED_BROKERS = 6;
const [selected, setSelected] = useState<SelectedBroker[]>([]);
const [limitNotice, setLimitNotice] = useState<boolean>(false);
```

- 舊 `selectedBrokerId` / `selectedBrokerName` / `focusedBroker` 中,前兩者由
  `selected` 取代;`focusedBroker` 保留(無成交 badge 需要,語意不變)。
- Derived(useMemo):
  - `selectedIds: Set<string>`(id 集合,傳 chip-data 兩函式)
  - `selectedNames: Set<string>` = `new Set(selected.map((b) => b.name))`(直接自 state
    導出,**不走 visibleTrades join** — 分點自 trades 消失時 active 態 / chip 不失效;
    TradeList active 態用)
  - `colorByName: Map<string, string>`(name → palette 色,N ≥ 2 時明細列圓點用)
  - svg 傳完整 `selected` 陣列(`BubbleSelectedBroker[]`,§3 — 需要 colorIdx 上色)
- **入口可達語意(R2)**:圖面為 filter 模式,N ≥ 1 後畫面上只剩選中分點的泡泡與明細列,
  故泡泡 / 明細列兩入口在 N ≥ 1 時實際只能「移除」;**加選第 2 個以上分點的唯一入口
  = 搜尋下拉**(下拉永遠列全體)。SC-1 驗收與測試依此語意寫:泡泡 / 列入口測
  N=0 加選 + N ≥ 1 移除;搜尋入口測連續加選。
- **toggle 核心**(單一 handler,三入口共用):

```ts
const toggleBroker = useCallback((id: string, name: string) => {
  setLimitNotice(false);
  setSelected((prev) => {
    if (prev.some((b) => b.id === id)) return prev.filter((b) => b.id !== id);
    if (prev.length >= MAX_SELECTED_BROKERS) { setLimitNotice(true); return prev; }
    const used = new Set(prev.map((b) => b.colorIdx));
    let colorIdx = 0;
    while (used.has(colorIdx)) colorIdx++;
    return [...prev, { id, name, colorIdx }];
  });
}, []);
```

  (colorIdx = 最小未占用 slot → 移除中間 chip 其他分點顏色不動;edge case 3。
  註:`setLimitNotice(true)` 於 updater 內呼叫 — React 18+ 同 batch 合法,但為避免
  reviewer 疑慮,實作可改先讀 `selected` 再分支,兩式等價,以測試鎖行為不鎖寫法。)
- 三入口接線:
  - 泡泡點擊:`handleBubbleClick(name)` → visibleTrades name→id lookup → `toggleBroker`;
    `null`(點空白)→ `setSelected([])` + 清 brush(現行為)。
  - 明細列點擊:`TradeList onSelect(r.broker)` → 同上 lookup + toggle。
  - 搜尋下拉:`BrokerSearch onPick(name)` → 同上(§4)。
- 換股 reset effect:`setSelected([]); setLimitNotice(false);`(併入現有 symbol effect)。

## 2. chip-data.ts 集合化(SC-4、SC-5)

兩個純函式 signature 由單值改集合(**caller 僅 ChipBubbleView 與測試**,已 grep 確認):

```ts
export function computeBrokerTotals(
  trades: BrokerTrade[],
  brokerIds: ReadonlySet<string>,   // 空集合 → 全零(維持「未選不顯統計」)
): BrokerTotals;

export function buildTradeRows(
  trades: BrokerTrade[],
  brokerIds: ReadonlySet<string>,   // 空集合 → 不過濾(= 現行 null 分支)
  maxRows: number,
  buySort?: SortSpec,
  sellSort?: SortSpec,
): { buyRows: TradeRow[]; sellRows: TradeRow[] };
```

- 過濾條件由 `t.broker === name` 改 `brokerIds.has(t.broker_id)`(BrokerTrade 本就有
  broker_id;去除 name 間接層)。
- `priceAggs`(價位長條圖):ChipBubbleView 內現有 selectedBrokerName 過濾改
  `selectedIds` 過濾(`rangeTrades.filter((t) => selectedIds.has(t.broker_id))`),
  「選中分點無成交列則回全體」的既有 fallback 行為保留。
- `TradeRow` 型別不動(仍無 broker_id;列圓點顏色走 `colorByName` name lookup,
  對齊 R14「lookup 不擴型別」前例)。

## 3. BubbleChartSvg(SC-2、SC-5)

Props 變更(`selectedBroker?: string | null` 移除,**breaking 但 caller 僅
ChipBubbleView + 測試**):

```ts
export interface BubbleSelectedBroker { id: string; name: string; colorIdx: number }
export interface BubbleChartProps {
  // ...既有欄位不動...
  /** 選中分點(≤6)。空陣列/undefined = 未選取。 */
  selectedBrokers?: readonly BubbleSelectedBroker[];
}
export const BROKER_PALETTE: readonly string[]; // 6 色 categorical,值於 Phase 3 讀 dataviz 定案
```

- filter 泛化:`matchedBrokerTrades = trades.filter((t) => ids.has(t.broker_id))`
  (ids 自 selectedBrokers 建);`threshold = selectedBrokers.length > 0 ? 0 : VOLUME_THRESHOLD`。
- F2 軸 fallback:`useBrokerAxes = layoutVolumes.length === 0 && selectedBrokers.length > 0`,
  軸資料自 matched trades 導出(邏輯同現行,來源改集合)。
- 空狀態 hint:1 個 → `${name} 今日無顯著成交量`(現行文案原樣,無角括號;R3);
  ≥ 2 →「選中分點今日無顯著成交量」。
- **外框色(SC-2 核心)**:bubble 建構迴圈中,
  `selectedBrokers.length >= 2` 時 `stroke = BROKER_PALETTE[colorIdxById.get(t.broker_id)]`、
  strokeWidth 由 1 升 2;`length <= 1` 時 stroke 維持 `COLOR.buyStroke / sellStroke`
  (SC-5 單選視覺零回歸)。fill 一律維持買紅賣綠,不動 COLOR 常數。
- `onBubbleClick` / hover / brush / priceRange / F11 axes-stable 契約全部不動。

## 4. BrokerSearch 多選化(SC-1、SC-3)

Props 變更(breaking,caller 僅 ChipBubbleView + 測試):

```ts
interface Props {
  trades: BrokerTrade[];
  selectedNames: ReadonlySet<string>; // 下拉列已選標記
  onPick: (broker: string) => void;   // toggle 語意(再點已選 = 移除)
}
```

- 移除 `value` echo 與 input 內 × 清除鈕(清除職責移至 chips;§5)。
- `pick()` 後**不關閉下拉、不清 query**(連續加選 UX);已選列前綴 ✓ + 高亮
  (`aria-selected` 標注)。ESC / blur 關閉行為不變。
  [auto-default: pick 後保持開啟 | reason: 多選核心操作流是連續加選,關閉即打斷]
- **R1(必要條件)**:下拉列 item 的 `onMouseDown` 必須 `e.preventDefault()`
  (同現有清除鈕 pattern)— 否則點擊奪焦觸發 input blur,150ms closeTimer 會關閉
  下拉,「保持開啟」在真瀏覽器失效且 jsdom 測不到。e2e E#(§8)須含
  「加選第 1 個後下拉仍開啟、直接點第 2 個」的真瀏覽器 assertion。
- Enter 鍵行為:對 active 列 toggle(同 click)。

## 5. ChipBubbleView header — Legend chips 與統計(SC-3、SC-4、SC-5)

Header flex-wrap 列(現有搜尋框之後)新增 chips 區:

- 每個 `selected` 一枚 chip:`data-testid="broker-chip"`,內含
  專屬色圓點(`BROKER_PALETTE[colorIdx]` inline style)+
  `formatBrokerName(id, name)` + × 鈕(`aria-label="移除〈顯示名〉"`)→ `toggleBroker`。
- `selected.length >= 2`:chips 後附「清除全部」鈕(`data-testid="broker-chips-clear"`)
  → `setSelected([])`。
- `limitNotice` 為 true:`role="status"` 短提示「最多同時選 6 個分點」。
  **清除時機(R4)**:下一次 toggle、換股、點空白清全組、chips「清除全部」、
  focusRequest 取代、blocklist 移除 — 所有改動選取的路徑一律 `setLimitNotice(false)`。
- 跳籌碼總覽鈕:N = 1 維持現行文案與 `onJumpToOverview(id)`;N ≥ 2 →
  「查看 N 個分點於籌碼總覽 →」+ `onJumpToOverview(ids 陣列)`(App.tsx 契約已支援)。
  無 `onJumpToOverview` 時 fallback 文案「已篩選 N 個分點」。
- 統計列:`computeBrokerTotals(rangeTrades, selectedIds)` 合併值,顯示條件
  `selected.length > 0`(標籤與樣式不動)。
- `rangeActiveForFilter = brushRange !== null && selected.length === 0`(C11 泛化)。

## 6. DetailPanel / TradeList(SC-4)

- Props:`selectedBrokerName: string | null` → `selectedNames: ReadonlySet<string>`
  (row active 態:`selectedNames.has(r.broker)`);新增
  `colorFor: (name: string) => string | null`(N ≥ 2 回 palette 色,否則 null)。
- 列首圓點:`colorFor(r.broker)` 非 null 時,分點名前 render
  `<span data-testid="row-broker-dot" style={{ background: color }} />`(size-2 圓)。
- Mobile sheet 標題:N = 0 →「成交明細」;N = 1 →「成交明細 — 〈name〉」(現行);
  N ≥ 2 →「成交明細 — N 個分點」。
- **Mobile 自動開 sheet effect(R7)**:現有 `if (isMobile && selectedBrokerId)` 改
  `if (isMobile && selected.length > 0)`;toggle 移除至 N = 0 時 sheet **維持開啟**
  (顯示全體明細,與現行「effect 只開不關」一致),使用者以既有 × / backdrop 關閉。

## 7. focusRequest / blocklist 互動(SC-6)

- focusRequest effect:`setSelected([{ id, name, colorIdx: 0 }])`(**取代**整組;
  blocklist 自動移除 + notice 邏輯不動)。
- 無成交 badge 條件改:`focusedBroker !== null && selected.length === 1 &&
  selected[0].id === focusedBroker.id && trades 無該 id`(語意同現行)。
- `handleBlockAdd`:`setSelected((prev) => prev.filter((b) => b.id !== blocked.id))`
  (其餘選中保留;SC-6 後半)。

## 8. 測試與 e2e(SC-7 + 各 SC 驗證)

- `chip-data.test.ts`:computeBrokerTotals / buildTradeRows 集合版(空集合、單、多、
  混合 id);**該變 assertion**:兩函式現有單值 signature 測試改集合呼叫(事前標記,
  鐵則 E 豁免條件成立)。
- `chip-bubble-svg.test.tsx`:selectedBrokers=2 人 → 各 bubble stroke =
  `BROKER_PALETTE[0]` / `[1]` 正向 assertion;=1 人 → stroke 為既有 COLOR 值(SC-5 鎖);
  空狀態 hint 文案雙分支。**該變 assertion**:`selectedBroker` prop 舊測試改新 prop。
- `ChipBubbleView.test.tsx`:三入口 toggle、上限 6 + notice、chips 移除 / 清除全部、
  合併統計數字、focusRequest 取代、blocklist 移除保留其餘、mobile sheet 標題。
  **該變 assertion**:search echo / input × 鈕相關舊測試(行為已由 chips 取代)。
- `e2e/specs/equity.spec.ts` 新 E#:FAKE fixture 選 2 分點(搜尋加選 ×2)→
  2 枚 `broker-chip`、明細含兩分點名列、header 統計 = fixture 手算合併值
  (資料級 assertion)。
- vitest 慣例照 `frontend-testing`;e2e selector 對 snapshot(e2e-conventions)。

## 9. SC ↔ 章節對照

| SC | 章節 |
|---|---|
| SC-1 三入口多選 toggle / 上限 | §1、§4 |
| SC-2 圖面 union filter + 外框色 | §3 |
| SC-3 Legend chips | §5 |
| SC-4 明細 / 統計合併 | §2、§5、§6 |
| SC-5 單選回歸 | §2(空/單語意)、§3(stroke 分支)、§5(文案)、§8(鎖測試) |
| SC-6 focusRequest / blocklist | §7 |
| SC-7 e2e | §8 |

## Known Risks

(暫無 — Phase 1 review 後回填)
