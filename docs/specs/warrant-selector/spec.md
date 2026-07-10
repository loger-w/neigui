# 權證選擇器 — 標的驅動的盤中權證篩選(equity mode 新 tab)

**Date**: 2026-07-08(EOD 初版)→ **2026-07-11 盤中版改版(user 拍板)**
**Type**: brainstorm 產出 spec(實作走 `/feat`,本檔為 Phase 0 pre-reading)
**Goal**: 「先選標的股、再挑權證」— 盤中列出標的全部權證(上市 + 上櫃),以條款、槓桿、流動性、**估價(是否合理價/便宜)**、分點籌碼、差槓比篩選排序;收盤後用最後快照,盤後也能選。
**SemVer**: MINOR(使用者可感的新功能)
**相關 memory**: [[reference_finmind_warrant_dataset]](分點 T+1、僅 warrant_id)
**下游依賴**: 本功能的條款快照 service 是「權證分點流向」(`docs/specs/warrant-broker-flow/spec.md`)的基建,實作順序在其之前。

---

## 1. 需求(user 拍板)

| 決策點 | 結論 | 拍板日 |
|---|---|---|
| 核心情境 | 先選標的股再挑權證;**盤中為主場景,收盤後以最後快照續用** | 2026-07-11(改版,取代 07-08「EOD 第一版」決策) |
| 估價定義 | **昨日 IV 評價法(主欄)+ 同標的 IV 百分位(輔欄)**;HV 溢價率不做(全表恆「貴」無鑑別度) | 2026-07-11 |
| 篩選維度 | 基本條款 + 槓桿/隱波 + 流動性/造市品質 + 分點籌碼 + 差槓比 + 估價 | 2026-07-08 / 07-11 |
| 頁面歸屬 | equity mode 新 tab,共用標的 symbol state | 2026-07-08 |
| 涵蓋範圍 | 上市 + 上櫃權證 | 2026-07-08 |

差槓比備註:每單位實質槓桿所付的買賣價差成本(權證小哥指標),對盤中短進短出是交易成本指標,與估價欄(定價貴賤)互補;維持預設排序鍵。

---

## 2. 資料源

### 2.1 FinMind 判死(2026-07-08 實測;2026-07-11 複測 + 補記)

- `TaiwanStockInfo` 4,276 rows 零權證;`taiwan_stock_tick_snapshot` 指定權證代號回空、整盤 snapshot(~2,822 檔)不含權證;`TaiwanStockKBar` 權證 0 rows。
- `TaiwanStockPrice` 有權證 EOD(030012 兩度實測有資料)但**無買賣價**,對差槓比無用 → 不採。
- **2026-07-11 補記**:`TaiwanStockInfoWithWarrant` 其實有權證 universe(認購 59,999 / 認售 17,997 / 認購售 43,827 rows,含上市上櫃與 2026-07-10 新掛牌)— 修正 07-08「零權證」的過度概括。但只有代號 + 名稱 + 分類,**無條款、無標的對映、無買賣價**,仍不足以支撐本功能。
- FinMind 權證僅分點報表 `TaiwanStockWarrantTradingDailyReport`(T+1,只接 warrant_id)→ 只用於 §6.3 籌碼展開。**2026-07-11 實測補記**:`data_id` 必填 + `end_date` 必須留空(單日單發,官方 400 訊息明示);分點逆查(`data_id=` 分點代號)回 0 rows,再確認不支援。
- 官方文件(Derivative / Chip 頁)複查:無任何權證條款或五檔 dataset;`TaiwanStockWarrantInfo` 等猜測名實測 422。

### 2.2 TWSE(上市權證,EOD)

| 用途 | 端點 | 實測 |
|---|---|---|
| 每日行情(含買賣價) | `GET https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=0999&response=json` | 26,601 rows(**認購,不含牛證**) |
| 基本條款 | `GET https://openapi.twse.com.tw/v1/opendata/t187ap37_L` | 40,119 rows;2026-07-11 確認在官方 swagger(`/v1/swagger.json`,143 paths)內 |

