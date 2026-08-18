# Bug: 籌碼總覽左側 K 線圖的「選取分點買賣超」柱狀圖,當天資料要隔天才出現

分流判定:已成形 bug 回報(症狀具體、路徑明確)→ 直接重現,無方向性抉擇。
規模:S 級(單檔 `backend/services/finmind.py` + 測試),spec review 0 輪。

## 1. 重現(loop-first)

### 症狀鏈

- 右側 ChipBrokersPanel(前 15 大買賣超)吃 `summary` / `brokers_window` →
  FinMind `taiwan_stock_trading_daily_report`(當天 T+0 有資料)。
- 左側 ChipKlineChart 下方「選取分點淨買賣」柱狀圖吃 `brokerSeries`(`useBrokerHistory`
  → `/api/chip/{symbol}/broker_history`)→ backend `fetch_broker_history` →
  FinMind `taiwan_stock_trading_daily_report_secid_agg`(逐分點 90 日 range)。
  圖表以 candle 日期查 `brokerDateNet`,查不到 → 0 高度柱(`ChipKlineChart.tsx:315-327`)。

### 能變紅的指令(2026-08-18 17:31,台股收盤後)

`python <scratchpad>/probe_secid.py 2330`(直打 FinMind,同 backend 用的兩個端點):

```
daily_report today rows: 4920 msg: success
top brokers today: [('1440', 2143373 shares), ('1360', -1796060), ('9268', -1055391)]
secid_agg 1440: rows=62 last_dates=['2026-08-13','2026-08-14','2026-08-17'] today_present=False
secid_agg 1360: rows=62 last_dates=[... '2026-08-17'] today_present=False
secid_agg 9268: rows=62 last_dates=[... '2026-08-17'] today_present=False
```

→ 同一時刻、同一股票、同一分點:`daily_report` 已有 2026-08-18 全部逐筆(右側面板顯示得出來),
`secid_agg`(end_date=today)最後一天停在 2026-08-17 → 左側柱狀圖當天為 0。
紅在 user 描述的症狀上(當天不顯示、隔天才有)。

### 排除項

- 不是前端 cache / 15 分 TTL 問題:`_do_fetch_broker_history` 每次都以 `end=clock.today()`
  打 secid_agg,上游本身就沒回當天。
- 不是 `_has_fresh_subset` 的 `last_date` 判斷:`last_date` 寫的是 `end`(today),
  與資料是否含當天無關,只影響 TTL。

## 2. Root cause

**FinMind `taiwan_stock_trading_daily_report_secid_agg`(逐分點聚合表)相對
`taiwan_stock_trading_daily_report`(逐筆表)至少晚一天發布**;`broker_history` 只吃
secid_agg,沒有用當天已可得的 daily_report 補最新一天,所以左圖當天缺柱、右側面板卻有。

假說驗證(一次一個):
- H1「secid_agg 上游缺當天」→ probe 直接證實(上表)。
- H2「backend cache / TTL 吞掉當天」→ 讀 `_do_fetch_broker_history` 排除(每次 end=today 重抓,
  且 probe 繞過 backend 也缺)。

## 3. 修法(最小改動)

`_do_fetch_broker_history`:secid_agg 抓完後,對每個 requested id,若其 series 沒有
`clock.today()` 那天,從 `fetch_chip_summary(symbol, today)`(既有 per-day cache,前端右側面板
早已抓過 → 通常零額外 FinMind 請求;`_parse_top_brokers` 回傳**全部**分點非只前 15)取該
broker 當天 `buy/sell/net`(單位張,與 secid_agg parse 一致)補上一列。summary 沒有該分點
(當天沒交易 / 尚未發布 / 非交易日)→ 不補,行為與 secid_agg 相同(只列有交易的日子)。

### SC

- SC-1:secid_agg 缺當天、summary 有該分點當天 → payload 該 id series 末尾為
  `{date: today, buy, sell, net}`(值取自 summary)。驗證:`tests/test_broker_history.py::
  test_fetch_broker_history_fills_today_from_daily_report_when_secid_agg_lags`。
- SC-2:secid_agg 已含當天 → 不重複、不覆寫。驗證:`..._does_not_fill_when_secid_agg_has_today`。
- SC-3:summary 無該分點(當天沒交易 / 非交易日)→ series 不變。驗證:
  `..._skips_fill_when_summary_lacks_broker`。
- SC-4:真實環境:2026-08-18 收盤後 `GET /api/chip/2330/broker_history?ids=1440&refresh=true`
  → `brokers.1440[-1].date == "2026-08-18"`,值與 `summary?date=2026-08-18` 的 1440 一致;
  頁面左圖當天柱出現。驗證窗口:secid_agg 尚未補齊當天的時段(當天 ~17:00 後至上游補齊前);
  窗口外降級:以 pytest 三案 + verification.md 記錄。

### Edge cases

1. 非交易日(週末):summary 當天空 → 不補,不 raise。
2. 當天尚未發布(盤中):summary top_brokers 空 → 不補;broker_history 15 分 TTL 過後重抓即補。
3. 分點當天有交易但 secid_agg 抓失敗(res 空、沿用舊 cache series)→ 仍走補列(對舊 series 補)。
4. secid_agg 稍後補齊當天 → 下次重抓整段覆寫,補列自然被上游值取代,無重複。

### 不能破壞的既有行為白名單

- secid_agg 逐 id 抓、`securities_trader_id` 必帶(test_safe_get_secid_agg_*)。
- partial cache 合併 / sticky brokers / days 分檔 / dedup / 全空且無 cache raise
  `secid_agg_unavailable`(既有 test_fetch_broker_history_* 全部)。
- payload shape `{symbol, fetched_at, last_date, brokers}` 不變。

### Out of scope

- 週末 / 假日時 secid_agg 缺「最後交易日」(非今天)的補列(未觀察到、需另 probe 上游發布時程)→ next-time。
- 前端不動。
