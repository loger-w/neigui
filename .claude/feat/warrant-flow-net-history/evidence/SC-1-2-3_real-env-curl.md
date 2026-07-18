# Phase 6 real-env 證據(2026-07-18,dev :8000 + 真 FinMind)

## SC-2 cache-only(零 FinMind 請求)

`GET /api/warrants/2330/flow/history` → 200 即回:
`window 20 built 2 missing 18 backfilled 0`,07-17 call external_net = 25,523,650(A4 輪真 cache 值)。

## SC-3 bounded backfill(第一批)

`GET ...?backfill=true` → 200,18.6s,`backfilled 3`(07-16、07-15、07-14 新→舊):
```
2026-07-09  35,690,960 / -316,040
2026-07-14   3,428,900 / 2,012,060
2026-07-15  32,251,020 / -3,042,240
2026-07-16  65,412,650 / 1,647,450
2026-07-17  25,523,650 / 4,017,010
```

## SC-3 續補(第二批)+ 假日 marker 真實觸發

再呼叫 → `backfilled 2`(07-13、07-08),**07-10 dump 空 → 寫 flow_nontrading marker、槽移除遞補**。
正確性抽驗:FinMind `TaiwanStockPrice 2330 07-08..07-14` 實際交易日 = 08/09/13/14 →
**07-10 確為非交易日,marker 判定正確**(R1 guard + marker 全鏈真實環境走通)。

## Regression 抽驗

- `GET /api/warrants/2330/flow` → 200,as_of 2026-07-17(主 panel 不受影響)
- `GET /api/warrants/abc!!/flow/history` → 400 `{"error": "bad_symbol"}`
- `GET /api/warrants/2412/flow/history` → 200(該標的實有權證 → 正常 20 槽,非 no_warrants;
  no_warrants shape 由 pytest + contract test 覆蓋)

## SC-4/5/7 UI

`infra_fail: chrome-devtools MCP profile 被並行 session 鎖 + claude-in-chrome extension 未連線`
→ 視覺面由 **E22 playwright(真 browser,資料級段數/點數/配色 assert)+ RTL 13 測試** 承擔;
DevTools 截圖 next session 補(state.json phase_6_blocked_reason)。
