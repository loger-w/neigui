# Brainstorm — 分點反查:特定分點當日買賣超股票(broker-daily-flows)

日期:2026-07-21(Phase 0)
來源:user prompt(/auto + /feat)+ AskUserQuestion 拍板(2026-07-20):
- **功能範圍 = A 案**:選定分點 → 當日買超 top N / 賣超 top N 股票兩張排行;點任一股票跳轉 equity「籌碼總覽」重用既有「該股主力分點」視圖(=「買賣超分點」的落點)。
- **UI 掛載點 = equity mode 新 tab**(與 overview / bubble / warrants / warrant-flow 並列,`hidden` attribute + lazy + active gate,樣板 = WarrantFlowPanel)。

## 資料可行性(probe 實證,2026-07-20)

| 事實 | 證據 |
|---|---|
| `GET /api/v4/taiwan_stock_trading_daily_report?securities_trader_id=X&date=D`(專用 path,非 `/data`)一發回該分點單日全部成交 | probe HTTP 200:9600(富邦總部)@2026-07-17 → 13,079 rows / 1,136 檔 |
| Row schema = price-level:`{securities_trader, securities_trader_id, stock_id, date, price, buy, sell}`(buy/sell 單位 = 股) | probe first/last row |
| `/data` 入口與 SecIdAgg 變體皆強制 `data_id`(股票),**不支援** trader-only | probe 400 ×3 |
| 分點目錄 `TaiwanSecuritiesTraderInfo`(dataset,無 data_id)一發 1,011 筆 `{securities_trader_id, securities_trader, date, address, phone}` | probe HTTP 200 |
| 資料更新時點 = 週一至五 21:00(T+0 晚間上料)→「今天」在 21:00 前查無資料是常態 | FinMind 官方文件 |
| 全市場分點 dump 需 SponsorPro(user 為 Sponsor)→ 全市場分點排行不可行 | FinMind 官方文件 |

## 成功條件(SC gate:編號 + 驗證方式 + 單位/量法)

