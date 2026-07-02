# next-time.md — /mod bubble-chip-ux

Phase 5 code-review(high effort,8 finder × 1-vote verify)產出 5 個 finding。
2 個(Finding 1 LoadingSpinner extract、Finding 5 pointer capture guard)已在
🔵 refactor commit 中收掉。以下 3 個 defer。

---

## Finding 2 — Brush band `<rect>` dedup(PLAUSIBLE — pushed back)

**Location**: `frontend/src/lib/chip-bubble-svg.tsx` L738-763

現況兩個 `<rect data-testid="bubble-brush-band">` 塊:
- `dragBrush` phase(svg-coord 直接算 `y = min(startY, currentY)`)
- `brushRange` phase(price 反 sY 轉座標)

**Reviewer 建議**:抽 helper 統一 rect 渲染。

**Defer 理由**:兩塊語意上就是 drag phase vs persistent phase 兩種畫面
狀態;合併 helper 會把「哪個 phase 觸發」隱藏進參數列。目前 25 行明確
分兩塊,讀者一眼看得出 dragBrush 為真 → drag 進行中;brushRange 且無
dragBrush → persistent。統一 helper 需要多帶 flag,不見得比較清楚。

**觸發重評估的條件**:若之後加第三個 phase(e.g. hover-preview),就
真的該抽。

---

## Finding 3 — Header 3-level 巢狀 ternary(PLAUSIBLE — pushed back)

**Location**: `frontend/src/components/ChipBubbleView.tsx` L213-235

Header 條件:
```tsx
{selectedBrokerId && selectedBrokerName ? (
  onJumpToOverview ? (
    <button>查看於籌碼總覽</button>
  ) : (
    <span>已篩選 1 個分點</span>
  )
) : (
  <span>今日共 N 個分點</span>
)}
```

**Reviewer 建議**:抽 `<HeaderStatus />` component 或 early-return function。

**Defer 理由**:三個分支是 flat if/else 結構,抽 component 只是換位置存
複雜度,不減淨。三個 case 語意都在 header 上下文內,拆到別的檔案反而
需要 4-5 個 props threading。

**觸發重評估的條件**:若之後 header 又加新狀態(e.g. multi-select preview),
分支超過 4 個就該抽。

---

## Finding 4 — Broker totals 4 span 重複結構(PLAUSIBLE — pushed back)

**Location**: `frontend/src/components/ChipBubbleView.tsx` L234-250

四個 `<span>` 只有 label / value / color 不同。

**Reviewer 建議**:改 config array + `.map()` 縮 20 行 → 8 行。

**Defer 理由**:「總買/賣張/金額」四欄是穩定 UI 欄位,不太會增減;
map + config 引入間接性(讀者要對照 config 才知道渲染順序)。目前
inline 20 行雖囉唆但可讀性高、無 magic string 引用。

**觸發重評估的條件**:若加第 5 欄或考慮 responsive 隱藏欄位,再抽。

---

## 其他觀察(非 code-review 產出)

- **E2E spec 補充**:A1 brush / A2 button / A3 totals / A5 loading /
  B1 row click / B2 chip bar / B3 broker row 都是 equity mode UI 改動,
  CLAUDE.md §1 e2e 判準表要求 → 加 E# spec。本次 /mod Phase 6 e2e 因為
  port 佔用暫未跑,需另開 mini-mod 補上。

- **Visual baseline 更新**:C4 讓未選狀態下 K 線縮 4.4%、融資融券固定
  較小尺寸。若 `e2e/specs/visual.spec.ts` 有 equity 相關 baseline,需要
  跑 `npm run test:update-snapshots` 刷新。
