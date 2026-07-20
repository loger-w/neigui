---
name: market-pipeline
description: Market mode 資料管線慣例。動 market snapshot、今日三卡(index_strength / cap_tiers / sector_rotation)、IndustryChain、universe filter、heatmap/leaderboard 任何一段時先讀。含 tick_snapshot 陷阱、cache key 共用、hot-path GIL 教訓。
---

# Market snapshot 管線慣例

> 2026-07-20 market-today 改版:EOD 歷史窗管線(breadth/McClellan、MA20 參與度、20 日量能/佔比、`_fetch_daily_prices_window`、`_fetch_eod_results` 背景 task)整組退役 — market 頁全部改吃 tick snapshot 當日資料 + `TaiwanStockIndustryChain` 靜態對映(`services/market_today.py` 純函式層 + `services/industry_chain.py`)。本檔已汰除死錨條目;仍通用的教訓保留於下。

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

## 今日三卡 / IndustryChain(2026-07-20 market-today 沉澱)

- **`services/market_today.py` = 純函式層,零 IO**:index_strength / cap_tiers / sector_rotation / sector_members 全部吃 caller 組好的輸入(universe rows / index_rows / mv_map / type_map / chain / name_map),手算 fixture 直測不需 mock。新指標照這個分層加,不要把 IO 混進 compute。Trigger:market 頁加新當日指標時。
- **001/101 index rows 在 universe filter 之前抽**:whitelist filter 天然剔除 index rows(上節),index_strength 需要的 001(加權)/ 101(櫃買)必須在 filter 前從 raw snapshot 抽出獨立傳入;`index_prev_close = close − change_price`。Trigger:需要指數即時值的任何 endpoint。
- **單位契約:`change_rate` 一律百分比數值**(−2.11 = −2.11%,upstream 透傳);貢獻點數公式內轉小數(`/100`)。真實 API 如此,手造 fixture 曾用 0.009 級雜值潛伏數週(2026-07-20 修正)。Trigger:動任何吃 change_rate 的 compute / fixture。
- **`TaiwanStockIndustryChain` = 47 產業 × 512 (industry, sub) 桶,N-to-M**:一檔可掛多桶(南亞 12 個);同產業內去重、跨產業允許重複是拍板規則。靜態對映 → 7 天 TTL 單檔 cache + FAKE 下只寫 memory 不落檔(`services/industry_chain.py`)。已知限制:載板不分 ABF/HDI、景碩歸半導體、部分股 NOT FOUND(詳 memory reference-finmind-industry-chain)。Trigger:動族群分桶 / 想加細分類時。
- **比值聚合的成員剔除必須分子分母對稱**:量比 Σ今日量÷Σ昨日量,任一欄缺的股要同時從分子與分母剔除(不對稱會系統性高估)。Trigger:寫任何 Σa/Σb 型聚合。
- **FAKE fixture 的日期語意要對 service 查詢日**:`TaiwanStockMarketValue` fixture date 曾寫 FAKE_TODAY 當天,但 service 查 T-1 交易日 → FAKE date filter 永遠 miss → mv_map 靜默空(cap_tiers null、貢獻空)數週無測試抓到。手造 fixture 前先讀 service 的日期推導。Trigger:加任何帶日期查詢的 FAKE fixture。

## 通用教訓(自 EOD 時代保留,錨點已汰換)

- **None-safe sort key 定式**:排 `field: float | None` 用 `sorted(key=lambda r: (r[field] is None, -(r[field] if r[field] is not None else 0.0), r[tie_break]))`。**不要** `sorted(reverse=True)`(None 比 float 會 TypeError)。Trigger:aggregation 排序含 None 值時。
- **獨立 try/except > gather return_exceptions**,兩個場景:(1) 兩 delegate 語意獨立(A ok 不代表 B ok);(2) test 覆蓋容易(mock 一個 raise 另一個 ok 驗 partial 降級)。Trigger:多個 compute 掛 hot path snapshot payload 時。
- **Threshold 嚴格 `>` `<` 的邊界要單獨測**:`> 1.5 → hot / < 0.7 → cold` 必須單獨測 `1.5 exactly → None`、`0.7 exactly → None` 才能 lock 契約(只測 2.0/0.5 過不了 `>=` 誤改)。Trigger:寫任何 threshold 分類函式(量比 hot/cold 沿用此契約)。
- **Extract 函式餵除法 aggregation 前要 clamp domain-impossible 值**:負 turnover 直通會打破正值不變量 → ZeroDivisionError → 整 snapshot 500;視同 corrupt → 0.0。Trigger:寫任何新 extract/parse 函式,其產出進入除法或比值 aggregation 時。
- **Pattern-delete cleanup 與 cache prefix 是同捆契約**(2026-07-14 warrant-broker-flow):刪「非當前 window 的 `<prefix>_*`」的 cleanup 會掃掉借用同 prefix 的別家檔案。**要嘛連 cleanup 邏輯一起共用、要嘛換 prefix 自帶 retention**(樣板 warrant_flow:`flow_prices_*` + 自家 `_cleanup_flow_caches`)。Trigger:新 service 想共用既有 cache 檔名 prefix 時。
- **`json.load`/`json.dump` 是單一 C call,整份文件 parse/serialize 持 GIL 不放 — `asyncio.to_thread` 救不了**(1.5GB 檔實測 event loop 凍 6.35s)。**sleep-mock 單元測試測不到**(`time.sleep` 釋放 GIL → 假綠),必須 real-env 探針。解法 = chunked JSONL 或砍資料量(2026-07-20 options txo_slim 同教訓)。Trigger:任何 >100MB JSON cache 進 async 服務時。
- **`asyncio.sleep(0)` 不會讓等待中的 timer/IO callback 先跑**(sleep(0) 把本 task 重排 ready queue 前面)。插 yield 打散長 sync 段要用 `sleep(0.005)` 之類真掛起。Trigger:async orchestrator 內連續跑多段純 Python 重計算時。
- **`TaiwanStockPrice` 不加 `data_id` 會忽略 `end_date` 只回 `start_date` 一天**;多 sid fallback 全 raise 時不 pin 空 cache(re-raise 給 caller),至少一 sid 200 才 cache empty。歷史錨點(market_breadth)已刪,教訓對任何 FinMind daily window fetch 仍成立。Trigger:需 FinMind daily prices 全 universe window 時(注意:market 頁已不需要 — 重引歷史窗前先想清楚 2026-07-20 退役的理由)。