- MI_INDEX 欄位:`暫停交易 / 證券代號 / 證券名稱 / 成交股數 / 成交筆數 / 成交金額 / 開盤價 / 最高價 / 最低價 / 收盤價 / 漲跌(+/-) / 漲跌價差 / 最後揭示買價 / 最後揭示買量 / 最後揭示賣價 / 最後揭示賣量 / 本益比 / 標的代號 / 標的名稱 / 標的收盤價/指數` — 買賣價量 + 標的對映一發到位。**RWD 層無 swagger**(官網內部 JSON API,非 OpenAPI)。
- **`type=0999` 只涵蓋認購(不含牛證)**:認售之 type 代碼待枚舉 — **spike S-1**。
- 髒點:`漲跌(+/-)` 是 HTML(`"<p> </p>"`);無成交時價格欄空字串;民國日期。
- t187ap37_L「最新標的可履約發行數量(每千單位權證)」= 行使比例來源候選,須與 TPEx `ExerciseRatio` 交叉驗證換算 — **spike S-2**。

### 2.3 TPEx(上櫃權證,EOD)

| 用途 | 端點 | 實測 |
|---|---|---|
| 每日行情(OHLC + 標的) | `GET https://www.tpex.org.tw/openapi/v1/tpex_warrant_daily_quts` | 8,964 rows |
| 買賣價(join 補) | `GET https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` | 9,976 rows,含全部權證 |
| 基本條款 | `GET https://www.tpex.org.tw/openapi/v1/tpex_warrant_issue` | 8,964 rows |

- 三端點皆在 TPEx swagger(`https://www.tpex.org.tw/openapi/swagger.json`,225 paths,2026-07-11 確認)。
- `tpex_warrant_daily_quts` 無買賣價,以 `SecuritiesCompanyCode` join `mainboard_daily_close_quotes` 的 `LatestBidPrice` / **`LatesAskPrice`(官方欄名 typo,原樣對 key)**。零成交權證 Close 為 `"---"` 但買賣價仍在 → 差槓比照算。
- `tpex_warrant_issue`:`ExpiryDate`(**西元**,與 TWSE 民國不同)/ `LatestExercisePrice` / **`" Latest ExerciseRatio"`(欄名帶空白)** / `Type`(認購|認售)/ Cap·FloorPrice / `Reset`。認購認售同表。
- TPEx OpenAPI 皆只回最新一日 — EOD 快照模式可接受。
- **TLS 風險限縮(2026-07-11)**:TPEx 憑證缺 SKI 是 python 3.13 `ssl` 層拒驗;**curl 實測可連**(swagger.json 477KB 抓取成功)。backend py3.12 Phase 0 驗一次;若炸用 `truststore`,**禁止 `verify=False`**。

### 2.4 盤中報價 — TWSE MIS(新,2026-07-11 實測)

```
GET https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_030012.tw|tse_2330.tw&json=1&delay=0
```

- 權證(030012)與個股(2330)同端點實測通:回**五檔委買賣價量**(`a`/`b` 價、`f`/`g` 量,`_` 分隔帶尾綴)、OHLC(`o`/`h`/`l`)、昨收 `y`、最新成交 `z`、日期時間 `d`/`t`/`tlong`。上櫃前綴 `otc_`。
- 收盤後回最後盤中快照(週六實測回 07-09 13:30 資料)→ 「盤後也能選」自然成立。
- 髒點:`z` 無成交時為 `"-"`;價量字串尾端多一個 `_`。
- 非官方、無文件。**未驗(spike S-6)**:`ex_ch` 批次上限、限流曲線、`otc_` 權證覆蓋率。

---

## 3. 架構:EOD 快照基底 + 盤中報價層

### 3.1 EOD 快照(每日一次)

- 新 service `services/warrants.py`(沿 `finmind.py` 樣板:singleton、atomic cache、inflight dedup、具體 catch)。
- `build_snapshot(date)`:TWSE 行情(認購 + 認售 type 各一發)+ t187ap37_L + TPEx 三發 → normalize(民國/西元、typo 欄名、`---`/空字串、千分位)→ join 行情×條款 → 算 §4 EOD 欄位 → 存單一日快照 JSON(含 per-underlying index:`{underlying_id: [warrant, ...]}`)。
- **新增(盤中版)**:快照生成時即以昨收反解**每檔權證昨日 IV** 存入快照 — 盤中估價的基準,盤中不重算。
- 條款端點只有「最新」版本 → 快照日 = 抓取日;endpoint 不收 date 參數,一律回最近交易日快照 + `as_of_date`。

