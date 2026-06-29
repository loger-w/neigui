# 個股即時 snapshot + 族群監控 整合 design

- 發起時間:2026-06-26
- 來源:`/deep-research` + workflow audit `wf_ec1e81c0-e46`(在 trash-mr-warrant session 啟動)
- 完整 audit raw:`C:\Users\USER\AppData\Local\Temp\claude\C--side-project-trash-cmoney\d389a032-f304-49af-95b7-d14840cd7ec8\tasks\wphrp2ygm.output`
- 架構決策:從原本 `trash-mr-warrant` 接 Touchance 的計畫切回 `trash-cmoney` 擴展(個股 / 族群場景純 FinMind / Linux Docker / 沿用既有接入)。trash-mr-warrant 變成 Touchance / 期貨 / 選擇權 / 權證 / 下單一條線

---

## TL;DR

新增第三個 mode `market`(大盤族群),走 batch-then-slice 架構:後端一次拿全台股 `taiwan_stock_tick_snapshot` 快取 10 秒,所有 per-symbol / per-sector 請求從這份 cache slice/aggregate。前端 lazy `MarketPage` + `SectorList` + `SectorHeatmap` + 3 個新 TanStack Query hook。

**Verdict: approved-with-fixes**(2 serious + 8 minor),原本 2 個 serious(`data_id=""` batch + `industry_category` 名稱)已透過 §6 probe 解決;1 個 serious(past-date 路徑)已直接砍掉。剩 minor 在 §5 列出。

---

## 1. 後端變更

### 新增 / 擴充檔案

- **新增** `backend/routes/sectors.py`(複數,對齊 `symbols.py` 慣例)
- **新增** `backend/routes/realtime.py`
- **新增** `backend/services/finmind_realtime.py`(sibling 模式,對齊 `finmind_options.py`,避免 2020 行的 `finmind.py` 再長)
- **延伸** `backend/services/finmind.py`(只加 `fetch_sector_constituents`,不放 realtime 的 cache version)
- **延伸** `backend/main.py`(掛 router,不動 global exception handler)

### Endpoint(probe 通過後定稿)

```
GET /api/realtime/snapshot/universe
  → 全市場 batch 快照(主要 feed,sector aggregator 內部依賴)

GET /api/realtime/snapshot?symbols=2330,2454,3034
  → 從 universe cache slice;missing symbol = null

GET /api/sectors
  → [{id, name, member_count}] 從 TaiwanStockInfo industry_category 抽

GET /api/sectors/{sector_id}/members
  → [{symbol, name, weight?}]

GET /api/sectors/{sector_id}/snapshot
  → aggregate({avg_change, total_volume, top_gainers, top_losers, breadth})
```

**注意**:**所有 realtime / sector endpoint 都是 live-only,不收 `?date=YYYY-MM-DD`**。原 plan 的 past-date 分支砍掉 — `taiwan_stock_tick_snapshot` 是 live 端點,過去日要走 `TaiwanStockPrice` 是不同 dataset / 不同 shape。

### Cache 策略

**ONE shared cache key per trading_date**:
- Key: `tick_snapshot_universe_{trading_date}`
- Version: `_CACHE_VERSION_REALTIME = 1`(隔離於 chip v3 / options v1)
- TTL:**10 秒**(用 `max_age_seconds: int | None = None` 新增 param,不要傳 `0.17` 給 `max_age_minutes`)
- 過去日期 cache 不適用(live 才有意義)
- 同 key 並發走 `_run_once(f"snapshot_universe_{date}_{int(refresh)}", ...)`
- Stale fallback:upstream 502 時回 cache + `{stale: true, cache_age_seconds, last_fetched_at}`
- `no_trading_day` flag 跟 §4 contract 一致

Sector aggregate 不另外 cache,直接從 universe cache 在 route handler in-memory aggregate(~2000 rows dict comprehension 便宜)。Sector constituents cache 7 天(慢動)。

---

## 2. 前端變更

### Mode 擴 tri-state(不是新 tab)

`App.tsx` 的 `Mode` union 加 `market`:
```ts
type Mode = "equity" | "options" | "market"
```

