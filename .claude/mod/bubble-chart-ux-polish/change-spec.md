# change-spec — 泡泡圖 UX polish(mod/bubble-chart-ux-polish)

2026-07-28。現況見同目錄 `current-state.md`(含重現截圖)。

**分流判定**:user 帶已成形問題描述(兩個具體 UX 缺陷 + 期望方向)→ grilling 姿態;
互動模型有開放決策點 → AskUserQuestion 拍板(/auto 必停點,已停)。
**拍板結果(2026-07-28,user 三題皆選建議項)**:
1. Header = 左欄固定搜尋 + 右側雙行(chips 行 / 統計常駐行),下拉只蓋圖表
2. 單看(聚焦)模式:點已選分點泡泡/明細列 → 統計切單分點,組合不動;再點解除;chip × 才移除
3. 點空白:單看中只解除單看;無單看照舊全清

命名:code/UI 用「單看」`solo`,避免與 CH-1 `focusRequest/focusedBroker`(語意=取代整組選取)撞名。
`[auto-default: solo/單看 命名 | reason: focus 已被 CH-1 佔用,撞名必混淆]`

## 成功條件(SC,畫面可指認)

- **SC-1 搜尋空間預留**(桌面 ≥1024px):header 改三欄 grid —
  左欄 = 分點搜尋框(固定 360px,選 0→6 chip 全程寬度不變);中欄 = 上下兩行
  (上 chips 行 / 下統計行);右欄 = 過濾清單|輸入區間|? 工具鈕。
  搜尋下拉(360px 寬)開啟時只向下蓋圖表區,**統計行數字完整可見**(統計行在搜尋框右側,
  不在其下方)。
- **SC-2 統計行常駐**:統計行永遠 render、位置固定 —
  未選:「今日共 N 個分點」(brush 時「此區間 N 個分點」,文案照舊);
  選中:「查看 N 個分點於籌碼總覽 →」(或 fallback「已篩選 N 個分點」)+ 買X張 賣Y張 買額A 賣額B。
  chips 行空態顯示 dim 引導字「點泡泡或搜尋分點加入比較」(高度佔位,header 不跳動)。
  `[auto-default: 空態引導文字 | reason: 常駐佔位順便給操作提示,零成本]`
- **SC-3 單看模式**:有選取時,點**已選**分點的泡泡或右欄明細列 → 統計行切為
  「單看〈name〉 買X張 賣Y張 買額A 賣額B + 回整組×鈕」(data-testid `bubble-solo-badge` /
  `bubble-solo-clear`);chips 全數保留;右欄 price bar + 買賣列表只顯該分點;
  泡泡圖該分點泡泡加聚焦外框(ink 色加粗 ring),其他選中分點外框照舊。
  再點同分點泡泡 / 按回整組 → 恢復整組統計與右欄。點另一已選分點 → 單看目標切換。
  單看期間「查看…於籌碼總覽」鈕暫隱(回整組後恢復)。
  `[auto-default: 單看時隱 jump 鈕 | reason: 統計行空間有限,單看是暫態,避免兩個主行動並列]`
- **SC-4 點未選分點照舊加選**(滿 6 提示照舊);加選**不**自動進單看。
  `[auto-default: 加選不自動 solo | reason: 加選意圖=擴組合,自動切單看反而蓋掉整組回饋]`
- **SC-5 點空白兩段式**:單看中 → 只解除單看(選取 + brush + 手動區間面板都不動);
  無單看 → 照舊全清(selected + brush + manualInput)。
- **SC-6 mobile(<1024px)**:header 垂直堆疊(搜尋/chips/統計各成行,統計行同樣常駐;
  **[amendment 2026-07-28: review R4]** 工具列自成一行、靠右 `ml-auto`);
  sheet 行為照舊;單看語意同桌面(sheet 內明細只顯該分點)。
  **[amendment 2026-07-28: review R3]** mobile 進單看時自動開 sheet。

## 不能破壞的既有行為白名單

<!-- Phase 5 finder prompt 必附本節行號範圍 -->
1. BrokerSearch「搜尋即加選」流(R1:pick 後不關下拉不清 query、連續加選);下拉內
   已選列 ✓ 標記、再點 = 移除(搜尋下拉的 toggle 保留 — 它有 ✓ 視覺回饋,與泡泡誤點不同類)
2. chip × 移除單一分點;「清除全部」鈕(N≥2);滿 6 上限 + limitNotice(任何改選取路徑清除)
3. 點**未選**分點泡泡/明細列 = 加選(SC-1 三入口 toggle 的加選半邊)
4. C7/C10/C11 brush 全鏈:drag 篩區間、ESC 清、手動輸入面板、`rangeActiveForFilter =
   brush && selected.length===0`(選取時 brush 退視覺參考 + parked 提示)、brush summary 內容
