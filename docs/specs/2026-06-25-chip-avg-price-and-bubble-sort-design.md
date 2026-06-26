# 籌碼總覽 分點均價 + 泡泡圖排序 — Design Spec

**Date**: 2026-06-25
**Branch**: `feat/txo-chip-framework`(沿用)
**Type**: 🟢 新功能 (UI-only — 資料層已備好)

---

## 1. 動機 & 範圍

使用者要看到「主力分點的買均價 / 賣均價」直接掛在籌碼總覽上,以及在泡泡圖右側清單能改用「價位」排序。

**核心觀察**:後端 `_parse_top_brokers` 已經以 weighted-avg(in share-space)算好 `avg_buy_price` / `avg_sell_price`,前端 `TopBroker` type 也已宣告 — 純 UI 改動,**不動 API 契約、不 bump cache version**。

### 1.1 In scope
- F1:`ChipBrokersPanel` Net mode + Volume mode 都加「買均價 / 賣均價」兩欄
- F2:`ChipBubbleView` 右側 buy/sell 兩個清單可點 column header 切換「張數 ↓↑ / 價位 ↓↑」

### 1.2 Out of scope(下次處理)
- Net mode 加當沖率
- 均價著色 vs 收盤
- 泡泡 tooltip 加分點均價
- 相對 % 差顯示

---

## 2. F1 — 分點均價欄

### 2.1 Layout
原先 spec 提的 caption 模式(均價疊在張數下方)使用者明確不接受 — 改回獨立欄位設計。

Net mode grid 從 6 欄擴成 8 欄:`22 28 1fr 64 52 56 52 56` = 330 + 1fr。Volume mode 同:`22 28 1fr 52 56 52 56 56` = 326 + 1fr。

```
#  分點          淨買賣  買張  買均     賣張  賣均
1  元大          +1,084  5,203 2408.73  4,119 2419.39
```

- 均價欄字級用 `text-xs text-ink-dim`(視覺上是「次要」資訊),張數仍是 `text-sm`(主要)
- 1fr 給分點名稱在 420px 容器內 ≈ 86px,中文 4-5 字 OK,超過走 `truncate`
- 「#」欄壓到 28px(原 32px)壓榨空間

### 2.2 顯示規則
| 場景 | 顯示 |
|------|------|
| `avg_buy_price > 0`(該分點有買) | `100.50`(2 位小數) |
| `avg_buy_price === 0`(沒買進) | `—`(`text-ink-dim`) |
| 同理 `avg_sell_price` |

格式:`price.toFixed(2)` — 直接數字,沒 `@` prefix(欄位 header 已說明,prefix 多餘)。

### 2.3 受影響元件
- `frontend/src/components/ChipBrokersPanel.tsx` — `BrokerRow` 兩段(net / volume mode)各加 caption 渲染
- 既有測試 `ChipBrokersPanel.test.tsx` 不變(沒檢 avg price),補新 case 驗證 caption 出現 + `0` → `—`

### 2.4 不動的東西
- `chip-data.ts` types(`avg_buy_price` / `avg_sell_price` 已宣告)
- 後端 service / route / cache version
- mock fixtures(`mkBroker` 已有 default 100)

---

## 3. F2 — 泡泡圖右側清單排序

### 3.1 目前
`ChipBubbleView.tsx` 把 `bubbleData.trades` 過 `buildTradeRows()` 拆成 `buyRows` / `sellRows`,固定 `sort((a, b) => b.volume - a.volume)`。`TradeList` 不知道排序邏輯。

### 3.2 設計
**1. `buildTradeRows` 簽名變更** — 兩側獨立排序,所以加 `buySort` / `sellSort`,保留同一 function 一次 build 兩側(避免 caller 各跑一輪 iteration):

```ts
export type TradeSortKey = "volume" | "price";
export type SortDir = "desc" | "asc";
export interface SortSpec { key: TradeSortKey; dir: SortDir }

const DEFAULT_SORT: SortSpec = { key: "volume", dir: "desc" };

export function buildTradeRows(
  trades: BrokerTrade[],
  selectedBroker: string | null,
  maxRows: number,
  buySort: SortSpec = DEFAULT_SORT,   // ← 新,預設沿用舊行為
  sellSort: SortSpec = DEFAULT_SORT,  // ← 新
): { buyRows: TradeRow[]; sellRows: TradeRow[] }
```