ModeSwitch 三選一:`個股籌碼` / `TXO選擇權` / `大盤族群`。

**為什麼新 mode 不是 equity 新 tab**:
1. Batch-of-everything data model 跟 equity 的 symbol-pinned controls(DateField + RangeSelector + SymbolSearch)語義不合
2. Heatmap UI 跟 equity overview 的 KlineChart + BrokersPanel split-pane 視覺衝突
3. Equity mode 維持深度 drilldown 焦點,不污染既測流程
4. Symbol → equity pivot 用 `setMode('equity') + setSymbol(x)` 一鍵切換,成本低

### 新元件(都 lazy + `<Suspense>` 包,對齊 `OptionsPage` 模式)

- `MarketPage.tsx`(lazy shell,擁有 date + selectedSector state)
- `MarketHeader.tsx`(date picker + refresh + last-updated ticker + stale flag UI)
- `SectorList.tsx`(左欄 sector 列表 + member_count + avg_change badge)
- `SectorHeatmap.tsx`(右欄 treemap / grid,**bull=紅 bear=綠**,測試一定要 data-testid + 正向 assertion)
- `SectorMembersTable.tsx`(sortable table 替代視圖,click row → cross-link)
- `RealtimeSnapshotPanel.tsx`(per-symbol live ticker block,日後可內嵌 equity overview)

### 新 hook(全走 TanStack Query)

```ts
useRealtimeSnapshot(symbols: string[])
  queryKey: ['realtime-snapshot', symbolsCSV]
  refetchInterval: 10_000
  returns: { data, loading, error, refresh, lastUpdated, stale }

useSectors()
  queryKey: ['sectors']
  staleTime: 24h
  returns: { data, loading, error, refresh }

useSectorSnapshot(sectorId: string)
  queryKey: ['sector-snapshot', sectorId]
  refetchInterval: 10_000(today only;weekend / off-hours pause)
  refetchIntervalInBackground: false
  returns: { data, loading, error, refresh, noTradingDay, lastUpdated, stale }
```

**TanStack Query migration scope**:新 hook only。Audit 揭露 trash-cmoney 既有 8 個 hook **已經全 migrate 完**(用 `useQuery` from `@tanstack/react-query 5.101`)→ CLAUDE.md §7 P0 採納項實際上已 done,要從「P0 採納項」移到「已對齊現狀」。

---

## 3. CLAUDE.md(trash-cmoney)更新

- **§0**:`market` 加進 page mode 列表
- **§4 跨檔契約**:登記 `_CACHE_VERSION_REALTIME = 1`;`realtime/snapshot` stale flag contract `{stale, cache_age_seconds, last_fetched_at}`
- **§5 資料源**:加 `taiwan_stock_tick_snapshot` 一行(BATCH 語義 + 10 秒 refresh + `data_id=""` 全宇宙)+ `TaiwanStockInfo.industry_category` 作為 sector taxonomy(註明是監管 28 類產業,**不是** 概念股 / 主題股)
- **§7 升級路線**:**P0(引入 TanStack Query)從「採納項」移到「已對齊現狀」** — 既有 8 個 hook 已全用 `useQuery`,認知校正
- **§8 Lessons Learned**:加兩條
  - 「Sector taxonomy = `TaiwanStockInfo.industry_category`(監管 28 類),**不是** user-facing 概念股 / 主題股 — UI tooltip surface category code 避免誤解」
  - 「`tick_snapshot` batch-then-slice — 一個 cache file 裝整個 universe,**不要** per-symbol fan-out,6000/hr 配額會被浪費」

---

## 4. Sequencing(8 steps)