### 3.2 盤中報價層(新)

- `GET /api/warrants/{stock_id}/quotes?refresh=bool`
- Backend 以 MIS 批次(50–100 檔/發,分批;含標的本身即時價)抓該標的全部權證五檔 → normalize → 即時計算 §4 盤中欄位 → 回傳。
- **Cooldown**:per-underlying ~10–15s 內重複請求回 cache(所有前端輪詢共用同一份;`_run_once` inflight dedup 慣例);收盤後 MIS 回最後快照,行為不需分支。
- Quote provider 抽象保留:v1 唯一實作 = MIS;未來換源不動計算層。

### 3.3 Route

- `routes/warrants.py`(每 router 一檔):
  - `GET /api/warrants/{stock_id}?refresh=` → EOD 快照 per-underlying 條款 + 昨日欄位
  - `GET /api/warrants/{stock_id}/quotes?refresh=` → 盤中層(§3.2)
  - `GET /api/warrants/{warrant_id}/brokers?refresh=` → FinMind 分點(T+1,單日單發)
- Error contract `{detail:{error}}` 沿用;502/503/400/404 語意照專案慣例。

---

## 4. 計算欄位(backend 統一計算,前端只呈現)

以 S = 標的價(EOD 用收盤、盤中用 MIS 即時)、K = 履約價、P = 權證價格、R = 行使比例、T = 剩餘年化時間、r = 無風險利率(常數 1.6%,service 內具名常數):

| 欄位 | 公式 | 備註 |
|---|---|---|
| 價內外 moneyness | call: (S−K)/K;put: (K−S)/K | 正 = 價內 |
| 剩餘天數 | 最後交易日 − as_of(日曆日) | BS 用 T = days/365 |
| 權證定價基準 P | 有成交用 `z`/收盤;零成交用 mid = (bid+ask)/2;皆無 → 計算欄位全 null | null 不擋列出 |
| 隱含波動率 IV | BS 反解(Brent),per-share premium = P / R | 解不出 → null |
| Delta | BS delta(用反解 IV) | IV null 則 null |
| 實質槓桿 | Delta × S / P × R | |
| 價差比 | (ask − bid) / bid | bid = 0 → null |
| 差槓比 | 價差比 / 實質槓桿 | 越低越好,**預設排序鍵(asc)** |
| **理論價(盤中)** | BS(S_now, K, T, IV_昨日) | 昨日 IV null → null |
| **估價差 %(主欄)** | (現價 − 理論價) / 理論價 | 中性標籤「偏貴 / 合理 / 偏便宜」,門檻常數實作期校準 |
| **同標的 IV 百分位(輔欄)** | 現價 IV 在同標的、同類型(call/put 分開)、相近 moneyness 與天期權證中的百分位 | 同組樣本 < 5 檔 → null;分組參數為 service 內具名常數 |

- 歐式/美式一律歐式 BS 近似;不做除息調整;重設型(Reset=Y)列出但 IV/greeks 標 null + 備註 icon(沿 07-08 決策)。

---

## 5. 成功條件(SC,可驗收)

1. **SC-1** equity mode 出現「權證」tab,沿用當前標的;切標的即刷新。
2. **SC-2** 表格列出該標的全部權證(上市 + 上櫃合併),欄位:代號、名稱、類型、市場、履約價、價內外 %、剩餘天數、行使比例、現價(z/mid)、五檔最佳買賣價量、IV、**理論價、估價差 %、IV 百分位**、實質槓桿、價差比、差槓比;預設差槓比升序。
3. **SC-3** 盤中自動更新:交易時段 TanStack `refetchInterval` 輪詢(間隔常數,對齊 backend cooldown),收盤後停止輪詢並顯示「最後更新 HH:MM」;盤後開頁直接顯示最後快照。
4. **SC-4** 篩選器:認購/認售 toggle、剩餘天數下限、價內外範圍、「委買量 > 0」開關、**估價差範圍、IV 百分位上限**;全部 client-side filter。
5. **SC-5** 估價標籤與差槓比標色:中性色階(accent/區間標),**不用紅綠**(紅綠保留多空語意)、不寫任何方向性/建議文案;data-testid + 正向 assertion 鎖住。
6. **SC-6** 點單一權證 row 展開:FinMind 分點買賣超(T+1 單發);顯示「資料日 = T-1」標註。
7. **SC-7** 標的無權證 → 「此標的無掛牌權證」空狀態(繁中)。
8. **SC-8** `no_trading_day` / `refresh=true` 慣例沿用;EOD 快照 cache 以日期為 key + `_cache_version`。
9. **SC-9** 完成 gate:`pytest -q` + `ruff check .` + `npm test` + `npm run build` + chrome-devtools 截圖入 `docs/specs/warrant-selector/screenshots/`。

