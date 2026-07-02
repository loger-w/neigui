# market-monitor-v2 — Next-time backlog

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