| Step | Repo | 內容 | 1 PR? |
|------|------|------|-------|
| ~~0(必先做)~~ | — | ~~Probe FinMind~~ — **已完成,結果見 §6**;原 spec 假設修正 | — |
| 0b(盤中再 probe) | — | 盤中跑 §6 probe A,觀察 `date` field 是否真的 ~10 秒刷新(收盤後 probe 定格 14:30:00) | 不算 PR |
| 1 | backend | `fetch_tick_snapshot_universe` + `_CACHE_VERSION_REALTIME` + `/api/realtime/snapshot/universe` + `/api/realtime/snapshot?symbols=` | 1 |
| 2 | backend | `fetch_sector_constituents` + `/api/sectors` + `/api/sectors/{id}/members` | 1 |
| 3 | backend | `fetch_sector_snapshot` aggregator + `/api/sectors/{id}/snapshot` | 1 |
| 4+5(合併)| frontend | Mode `market` 加 + lazy MarketPage + `useRealtimeSnapshot` + `RealtimeSnapshotPanel`(不分兩 PR,避免 step 4 ship 空頁面違反 §B 三類分開 commit) | 1 |
| 6 | frontend | `useSectors` + `useSectorSnapshot` + `SectorList` + `SectorMembersTable` + cross-link 到 equity mode(date / windowDays state 處理要明確) | 1 |
| 7 | frontend | `SectorHeatmap` 視覺變體 + 切換 + 色彩 binding 測試(bull=紅 bear=綠) | 1 |
| 8(optional)| frontend | 內嵌 `RealtimeSnapshotPanel` 到 equity overview 頂端 ticker | 1 |

---

## 5. Risks(8 條,挑重要)

1. **Scope creep**:個股 realtime + 族群兩個 feature 綑綁 → 拆 sequencing 後 step 1-3 可獨立 ship
2. **Sector taxonomy mismatch**:`industry_category` 是監管 28 類,跟 user-facing「AI 概念」「CoWoS 概念」不對應 — 後續可能要加 user-defined watchlist 層
3. **Polling thrash**:10 秒 refetch × 多 sector 開 × 多 tab 可能爆 quota — server cache dedup 吸收(一個 upstream/10 秒),`refetchIntervalInBackground: false` 暫停 inactive tab
4. **盤後 / 盤前 stale prices 假裝即時**:`MarketHeader` 必 surface `last_fetched_at` + `no_trading_day` flag
5. **色彩極性 bug 重演**:Heatmap **bull=紅 bear=綠**(台股慣例),`SectorHeatmap.test.tsx` 用 data-testid + 正向 assertion 鎖死(對齊 [[txo-chip-framework reflexivity hedge]] 的教訓)
6. **跨 mode pivot state 流失**:sector member click → equity mode 時 `date` / `windowDays` 怎麼處理要明確規格化(reset 今日?保留 market 的 date?從 equity localStorage 拉?)
9. **`TaiwanStockInfo` 同 stock_id 多 row**:Probe 顯示 `data_id=2330` 拿到 2 rows(不同 `industry_category`)— 推測台積電可能同時掛「半導體業」+「電子工業」。Sector aggregator 不能 1-to-1 map,要規格化(主類 only / 全部都算 / 取最新 date 那筆)。設計 sector → constituents 反向 query 也要考慮這個(同檔股可能出現在多個 sector list 內)。實裝前要驗一次 `TaiwanStockInfo` 不帶 `data_id` 全市場的 cardinality(2330 不是孤例還是普遍?)。
10. **`TickType` 含義未知**:probe 看到 2330=1 / 5701=2,推測跟漲跌或上下檔有關。Backend 暴露 raw 給 frontend 之前要查清楚 — 若是內部分類,別讓 UI 直接顯示;若是漲跌標記,可以省略自己算。
11. **Snapshot 只有最佳一檔**:`buy_price / sell_price` 是 best-1 不是五檔深度。若 UI 要五檔資訊得另外 dataset(可能 `TaiwanStockPrice5BestBidAsk` 之類),Phase 2 再驗。Phase 1 設計時 UI 不應假設五檔。
7. **Universe atomic_write_json 延遲**:~2000 rows × tick fields 每 10 秒寫 tmp + replace — 在 antivirus 掃描的 Windows 路徑可能撞 TTL,Step 1 要加 latency probe;不行就在 JSON cache 上加 in-memory layer
8. **Stale fallback flag UI**:cache 過 10 秒回退時,UI 必須明顯指示 stale,否則 user 以為是 live

---

## 6. Probe 結果(2026-06-26 收盤後執行,腳本 `<scratchpad>/finmind_probe.py`)

