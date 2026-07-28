# change-spec — 泡泡圖 dismiss-click guard(mod/bubble-dropdown-dismiss-guard)

2026-07-28。前置:mod/bubble-chart-ux-polish(PR #67,0.46.0)剛 merge — 本輪是其
follow-up,現況 = 該輪 change-spec + 實作(單看 / 兩段式空白已上)。

**分流判定**:user 帶已成形改法(「選取框開啟時,點泡泡圖不要讓篩選的分點消失」)—
目標與觸發條件都明確,剩餘皆實作級決策 → 照 /auto 替代條件推進,標 [auto-default]。

## 現況(問題鏈)

- BrokerSearch 下拉 `open` 是內部 state;點圖表時事件序 = **pointerdown(圖表)→
  blur(input)→ closeTimer 150ms → click(圖表 overlay)**。
- click 到達 `handleBubbleClick` 時必然執行:空白 → 兩段式清除(無單看時全清);
  泡泡 → 加選/單看。使用者「點別處關下拉」的意圖被解讀成圖表操作,篩選組合被誤毀。

## 成功條件(畫面可指認)

- **SC-1**:下拉開啟(有結果列表可見)時,點泡泡圖任意位置(空白或泡泡)→
  **只關閉下拉**(**[amendment 2026-07-28: review R1]** guard 主動觸發關閉,
  不依賴「點別處自然 blur」— iOS tap 不 blur),chips / 單看 / brush 全部不動。
- **SC-2**:下拉關閉後,再點圖表 → 行為照舊(空白兩段式、點泡泡加選/單看)。
- **SC-3**:右欄明細列不在 guard 範圍(精準可見目標,點擊意圖明確)。
  `[auto-default: guard 只罩圖表 | reason: 誤點風險在大面積圖面;明細列是精準目標]`

## 機制(實作級,全 [auto-default];**[amendment 2026-07-28: review R1-R3 改版]**)

- BrokerSearch 加 optional prop `onOpenChange?: (open: boolean) => void`,回報
  「下拉實際可見」(`open && filtered.length > 0`)的變化(useEffect)。
- ChipBubbleView:`searchOpenRef`(onOpenChange 寫入,ref 不進 state)+
  `dismissNextClickRef`(**per-gesture boolean flag,不用 wall-clock 時間窗** —
  review R3:時間窗對 >400ms 慢按壓失效、對殘留窗吞合法點擊,gesture 配對兩者皆免)。
- 圖表 wrapper(bubbleRef div)兩個 capture handler:
  - `onPointerDownCapture`:**無條件覆寫** `dismissNextClickRef.current =
    searchOpenRef.current`(review R2 方案1:下拉已關的下一個手勢自動清 flag,
    wrapper 內所有「pointerdown 有、click 不達」殘留路徑 — drag-abort / axis brush /
    brush-summary 鈕 — 全部歸零);flag 為 true 時**同步主動關下拉**:
    `document.activeElement instanceof HTMLElement && .blur()`(**review R1 P0 級
    缺口:iOS Safari tap 非 focusable 元素不觸發 blur** → 下拉永開、圖表永久死區;
    主動 blur 觸發既有 closeTimer 鏈,桌面 double-blur 無害)。
  - `onClickCapture`:flag 為 true → 清 flag + `stopPropagation()`(capture 階段
    停傳播,svg overlay 的 onClick 不會收到)— guard 不進 handleBubbleClick,
    明細列在 wrapper 外**結構性豁免**(SC-3 恆成立,不再依賴幾何巧合)。
- Dismiss 語意涵蓋 wrapper 內一切可點目標(含 brush-summary 的 篩選/編輯/清除鈕、
  手動區間面板):下拉開啟時第一擊一律只關下拉,再擊才生效 — 與 popover dismiss
  慣例一致。`[auto-default: wrapper 內全罩 | reason: 半罩(鈕例外)會讓「第一擊
  是否生效」不可預測]`
- **已知驗證缺口(review R1)**:iOS 真機的「tap 不 blur」路徑無法被 jsdom 或
  Chrome touch 模擬覆蓋(兩者都會 blur)— 主動 blur 修法本身即為此路徑而設,
  真機回歸留待 user 實用回報。

## 白名單(不能破壞)

1. R1 連續加選:下拉內 mousedown pick(preventDefault 保 focus)不觸發 wrapper
   pointerdown(下拉在 BrokerSearch wrapper 內,不在圖表 wrapper)→ 不受 guard 影響
2. 上輪全部行為:單看 toggle / 空白兩段式 / brush / blocklist / focusRequest / mobile sheet
3. e2e E39(點泡泡前有 press Escape 關下拉 → 不落 guard 窗)、E40、其餘 E# 全綠

## Diff 級

- 🔴 `frontend/src/components/BrokerSearch.tsx`:Props + onOpenChange effect(~6 行)
- 🔴 `frontend/src/components/ChipBubbleView.tsx`:兩 ref + wrapper onPointerDownCapture
  + handleBubbleClick 開頭 guard(~10 行)
- 測試(紅先行;**[amendment 2026-07-28: review R4]** 一律真實 timer — focus 開
  下拉不需推時間;禁用 fake timers 以免 Date/timer 假象讓測試以錯誤原因紅):
  - ChipBubbleView:T1 下拉開啟 pointerDown+click 空白 → chips 保留;T1b 同情境點
    已選泡泡座標 → 無單看 badge、chips 不動;T2 Escape 關下拉後點空白 → 照舊清除
  - BrokerSearch:onOpenChange 回報 true(輸入有結果)/ false(Escape)
  - e2e **E41**:真瀏覽器事件序 — 加選 2(下拉仍開)→ 點圖表空白 → chips 仍 2 +
    listbox 消失;再點空白 → 全清
- `changelog.ts` 0.46.1(PATCH,hotfix 0.46.0)+ changelog.test 版本 pin 隨動(該紅)

## 既有測試標記

**[amendment 2026-07-28: Phase 4 修正 — 原「全部不該紅」判斷錯誤]**:jsdom 裡
`selectBrokerViaSearch` 後下拉**恆開**(無真 blur),含 `triggerBrush`(帶
pointerdown)的測試會 arm guard 吞掉後續圖表點擊 → 兩個測試**該紅**,修法 =
測試補「選完 Escape 關下拉」對齊真瀏覽器序(點圖表的 pointerdown 會 blur 關下拉):
- C7「點空白處 → summary + selection 一起消失(SC-A1c)」
- 單看 T3「單看中點空白(chips + brush 保留)」(含 setupTwoSelected helper 統一補)

其餘不該紅(無 pointerdown 的純 click 不 arm)。changelog 版本 pin 該紅(隨 0.46.1)。
