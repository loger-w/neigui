# brainstorm — 泡泡圖加上成交量(每價位量能分布)

日期:2026-08-11。模式:/auto + /feat。

## 分流判定

已成形方案:UI 形式由 user 經 AskUserQuestion 拍板(「每價位量能分布」,水平條疊圖內,
選項含 ASCII preview),資料源與落點檔案由現況調查確定 → grilling 姿態,餘下皆實作
選擇,依 /auto 契約標 `[auto-default]` 推進。

## 需求

在 equity mode 泡泡圖(`BubbleChartSvg`,蝶形:Y=價位、X=分點買賣張數)圖內,
沿 Y 軸每價位疊「全市場成交量分布」水平條(volume profile),作為背景脈絡 —
讓 user 一眼看出選中分點的成交落在整體量能的哪個價位帶。

## 資料事實(自查,不問 user)

- `BubbleChartSvg` 已收全量 `trades: BrokerTrade[]`(`visibleTrades`,blocklist 已過濾)。
- `BrokerTrade = {broker, broker_id, price, buy, sell}`;FinMind 分點資料每筆成交
  買賣雙邊都有分點 → 每價位 `Σbuy ≈ Σsell ≈ 該價位總成交張數`。
- 右欄 `PriceBarSvg` 已有每價位買/賣分色長條(明細面板),本 feature 是把「總量」
  形態搬進圖內當背景,非取代右欄。
- 不需 backend 改動、不需新資料流、不需新依賴。

## 拍板決策

- **[user 拍板] UI 形式 = 每價位量能分布(圖內水平條)**,非分時量柱、非 header 數字。
- [auto-default: 每價位量值 = (Σbuy + Σsell) / 2 | reason: 買賣雙邊分點加總各 ≈ 總量,
  取平均為最不偏估計;單一中性條不做買賣分色 — 買賣分色已在右欄 PriceBarSvg,
  圖內再分色會與泡泡買紅賣綠打架]
- [auto-default: 條錨定左緣(x = PADDING.left)向右延伸,最長 ≈ 圖寬 20% | reason:
  與 user 選項 preview 一致;20% 上限確保不壓過泡泡主體]
- [auto-default: 中性色低透明(ink 系,非紅綠非 accent)+ pointer-events:none |
  reason: frontend-conventions「資料標籤非互動態禁 accent、紅綠保留多空」鐵則]
- [auto-default: 恆用全量 trades 計算,不隨分點選取 / brush priceRange 過濾 |
  reason: 定位是背景脈絡,對齊既有 F11 axes-stable 原則(選取切換不重排);
  選取後仍看得到「分點 vs 全市場」對比,這正是 feature 價值]
- [auto-default: 常駐顯示、無開關 toggle | reason: 低調背景層不干擾讀圖,S 級不加
  額外 UI 面;若 user 試用後嫌吵再加 toggle(記 next-time)]
- [auto-default: scope = S | reason: 實作僅 `chip-bubble-svg.tsx` 單檔(+colocated
  test / e2e assertion / changelog 同步產物),資料用既有 trades prop,無新依賴、
  無對外 API;非 hot path(無 profile 證據)。→ 跳 design 文件化、PLAN 0 輪 review、
  主 session 直做(2026-08-11 拍板)]

## 成功條件(SC gate)

- **SC-1**:泡泡圖背景沿 Y 軸每價位渲染水平量能條 `<g data-testid="bubble-volume-profile">`,
  每價位一條 `<rect>`,長度 ∝ (Σbuy+Σsell)/2、以該價位最大量為分母;z-order 在
  grid 之後、分時線與泡泡之前(最底資料層,不遮泡泡)。
  驗證:vitest — pure fn 單元測試(聚合值、比例、排序)+ render 測試(rect 數 =
  價位數、最大條寬 = maxBarW);截圖對照。