### A. Snapshot 端點正確路徑

❌ `/api/v4/data?dataset=TaiwanStockTickSnapshot` — **422 enum reject**(/data 路徑 dataset 列表不收 snapshot)
✓ **`GET /api/v4/taiwan_stock_tick_snapshot`** — 直接端點,不帶 params → `status=200, rows=2818`(整個 TWSE+TPEx universe)
✓ `data_id="2330"` → 1 row(單檔精準查)
✓ `data_id=""`(空)→ 2818 rows(等同不帶 params)

→ Service code 走 `httpx.get(f"{_FINMIND_BASE}/taiwan_stock_tick_snapshot")`,**對齊 trash-cmoney 既有 `taiwan_stock_trading_daily_report` 直接端點 pattern**,不要走 `?dataset=` 路徑。

### B. Snapshot row schema(20 fields,2026-06-26 14:30 收盤 sample 2330)

```json
{
  "open": 2360.0, "high": 2370.0, "low": 2325.0, "close": 2340.0,
  "change_price": -50.0, "change_rate": -2.09, "average_price": 2347.58,
  "volume": 5701, "total_volume": 39059,
  "amount": 13340340000, "total_amount": 91694500000,
  "yesterday_volume": 34284, "volume_ratio": 1.14,
  "buy_price": 2335.0, "buy_volume": 325,
  "sell_price": 2340.0, "sell_volume": 695,
  "date": "2026-06-26 14:30:00.000000",
  "stock_id": "2330", "TickType": 1
}
```

注意:
- **只有最佳一檔 bid/ask**(`buy_price / buy_volume / sell_price / sell_volume`),不是五檔深度。要五檔得另外 dataset,Phase 2 才驗。
- `date` 是 ISO datetime string,**不是** epoch — backend 轉 `YYYY-MM-DD` 給 frontend 時要 split。
- `TickType` 1 vs 2 含義未知 — Open Question §5 新增(2330=1, 5701=2,推測跟漲跌 / 上下檔有關)。
- `change_price` / `change_rate` upstream 已算好,frontend 不必再算。

### C. `TaiwanStockInfo` industry field 名

✓ **`industry_category`** 確認(2330 → 「半導體業」)。Row 結構:
```json
{"industry_category": "半導體業", "stock_id": "2330", "stock_name": "台積電", "type": "twse", "date": "2026-06-26"}
```

注意:`data_id=2330` 拿到 **2 rows**(同 stock_id 但 `industry_category` 不同 — 例如「半導體業」+「電子工業」)。意味 sector aggregator 不能直接以 `(stock_id → industry_category)` 1-to-1 map,要 dedup 取最新 / 取 primary / 或 1-to-many 處理。**§5 risks 新增**。

### D. `taiwan_options_snapshot` 不支援 batch(Phase 2 預先記錄)

`GET /api/v4/taiwan_options_snapshot` 不帶 params → 422 `Field required: data_id`。**選擇權 snapshot 要 data_id 必填**(可能要枚舉合約 month/strike),不像股票 snapshot 可以裸抓。Phase 2 設計 TXO snapshot 流時要驗 enum / batch 方式。

### Open data update cadence

Probe 是 14:30 收盤後抓的,`date` 都定格在 `14:30:00.000000` — 沒辦法觀察 live refresh 頻率。**盤中要再 probe 一次**確認真的是 ~10 秒(若是 30 秒甚至 1 分鐘,前端 `refetchInterval` 要調整,且 cache TTL 跟著對齊以免 stale fallback 訊號失真)。

---

## 7. 完整原始材料

- Workflow audit raw output:`C:\Users\USER\AppData\Local\Temp\claude\C--side-project-trash-cmoney\d389a032-f304-49af-95b7-d14840cd7ec8\tasks\wphrp2ygm.output`
- Deep-research(資料源比較,2026-06-26 啟動):`C:\side-project\trash-mr-warrant\docs\research\2026-06-26-dq4-and-broker-api-survey.md`
- Memory:`reference_finmind_api`(Sponsor 訂閱)、`reference_touchance_account`(達錢 4 帳號,跟此 spec 無關但相關專案)
