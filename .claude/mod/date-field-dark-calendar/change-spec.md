# Change Spec — mod/date-field-dark-calendar(小活分流:單檔 CSS、無 API、無 migration)

> 對齊紀錄:2026-09-24 user 回報「日期選擇框沒有根據專案的風格做」;查證 = 欄位本身已沿用
> `DateField`(與個股頁 class 相同),問題在**點開後的原生月曆彈窗**:專案未宣告
> `color-scheme`,Chrome 在深色頁面彈白底月曆。user 選「原生月曆改深色」+「加一條 e2e 斷言」。

## 現況 / Caller map
- `DateField`(`components/ui/date-field.tsx`,class `date-field-input`)caller 共 3:
  `App.tsx:449`(個股)/ `OptionsHeader.tsx:54`(選擇權)/ `BrokerFlowsPanel.tsx:293`(分點反查)。
- `index.css`:`.date-field-input::-webkit-calendar-picker-indicator { filter: invert(0.65) sepia(0.2); opacity: 0.7 }` —
  調給 light scheme 的**黑色**圖示。專案只有深色主題(無 prefers-color-scheme / light theme)。

## 決策
- `.date-field-input` 宣告 `color-scheme: dark` — **只作用在日期欄位**,不放 `:root`
  (放 root 會連帶改捲軸、選擇權頁合約 `<select>` 等其他原生控制項,超出 user 要求)。
- 深色 scheme 下 Chrome 圖示改畫淺色 → filter 反算為 `invert(0.35) sepia(0.2)`。
  實驗(Playwright Chromium,#0e0c08 底):現況 A 與「dark + invert(0.35)」C **整個欄位逐像素相同**
  (diff bbox None);dark 不改 filter 的 B 圖示變亮(peak 128→183)。
  〔更正 2026-09-25〕B 實為「dark + 完全拿掉 filter」;「dark + 保留 invert(0.65)」未量,推算會**變暗**
  (最亮約 66,近乎看不見)。詳見 verification.md 同條更正。
- 月曆彈窗本身為瀏覽器原生外觀(字型 / 選取色不一定吃專案 token),Firefox / Safari 各異 — user 已知悉。

## 測試 seam(user 議定)
- e2e N#(navigation.spec.ts):個股 / 選擇權 / 分點反查三頁的「選擇日期」欄位
  `getComputedStyle(el).colorScheme === "dark"`(真 browser computed,非讀原始碼)。
- 彈窗外觀本身頁面截圖拍不到 → user 點開過目驗收。
- **事前標「該變」**:`changelog.test.ts`「最新版本是 vX」0.50.0 → 0.50.1(changelog PATCH,
  影響體驗的視覺修正,kind fix / scope global)。

## 既有行為白名單
- W1 欄位收合外觀不變(底色 / 邊框 / 字色 / 圖示色;實驗逐像素相同)。
- W2 鍵盤逐段輸入、方向鍵、Tab 行為不變。
- W3 個股頁 `snapToDates` 跳最近交易日、前 / 後一交易日按鈕不變。
- W4 分點反查草稿防護(範圍 + debounce)不變。
- W5 其他原生控制項(捲軸、選擇權合約 `<select>`)外觀不變。
- W6 visual baseline(V1/V2/V4/V5 含日期欄位)不應產生 diff。

## 實作期追記(review 後)
- review(Std / Spec 兩軸)指出 W2 視覺面:鍵盤編輯中「選取段」反白在 dark scheme 下由
  系統藍 #0078d4 白字 → 淺藍 #99c8ff 黑字(收合狀態不受影響;`evidence/W2_focus_segment_before_after.png`)。
- user 選「改用專案強調色」→ 實作 `::-webkit-datetime-edit-*-field:focus` 無效;Chromium 149
  實驗 5 種作者 CSS(pseudo :focus / !important / accent-color / ::selection)**全部無法改變
  選取段反白**(固定 (153,200,255) + 黑字)→ 原生欄位做不到,屬方向層級限制。
- user 決定:**維持深色原生淡藍,本次以「月曆改深色」收尾**;自製日期元件記 next-time。
  未生效的規則與對應 e2e(N8)已撤回,未進版控。

## Out of scope
- 自製專案風格月曆(user 未選)。
- `DateField` 觸控放大(next-time 既有條目)。
