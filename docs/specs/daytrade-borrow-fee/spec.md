# 券差查詢 — 應付現股當日沖銷券差借券費率(market mode 新 tab)

**Date**: 2026-07-08
**Type**: brainstorm 產出 spec(實作走 `/feat`,本檔為 Phase 0 pre-reading)
**Goal**: 當沖賣出未回補產生「券差」時,證交所/櫃買辦理標借,公告各證券借券費率。做一個比官網好用的每日全表瀏覽 + 高費率異常探測。
**SemVer**: MINOR(使用者可感的新功能,新 tab + 新資料源)
**參考頁**: https://www.twse.com.tw/zh/trading/day-trading/bfif8u.html

---

## 1. 需求(user 拍板,2026-07-08)

| 決策點 | 結論 |
|---|---|
| 券差定義 | TWSE BFIF8U「應付現股當日沖銷券差借券費率」同款資料 |
| 使用場景 | 每日全表瀏覽 + 高費率異常探測(排序 + 門檻標色) |
| 頁面歸屬 | **market mode 新 tab**(全市場層級資料) |
| 涵蓋範圍 | **上市 + 上櫃一次做** |
| 歷史深度 | 單日 view 為主;因資料源是月批次,「本月發生次數」欄免費附帶 |

---

## 2. 資料源(2026-07-08 全部實測驗證)

### 2.1 TWSE — BFIF8U

```
GET https://www.twse.com.tw/rwd/zh/dayTrading/BFIF8U?date=YYYYMMDD&response=json
```

- **月批次**:date 給任一天,回該月全部資料(2026-07 實測 369 rows)。可回溯(官網註明自 103/05/05 起提供)。
- `fields`: `券差日期` / `證券代號` / `證券名稱` / `投資人借券股數` / `投資人借券費率`
- 資料髒點(parser 必處理 + 測試鎖):
  - 日期 = 民國格式 `115/07/01` → 轉 `YYYY-MM-DD`
  - 代號/名稱右側 padding 空白(`"0050      "`)→ strip
  - 股數千分位(`"25,000"`)、費率帶百分號(`"3.500%"`)
- 涵蓋 ETF(00403A / 0050 實測出現),不只個股。
- `stat != "OK"` 或 `data` 空 = 該月無資料。

### 2.2 TPEx — tpex_intraday_fee

```
GET https://www.tpex.org.tw/openapi/v1/tpex_intraday_fee
```

- 回**當月**全部(2026-07 實測 172 rows),**無日期參數 — 歷史月份 OpenAPI 拿不到**(限制見 §7)。
- 欄位:`Date`(民國 `1150701` 無斜線)/ `SecuritiesCompanyCode` / `CompanyName` / **`" LendingVolume"`(欄名帶 leading space,原樣對 key)** / `LendingFee`(`"1.000"`,單位 %,無百分號 — 與 TWSE 格式不同)。
- **TLS 風險**:TPEx 憑證缺 Subject Key Identifier,Python 3.13 `ssl` 直接拒驗(2026-07-08 實測)。backend 為 3.12,實作第一步先用 backend venv 驗證 httpx 可連;若同炸,解法用 `truststore`(系統憑證庫)或自訂 ssl context,**禁止 `verify=False`**。

### 2.3 共通

- 皆非 FinMind → 不占 6000 req/hr 配額;低頻(每日一發/市場)對 TWSE/TPEx 無限流壓力。
- 費率法定上限 7%(依收盤價計算之上限)。

### 2.4 FinMind 判死(2026-07-11 實測,記錄避免重挖)

FinMind 有 `TaiwanStockDayTradingBorrowingFeeRate`(文件 Chip 頁,BFIF8U 同源),但實測不可採:

- **有損聚合**:每股每日只保留股數最大一筆。2026-07-09 官方 60 筆 vs FinMind 20 筆;2408 官方 16 筆(最高費率 4.0%)只剩 `68000股@0.97%`;**2434 / 8046 當日 7% 法定上限筆直接消失**(FinMind 顯示 2.62% / 0.1%)→ 「高費率異常探測」「本月發生次數」「股數合計」全部失真。
- **僅上市**:2026-06-01~07-09 全部 47 檔零上櫃。
- 歷史深度至少回 2021(2015 已空)— 夠用,但前兩點已判死。
- 股票集合與 BFIF8U 完全一致(07-09 20/20),確認同源、僅是 FinMind 端 dedup 掉明細。

---

## 3. 成功條件(SC,可驗收)

