# 權證買賣超分點 — 標的權證流向 tab(equity mode 新 tab)

**Date**: 2026-07-11
**Type**: brainstorm 產出 spec(實作走 `/feat`,本檔為 Phase 0 pre-reading)
**Goal**: 盤後檢視「該標的最近可得日被買/賣多少權證、哪幾檔、哪些分點、多少金額」,淨買超 / 淨賣超各前 15 大分點,點分點可展開其進出的權證明細。
**SemVer**: MINOR(使用者可感的新功能)
**依賴**: `warrant-selector`(`docs/specs/warrant-selector/spec.md`)的條款快照 service 提供「權證 → 標的」對映;**實作順序排在其後**。
**相關 memory**: [[reference_finmind_warrant_dataset]]

---

## 1. 需求(user 拍板 2026-07-11)

| 決策點 | 結論 |
|---|---|
| 檢視時機 | **盤後**(如既有籌碼視角),非盤中即時 |
| 資料延遲 | 接受權證分點 T+1 公布 lag;UI 明示資料日,顯示「最近可得日」 |
| 頁面歸屬 | equity mode 新 tab「權證分點」(籌碼總攬 / 泡泡圖右側) |
| top15 口徑 | **淨買超金額前 15、淨賣超金額前 15** 兩欄(對齊主力券商面板閱讀習慣) |
| 載入時機 | **切到 tab 才載入**(Claude 取捨獲授權:tab 點擊即意圖,fan-out 只花在真的要看的股票;per stock+date cache) |

---

## 2. 資料源(2026-07-11 全部實測)

- **FinMind `TaiwanStockWarrantTradingDailyReport`**(分點,唯一來源):
  - 欄位:`securities_trader`(分點名)/ `securities_trader_id` / `price` / `buy` / `sell`(股數)/ `stock_id` / `date`。
  - 限制:`data_id` 必填(全市場一發不給)、`end_date` 必須留空(單日單發)、分點逆查(`data_id=` 分點代號)不支援(實測 0 rows)。
  - 量級:熱門權證單日 ~290 rows(03732B 實測)。
- **FinMind `TaiwanStockPrice` date-only 全市場單日一發可得**(07-09 實測 44,047 rows 含全部權證)→ 「篩該標的當日有量權證」只花 1 request;此 cache 可與其他功能共用(全市場層級,非 per-stock)。
- **權證 → 標的對映**:warrant-selector 的條款快照(TWSE t187ap37_L + TPEx tpex_warrant_issue)。
- **Lag 事實**:最新可得通常 = 前一交易日;當日資料當晚是否可得未驗 — **spike L-1**。

配額注意(`finmind-conventions`):fan-out 只打「當日有成交」的權證,依成交金額排序取前 150 檔(cap 常數),超出 → `truncated: true`。熱門股首次查詢約數十~150 requests(6000/hr 配額的 ≤ 2.5%),之後命中 cache 零成本。

---

## 3. 計算 / 聚合口徑

- 金額 = Σ(`price` × 股數);每分點每權證:買金額、賣金額、淨額 = 買 − 賣。
- **⚠ 2026-07-14 real-env 發現(RE-1)**:分點報表為全分點覆蓋 → 守恆恆等式:**單一權證跨全分點淨額 ≡ 0**(2330 真資料 200 檔全部精確 0.0)、summary 每 kind 買金額 == 賣金額。分點層 net(top15 兩欄,本 feature 核心)不受影響、有效。
- **2026-07-18 口徑變更(mod/warrant-flow-external-net,user 拍板;決策與 probe 全文 `.claude/mod/warrant-flow-external-net/change-spec.md`)**:per-warrant 欄與 summary 改「外部淨額」口徑 — `external_net = −(發行商造市總公司席位 net)` = 散戶/主力/他券商合計淨買賣。HO 席位對映 = 權證名抽發行商 brand(underlying_name 前綴容錯)→ 12 家 alias 白名單 → seat 精確名;無法對映(報表空 / brand 不明 / 無 HO row)→ `null`,UI「—」,不冒充 0。probe 實證(2330 top30):27/27 單一命中、HO 量占比中位 49.2%。
- 三層聚合(backend 一次算完,前端只呈現):
  1. **summary**:認購 / 認售各自的 `trade_value`(有量權證成交額合計,**未受 cap 限制**)+ `external_net`(Σ analyzed 內非 null;全 null → null)
  2. **per-branch**(跨該標的全部有量權證合計):買金額、賣金額、淨額 → 淨買超 top 15、淨賣超 top 15;每分點附「其進出的權證明細」(展開用);HO 席位照常入排行
  3. **per-warrant**:代號、名稱、類型(認購/認售)、成交金額、外部淨額(null =「—」)

---

## 4. 成功條件(SC,可驗收)

