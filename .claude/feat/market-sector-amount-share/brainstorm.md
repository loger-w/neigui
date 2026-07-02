# Brainstorm — market-monitor-v2 P4 sector amount share

**Date**: 2026-07-02
**Mode**: /goal 自主(prompt 已給定三個關鍵抉擇方向,Phase 0 對齊 gate 自動化)
**Spec**: docs/specs/market-monitor-v2/spec.md §6.4 / §8
**Plan**: docs/specs/market-monitor-v2/plan.md Phase 4
**樣板**: .claude/feat/market-sector-breadth/(P3,§4.1~§4.4 同構,只換公式)

---

## 1. 目標

每 sector「今日成交值佔大盤比(today_share)+ Δ vs 20 日均值(share_delta_20ma)」表,
加進 `/api/market/snapshot` payload(`sector_amount_share` 欄位)。XQ 風格資金流向輪動觀察。

資料源:FinMind `TaiwanStockPrice` daily 的 `Trading_money` 欄(dollar 成交值)。
**Pre-reading 已確認**:P2 `_do_fetch_prices` 寫 cache 是 raw rows 不裁欄
(`market_breadth.py:376` `all_rows.extend(rows)`)→ `Trading_money` 已在共用 cache 內,
cache_key reuse 策略成立,冷啟動零額外 fetch cost。

## 2. 成功條件(SC-N + 驗證方式)

- **SC-1 — `_extract_amount_by_stock` 純函式**:從 daily price rows 建
  `stock_id → {date → turnover_value}`;universe 過濾 / date 或 stock_id 缺 → skip row /
  `Trading_money` 缺或非數值 → 0.0(保留該 row)/ duplicate (sid, date) later-wins(F6-echo)。
  - 驗證:`python -m pytest -q tests/test_sector_aggregation.py::TestExtractAmountByStock`
- **SC-2 — `_aggregate_sector_amount_share` today_share 正確**:
  `today_share[s] = sector Trading_money sum / total universe Trading_money sum on today_date`;
  today sector amount = 0 → 該 sector 缺席(對齊 P3 vol_ratio「今日整族群無量 = 缺席」);
  today 全市場 total = 0 → `[]`(KG7 自然解);sector 不在 sector_map → 歸「其他」。
  - 驗證:`python -m pytest -q tests/test_sector_aggregation.py::TestAggregateSectorAmountShare`
- **SC-3 — share_delta_20ma 正確**:
  `share_delta[s] = today_share[s] − mean(daily_share[s] over past avg_window 有效交易日,排除 today)`;
  有效過去日 < avg_window(新上市 sector / 資料不足)→ `None`;正負皆可出現。
  - 驗證:同上 test class(delta 專屬 test methods)
- **SC-4 — 排序契約**:today_share DESC,tie-break sector name ASC;
  today_share 恆非 None(缺席 sector 不進 result)→ 不需 F1 None-safe key。
  - 驗證:同上 test class(sort test)
- **SC-5 — `compute_sector_amount_share` orchestrator**:
  universe 空 → `raise ValueError("universe_empty")`;empty prices → `[]`;
  `refresh=True` 一路傳到 fetcher;httpx.HTTPError propagate;
  **window derivation 與 P2/P3 完全相同**(cache_key reuse,T37 spy test 對齊 T36 慣例)。
  - 驗證:`python -m pytest -q tests/test_sector_aggregation.py::TestComputeSectorAmountShareOrchestrator`
    + `TestConstantsLock::test_T37_p4_amount_share_shares_fetch_window`
- **SC-6 — finmind_realtime 整合**:payload 加 `sector_amount_share` 欄位
  (排在 `sector_volume_ratio` 之後,不動既有 key 順序);第三個獨立 try/except
  (只 catch `httpx.HTTPError`);fail → `None` **不動 stale**(F6 sequel);
  P1/P2/P3 欄位 intact;empty universe → `None`(helper gate)。
  - 驗證:`python -m pytest -q tests/test_finmind_realtime.py`(T-INT-1 happy / T-INT-2 fail 隔離 / T-INT-3 empty universe)