- **SC-2**:量能條不影響既有互動 — `pointerEvents="none"`,hover crosshair /
  bubble hitTest / click 清選取 / Y 軸 brush 全部不變。
  驗證:vitest 既有 chip-bubble-svg 測試全綠(0 修改)+ 新測試 assert 層帶
  pointer-events none。
- **SC-3**:量能條恆以傳入 `trades` 全量計算 — `selectedBrokers` 非空或 `priceRange`
  過濾時條形不變。驗證:vitest — 同 trades 下傳/不傳 selectedBrokers、priceRange,
  profile rects 的 width 集合相同。
- **SC-4**(畫面可指認):equity mode → 主力券商(泡泡圖)tab,圖內左緣可見一組
  水平灰調量能條,與價位對齊,泡泡與分時線清晰壓在其上;顏色非紅非綠非 accent 紅。
  驗證:chrome-devtools MCP 截圖 `docs/specs/bubble-volume-profile/screenshots/` +
  user 過目。
- **SC-5**(e2e 歸屬):equity mode UI 新功能 → `e2e/specs/equity.spec.ts` 加 E# spec:
  泡泡圖 tab 下 `bubble-volume-profile` layer 存在且 rect 數 > 0(資料級,非 visibility-only)。
  驗證:`e2e/` `npm test` 綠。

## Edge cases(≥3)

1. **單一價位**(全日一價):1 條,maxVol = 該價位量,無除零(maxVol>0 guard)。
2. **trades 空 / 全 sub-threshold**:既有 early-return(HintSvg)先擋,layer 不渲染;
   `useBrokerAxes` fallback(安靜日 + 選取)時 y-scale 來自分點軸,profile 只畫
   價位落在 [yLow, yHigh] 內的條(越界跳過,不畫出圖外)。
3. **大量價位**(50+ 檔位,如低價股全 tick):條高 = min(8, max(1, cH/價位數 × 0.7)),
   允許 1px 細條,不重疊策略為以 sY(price) 垂直置中。
4. **量懸殊**(單一價位吃掉 95% 量):線性比例照畫 — 這正是要呈現的形態,不做
   sqrt/log 壓縮(與泡泡半徑 sqrt 不同,條長是位置比較用)。

## Amendments

- [amendment 2026-08-11: review S-P2-1 — 量能條比例分母恆用「全量 profile 最大值」
  (clip 只決定畫不畫,不影響比例);broker-axes fallback 下存活條不得被拉伸成滿格,
  否則非市場量峰被呈現成量能最大值,違背全市場背景脈絡定位]
- [amendment 2026-08-11: review C-P2-1 — 條的繪製範圍(sY±barH/2)須 clamp 進
  chart 內區([PADDING.top, PADDING.top+cH]),邊界價位不得半截畫進刻度帶]
- [amendment 2026-08-11: review S-P1-1/S-P1-2 — SC-1 驗證補強:最大條寬 = cW×20%
  以絕對值鎖住;大量價位(60 檔)條高公式 [1,8] 區間與不重疊納入測試]
- [amendment 2026-08-11: review C-P2-3 — E42 補幾何 assertion(單價位 fixture 下
  寬度 = (svg寬−72)×0.2),多價位正規化由 vitest 組分擔]
- [amendment 2026-08-11: review S-P2-3/C-P2-2 — buildVolumeProfile 進 useMemo
  (brush 拖曳每幀 re-render 不重跑全量聚合)]

## Out of scope

- 分時成交量柱(時間軸)、header 總量數字(未選方案)。
- 右欄 PriceBarSvg 任何改動。
- backend / API payload 改動(IntradayPoint 補 volume 欄 — 留給分時量柱若日後要做)。
- 量能條 hover tooltip / 數字標籤(pointer-events none,讀數走右欄)。
- 顯示開關 toggle。

## e2e 歸屬結論(e2e-conventions 判準表)

equity mode UI 新功能 → `equity.spec.ts` 加 E#(SC-5);非純內部 refactor,不豁免。
