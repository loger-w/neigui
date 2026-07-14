---
name: market-pipeline
description: Market mode 資料管線慣例。動 market snapshot、EOD compute、breadth/McClellan、sector aggregation、universe filter、heatmap/leaderboard 任何一段時先讀。含 tick_snapshot 陷阱、per-day loop、cache key 共用、hot-path GIL 教訓。
---

# Market snapshot / EOD 管線慣例

## Snapshot universe(2026-06-29 market-monitor 沉澱)

- **`taiwan_stock_tick_snapshot` universe 包含「001 加權指數 / 002 不含金融指數」等 index rows**。Index 沒對到 TaiwanStockInfo,會佔據 amount 排行榜第 1。**Filter universe 必須走 `stock_id in primary_sector` 對映**(primary_sector 從 TaiwanStockInfo 推),指數天然排除;不要用 `len(stock_id)==4` 之類 pattern 過濾(會誤殺新格式)。Trigger:任何用 `taiwan_stock_tick_snapshot` 整盤 universe 的 endpoint。
- **`TaiwanStockInfo` 同時是 sector 來源也是 name 來源**:`industry_category` + `stock_name` 同 row。Build name_map 跟 sector_map 一起做,避免 frontend 看到「2330 2330」這種股號 fallback。Trigger:做整盤 snapshot 派生 endpoint。
- **TanStack Query refresh() 跟 polling 撞 race**:hook 同 queryKey polling 中,user 點 refresh 會被 in-flight queryFn dedup 吃掉,refresh 旗標等下一個 tick 才生效。修法:`refresh()` 內先 `queryClient.cancelQueries({queryKey})` 再 `refetch()`。Trigger:寫含 `refetchInterval` 又有 manual refresh 的 hook。
- **App.tsx mode 切換是 ternary 不是 hidden**:現為 4-way ternary(equity/options/market/borrow,2026-07-11 起),加新 mode 必須擴 ternary 鏈。若用 `<div hidden={mode !== "X"}>` 從末加,既有 ternary 的 else 分支會跟新 div 同時 mount,造成雙頁面同時抓資料(e2e N4 有 unmount 鎖)。**else 末端分支 = invalid localStorage mode 的 fallback 終點**(目前 = BorrowFeePage,mount 即 fetch)— 加新 mode 時 fallback 終點會跟著變,`App.test.tsx` invalid-mode 測試註解要同步。(§3「hidden > 條件 render」是 tab 層級;mode 層級用 ternary — 兩者不衝突。)Trigger:加第 N 個 mode 進 App.tsx。
- **Squarified treemap 公式**:`colW = sum / rect.h`(短邊配方向),不是 `colW = (sum * rect.h) / area`。單測務必包邊界 fit check(`tile.x + tile.w ≤ sector.x + sector.w`)。Trigger:`lib/heatmap-svg.tsx` 同類純算式或新增類似 treemap。

## Universe filter(2026-06-30 P1 沉澱)

- **`TaiwanStockDispositionSecuritiesPeriod` raw response 含 5-6 位衍生品 ID**:dataset 名雖叫 "Securities",真實 dump 中約 1/4 是權證 / TDR disposition ID,非純 4 位普通股。處置股清單**不能直接當 watch_list**,要**先過 `primary_sector` whitelist 再分桶**。Trigger:接 FinMind 任何「股票事件 / 警示 / 異常」dataset 時。
- **`classify_stock_id` 純結構規則 ≠ exhaustive issue type**:現規則 `00` prefix → ETF / 4 位純 digit 非 `00` → 普通股 / 其他 → warrant。**5 位 alpha KY 股 / 興櫃 6 位數合法普通股若未來納入會被誤歸 warrant**,擴 universe 必須 patch classifier。Trigger:擴 universe 規模 / 收 KY / 興櫃時。
- **`excluded_count` 語意 = candidates ∩ primary_sector 後分類,≠ 全 universe 真實 ETF/權證統計**。frontend banner 文案**禁止寫**「已排除 ETF N 檔」細分數字(會 drift 且誤導),改寫「已過濾 ETF / 權證 / 注意處置股」不細分。Trigger:寫 universe filter UX 文案 / Snapshot API 對外 doc。

## Breadth / McClellan(2026-07-01 P2 沉澱)

- **`TaiwanStockPrice` 不加 `data_id` 會忽略 `end_date` 只回 `start_date` 一天**——「不帶 data_id + date range 拉全 universe window」的假設是錯的。正確策略:`services.trading_calendar.get_trading_days` 拿 window 內 trading day,per-day loop 每天一 call(冷啟動成本高,靠 24h cache + `eod_results_*` result cache 攤還;現行數字見 hot-path 節)。Trigger:需 FinMind daily prices 全 universe window 時。
- **Multi-sid fallback 兩 sid 全 raise 不 pin 空 cache**:追蹤 `saw_response` 旗標;至少一 sid 200(即使 empty)→ cache empty 24h(FinMind 確實說「無資料」);全 raise → **re-raise 最後 exception 讓 caller 處理**,否則 transient 5xx 被鎖進 24h TTL。`_do_fetch_taiex` 是修正後樣板。Trigger:設計任何「多 sid / 多 endpoint fallback」的 fetcher。
- **Divergence-style signal detector 必須嚴格新高 + date-align**:`tx_last > max(tail[:-1])`(嚴格 `>` 排除當前 bar,`>=` 含當前 bar 恆真會誤觸發)+ 兩序列先 `by date inner-join` 再 slice window(避免兩軸各自 sparse 錯位)。`detect_divergence` 是樣板。Trigger:寫任何跨 signal 比對(divergence / correlation / lead-lag)偵測。

