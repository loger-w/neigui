# Implementation PLAN — borrow-fee-totals(condensed)

> 依 design.md v2。TDD 紅先行;backend 先(payload 是前端依賴)。

## 1. backend/services/daytrade_fee.py(+ tests/test_daytrade_fee.py)

- `get_day`:`month_dates` 迴圈內並行累加 `month_shares[sid] += r["lending_shares"]`;
  payload 增 `"month_shares": month_shares`。其餘零改動(cache / 回退鏈 / partial)。
- 紅測試(既有 monkeypatch fetch_month 樣板):
  - `month_shares` 手算:單股同日兩列 + 跨日一列 → 全列相加(8046 型);
  - key 集 = `month_counts` key 集;
  - 既有 payload keys(rows/as_of_date/month_counts)不變。
- `tests/test_daytrade_fee_routes.py`:fake_get_day 回傳 dict **補 month_shares 欄**
  + response assertion(R2 修:mock 也要改,僅為 passthrough 鎖)。
- **`tests_e2e/test_api_daytrade_fee.py`(R1 修,真正整合層)**:增資料級 assertion
  `body["month_shares"]["8046"] == 17000`(fixture 手算 2,000+12,000+3,000;tpex 無
  8046)— 與 month_counts==2 同型樣板;此檔是 pytest gate 內唯一鎖 fixture 驅動
  整條 route 的位置。
- 對應 SC-1、SC-3。

## 2. frontend/src/lib/borrow-fee.ts

- `BorrowFeeData` 增 `month_shares: Record<string, number>`(附 doc comment:
  含同日多筆、key 可能缺)。
- 既有測試 mock payload 補欄位(TS 逼出,機械化;事前標該變 — 僅型別完整性,
  無行為 assertion 改動)。
- 對應 SC-1。

## 3. frontend/src/components/BorrowFeePage.tsx(+ BorrowFeePage.test.tsx)

- 依 design §3:derived `dayTotal` / `monthTotal` / `monthTotalText` / `monthCount`
  (null 語意照 design R1);summary `<p data-testid="borrow-fee-stock-summary">` 於
  BorrowFeeStockFilter 容器正下方;全形括號文案;ink 階層標色禁 accent。
- 取值一律 optional chain:`data.month_shares?.[sid] ?? null`(monthCount 同型;
  R5 修 — 前後端版本 skew 時 map 整個缺不得 TypeError 白屏,與缺 key 合流「—」)。
- 紅測試(vi.spyOn 樣板、testid textContent 比對):
  - 選股 → summary 出現,本日 / 本月手算(含同日兩列 case)千分位;
  - 清除選股 → 消失;未選 → null;
  - 該股今日無列 → 本日 0 股、本月照顯;
  - month_shares 缺 key → 「—」且無「(」段;
  - regression:未選股全表 + 既有 assertion 不變。
- 對應 SC-2、SC-3、SC-5。

## 4. e2e/specs/borrow-fee.spec.ts + e2e/helpers/selectors.ts

- `e2e/helpers/selectors.ts` TESTIDS 增 `borrowFeeStockSummary`(既有 map 追加,
  非新檔;R3 修 — spec 一律走 TESTIDS 常數慣例)。
- 寫 spec 前先跑手算 script(python 讀 twse_202606.json + tpex.json,以 FAKE_TODAY
  基準日重算 as_of 與 8046 當日/當月值)— **不憑 design 預估值寫死**;script 為
  throwaway 放 session scratchpad 不入 repo,算值以註解留在 BF4 內(R4 修)。
- 新 BF4:選 8046 → `borrow-fee-stock-summary` 含「本日標借合計 X 股」
  「本月累計 Y 股(N 次)」資料級 assertion;痛點註解連 SC-3。
- 既有 BF1-3 保綠。
- 對應 SC-4、SC-5。

## 不動面

useDaytradeFee hook、BorrowFeeStockFilter、DaytradeFeeTable、cache 層、
error contract、`_CACHE_VERSION`。