排序行為:
- `(volume, desc)` → 現況(預設)
- `(volume, asc)` → 小到大
- `(price, desc)` → 高到低(台股看盤習慣)
- `(price, asc)` → 低到高
- tie-breaker:固定用 `broker asc`(穩定)

舊 caller(`ChipBubbleView` 是唯一一個,已 grep)不傳新參數時行為不變。

**2. `ChipBubbleView` 新增 state**:

```ts
const [buySort, setBuySort] = useState<SortSpec>(DEFAULT_SORT);
const [sellSort, setSellSort] = useState<SortSpec>(DEFAULT_SORT);
```

買 / 賣兩側獨立排序狀態,傳入 `buildTradeRows`。

**3. `TradeList` 元件**:
- 新增 props:`sortKey`、`sortDir`、`onSortChange(key: TradeSortKey)`
- header 兩個欄位變成 `<button>`(現是 `<span>`),點擊呼叫 `onSortChange`
- header 顯示排序指示符:當前 key 旁邊放 `↓`(desc) / `↑`(asc);其他 key 不顯示箭頭
- `onSortChange(key)`:同 key → toggle dir;不同 key → 切換 + 重置 dir 為 `desc`

### 3.3 受影響元件
- `frontend/src/lib/chip-data.ts` — `buildTradeRows` 簽名 + 排序邏輯
- `frontend/src/lib/chip-data.test.ts` — 補 sort 參數 case
- `frontend/src/components/ChipBubbleView.tsx` — state + handler + TradeList props
- `ChipBubbleView` 沒既有測試檔 — F2 補一份 RTL test(只測 header click 切排序、箭頭顯示)

### 3.4 a11y
- header `<button>` 加 `aria-sort="ascending|descending|none"`,符合 ARIA grid pattern
- `aria-label` 用繁中:`依張數排序(目前由大到小)` 之類

---

## 4. 測試清單(完成 gate)

### Frontend(vitest)
- 既有 `ChipBrokersPanel.test.tsx` 應全綠(不改 mock,均價欄是純新增)
- 新增 `ChipBrokersPanel` case:`render` 後可找到 `@100.50` 文字;`avg_buy_price: 0` 時顯示 `—`
- 既有 `chip-data.test.ts` 對 `buildTradeRows()` 不傳 sort 參數的 case 應全綠(default 沿用舊行為)
- 新增 `chip-data.test.ts` case:`buildTradeRows(..., "price", "desc")` 排序正確、`asc` 反向、tie-break stable
- 新增 `ChipBubbleView.test.tsx`(RTL + jsdom):
  - 預設 buy header 顯示「張數 ↓」
  - 點「價位」header → 切「價位 ↓」、rows 重排
  - 再點「價位」→ 切「價位 ↑」
  - buy / sell 排序獨立(改買排序不影響賣)
  - `aria-sort` 屬性正確

### Backend(pytest)
- 無動;`pytest -q` 應 111 passed 不變

### 真實環境
- `npm run dev` + `chrome-devtools-mcp` 截 2330 籌碼總覽 + 泡泡圖,確認 caption 與排序切換實際運作

---

## 5. Commit 分段

🟢 三個 commit(對應 user-global B 條):
1. `feat(chip): surface broker avg buy/sell price in overview panel`(F1)
2. `feat(chip): bubble trade list sortable by price or volume`(F2)
3. `chore(refactor): DevTools MCP verification screenshots`(驗證截圖)

如果 F1 / F2 改動 tightly coupled(目前看是不會,兩個檔互不相干),保持分開。

---

## 6. 風險 & 退路

- **caption 撐高 row 影響滾動高度** → F1 完成後 DevTools 截圖確認 15 列 + sticky header 仍能正常 scroll;有問題就改回單欄省略
- **buildTradeRows 簽名變更影響其他 caller** → grep 確認只有 `ChipBubbleView` 用,改動範圍可控
- **avg price 為 0 但實際有交易**(後端 bug)→ 顯示 `—` 比顯示 `@0.00` 安全,反正資料層已驗證(`_b_cnt > 0` 才算)