## 3. Edge cases(≥ 3)

- **E1 新上市 sector(< avg_window 有效過去日)**:today_share 正常算,share_delta = None。
  區分機制:per-sector day dict 只含實際有 row 的日 → 缺日不補 0(對齊 P3 vol_ratio 慣例),
  len(past_shares) < avg_window → None。
- **E2 today 全市場 Trading_money = 0**(FinMind 欄位全缺):所有 sector today amount = 0
  → 全部缺席 → `[]`。KG7 不需特殊分支,自然解,但要 test lock。
- **E3 過去某日 total_day_amt = 0**:該日 daily_share 0/0 未定義 → 該日不計入 past window
  (skip,不算有效日);注意 sector amt > 0 ⟹ total > 0(total 含該 sector),
  只有 sector amt = 0 且 total = 0 才會踩到。
- **E4 row 缺 `Trading_money` 欄或非數值**:turnover = 0.0,row 保留(對齊 P3 volume=0 慣例)。
- **E5 stock 不在 sector_map**:歸「其他」(`_OTHER_SECTOR`,對齊 P3)。
- **E6 end_date 落週末**:today_date = max date across prices(F7 global 慣例),T-E9 style test。
- **E7 duplicate (sid, date) rows**:later value wins(F6-echo 繼承)。

## 4. Out of scope

- Frontend(MarketSnapshot TS type / UI panel)— 留 P5
- `_CACHE_VERSION_REALTIME` / `_CACHE_VERSION_BREADTH` bump(spec §4 明示 P4 不 bump)
- P1 universe filter / P2 market_breadth.py / P3 sector_aggregation.py 既有函式修改
  (`_extract_close_and_volume_by_stock` **不擴 tuple** — 見 §5 抉擇 1)
- Intraday `total_amount` 分母(spec §6.4 是 daily EOD 語意)
- KY / 興櫃 universe 擴充

## 5. 關鍵抉擇(prompt 給定方向 + Phase 1 review 交叉確認)

1. **Extract 函式**:選「新增 `_extract_amount_by_stock` 專職版」。
   理由:擴 `_extract_close_and_volume_by_stock` tuple 為 3 元素會動到 P3 既有函式
   (extract 本體 + 兩個 aggregate 的 unpack site),違反本輪「不要動 P3 既有函式」邊界;
   多一次 O(N) iterate(每 snapshot 3 次 extract pass)是 accepted trade-off
   (P3 design §8.12 已量測 ~150k rows dict build ≈ 2-3s,加一次 ≤ 3s post-cache-warm)。
   → Phase 1 review 交叉確認此決策。
2. **today_share 分母**:today total = sum(Trading_money across **filtered universe**)。
   語意註記:分母是「4 位數普通股 universe」不含 ETF/權證/處置股 — 這是 feature 不是 bug
   (看普通股內部輪動);對外文案不寫「大盤」絕對值。
3. **share_delta window**:排除 today,只跟過去 avg_window 個有效日比(對齊 P3 vol_ratio)。

## 6. S/M/L 分流

**M**(4 檔:sector_aggregation.py / test_sector_aggregation.py / finmind_realtime.py /
test_finmind_realtime.py;無新資料流 — 共用 P2 cache;無新依賴;非鑑權/金流/對外 API 面;
`/api/market/snapshot` 是內部 frontend API,P3 同形狀改動走 M 前例)
→ Phase 1 / Phase 2 各 1 輪 review;Phase 4 依 prompt 指示用 Workflow 多 lens review。

## 7. E2E 判準表歸類

改動類型 = 「Backend route response shape」但 **payload add-only 且前端本輪不接**(P5 才接)
→ 對齊 P3 前例:backend pytest integration test 補契約;`live-contract.spec.ts` L# 留待 P5
前端 hook 接入時一併補。本輪 e2e 豁免,commit 註明 `[no-e2e: backend add-only field, frontend lands P5]`。
