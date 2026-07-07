# 權證選擇器 — 標的驅動的權證篩選(equity mode 新 tab)

**Date**: 2026-07-08
**Type**: brainstorm 產出 spec(實作走 `/feat`,本檔為 Phase 0 pre-reading)
**Goal**: 「先選標的股、再挑權證」— 輸入/沿用 equity 頁標的,列出其全部權證(上市 + 上櫃),以條款、槓桿、流動性、差槓比、分點籌碼篩選排序,挑出最適合的權證。
**SemVer**: MINOR(使用者可感的新功能)
**相關 memory**: [[reference_finmind_warrant_dataset]](分點 T+1、僅 warrant_id)

---

## 1. 需求(user 拍板,2026-07-08)

| 決策點 | 結論 |
|---|---|
| 核心情境 | **先選標的股再挑權證**(非全市場掃描) |
| 篩選維度 | 基本條款 + 槓桿/隱波 + 流動性/造市品質 + 分點籌碼 + **差槓比** |
| 即時性 | **EOD 第一版**;盤中列升級路徑(§8),架構預留、不實作 |
| 頁面歸屬 | **equity mode 新 tab**,共用標的 symbol state |
| 涵蓋範圍 | 上市 + 上櫃權證 |

---

## 2. 資料源(2026-07-08 全部實測驗證)

### 2.1 FinMind 判死(記錄避免重挖)

- `TaiwanStockInfo` 4,276 rows **零權證**;`taiwan_stock_tick_snapshot` 指定權證代號回空、整盤 snapshot(~2,822 檔)不含權證;`TaiwanStockKBar` 權證 0 rows。
- `TaiwanStockPrice` 有權證 EOD(030012 實測有資料)但**無買賣價**,對差槓比無用 → 不採。
- FinMind 權證僅分點報表 `TaiwanStockWarrantTradingDailyReport`(T+1,只接 warrant_id)→ 只用於 §5.4 籌碼展開。

### 2.2 TWSE(上市權證)

| 用途 | 端點 | 實測 |
|---|---|---|
| 每日行情(含買賣價) | `GET https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=0999&response=json` | 26,601 rows(**認購,不含牛證**) |
| 基本條款 | `GET https://openapi.twse.com.tw/v1/opendata/t187ap37_L` | 40,119 rows |

- MI_INDEX 欄位:`暫停交易 / 證券代號 / 證券名稱 / 成交股數 / 成交筆數 / 成交金額 / 開盤價 / 最高價 / 最低價 / 收盤價 / 漲跌(+/-) / 漲跌價差 / 最後揭示買價 / 最後揭示買量 / 最後揭示賣價 / 最後揭示賣量 / 本益比 / 標的代號 / 標的名稱 / 標的收盤價/指數` — **買賣價量 + 標的對映一發到位**。
- **`type=0999` 只涵蓋認購(不含牛證)**:認售(及牛熊證,若未來要)之 type 代碼待枚舉 — **spike S-1**。
- 髒點:`漲跌(+/-)` 是 HTML(`"<p> </p>"`);無成交時價格欄空字串;民國日期。
- t187ap37_L 欄位:出表日期 / 權證代號 / 權證簡稱 / 權證類型(認購|認售)/ 類別(一般型)/ 流動量提供者報價方式 / 可履約開始日 / 最後交易日 / 可履約截止日 / 發行單位數量 / 履約方式 / 標的證券·指數 / **最新標的可履約發行數量(每千單位權證)** / 原始·最新履約價格 / 上·下限價格 / 備註。
  - 「每千單位權證」欄位語意 = 行使比例來源候選,**須與 TPEx `ExerciseRatio` 交叉驗證換算**(AES-KY 樣本值 7.00,對高價股行使比例 0.007 合理)— **spike S-2**。

### 2.3 TPEx(上櫃權證)

| 用途 | 端點 | 實測 |
|---|---|---|
| 每日行情(OHLC + 標的) | `GET https://www.tpex.org.tw/openapi/v1/tpex_warrant_daily_quts` | 8,964 rows |
| 買賣價(join 補) | `GET https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` | 9,976 rows,含全部 8,964 檔權證 |
| 基本條款 | `GET https://www.tpex.org.tw/openapi/v1/tpex_warrant_issue` | 8,964 rows |