## Sector aggregation / cache key 共用(2026-07-01 P3 沉澱)

- **Pattern-delete cleanup 與 cache prefix 是同捆契約**(2026-07-14 warrant-broker-flow):`_cleanup_stale_window_files` 刪「非當前 window 的 `breadth_prices_*`」— 任何新 service 想借用該 prefix 存自己的 window/day 檔,會被 breadth 的下一次 cleanup 掃掉(反向亦然)。**要嘛連 cleanup 邏輯一起共用、要嘛換 prefix 自帶 retention**(warrant_flow 選後者:`flow_prices_*` + 自家 `_cleanup_flow_caches`)。Trigger:新 service 想共用既有 cache 檔名 prefix 時。
- **Cache key 共用 = 常數同值 + 公式同構,兩者都要 lock**:P3 `sector_aggregation._derive_window` 硬編 multiplier 匹配 P2 `market_breadth.compute_breadth` 的 pad 公式,同 `(end_date, lookback)` 產同一 `breadth_prices_<start>_<end>` key 才能共用 cache。**單獨 lock 常數值不夠**——必須 spy on `_fetch_daily_prices_window`,分跑兩個 orchestrator assert 呼叫的 `(start, end)` 完全相同(T36 樣板)。Trigger:任何新 service 想共用既有 prices cache 減冷啟動時。
- **Global `today_date = max date across all prices`** vs per-stock last-known:global 對齊「as of a specific trading day」語意,個股該日無 row → drops from denominator,pct 上偏(已顯性文件化的 trade-off)。Trigger:sector-level 聚合 metric 遇「哪個日期算今日」問題。
- **None-safe sort key 定式**:排 `field: float | None` 用 `sorted(key=lambda r: (r[field] is None, -(r[field] if r[field] is not None else 0.0), r[tie_break]))`。**不要** `sorted(reverse=True)`(None 比 float 會 TypeError)。Trigger:aggregation 排序含 None 值時。
- **Per-day loop + shared cache 冷啟動一次即可**:多個 consumer 同 `(start, end)` 呼叫 `_fetch_daily_prices_window`,`_run_once` inflight dedup + 24h disk cache 保證至多 1 個實跑 fetch loop。Trigger:新 backend 服務需要全 universe daily window 時。
- **獨立 try/except > gather return_exceptions**,兩個場景:(1) 兩 delegate 語意獨立(A ok 不代表 B ok);(2) test 覆蓋容易(mock 一個 raise 另一個 ok 驗 partial 降級)。Trigger:多個 EOD compute 掛 hot path snapshot payload 時。
- **Threshold 嚴格 `>` `<` 的邊界要單獨測**:`> 1.5 → hot / < 0.7 → cold` 必須單獨測 `1.5 exactly → None`、`0.7 exactly → None` 才能 lock 契約(只測 2.0/0.5 過不了 `>=` 誤改)。Trigger:寫任何 threshold 分類函式。

## Amount share / extract 函式(2026-07-02 P4 沉澱)

- **Extract 函式餵除法 aggregation 前要 clamp domain-impossible 值**:負 Trading_money 直通會打破「sector_today>0 ⟹ today_total>0」不變量 → ZeroDivisionError 穿透 httpx-only catch → 整 snapshot 500。負 turnover 視同 corrupt → 0.0。Trigger:寫任何新 extract/parse 函式,其產出進入除法或比值 aggregation 時。
- **共用 cache_key 含日期 ⟹ 每日首請求必冷**:`breadth_prices_<start>_<end>` 的 end = 當日,日期翻頁後 key 變 → 當日第一個 snapshot request 付冷啟動。**別把當日首請求的等待當 regression 修**。現行行為:warm <1s(`eod_results_*` result cache)/ refresh 不進 EOD / 冷啟動期間其他 endpoint 不被卡。Trigger:real-env 驗證 snapshot 覺得「怎麼突然變慢」時。

## Hot-path(2026-07-02 /perf 沉澱)

- **`json.load`/`json.dump` 是單一 C call,整份文件 parse/serialize 持 GIL 不放 — `asyncio.to_thread` 救不了**(1.5GB 檔實測 event loop 凍 6.35s)。**sleep-mock 單元測試測不到**(`time.sleep` 釋放 GIL → 假綠),必須 real-env 探針。解法 = chunked JSONL(meta 行 + 每 100k rows 一行),stall 上界縮到單 chunk ~100-150ms。`market_breadth._write_prices_cache/_read_prices_cache` 是樣板。Trigger:任何 >100MB JSON cache 進 async 服務時。
- **`asyncio.sleep(0)` 不會讓等待中的 timer/IO callback 先跑**(sleep(0) 把本 task 重排 ready queue 前面)。插 yield 打散長 sync 段要用 `sleep(0.005)` 之類真掛起。Trigger:async orchestrator 內連續跑多段純 Python 重計算時。
- **新 EOD compute 一律掛進 `_fetch_eod_results`,不要 inline await 進 `_do_fetch_market_snapshot`**:掛對位置才拿到 (end_date, universe digest) result cache + shared prices 注入 + refresh 隔離(refresh=true 只 bust intraday,不進 EOD)。Trigger:market-monitor P5+ 加新 EOD 指標時。