- **SC-1 後端反查 endpoint**:`GET /api/broker/daily-flows?broker_id=<id>&date=<YYYY-MM-DD>[&refresh=true]` 回 `{broker_id, broker_name, requested_date, as_of_date, no_trading_day, stock_count, buy_top, sell_top}`;`buy_top` / `sell_top` 每項 `{stock_id, stock_name, buy_lots, sell_lots, net_lots, net_amount}`(lots = 張,股數 // 1000 截斷,對齊 `_parse_broker_history` 慣例;net_amount = Σ(price×股數) 買減賣,單位=元,int round)。排序:buy_top 依 net_amount 降冪取前 30、sell_top 依 net_amount 升冪取前 30 `[auto-default: 以金額排序、N=30 | reason: 跨價位股票可比,對齊分點追蹤網站慣例;張數並列顯示]`。stock_name 由既有 symbols 載入 join,join 不到回空字串。
  驗證:`python -m pytest -q tests/test_broker_flows.py`(mock rows → 聚合/排序/截斷正確)+ `tests_e2e/test_api_broker.py` contract test(shape + `detail.error`)。驗證窗口:anytime(FAKE fixture)。
- **SC-2 無資料回退**:requested date 無 rows(週末 / 21:00 前未上料)→ 以 trading_calendar 候選日往回補抓 `[amendment 2026-07-21: design review R3 改為 warrant_flow weekday-loop 同構(自適應含 T+0,消除 TaiwanFuturesDaily 上料時序假設);行為對 SC 不變 — 仍是「往回 ≤2 個交易日」]`,**最多再退 2 個交易日**(每步 1 request;皆空 → 503 `{"error": "broker_flows_unavailable"}`);回退時 `as_of_date < requested_date` 且 `no_trading_day: true`(對齊既有跨檔契約);**空結果不落 cache**(晚間上料自動吃到,finmind-conventions 候選日自適應)。
  驗證:pytest(mock 首日空 → 次日有料 → as_of_date/no_trading_day 正確;全空 → 503;mock 計數 assert 請求數 ≤ 3)。
- **SC-3 分點目錄搜尋**:`GET /api/broker/traders?search=<q>` 由 `TaiwanSecuritiesTraderInfo` 建目錄(JSON cache,TTL 24h `[auto-default: 24h | reason: 目錄變動極低頻,1 request/day 配額可忽略]`),id 前綴或名稱 substring 匹配,回 `[{broker_id, broker_name}]`(上限 50 筆)。
  驗證:pytest(搜尋匹配 + cache 命中不重抓)+ contract test。
- **SC-4 前端新 tab「分點反查」**:equity mode 第五個 tab;內含分點搜尋框(目錄 autocomplete)+ 選定後渲染買超/賣超兩張排行表(繁中;買超表 = bull 紅、賣超表 = bear 綠,台股慣例);hook 走 TanStack Query `{ data, loading, error, refresh }` shape + `signal` 直傳;active gate:未切到 tab 不發請求;不進全域 refresh(同 WarrantFlowPanel)。
  驗證:`npm test`(vitest RTL:渲染 + 排序顯示 + 空狀態)+ e2e E#。
- **SC-5 跳轉串接**:點排行任一股票 → `setTab("overview")` + `handlePick(stock_id, name)` + 預選該分點(`selectedBrokerIds = {broker_id}`)→ 籌碼總覽顯示該股 + 該分點 K 線 overlay(重用 useBrokerHistory 既有能力)。
  驗證:vitest(callback 傳遞)+ e2e E#(點擊後 URL/tab/面板斷言)。
- **SC-6 回退標註 UI**:`no_trading_day: true` 時 tab 內顯示「<requested> 無資料,顯示 <as_of_date>」繁中標註(hook 暴露 `noTradingDay` boolean,對齊跨檔契約)。
  驗證:vitest(flag → 標註出現/消失)。
- **SC-7 E2E 覆蓋**:`e2e/specs/equity.spec.ts` 新 E#(切 tab → FAKE fixture 排行資料級 assertion(非 visibility-only)→ 點擊跳轉 overview 斷言)+ `backend/tests_e2e/test_api_broker.py`;FAKE fixtures 基準日對齊 2026-06-26(Fri),與 fetch method **同 commit** 加 MANIFEST 條目(dataset gate 順序耦合)。special-path 反查 fixture 的 FAKE 層須複製上游查詢語意(`securities_trader_id` + `date` 過濾)。
  驗證:`cd e2e && npm test` 綠(新 E# 含在內)。
- **SC-8 配額上限**:單次反查 ≤ 3 FinMind requests(首日 + 最多 2 步回退);同 (broker, as_of_date) 結果落 JSON cache(當日 TTL 30 min、過去日永久,對齊 brokers_window 慣例);同 key 並發走 `_run_once` inflight dedup。
  驗證:pytest mock 計數(cache 命中 0 request;並發 dedup 1 request)。

## Edge cases(≥3)

1. **單向分點**:當日只買無賣(或反之)→ sell_top 空陣列,UI 顯示「無賣超」空狀態(不是 error)。
2. **大分點截斷**:9600 一天 1,136 檔 → 排行只取 30,`stock_count` 顯示總檔數讓 user 知道有截斷。
3. **無效 / 停業分點 id**:FinMind 對無效 id 回 0 rows(無法與「未上料」區分)→ 直接查:目錄內找不到該 id → 404 `{"error": "broker_not_found"}`;目錄內但回退後仍全空 → 503 `broker_flows_unavailable` `[auto-default | reason: 目錄是權威名單,可前置擋掉多數無效 id]`。
4. **非普通股代號**(債券 ETF「00400A」、權證等會出現在報表)→ 全部保留;stock_name join 不到顯示代號本身。
5. **future date**:`date > clock.today()` → clamp 成 today 再走候選日邏輯(不 400)`[auto-default | reason: DateField 已擋,後端寬容處理]`。

## Out of scope

- 同券商全分點彙總(fan-out 配額高;user 已拍板不做)
- 全市場分點買賣超排行(需 SponsorPro dump)
- 多日 / 區間分點買賣超(只做單日;區間 = 既有 per-stock broker history 職責)
- 權證分點反查(dataset 不支援 broker reverse,memory reference_finmind_warrant_dataset)
- 分點目錄的地址/電話展示(只用 id + name)

## 執行約束(跨輪指示 + 慣例)

- 前端 UI 實作(Phase 3)開工前呼叫 `frontend-design` + `bencium-controlled-ux-designer`(user 2026-07-07 兩度指示,memory feedback_frontend_design_skills)。
- 新 service module 呼叫 FinMind 走 per-module `get_finmind()` wrapper(finmind-conventions)。
- 新 code 日期一律 `clock.today()`,禁 `date.today()`(e2e-conventions clock 凍結)。
- FastAPI error contract:`detail={"error": "<code>"}`;502=upstream 故障 / 503=未就緒 / 400=用戶錯 / 404=找不到。
- 三大法人鍵名慣例與本 feature 無交集;Bull=紅/Bear=綠必守。
- Workflow/agent dispatch 預設 effort low(memory feedback_subagent_effort_low)。
- E2E 歸屬結論(判準表):equity mode 新 tab → `equity.spec.ts` E#;新 endpoint → `tests_e2e/test_api_broker.py`;新 FinMind dataset → FAKE fixture + MANIFEST 同 commit;fixture 改動後清 `e2e/.cache`。
- changelog:新 panel = user 可感新功能 → MINOR bump + VersionEntry(寫 entry 前讀 changelog-conventions)。

## S/M/L 分流

**L**(跨前後端、預估 >15 檔:backend service/route/fetch + 3 test 檔 + fixtures/MANIFEST + frontend hook/component/App/api/types + 2-3 test 檔 + e2e spec)。Phase 1/2 各 max 3 輪 review。
`goal_efficiency_mode = true`(/auto + >15 檔,wave batch commit,commit body 列 SC-N)`[auto-default per auto.md 適用條件]`。