- `tpex_warrant_daily_quts` **無買賣價**,以 `SecuritiesCompanyCode` join `mainboard_daily_close_quotes` 的 `LatestBidPrice` / **`LatesAskPrice`(官方欄名 typo,原樣對 key)**。零成交權證 Close 為 `"---"` 但買賣價仍在(實測 72124U bid 0.07 / ask 0.17)→ 差槓比照算。
- `tpex_warrant_issue` 欄位:`ExpiryDate`(**西元** `20260818`,與 TWSE 民國不同)/ `LatestExercisePrice` / **`" Latest ExerciseRatio"`(欄名帶空白)** / `Type`(認購|認售)/ `American/European` / Cap·FloorPrice / `Reset` / 發行量。**認購認售同表,無 TWSE 的 type 枚舉問題**。
- TPEx OpenAPI 皆**只回最新一日**,無歷史 — EOD 快照模式下可接受(每日抓存即累積)。
- **TLS 風險**:TPEx 憑證缺 SKI,py3.13 拒驗(實測);backend py3.12 待驗,炸則 `truststore`,**禁止 `verify=False`**。(與券差 spec 共用同一風險條目)

---

## 3. 計算欄位(backend 統一計算,前端只呈現)

以 S = 標的收盤價、K = 履約價、P = 權證價格、R = 行使比例、T = 剩餘年化時間、r = 無風險利率(常數 1.6%,service 內具名常數):

| 欄位 | 公式 | 備註 |
|---|---|---|
| 價內外 moneyness | call: (S−K)/K;put: (K−S)/K | 正 = 價內 |
| 剩餘天數 | 最後交易日 − as_of(日曆日) | BS 用 T = days/365 |
| 權證定價基準 P | 有成交用收盤;零成交用 mid = (bid+ask)/2;無買賣價 → 計算欄位全 null | null 不擋列出 |
| 隱含波動率 IV | BS 反解(Brent),per-share premium = P / R | 解不出(深價外/貼水)→ null |
| Delta | BS delta(用反解出的 IV) | IV null 則 null |
| 實質槓桿 | Delta × S / P × R | |
| 價差比 | (ask − bid) / bid | bid = 0 → null |
| **差槓比** | 價差比 / 實質槓桿 | **越低越好,預設排序鍵(asc)** |

- 歐式/美式一律以歐式 BS 近似(台灣權證幾乎全歐式;美式誤差可接受,spec 註記)。
- 不做除息調整、不做重設型(Reset=Y)特殊處理:v1 直接列出但 IV/greeks 標 null + 備註 icon。

---

## 4. 成功條件(SC,可驗收)

1. **SC-1** equity mode 出現「權證」tab,沿用當前標的;切標的即刷新。
2. **SC-2** 表格列出該標的全部權證(上市 + 上櫃合併),欄位:代號、名稱、類型(認購/認售)、市場、履約價、價內外 %、剩餘天數、行使比例、收盤/mid 價、買賣價量、IV、實質槓桿、價差比、**差槓比**;預設差槓比升序。
3. **SC-3** 篩選器:認購/認售 toggle、剩餘天數下限、價內外範圍、「委買量 > 0」開關(排壁紙);全部 client-side filter。
4. **SC-4** 差槓比與價差比欄依門檻標色(常數;差槓比 ≤ 0.1 良 / ≥ 0.5 差之類,實作期校準);**不寫方向性文案**。
5. **SC-5** 點單一權證 row 展開:FinMind 分點買賣超 T+1(on-demand 單發,不 fan-out 全表);顯示「資料日 = T-1」標註。
6. **SC-6** 標的無權證 → 顯示「此標的無掛牌權證」空狀態(繁中)。
7. **SC-7** `no_trading_day` / `refresh=true` 慣例沿用;快照 cache 以「日期」為 key + `_cache_version`。
8. **SC-8** 完成 gate:`pytest -q` + `ruff check .` + `npm test` + `npm run build` + chrome-devtools 截圖入 `docs/specs/warrant-selector/screenshots/`。

---

## 5. 設計

### 5.1 Backend — 每日全市場快照 + per-underlying filter

