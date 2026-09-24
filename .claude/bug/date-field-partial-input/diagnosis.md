# Diagnosis — fix/date-field-partial-input(2026-09-25)

來源:user 跑 `/code-review`(對 mod/date-field-dark-calendar)發現 #1 / #2,user 選「A 修兩個既有 bug」。

## 症狀
- **A1 個股頁**:日期欄位按月曆「清除」或逐位打年份 → 空值 / `0002-…` 半成品被 snap 到交易日清單最早一天
  (約一年前)、寫回欄位、`onValueChange` → 以錯誤日期抓資料;年份段因被改寫而幾乎無法用鍵盤輸入。
- **A2 選擇權頁**:同樣輸入 → 半成品日期直接進所有查詢。reviewer 原述「空日期打 API」經查不成立 —
  `options-api.ts` 對空日期不帶 `date` 參數(= 重抓最新);實際錯誤是半成品年份。

## Phase 1 迴圈(已跑,皆紅)
- **L1**(vitest,DateField 元件):`snapToDates` + change 為 `""` / `0002-06-26` / `0020-…` / `0202-…` →
  4/4 紅:`onValueChange` 收到最早日 `2025-07-01`。
- **L2**(Playwright,選擇權頁):年份段逐鍵 `2,0,2,6` → 29 支 `date=0002/0020/0202-06-26` 請求。
  最小化:**單鍵 `2` 即 9 支 `date=0002-06-26`**,兩次結果相同。

## Phase 3 假說(user 2026-09-25 認可排序)
1. H1(A1 根因):DateField snap 包裝不分完整日期與輸入中半成品,全交 `snapToTradingDay` → 早於清單即夾最早日
   (該夾取原為「清單範圍前的真日期」設計)。
2. H2(A1 附帶):包裝把 snap 結果寫回 DOM,蓋掉正在打的年份段。
3. H3(A2 根因):OptionsHeader 走純原生路徑,原始值直送 setDate。
4. H4(非根因):options hook 的 enabled 只看合約 — 在 caller 加 if 規避,不採。

## Phase 4 證據
- probe:`snapToTradingDay` 對 `""` / `0002-06-26` / `0202-06-26` 皆回 `2025-07-01`,合法週末日正常退前一交易日 → H1 成立。
- L2 直接顯示原始值進請求 → H3 成立。
- **根因**:共用 DateField 沒有「可提交」概念;H1 / H3 同源。

## 修正
- DateField 包裝路徑(有 snapToDates 或 onValueChange)加可提交判斷:完整 `YYYY-MM-DD` 且在
  [`min` ?? 2000-01-01, `max`];不可提交者存內部草稿(欄位顯示輸入中內容,不 snap / 不回呼 / 不改寫 DOM),
  blur 丟草稿還原。純原生路徑不變(分點反查自有防護)。
- OptionsHeader 改用 `onValueChange` 接上防護。

## Regression seam
- `date-field.test.tsx`(L1 轉正,+ 回呼路徑 / 逐位提交一次 + blur 還原 / min-max 共 7 條)。
- `options.spec.ts` O7(L2 轉正,真鍵盤 + 網路症狀)。

## 事前標「該變」
- `changelog.test.ts`「最新版本是 vX」0.50.2 → 0.50.3(PATCH,fix / global)。

## Blast radius
- `snapToTradingDay`:唯一 caller = DateField。
- DateField caller:App(個股,snap + onValueChange → 受防護)、OptionsHeader(改 onValueChange → 受防護)、
  BrokerFlowsPanel(純原生 → 不變)。

## Out of scope(記 next-time)
- 逐位打「日」時 `01` → `15` 兩個都是合法日期,仍會各查一次(非錯誤請求,只是多一輪)。

## Review 追記(two-axis round 1)
- **O7 語系依賴(Spec 高 / Std-1)**:原寫法點第一段當年份;段序跟 Chromium 程序語系走(`--lang`),
  Playwright `locale` 管不到。reviewer 以 `--lang=en-US` 重現舊寫法停在 `0005-02-02`。改為段序偵測
  (第一段按 ↑ 看哪段變,非年份則 Tab 兩次);`--lang=en-US` 與本機 zh-TW 皆綠,repeat×3 綠。
- **草稿遮住外部 value 變動(Spec 低)**:外部 `value` 變動時丟草稿(紅先行 → 綠)。
- **純原生路徑補鎖定測試**:不完整值原樣交給 onChange(BrokerFlowsPanel 依賴)。
- **行為改變(需 user 確認)**:選擇權頁按月曆「清除」過去 = 以空日期重抓最新資料(欄位顯示空白);
  現在 = 不動作,失焦還原原日期。
- **changelog scope**:實作拆為 equity / options 兩條(比本檔原寫的 global 精確),以實作為準。