5. CH-1 focusRequest 全鏈(切 tab 聚焦、R6 blocklist 自動移除 + 提示、當日無成交 badge、
   seq 重複觸發);**focusRequest 觸發時 solo 清空**(新互動,不得殘留舊單看)
6. BB-1 blocklist:排除即從選取移除、跨股持久化;排除單看中的分點 → solo 隨之失效(derived)
7. jump-to-overview 鈕文案與 payload(單選帶 id、多選帶 id[])— E23/E38 assertion
8. 統計數字語意:`computeBrokerTotals(rangeTrades, ids)` 的整組加總(E24/E33/E38 資料級)
9. `bubble-broker-totals` testid:僅 selected>0 時存在(E33 換股後 toHaveCount(0))
10. mobile:tap 泡泡選中 → 自動開 sheet;sheet 只開不關(R7);backdrop/× 關閉
11. TradeList 排序 headers、虛擬化、row active 態、N≥2 色圓點(BROKER_PALETTE id-key)
12. 換股 reset:selected/limitNotice/brush/manualInput/sheet/focusedBroker 清空(solo 加入同批)
13. 泡泡 hover tooltip(ref-based DOM 更新)
14. 桌面右欄 400px grid / DetailPanel 直接當 grid item(不包 div)結構約束
15. e2e E3/E7/E23/E24/E25/E32/E33/E38 全綠

## Backward compat / migration

純前端 state 與 layout;無 API / localStorage / URL 契約變更。無 migration。
`selected` shape、`onJumpToOverview` signature、BrokerSearch props 均不動。
BubbleChartSvg 新增 **optional** `soloBrokerId?: string | null` prop(不傳 = 現行為,
chip-bubble-svg 其他 caller 無 — 唯一掛載點 ChipBubbleView)。

## Out of scope(寫入 docs/next-time.md)

- BrokerSearch 下拉內 買/賣欄固定 44px 大數字溢位(user 未點名,獨立小修)
- 單看時 jump 鈕改「查看該分點」單跳
- hover tooltip 補當日總買賣超(拍板未採選項 B)
- mobile sheet 針對單看的 header 文案優化(顯示「單看 — name」以外的強化)

## E2E 歸屬(e2e-conventions 判準表)

equity mode UI/flow → `e2e/specs/equity.spec.ts`:
- 改既有行為:無既有 E# 直接 assert「點泡泡 toggle-off」→ 不需改既有 assertion
- 新增 **E39**:多選 2(搜尋加選)→ 點擊已選分點泡泡 → totals 切單分點數字 +
  chips 仍 2 → 再點回整組 → 點空白兩段式(單看中點空白組合仍在;再點空白全清)。
  **[amendment 2026-07-28: review R2 P1 — 實作陷阱寫死]**:
  (1) fixture 三分點同價位同買量,重合泡泡 hitTest 平手取 trades 序位第一 →
  **solo 目標寫死 = 分點001**(序位第一),不得斷言點其他 circle 中心命中該分點;
  (2) circle 帶 `pointerEvents="none"`,Playwright `locator.click()` 過不了 actionability →
  用 `circle.boundingBox()` 取中心後 `page.mouse.click(cx, cy)`(落在 main overlay);
  (3) 點空白用 overlay 右上角無泡泡區;
  (4) **[amendment 2026-07-28: review R2-1]** 加選完成後 press Escape 關搜尋下拉
  (對齊 E38 樣板),點擊目標用 `circle[data-broker-id="BROKER001"]` 的 `.first()`
  (buy 側、位於圖表右半,遠離下拉覆蓋區)
- 新增 **E40**:搜尋下拉開啟時 `bubble-broker-totals` 仍 visible 且 boundingBox 與
  listbox 不相交(SC-1 鎖)
- visual.spec 無泡泡 baseline,不加 pixel baseline,layout 用 E40 功能級鎖。
  `[auto-default: 不加 visual baseline | reason: 現無泡泡 V#,功能級 bounding box assert 已覆蓋訴求]`

---

# Diff 級 spec(Phase 3)

## 檔案清單與三類標記

### `frontend/src/components/ChipBubbleView.tsx`

**🟢 A. Header 空間預留重構**(commit 1)
- L373-379 root 不動;L383 header 容器改:
  `flex flex-col gap-y-1 lg:grid lg:grid-cols-[360px_minmax(0,1fr)_auto] lg:gap-x-3 lg:items-start`
  (px-3 py-1.5 border-b 等外觀 class 保留;min-h-10 移除,高度由常駐兩行決定)