- 新 service `services/warrants.py`(沿 `finmind.py` 樣板:singleton、atomic cache、inflight dedup、具體 catch)。
- `build_snapshot(date)`:抓 TWSE 行情(認購 + 認售 type 各一發)+ t187ap37_L + TPEx 三發 → normalize(民國/西元日期、typo 欄名、`---`/空字串、千分位)→ join 行情×條款 → 算 §3 欄位 → 存單一日快照 JSON(內含 per-underlying index:`{underlying_id: [warrant, ...]}`)。
- 條款端點(t187ap37_L / tpex_warrant_issue)只有「最新」版本 → 快照日 = 抓取日;**v1 endpoint 不收 date 參數**,一律回最近交易日快照 + `as_of_date`(歷史回放在 §6 out of scope)。
- Route:新檔 `routes/warrants.py`(對齊「每 router 一檔」):
  - `GET /api/warrants/{stock_id}?refresh=bool` → `{ as_of_date, no_trading_day?, underlying: {stock_id, name, close}, warrants: [...] }`
  - `GET /api/warrants/{warrant_id}/brokers?refresh=bool` → FinMind 分點(T+1),error contract 沿用(與上一條路徑段數不同,FastAPI 無歧義)。
- BS 計算純函式獨立 module(`services/bs.py` 或 warrants 內私有),pytest 直接鎖數值(對照教科書案例)。

### 5.2 Frontend

- equity mode 新 tab(`hidden` attribute 慣例),`App.tsx` 傳當前 symbol。
- hook `useWarrants(stockId)` → `{ data, loading, error, refresh, noTradingDay }`;分點展開另一 hook `useWarrantBrokers(warrantId)` lazy。
- 元件 `WarrantSelector`(表格 + 篩選列)+ 純函式 filter/sort 抽 `lib/warrant-utils.ts` 單測。
- 重元件依慣例 `React.lazy()`。UI 繁中、semantic tokens;認購/認售不可用紅綠當類型色(紅綠保留給多空語意,類型用 accent/outline badge)。
- **開工前先呼叫 frontend-design + bencium-controlled-ux-designer**(memory: [[feedback_frontend_design_skills]])。

### 5.3 測試 / e2e

- Backend:normalize 髒點各一測(民國/西元、typo 欄名、`---`、HTML 漲跌欄、leading-space key)、join 完整性(TPEx 行情×mainboard×issue)、BS 數值鎖、IV 反解邊界(深價外解不出 → null)、per-underlying index。fixture 取本次 probe 真實 payload 縮樣。
- Frontend:hook + filter/sort 純函式 + 空狀態 + 標色。
- e2e:equity mode UI 新增 → 依 `e2e-conventions` 判準表歸 E# spec,**/feat Phase 0 必讀定案**;需 fake 快照 fixture。

### 5.4 分點籌碼(明確降級設計)

全表不含分點欄(避免 FinMind fan-out 燒配額:一個標的可能 300+ 權證);只在展開單一權證時抓。快取 per warrant_id + date。

---

## 6. Out of scope(v1 不做)

- 牛熊證/展延型(TPEx wcb/wxy 端點、TWSE 牛熊 type)— 結構不同(Cap/Floor/強制回收)
- 全市場條件掃描(未鎖標的)
- 盤中即時(見 §8)
- IV 歷史曲線 / 權證回測
- 歷史日期快照回放(條款端點只有最新)

## 7. 風險與 spike(實作期 Phase 0 處理)

| # | 項目 | 處理 |
|---|---|---|
| S-1 | TWSE MI_INDEX 認售權證 type 代碼 | Phase 0 枚舉(0999P 等候選),驗 rows 標題 |
| S-2 | t187ap37_L「每千單位權證」→ 行使比例換算 | 抽同標的上市/上櫃權證比對 ExerciseRatio 交叉驗證 |
| S-3 | TPEx TLS(缺 SKI) | backend py3.12 venv 實測;炸則 truststore |
| S-4 | t187ap37_L 40k rows 是否含已到期 | 以最後交易日過濾 + 與 MI_INDEX 代號交集驗證 |
| S-5 | TWSE OpenAPI / RWD 限流 | 每日各一發,低風險;加 UA + backoff |

## 8. 盤中升級路徑(預留,不實作)

- 報價來源抽象為「quote provider」層:v1 唯一實作 = EOD 快照。
- 盤中候選 = TWSE MIS(`mis.twse.com.tw` getStockInfo,支援權證五檔)+ TPEx MIS 對等;非官方、單 IP 限流嚴格,但情境鎖單一標的(幾十~幾百檔)小批量輪詢可行。升級時 spike 實測限流 + 覆蓋率,另開 spec。
- FinMind 這條路已判死(§2.1),除非官方新增權證 snapshot(memory 會追蹤)。
