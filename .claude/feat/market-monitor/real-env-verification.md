# Phase 6 — 真實環境驗證

執行時間:2026-06-29 18:25 TPE(收盤後 ~5 小時)
Branch:`feat/market-monitor` @ `d1c1592`

## 限制

`chrome-devtools-mcp` 與 `claude-in-chrome` 兩個 browser MCP 都不可用:
- DevTools MCP:profile `C:\Users\USER\.cache\chrome-devtools-mcp\chrome-profile` 被既有實例佔住,需 `--isolated`
- claude-in-chrome:擴充未連線

→ 真實環境 **backend** 透過 curl 直接驗(SC-1 完整證明),UI 視覺證明(SC-2 / SC-3 / SC-4 / SC-5 視覺部分)受限。Per /feat Phase 6 rule (d) 標 `_unscoped.phase_6 += 1` infra_fail,**不算 SC 回退**。視覺部分 RTL component test 已 jsdom 涵蓋邏輯;Phase 7 將標明「視覺證據待補」。

## SC-1 — Backend snapshot pipeline ✓

| 驗證項 | 結果 | 預期 |
|---|---|---|
| HTTP status | 200 | 200 |
| Payload shape(JSON keys)| `as_of / last_tick / is_trading_session / stale / lag_seconds / sectors / leaderboards` | 設計 §4 7 keys ✓ |
| Over-the-wire size(gzip)| **24,241 bytes ≈ 24 KB** | < 50 KB (SC-1 brainstorm amend) ✓ |
| Raw size | ~126 KB | (僅內部估算) |
| Wall time(`time_total`)| **0.51-0.74 s** | < 800 ms p50 ✓ |
| Sector count | 49 sectors | 設計 §4 估 ~ 28(實際 49 含 ETF) |
| Stocks across sectors | 1,080 | cap 30/sector × 49 = max 1470,實際少於 cap 自然 |
| stale | False | universe fetch ok → False ✓(R3 fix work)|
| is_trading_session | False | 收盤後,正確 ✓ |
| lag_seconds | 12369 (~206 min) | 從 last_tick 14:59 到 now 18:25 ≈ 3.4 hr ✓ |

### Real payload sample(收盤後快照)

**amount top 5(verified 過濾指數後)**:
```
2330 台積電 amt=78657.0M
2327 國巨*   amt=41048.6M
3481 群創    amt=40382.4M
2454 聯發科  amt=38648.8M
2303 聯電    amt=36161.8M
```

**gainers top 5(漲幅)**:
```
6483 原創生醫    chg=+29.23% (接近漲停)
6847 普瑞博      chg=+17.95%
7922 源點*       chg=+17.06%
6493 雷虎生      chg=+14.81%
7913 通寶半導體  chg=+13.78%
```

**first sector(觀光餐旅)**:30 stocks,avg_chg = +0.54%,包 5701 劍湖山 / 5364 力麗店 / 2727 王品 — sector 歸類正確。

### Phase 6 發現的真實 bug(已 fix 並 commit)

1. **`stock.name = stock_id`(中文公司名漏)** — snapshot endpoint 不回 name 欄,TaiwanStockInfo 含 stock_name。Fix:從 sector_map rows 同時 build `name_map`,注入 `_group_by_sector` + `_compute_leaderboards`。3 個 regression tests 加。
2. **加權指數 / 不含金融指數 佔據排行榜** — `taiwan_stock_tick_snapshot` universe 包 index rows(stock_id 001/002),TaiwanStockInfo 沒對到。Fix:filter universe 為 `stock_id in primary_sector`,指數天然排除。

兩個都是 design 未涵蓋的 edge — Phase 7 結構表 `regression 抽樣對象` 欄會點明。

## SC-2 — 熱力圖 finviz-style treemap ⚠ 視覺證據待補