- 左欄:`<BrokerSearch>` 原樣(wrapper 自帶 w-full max-w-[360px],grid 欄位固定 360)
- 中欄 `min-w-0 flex flex-col gap-y-0.5`:
  - chips 行 `flex flex-wrap items-center gap-x-3 gap-y-1 min-h-6`:
    chips map + 清除全部 + limitNotice + blockRemovalNotice;空態(selected=0 且無 notice)
    顯 `<span class="text-xs text-ink-dim">點泡泡或搜尋分點加入比較</span>`
  - 統計行 `flex flex-wrap items-center gap-x-3 min-h-5`(常駐):
    - selected=0:今日共/此區間 N 個分點(現 L464-466 內容移入)
    - selected>0:jump 鈕或已篩選 N(現 L436-462)+ `bubble-broker-totals`(現 L468-486)
- 右欄:現 L497-526 div 改為 grid 第三欄。**[amendment 2026-07-28: review R4 P2]**
  **保留 `ml-auto`,不用 justify-self-end**(justify-self 只在 grid 生效,mobile base 是
  flex flex-col 會讓工具列靠左回歸;auto margin 在 grid cell 與 flex-col 兩形態都推右)。
  SC-6 補:mobile 工具列自成一行、靠右
- 既有測試預期:全綠(RTL 按 testid/text 查,不測位置)

**🔴 B. 單看模式 + 點空白兩段式**(commit 2,測試紅先行)
- 新 state:`const [solo, setSolo] = useState<{id: string; name: string} | null>(null)`
- derived:`const activeSolo = solo !== null && selectedIds.has(solo.id) ? solo : null`
  (防禦層;invariant 主要由下一條顯式清除維持)
- **[amendment 2026-07-28: review R1 P0 — solo 殘留復活]** 所有「移除選取」路徑顯式清殘留,
  否則移除後重加選同分點時 stale solo 無聲復活(違反 SC-4):
  - `toggleBroker` 移除半邊:`setSolo((s) => (s && s.id === id ? null : s))`
  - 「清除全部」鈕:`setSolo(null)`
  - `handleBlockAdd`:`setSolo((s) => (s && s.id === b.id ? null : s))`
  - 補測試 **T6b**:solo A → chip × 移除 A → 重新加選 A → 無 solo badge
- 換股 reset effect(L111-119)加 `setSolo(null)`;focusRequest effect(L143-159)加
  `setSolo(null)`
- **[amendment 2026-07-28: review R3 P2]** mobile 進 solo 時 `setSheetOpen(true)`
  (對齊「tap 泡泡 → 自動開 sheet」既有心智,避免 solo 在 mobile 靜默無回饋)
- `handleBubbleClick` 改:
  ```
  broker === null:
    activeSolo ? setSolo(null)                       // SC-5 段1
    : 照舊全清(selected/limit/brush/manualInput)      // SC-5 段2
  已選 id:
    activeSolo?.id === id ? setSolo(null) : setSolo({id, name})   // SC-3
  未選 id:
    toggleBroker(id, name)(照舊加選;solo 不動)                     // SC-4
  ```
  **[amendment 2026-07-28: review R5 P2]** name fallback(L294-296,無 brokerId 的舊路徑)
  改為「以 name 查 `visibleTrades` 解析出 `t.broker_id` 後,進**同一個三分支**」—
  不是保留原 toggleBroker 直呼(否則無 id 的已選點擊仍走移除,與三分支矛盾)
- 下游 effective 集合:`const effectiveIds = activeSolo ? new Set([activeSolo.id]) : selectedIds`
  - `brokerTotals`(L243)、`priceAggs` filter(L338)、`buildTradeRows`(L353)改吃
    `effectiveIds`;TradeList/DetailPanel 的 `selectedIds` prop(active 態)照舊傳 `selectedIds`
- 統計行 solo 變體(selected>0 且 activeSolo):
  `<span data-testid="bubble-solo-badge">單看〈{formatBrokerName(...)}〉</span>` +
  totals(單分點值,容器 testid 仍 `bubble-broker-totals`)+
  `<button data-testid="bubble-solo-clear" aria-label="回整組統計">回整組 ×</button>`;
  jump 鈕/已篩選 N 在 activeSolo 時不 render
- mobile sheet header(L663-669):activeSolo 時顯 ` — 單看 {solo.name}`
  `[auto-default: sheet header 顯單看 | reason: sheet 內容已切單分點,不標會誤讀]`

**🟢 C. 泡泡聚焦視覺**(commit 3)
- `<BubbleChartSvg soloBrokerId={activeSolo?.id ?? null} ...>`

### `frontend/src/lib/chip-bubble-svg.tsx`

