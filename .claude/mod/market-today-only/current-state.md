# mod/market-today-only — Phase 1 現況表

## 動機(user 2026-07-20)
20/60 日歷史窗計算太久(冷載入分鐘級);希望使用者看到「今天的狀況」就好。

## Baseline
全四 gate 於 2026-07-20 13:28 pre-push hook 全綠(backend 745 passed / ruff clean / vitest 888 / build 過),tree 與本分支起點相同(main 301f4e5)。

## 現況資料流

```
/api/market/snapshot (finmind_realtime.py)
├── intraday:taiwan_stock_tick_snapshot(5s cache,零配額)→ heatmap / leaderboard
│     row 自帶:change_rate、total_amount、total_volume、yesterday_volume、volume_ratio
└── EOD(_fetch_eod_results,background task + 24h result cache + backoff):
      ├── breadth              ← market_breadth.compute_breadth(60 日窗 + EMA pad,McClellan/AD Line/3 訊號)
      ├── sector_breadth       ← sector_aggregation.compute_sector_breadth(MA20)
      ├── sector_volume_ratio  ← sector_aggregation.compute_sector_volume_ratio(20 日均量)
      └── sector_amount_share  ← sector_aggregation.compute_sector_amount_share(20 日均佔比 Δ)
      共用 _fetch_daily_prices_window(TaiwanStockPrice per-day loop,冷載入 = 最重路徑)
```

## Caller map(grep 完整)

### Backend
| 檔 | 角色 | 目標 |
|---|---|---|
| `services/finmind_realtime.py` | `_fetch_breadth/_fetch_sector_*` delegate(389-467)、`_fetch_eod_results`(477-607)、`_eod_background`/`_eod_backoff_until` task 機制(607-674)、payload 組裝(854-886) | 🔴 EOD 機制整段移除,改當日 compute(純函式,吃 universe rows) |
| `services/market_breadth.py` | McClellan/AD Line 全套 + `_fetch_daily_prices_window`(chunked JSONL prices cache)+ `_cleanup_stale_window_files` | 🔴 整檔移除(唯一 consumer = _fetch_breadth;`_fetch_daily_prices_window` 另有 sector_aggregation 委派,一併移除) |
| `services/sector_aggregation.py` | 三個 compute_sector_* | 🔴 整檔移除或改寫為當日版(見 change-spec) |
| `routes/market.py` | route 層,不碰 EOD 細節 | 不動 |
| `tests/test_market_breadth*.py`、`test_sector_aggregation*.py`、`test_finmind_realtime.py` EOD 段 | 鎖 EOD 行為 | 🔴 該紅:EOD 行為測試隨功能移除;當日版新測試 🟢 |

### Frontend
| 檔 | 角色 | 目標 |
|---|---|---|
| `lib/market-types.ts` | snapshot payload 型別(breadth / sector_* 欄位) | 🔴 型別改當日版 shape |
| `components/MarketPage.tsx` | 四格掛載 + props | 🔴 對接新欄位 |
| `components/MarketBreadthPanel.tsx`(192 行)+ `lib/breadth-svg.tsx`(84 行) | McClellan 圖 + 3 訊號 | 🔴 重做為「今日漲跌家數」版(UI 需 frontend-design skill) |
| `components/MarketSectorBreadthHeatmap.tsx`(102 行)+ `lib/sector-breadth-svg.tsx` | % > MA20 熱力圖 | 🔴 語意改「今日上漲家數比例」(視覺可沿用) |
| `components/MarketSectorVolRatio.tsx`(80 行) | 20 日均量倍數 + 過熱/冷清 | 🔴 分母改昨日量(snapshot 自帶),UI 大致沿用 |
| `components/MarketSectorAmountShare.tsx`(77 行) | 今日佔比 + Δ20 日 | 🔴 保留今日佔比,移除 Δ 欄 |
| 對應 `*.test.tsx` | | 🔴 隨行為改 |

### E2E / fixtures
| 檔 | 角色 | 目標 |
|---|---|---|
| `e2e/specs/market.spec.ts` M9(EOD 四欄資料級 assertion)、M2/M3 | 鎖 EOD populated 資料 | 🔴 M9 改當日版 assertion |
| `scripts/gen-market-e2e-fixtures.py` | 生成 EOD 窗口 fixture(TaiwanStockPrice universe / TAIEX) | 🔴 EOD 窗口 fixture 廢除(當日版吃 tick snapshot fixture,已存在) |
| `backend/tests_e2e/fixtures/` 的 EOD 窗口檔 + MANIFEST 條目 | | 🔴 移除(MANIFEST gate 同 commit) |

### 動態用法檢查
- `_EOD_COMPONENT_KEYS` tuple 遍歷(finmind_realtime 內部)、`eod.get("...")` 字串 key — 均已列上表。
- cache 檔 prefix:`breadth_prices_*`(chunked JSONL)、`eod_results_*`、`disposition_*`(disposition 是 universe filter,**保留**)。孤兒 cache 檔隨功能移除變死檔 → migration 節處理。
- grep `compute_breadth|compute_sector_|_fetch_daily_prices_window|market_breadth|sector_aggregation` 全 repo:僅上表檔案 + docs/specs 歷史文件(不動)。

## 現況 vs 目標摘要

| 面向 | 現況 | 目標 |
|---|---|---|
| 資料源 | 歷史:TaiwanStockPrice 60 日窗 per-day loop(冷載入分鐘級,吃 FinMind 配額) | 即時 tick snapshot(已在抓,5s cache,**不計配額**),零額外請求 |
| 更新頻率 | EOD 基準(盤中顯示的是昨收基準)+ 24h result cache | 盤中即時(隨 snapshot 輪詢跳動) |
| 冷載入 | 每日首請求 + 每次部署後付分鐘級成本 | 消失 |
| Backward compat | payload 欄位 shape 改變;無外部 API consumer(前後端同 repo 同步部署) | 前後端同 PR 改齊 |
| Migration | `breadth_prices_*` / `eod_results_*` 孤兒 cache | 移除 cleanup 邏輯自身;孤兒檔一次性清理(見 change-spec) |
