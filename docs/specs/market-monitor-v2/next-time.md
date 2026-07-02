# market-monitor-v2 — Next-time backlog

## From /perf snapshot-hot-path(2026-07-02)

- **增量 fetch 消滅每日 240s 冷啟動**:目前日期翻頁 → `breadth_prices_<start>_<end>`
  key 變 → 全 window 128 次 FinMind 重抓。真正新資料只有 1 個交易日 — 可重用
  昨日 window 檔補缺日(需重新設計 cache key / 與 C4 清理互動)。做之前先評估:
  冷啟動只有每日第一個 request 付,且已不卡其他 endpoint。
- **recompute 期間單 component aggregation 殘餘 ~0.9s loop stall**(每日一次,
  探針 max 897ms):5.75M rows 純 Python pass 在 loop 上跑。若要進一步壓,
  把 extract/aggregate 純函式 to_thread(純 Python 在 thread 會每 5ms 讓 GIL,
  與 C json parse 不同)。CP 值低,先擱置。
- **orjson**:若未來 parse 還要更快(4.2s → ~1s),加依賴換 `orjson.loads`
  per chunk。目前 C5 裁欄後 4.2s 每日一次,不值得加 dep。
- `_read_cache`/`_write_cache`(單文件版)仍服務小檔(taiex / eod_results /
  realtime_*)— 若未來有小檔長成大檔,套 chunked 樣板。

## From /bug sector-override-phantom(2026-07-02)

- **`tests_e2e/fixtures/TaiwanStockInfo.json` 也散播同一錯誤假設**:含不存在的
  「金融保險業」category,且掛在 2412 中華電(真實為通信網路業)。手工 fixture
  任意值不影響本 bug 的 production 修正,但下次 rotate fixture 時校正為真實
  category 字串(動它可能連動 e2e baseline,獨立處理)。
- `tests/test_sector_aggregation.py:142` 手編 sector_map 用「金融保險業」當任意
  label — 純函式測試無真實性語意,cosmetic,rotate 時順手改。
- Override 同型結構掃描:`_PRIMARY_INDUSTRY_OVERRIDE` 是 repo 唯一手編 category
  字串對映;drift-lock 測試(`test_override_values_are_real_finmind_categories`)
  已鎖未來新增 entry 的 typo / FinMind 改名。

## From /bug mcclellan-scaling(2026-07-02)

- **spec.md §6.3 公式文字漏 ×1000**:`RANA = (上漲家數 − 下跌家數) / (上漲家數 + 下跌家數)`
  缺 Ratio-Adjusted 的 `× 1000`(StockCharts 慣例)。這是本 bug 的源頭 — P2 實作照 spec
  文字逐字抄就漏。code 已修(`compute_rana` ×1000,測試鎖住),spec 文字下次動 docs 時
  同步補 `× 1000`,避免未來重寫 / 移植時再照抄一次。
- 同類結構掃描結果:repo 內無其他「ratio 進 EMA」的指標鏈(sector vol_ratio / amount_share
  是直接比值無 EMA 縮放慣例),無同型潛在 bug。
- KG 維持:±100 thrust 閾值台股 ~1000 issues 未校準(spec §9 known gap,V2.5 backtest 校準)。