1. **SC-1** market mode 出現「券差」tab;選日期(預設最近交易日)顯示當日上市 + 上櫃合併表格。
2. **SC-2** 表格欄位:市場(上市/上櫃)、代號、名稱、借券股數、借券費率、**本月發生次數**;預設依費率降序。
3. **SC-3** 費率 ≥ 門檻(常數,初版 3.5%)的 row 以 accent 標色;不寫任何方向性文案(不寫「軋空」「回補壓力」等,只呈現數字)。
4. **SC-4** 當日無資料(非交易日/尚未公告)沿用 `no_trading_day` 慣例:回最近有資料日 + flag,前端顯示「無交易日」既有樣式。
5. **SC-5** 排序可切換(費率/股數/發生次數/代號),欄位標題點擊切換。
6. **SC-6** `?refresh=true` 跳過 cache 重抓兩源;cache 以「月 + 市場」為 key,帶 `_cache_version`。
7. **SC-7** 完成 gate:`pytest -q` + `ruff check .` + `npm test` + `npm run build` + chrome-devtools 截圖(截圖入 `docs/specs/daytrade-borrow-fee/screenshots/`)。

---

## 4. 不能破壞(白名單)

| 行為 | 驗證 |
|---|---|
| equity / options mode 完全不變 | 既有 frontend test 全綠 |
| market mode 既有 tabs(heatmap/寬度/排行)不變 | 既有 `MarketPage` 測試全綠 |
| `/api/market/*` 既有 endpoint 路徑 + error contract `{detail:{error}}` | `test_market_routes.py` 全綠 |
| `_CACHE_VERSION`(既有 services)不動 | 新 service 用自己的版本號 |

---

## 5. 設計

### 5.1 Backend

- 新 service `services/daytrade_fee.py`(對齊 `services/finmind.py` 樣板:module singleton、`atomic_write_json`/`read_json` cache、inflight dedup、具體 exception catch → route 邊界 502)。
- 抓取單位 = 月:`fetch_month(market, yyyymm)` → normalize 成
  ```json
  {"date": "2026-07-01", "market": "twse|tpex", "stock_id": "0050", "name": "元大台灣50", "lending_shares": 25000, "fee_rate": 3.5}
  ```
- Route:`routes/market.py` 加 `GET /api/market/daytrade-fee?date=YYYY-MM-DD&refresh=bool`
  - 回 `{ as_of_date, no_trading_day?, rows: [...], month_counts: {stock_id: n} }`
  - `month_counts` 由當月(必要時跨到上月補齊 20 日窗?**不** — 只算當月,語意單純)全 rows 聚合。
  - date 無資料 → 往前找當月最近有資料日;整月空 → 前月遞迴一次為止,再空回 404 `{"error": "no_data"}`。
- 民國日期轉換 utility 寫在 service 內(兩種格式:`115/07/01` 與 `1150701`)。

### 5.2 Frontend

- market mode 新 tab「券差」,tab 切換沿用 `hidden` attribute 慣例。
- 新 hook `useDaytradeFee(date)` → `{ data, loading, error, refresh, noTradingDay }`(TanStack `useQuery` + signal 直傳)。
- 元件 `DaytradeFeeTable`:純表格 + 排序 state;semantic tokens;UI 文字繁中。
- 標色:`fee_rate >= FEE_HIGHLIGHT_THRESHOLD`(constant 3.5)套 `text-accent`;不用紅綠(此表無多空方向語意,避開 bull/bear 色)。

### 5.3 測試 / e2e

- Backend:parser 髒點各一測(民國日期兩格式、padding、千分位、百分號、TPEx leading-space 欄名)、no_trading_day 回退、month_counts 聚合、refresh 跳 cache。fixture 用本次 probe 真實 payload 縮樣。
- Frontend:hook 測試(frontend-testing 慣例)+ 表格排序/標色/無資料態。
- e2e:market mode UI 新增 → 依 `e2e-conventions` 判準表屬 M# spec;**/feat Phase 0 必讀該 skill 定案**,fixture 需加 fake 券差 payload。

---

## 6. Out of scope(v1 不做)

- 歷史月份瀏覽 UI(TWSE 可回溯但 TPEx OpenAPI 只有當月;做了半殘,不如不做)
- 跨月連續發生訊號 / 通知
- 與個股籌碼頁(equity)的交叉連結(點代號跳 equity 分析 — 好想法,寫入 next-time)

## 7. 風險與 spike(實作期 Phase 0 處理)

| 項目 | 內容 | 處理 |
|---|---|---|
| TPEx TLS | 憑證缺 SKI,py3.13 拒驗;backend py3.12 未驗 | Phase 0 用 backend venv 實測;炸則 truststore |
| TPEx 歷史月份 | OpenAPI 無日期參數 | 接受限制(v1 只需近月);官網 www/zh-tw JSON 端點留待需要時再探 |
| TWSE RWD 限流 | 未知,但每日一發極低頻 | 加 UA header + 失敗 backoff 即可 |