---

## 6. 設計補充

### 6.1 Frontend

- equity mode 新 tab(`hidden` attribute 慣例),`App.tsx` 傳當前 symbol。
- hook `useWarrants(stockId)`(EOD 條款)+ `useWarrantQuotes(stockId)`(盤中層,`refetchInterval`)→ 皆 `{ data, loading, error, refresh, ... }`;分點展開 `useWarrantBrokers(warrantId)` lazy。
- 元件 `WarrantSelector`(表格 + 篩選列)+ 純函式 filter/sort 抽 `lib/warrant-utils.ts` 單測;重元件 `React.lazy()`。
- UI 繁中、semantic tokens;認購/認售類型用 accent/outline badge,不用紅綠。
- **開工前先呼叫 frontend-design + bencium-controlled-ux-designer**(memory: [[feedback_frontend_design_skills]])。

### 6.2 測試 / e2e

- Backend:normalize 髒點各一測(民國/西元、typo 欄名、`---`、HTML 漲跌欄、leading-space key、MIS 尾綴 `_` 與 `z="-"`)、join 完整性、BS 數值鎖(教科書案例)、IV 反解邊界、理論價/估價差/IV 百分位數值鎖、cooldown 行為、per-underlying index。fixture 取 probe 真實 payload 縮樣。
- Frontend:hook + filter/sort 純函式 + 空狀態 + 標色 + 輪詢啟停。
- e2e:equity mode UI 新增 → 依 `e2e-conventions` 判準表歸 E# spec,**/feat Phase 0 必讀定案**;需 fake 快照 + fake quotes fixture。

### 6.3 分點籌碼(明確降級設計)

全表不含分點欄(避免 fan-out 燒配額);只在展開單一權證時抓,快取 per warrant_id + date。

---

## 7. Out of scope(v1 不做)

- 牛熊證/展延型(結構不同:Cap/Floor/強制回收)
- 全市場條件掃描(未鎖標的)
- IV 歷史曲線 / 權證回測
- 歷史日期快照回放(條款端點只有最新)
- 盤中估價基準的即時 IV 曲面重建(v1 固定用昨日 IV)

## 8. 風險與 spike(實作期 Phase 0 處理)

| # | 項目 | 處理 |
|---|---|---|
| S-1 | TWSE MI_INDEX 認售權證 type 代碼 | Phase 0 枚舉(0999P 等候選),驗 rows 標題 |
| S-2 | t187ap37_L「每千單位權證」→ 行使比例換算 | 同標的上市/上櫃權證比對 ExerciseRatio 交叉驗證 |
| S-3 | TPEx TLS(缺 SKI) | backend py3.12 venv 實測(curl 已通,風險限縮 python ssl 層);炸則 truststore |
| S-4 | t187ap37_L 40k rows 是否含已到期 | 最後交易日過濾 + 與 MI_INDEX 代號交集驗證 |
| S-5 | TWSE OpenAPI / RWD 限流 | 每日各一發,低風險;UA + backoff |
| S-6 | **MIS 批次上限 / 限流曲線 / otc_ 權證覆蓋** | Phase 0 實測:批次大小遞增探邊界、量測安全輪詢頻率、otc_ 權證抽測;結果決定 cooldown 與 refetchInterval 常數 |
| S-7 | 盤中多 client 並發與 cooldown | `_run_once` inflight dedup + cooldown cache,test 鎖並發行為 |