- Backend `sectors[*].stocks[*]` shape 正確,含 stock_id / name / change_rate / market_value 5 欄
- 49 sectors × 平均 22 stocks 結構正確,frontend `layoutHeatmap` 可吃
- **視覺證明**:browser MCP infra_fail,RTL test 已 jsdom 證明:
  - `MarketHeatmap.test.tsx` 8 個 cases:role=img / data-fill-bin=bull|bear / onSymbolPick / 市值估 fallback
  - `heatmap-svg.test.ts` 15 cases:colorForChange 9 bin 鎖 hex / R>G 紅 G>R 綠 / squarified geometry
- **盤中視覺驗證**:下個交易日上午 09:00-13:30 補(green=紅 / 紅=綠 直接看截圖)

## SC-3 — 排行榜 3-tab ⚠ 視覺證據待補

- Backend leaderboards 4 keys(gainers / losers / amount / volume_ratio)各 30 row,row 含 6 欄(stock_id / name / change_rate / total_amount / volume_ratio / sector)
- `volume_ratio` top 3 數值真實顯示(`17000.0 / 16246.0 / 250.0`)— 量比 tab 不再「只有排名沒值」(v3 F5 修)
- **視覺證明**:`MarketLeaderboard.test.tsx` 9 cases — 3 tab 切換 / volume_ratio x suffix / null fallback `—` / bull-red bear-green 正反向 assertion
- **盤中視覺驗證**:下個交易日補

## SC-4 — Mode 切換 + cross-mode pivot ⚠ 視覺證據待補

- App.tsx 3-way ternary 已重構(v3 C1 fix),mode='market' 時 OptionsPage 不 mount
- `handleSymbolPick` 複用 handlePick(v3 C3 fix)— symbolName/selectedBrokerIds/userPickedDate 全 reset
- **視覺證明**:`ModeSwitch.test.tsx` 6 cases — 三 button 渲染 / active state / 大盤 click → onChange('market')
- **真實環境**:用戶可手動測 — open localhost:5173 → ModeSwitch 三 button → 點「大盤」→ MarketPage lazy chunk(10.31 KB / gzip 4.08 KB build evidence)載入

## SC-5 — Polling + stale + session detection ⚠ 部分視覺證據

- Backend `is_trading_session=False / lag_seconds=12369` 確實反映收盤狀態
- Hook `useMarketSnapshot` `refetchInterval` callback(in_session=true ? 2500 : false)邏輯 jsdom 已測
- `MarketHeader` 收盤狀態 `lag pill` 隱藏(R7 fix)— `showLagPill = isTradingSession && lagSeconds != null`
- Frontend `MarketPage` error 改 banner overlay 不 unmount(R1 fix)
- **盤中 polling refresh 視覺**:下個交易日 09:00-13:30 補

## 真實環境驗證指令清單(reproducible)

```bash
# SC-1 整體 endpoint
curl -s -w "status=%{http_code} time=%{time_total}s\n" http://127.0.0.1:8000/api/market/snapshot

# SC-1 gzip 真實 size
curl -s --compressed -D headers.txt http://127.0.0.1:8000/api/market/snapshot -o snapshot.json
grep -i "content-encoding\|content-length" headers.txt

# SC-1 refresh 旗標
curl -s -w "time=%{time_total}s\n" "http://127.0.0.1:8000/api/market/snapshot?refresh=true"

# SC-5 收盤狀態確認
python -c "import json; d=json.load(open('snapshot.json',encoding='utf-8')); print(d['is_trading_session'], d['stale'], d['lag_seconds'])"
```

## Phase 7 結構表 regression 抽樣對象(從 Phase 6 沉澱)

- name 中文顯示(`_build_name_map` 3 tests)
- 指數過濾(`stock_universe` filter — 沒寫獨立 test 但 by definition `001` 不在 primary_sector)
- Phase 4 R1 (error banner 不 unmount)/ R3 (stale 條件)/ R7 (lag pill hide)/ R8 (cancelQueries)/ R2 (Z suffix)— 都 commit 在 Phase 4 fix bundle
