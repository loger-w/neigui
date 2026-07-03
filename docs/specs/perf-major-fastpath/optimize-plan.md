# perf: 主力線可見範圍優先載入(major fast-path)

2026-07-03 /perf api-check 沉澱。Phase 1/2 診斷全文見本次 session;此檔記 Phase 3 策略與驗收基準。

## Phase 1 現況數字(量測方式:chrome devtools resource timing + FinMind user_info 配額差值)

| 場景 | 現況 | 量測條件 |
|---|---|---|
| 籌碼總攬冷載入 — summary / base / brokers | 0.6 / 0.7 / 0.7 s | 冷股(2609/2002/1216/3231 四次重複)|
| 籌碼總攬冷載入 — **history/major(540d)** | **23.8-24.7 s** | 同上,360 req ÷ 15/s |
| 暖載入(cache 命中)全端點 | 10-45 ms | 同 symbol 第二次 |
| 選擇權頁冷(每日首次) | 8.5-9.2 s | 9 個大 payload 上游請求 |
| 選擇權頁暖 | 43-46 ms | 同日第二次 |
| 切股票(舊 major 在途 6.5s 時切)新股 fast 端點 | 610-662 ms | cancel 鏈生效,無堵塞 |
| 配額成本 | 366 req / 冷股 | 6000/hr → ~16 檔/hr |

歸因:major 冷載入 100% 是 FinMind 請求等待(暖載 41ms 證明計算成本趨近零)。
FinMind `TaiwanStockTradingDailyReport` 拒絕日期區間(400 "only send one day data"),
每交易日 1 request 為上游強制。

## 目標(Phase 5 驗收)

- **主力副圖 TTI(可見 90 根 K 棒有資料):< 8s**(現況 24s,理論 ~7s = ~100 req ÷ 15/s + overhead)
- 540 日全量背景補齊:< 30s(和現況同量級;背景進行,不擋 UI)
- 不退化:summary / base / brokers_window 維持 < 1s;既有測試全綠
- 量測方式與 Phase 1 完全相同(冷股 + resource timing)

## 策略(P1,user 已選)

前端 `useChipData` 把 major 拆兩段查詢,backend 不動:

1. `majorFastQ`:`/history/major?days=150`(150 日曆日 ≈ 100 交易日,覆蓋預設
   `KLINE_ZOOM_DEFAULT = 90` 根 + 假期緩衝)→ 到手即渲染
2. `historyMajorQ`(既有 540):`enabled: majorFastQ.isSuccess` — 序列化避免
   同日 per-day 重複請求;540 fan-out 靠 backend per-day cache
   `{symbol}_{d}_major` 直接跳過 fast 已抓的 ~100 天
3. merge:`major = full.data?.major ?? fast.data?.major ?? []`
4. `majorLoading` 新語意:尚無任何 major 資料且仍在抓(fast 到手即熄 overlay;
   背景 540 補齊不再蓋 overlay — 原本 refresh 會蓋 24s,此為順帶改善)

## Trade-off

- 多付:每檔 +1 次 TaiwanStockPrice range call + 今日 report 重抓(~2 req/檔,<1%)
- 行為微調:主力副圖分兩段出現(90 根先到,zoom 出去舊 bar 從 0 漸補)——
  既有 `?? 0` fallback 本來就容忍 major 缺日
- 不採納 secid_agg 區間近似(366→20 req):主力定義 = 每日動態 top-15 買+賣,
  固定分點會改變數值,屬 mod 非 perf
- P2(fan-out 併發拉高;probe 實測 36 併發全 200 / wall 0.9s / p50 0.44s)本輪
  不做,留檔:可把 fast 段 ~7s 再壓到 ~1.5s,代價是配額燒速與 cancel 省額效果

## Phase 5 結果(2026-07-03,冷股 2886,同 Phase 1 量測法)

| 指標 | Before | After | 達標 |
|---|---|---|---|
| 主力副圖 TTI(可見 90 根) | 23.8-24.7 s | **6.26 s**(-74%) | ✓ < 8s |
| 540 日全量完成 | 23.8-24.7 s | 23.7 s(背景,不擋 UI) | ✓ 同量級 |
| summary / base / brokers(冷) | 0.6 / 0.7 / 0.7 s | 0.19 / 0.24 / 0.26 s | ✓ 無退化 |
| 暖載 major(150 / 540) | 41 ms | 533 / 1055 ms(per-day cache 命中) | ✓ 可接受 |
| vitest | — | 575/575 綠;build 過 | ✓ |

暖載 major 從 41ms 變 0.5-1s 的原因:aggregate cache key 帶 days,150d 視窗是新 key
首次冷;之後同日重看回到 <50ms。截圖:`screenshots/2886-after-two-stage-load.png`。

## P2 結果(2026-07-03,rate 15→40,冷股 5880,同法量測)

前提改變使 §9「降速止血」決策可逆:cancel 鏈實測有效 + P1 把切走浪費鎖在
fast 窗 ~100 req。sustained probe:120 req @ 40/s(burst 40)全 200、
p50 0.29s、零 throttle。

| 指標 | P1(15/s) | P2(40/s) | 達標 |
|---|---|---|---|
| 主力副圖 TTI | 6.26 s | **1.97 s** | ✓ < 3s |
| 540 全量完成(選股起算) | 23.7 s | **8.6 s** | ✓ < 12s |
| summary / base / brokers(冷) | 0.19-0.26 s | 0.45-0.52 s | ✓ < 1s |
| FinMind 錯誤(429/402/5xx) | 0 | 0 | ✓ |

註:.env 用 PowerShell 5.1 `-Encoding utf8` 重寫會帶 BOM,`FINMIND_TOKEN`
讀不到 → symbols 503「FINMIND_TOKEN not set」。修法:`[System.IO.File]::
WriteAllLines` + `UTF8Encoding($false)`。

## 行為白名單(保證不變)

- `useChipData` 對外 shape(`{summary, history, loading, summaryLoading,
  historyLoading, majorLoading, error, refresh}`)不變
- date 變更只重抓 summary;symbol 變更全部重抓(含 abort 舊請求)
- 全域 `loading` 不含 major(重新整理 spinner 不等 fan-out)
- backend 路由 / cache key / 契約零改動