**🟢 C.**(commit 3)
- Props 加 `soloBrokerId?: string | null`
- 泡泡 render 處:`t.broker_id === soloBrokerId` → **[amendment 2026-07-28: review R6 P2
  拍板]** **取代** stroke 為 ink 色(#ede4d3)strokeWidth 2.5(單一 stroke,對齊既有畫法;
  solo 期間 identity 色由 solo badge 名稱 + chips 圓點補足,不畫第二個 circle),
  circle 加 `data-solo="true"`(測試錨點)。
  **[amendment 2026-07-28: review R6-1]** soloBrokerId 命中的 circle **reorder 至 bubbles
  最後 render**(painter's order — 重合泡泡下 ink ring 否則被後繪 palette 框遮蓋;
  僅命中時 reorder,soloBrokerId 為 null 時輸出順序與現行為完全一致)。
  **[amendment 2026-07-28: Phase 4 實作修正]** reorder 只動 render 陣列;`bubblesRef`
  (hitTest 用)維持原序 — 否則重合泡泡平手判定翻轉,「再點同泡泡解除單看」會變成
  切換到其他分點,E39 第二擊斷言必紅
- 不傳 / null → 輸出與現行為 byte-identical(單元測試鎖)

### 測試

**`frontend/src/components/ChipBubbleView.test.tsx`**(commit 2 紅先行;樣板:
circle cx/cy 直擊 + offsetHeight stub,見 frontend-testing)
- 🔴 既有「泡泡/明細列入口 toggle」測試中「點已選 = 移除」的 assertion → 改為單看語意
  (chips 保留 + solo badge 出現)— 唯一合法改 assertion 通道,逐條列於 commit message
- 🟢 新增:
  - T1 多選2 點已選A → badge=A、totals=A 單獨值、chips 仍 2
  - T2 再點A → badge 消失、totals 回整組值
  - T3 solo 中點空白 → badge 消失、chips 仍在、brushRange 保留
  - T4 無 solo 點空白 → 全清(既有測試若已覆蓋則沿用)
  - T5 solo A 中點已選B → badge 切 B
  - T6 solo A 中 chip × 移除 A → badge 消失(derived 失效)
  - T7 solo 中點未選C → C 加選、solo 維持(A 仍單看?→ 設計:加選不動 solo,badge 仍 A)
  - T8 明細列(offsetHeight stub)點已選 → solo
  - T9 solo 時 buy/sell rows 只含 A(buildTradeRows effectiveIds)
  - T10 回整組鈕 → 解除
  - T11 chips 空態引導文字存在;選中後消失
  - T12 統計行未選時「今日共 N 個分點」仍 render(常駐)
- 🟢 A commit 補:header 結構 lock — 搜尋 wrapper 在固定欄、統計行容器常駐(testid
  `bubble-stats-row`)

**`frontend/src/lib/chip-bubble-svg.test.tsx`**(commit 3)
- soloBrokerId 命中 → data-solo circle + stroke 變;null → 與現輸出一致

**`e2e/specs/equity.spec.ts`**(commit 2/3 同步)
- E39 / E40(上節);selectors.ts 加 `bubbleSoloBadge` / `bubbleSoloClear` / `bubbleStatsRow`

### `frontend/src/lib/changelog.ts`(最後 commit)
- 0.46.0 MINOR:泡泡圖 header 空間預留 + 單看模式(寫 entry 前讀 changelog-conventions)

## 既有測試逐一標記

- ChipBubbleView.test.tsx「泡泡入口 toggle:點已選移除」類 → **該紅**(🔴 B)
- ChipBubbleView.test.tsx「點空白全清」類(無 solo 情境)→ 不該紅
- 其餘 ChipBubbleView / BrokerSearch / chip-bubble-svg / App 測試 → 不該紅
- e2e E3/E7/E23/E24/E25/E32/E33/E38 → 不該紅

## P2 註記(自評 round 1)

- priceAggs 的 solo 切換(price bar 只顯單分點)無獨立 vitest 鎖 — jsdom 對 SVG bar
  值 assert 成本高;退化由 T9(明細列表同一 effectiveIds 源)+ real-env 截圖
  (02-solo-mode-1536.png price bar 已切單分點分佈)間接覆蓋。觸發補鎖:priceAggs
  與 buildTradeRows 的資料源分岔時。

## Commit 計畫(🔵→🔴→🟢 順序;本案無 🔵)

1. 🟢 feat(frontend): 泡泡圖 header 空間預留 — 固定搜尋欄 + chips/統計常駐雙行(SC-1/2/6)
2. 🔴 fix(frontend): 泡泡/明細列點已選分點改單看模式 + 點空白兩段式(SC-3/4/5)[red→green]
3. 🟢 feat(frontend): 單看泡泡聚焦外框 + E39/E40 e2e(SC-3 視覺)
4. chore: changelog 0.46.0 + next-time 收割

self_review_head: c8d765e4c89bb6e527c5afd7b08c2511d1bc0e7d