1. **SC-1** equity mode 新 tab「權證分點」(總覽 / 泡泡圖右側);**切到 tab 才發請求**,首次載入顯示進度文案(繁中,如「彙整分點資料中…」)。
2. **SC-2** 頂部 summary:資料日 badge(如「資料日 07-09」)+ 認購/認售各「成交額 + 外部淨額」與定義說明行(2026-07-18 口徑變更,原買/賣四數字恆等退化)。
3. **SC-3** 「買超 15 大 / 賣超 15 大」並排兩欄:分點名 + 依金額比例的水平 bar + 金額;**點分點展開其買賣的權證清單**(權證代號/名稱/買賣金額)。窄版面兩欄疊直(`useContainerSize` 慣例)。
4. **SC-4** 權證明細表:成交金額降序;欄位 = 代號、名稱、類型、成交金額、外部淨額(null 顯示「—」)。
5. **SC-5** 色彩紀律:淨買超 = bull(紅)/ 淨賣超 = bear(綠)(台股慣例);外部淨額同紀律、null 中性(ink-dim);認購/認售類型 badge 不用紅綠;不寫方向性文案;data-testid + 正向 assertion 鎖色彩 binding。
6. **SC-6** `truncated` 時 UI 註記「僅統計成交金額前 150 檔權證」。
7. **SC-7** 空狀態(繁中):標的無掛牌權證 / 該日全部權證零成交,分開文案。
8. **SC-8** `no_trading_day` / `refresh=true` / cache(key = stock_id + date,`_cache_version`)慣例沿用;date 預設最近可得日(往前回退)。
9. **SC-9** 完成 gate:`pytest -q` + `ruff check .` + `npm test` + `npm run build` + chrome-devtools 截圖入 `docs/specs/warrant-broker-flow/screenshots/`。

---

## 5. 設計

### 5.1 Backend

- Route 掛 `routes/warrants.py`(資料本質是權證,與 warrant-selector 同 router):
  - `GET /api/warrants/{stock_id}/flow?date=YYYY-MM-DD&refresh=bool`
  - 回 `{ as_of_date, no_trading_day?, truncated?, summary: {...}, top_buy_branches: [...], top_sell_branches: [...], warrants: [...] }`
- `services/warrants.py` 加 `build_flow(stock_id, date)`:
  1. 條款快照取該標的權證清單(依賴 warrant-selector)
  2. `TaiwanStockPrice` 全市場單日(全域 cache)→ 交集出有量權證,按成交金額取前 150
  3. FinMind 分點報表逐檔(過 `TokenBucket.acquire_async()`;`_run_once` inflight dedup;per warrant+date cache)
  4. §3 聚合 → 存 per (stock_id, date) cache
- FinMind 呼叫走 per-module `get_finmind()` wrapper(`finmind-conventions`,test 才能獨立 patch)。
- date 無資料 → 往前找最近可得日 + `no_trading_day` 慣例;error contract `{detail:{error}}`。

### 5.2 Frontend

- hook `useWarrantFlow(stockId)` → `{ data, loading, error, refresh, noTradingDay }`;TanStack `useQuery` + `enabled: tab === "warrant-flow"`(切 tab 才抓),signal 直傳。
- 元件 `WarrantFlowPanel`(summary 條 + 兩欄分點 bar 列表 + 權證明細表),`React.lazy()`;聚合渲染的純函式(bar 比例、金額格式)抽 `lib/` 單測。
- tab 切換沿 `hidden` attribute 慣例;UI 繁中、semantic tokens、`cn()`。
- **開工前先呼叫 frontend-design + bencium-controlled-ux-designer**(memory: [[feedback_frontend_design_skills]])。

### 5.3 測試 / e2e

- Backend:聚合數值鎖(fixture 用 03732B 真實 payload 縮樣:買賣金額、淨額、top15 排序、認購認售 summary)、cap + `truncated`、有量權證交集、date 回退、cache 命中。
- Frontend:hook(enabled 條件)+ 純函式 + 空狀態兩文案 + 色彩 binding assertion。
- e2e:equity mode UI 新增 → 依 `e2e-conventions` 判準表歸 E# spec,**/feat Phase 0 必讀定案**;需 fake flow payload fixture。

---

## 6. Out of scope(v1 不做)

- 盤中即時流向(無資料源,分點本質盤後公布)
- 分點 → 權證逆查(FinMind 不支援,實測判死)
- 跨日累計 / 趨勢圖(v1 單日;寫入 next-time)
- 與主力券商面板(普通股分點)的交叉高亮(next-time)

## 7. 風險與 spike(實作期 Phase 0 處理)

| # | 項目 | 處理 | 實測結果(2026-07-14 /feat Phase 0 spike) |
|---|---|---|---|
| L-1 | 當日權證分點「當晚」何時可得(lag 精確時點) | 擇一交易日晚間實測 FinMind;結果寫回本節,決定「最近可得日」回退文案 | T-1 資料 T+1 上午 10:35 已可得;「當晚」時點未直測(spike 跑在上午)。**設計改自適應**:候選日從 today 起,fan-out 前用成交金額最大權證做 1-request 可得性 probe,0 rows 回退前一日、空日不寫 cache — 不再依賴精確時點 |
| L-2 | fan-out cap 150 的覆蓋率校準 | 用 2330 級熱門股實測「有量權證檔數」分布與金額覆蓋率(前 150 檔應涵蓋 >95% 金額),必要時調常數 | 07-13 全市場 dump:2330 有量 477 檔,cap 150 = 91.79% **不達標**;cap 200 = 95.69%(最壞標的),其餘 top-10 標的 ≥ 99.5% → **cap 校準 150 → 200**(200 req = 3.3% 時配額;全市場有量 >200 檔的標的僅 7 個) |
| L-3 | 條款快照未含已下市權證 → 當日有量但對映缺漏 | 交集時記 log + 缺漏數入 payload(`unmapped_count`),UI 不擋 | 07-13 全市場有量 13,528 檔中 118 檔 unmapped(0.87%),樣本全為牛熊證/展延型(快照 universe 結構性排除)非下市;unmapped 無法歸屬標的 → `unmapped_count` 取**全市場口徑**,牛熊證納入寫 next-time |
