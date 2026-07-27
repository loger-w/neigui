# Brainstorm — 券差選股加總(borrow-fee-totals)

## 分流判定記錄

模糊 idea 路(判準條件 1 未中:「同時查看某檔股票全部加起來的股數」只有目標)。
方向由 user 於 session AskUserQuestion 拍板:**選股後顯示總計,「當月累計也可以,
不過也要當天的借券股數加總」→ 兩個數字都做(本日合計 + 本月累計)**。
剩餘為實作級決策,依 /auto 契約標 `[auto-default]`。

## 目標

券差查詢頁(`BorrowFeePage`)以個股 filter 選定股票後,顯示該股**本日標借合計股數**
與**本月累計標借股數** — 目前表格逐列顯示,同股多列(同日多次標借)與跨日累計
需要使用者心算。

## 現況事實(自查)

- `GET /api/daytrade-fee`(`services/daytrade_fee.py::get_day`)payload:`rows` **只含
  as_of 當日**列(同股同日可多筆 — fixture 8046 於 06/24 即有 2,000 + 12,000 兩列,
  上游多次標借為真實情境);`month_counts` = 該股當月出現**日數**(set of dates),
  無股數資訊 → **本月累計必須 backend 擴 payload**。
- 前端 `BorrowFeePage`:`selectedStock` 過濾 rows;選股後該檔今日無列 → 空狀態
  「該檔今日無券差資料」。filter options 來自當日 rows(`distinctStocks`)。
- `BorrowFeeData` 型別在 `lib/borrow-fee.ts`;`formatShares` 在 `borrow-fee-utils.ts`。
- e2e:`e2e/specs/borrow-fee.spec.ts`(BF1-BF3)+ FAKE fixture
  `tests_e2e/fixtures/borrow_fee/`(子目錄直讀,twse-tpex-conventions FAKE 層)。
- Cache:`_CACHE_VERSION = 1`(payload 組裝在 cache 之後,本次不動 cache shape,
  不需 bump — cache 存的是 normalized rows 非 payload)。

## 拍板方案

- **Backend**:`get_day` payload 增 `"month_shares": Record<stock_id, int>` —
  該股**當月全部 rows** 的 `lending_shares` 加總(含同日多筆;與 `month_counts`
  同資料源 all_rows,樣板對齊)。additive field,error contract 不變。
  [auto-default: payload map 對齊 month_counts 樣板 | reason: 前端一次拿全表,
  免新 endpoint / 免 N+1;shape 與既有欄位同構]
- **Frontend**:`BorrowFeeData` 增 `month_shares`;選定個股後,filter 下方、表格
  上方顯示 summary 列(`data-testid="borrow-fee-stock-summary"`):
  「本日標借合計 X 股 · 本月累計 Y 股(N 次)」— X = 該股 as_of rows 前端加總
  (同日多筆合計)、Y = `month_shares[stock_id]`、N = 既有 `month_counts`。
  未選股不顯示。
  [auto-default: summary 放 header 區 filter 之下 | reason: 與選股動作視覺相鄰,
  不動表格結構]
- 該檔今日無列(換日殘留選股)→ 本日合計顯 0 股、本月累計照顯(表格區空狀態
  文案不變)。`month_shares` 缺該股 → 累計顯「—」。
  [auto-default: 0 股 / 「—」分別處理 | reason: 0 是真值(今日無標借)、缺 key
  是資料面缺口,語意不同不混用]

## SC(成功條件)

- **SC-1 backend payload**:`GET /api/daytrade-fee` 回應增 `month_shares`
  (stock_id → 當月 lending_shares 加總,含同日多筆);`rows` / `month_counts` /
  `no_trading_day` / `partial` / error contract 不變。
  驗證:`backend` `python -m pytest -q tests/test_daytrade_fee.py`(月加總手算
  case,含 8046 同日兩筆)+ route 層 payload key assertion。驗證窗口:anytime。
- **SC-2 選股 summary**:選定個股後,個股 filter 正下方出現一列
  `borrow-fee-stock-summary`,文字含「本日標借合計 X 股」與「本月累計 Y 股(N 次)」
  (X/Y 千分位 `formatShares` 格式);清除選股後該列消失。畫面可指認:header 區
  filter 下方、繁中文案如上。
  驗證:vitest `BorrowFeePage.test.tsx` summary render / 數值 / 清除 cases。
  驗證窗口:anytime。
- **SC-3 同日多筆合計**:同股同日多列時,本日合計 = 各列加總;本月累計 = 全月
  各列加總(手算 fixture)。
  驗證:vitest 手算 assertion(前端 X)+ pytest 手算(backend Y)。驗證窗口:anytime。
- **SC-4 e2e**:`borrow-fee.spec.ts` 新 BF#:FAKE fixture 選 8046(南電)→ summary
  顯示本日合計與本月累計之 fixture 手算值(資料級 assertion)。
  驗證:`e2e` `npx playwright test specs/borrow-fee.spec.ts`。驗證窗口:anytime。
- **SC-5 regression**:未選股時頁面與現行一致(全表、無 summary 列);既有
  BF1/BF2/BF3 綠;`月次數`欄與空狀態文案不變。
  驗證:既有 vitest + e2e 全綠。驗證窗口:anytime。

## Edge cases(≥ 3)

1. **同股同日多筆**(SC-3 核心):8046 型 — 本日合計為兩列相加,不取單列。
2. **選股殘留但該檔今日無列**(換日 refresh):本日合計 0 股、本月累計照顯,
   表格區維持既有「該檔今日無券差資料」空狀態。
3. **month_shares 缺該股 key**(跨月邊界 / 資料缺口):累計顯「—」不顯 0(缺 key
   ≠ 零標借)。
4. **partial tpex**(過去月 cache 凍結):累計可能低估 — 沿用既有 partial badge,
   summary 不另加註(badge 已涵蓋語意)。

## Out of scope

- 歷月查詢 / 日期選擇(頁面維持最近可得日)。
- 全表每檔附累計欄(user 選了「選股後顯示」路線)。
- 累計走勢圖 / 逐日明細展開。
- cache shape 改動(payload 組裝層新增,`_CACHE_VERSION` 不 bump)。

## e2e 歸屬(e2e-conventions 判準表)

- Backend route response shape 增欄 → backend route 測試必補(additive field
  assertion);前端會用 → 併入 BF# 資料級驗證(borrow-fee.spec.ts,BF 系列)。
- UI 新 summary → 新 BF# case;非 layout 大改,不動 visual.spec。

## 執行約束

- backend 改動前讀 `backend-conventions` + `twse-tpex-conventions`(FAKE 層);
  frontend 讀 `frontend-conventions` / `frontend-testing`(已載入)。
- summary 數字標色:中性資料非互動 → 用 ink 強度階,**禁 accent**(frontend-conventions
  色彩語意鐵則);「本月次數」沿用現行 ink-muted。
- UI 實作前 frontend-design / bencium 已於本 session 載入,沿用其原則(1px border /
  ink 階層 / 無陰影)。

## Scope 分流

**L**(跨前後端:backend service + tests、frontend 型別 + 頁面 + tests、e2e spec
≥ 5 檔;無鑑權 / migration / hot path)。M/L 輪數統一;方向已拍板。
