# market-monitor-v2 — Next-time backlog

## From /bug mcclellan-scaling(2026-07-02)

- **spec.md §6.3 公式文字漏 ×1000**:`RANA = (上漲家數 − 下跌家數) / (上漲家數 + 下跌家數)`
  缺 Ratio-Adjusted 的 `× 1000`(StockCharts 慣例)。這是本 bug 的源頭 — P2 實作照 spec
  文字逐字抄就漏。code 已修(`compute_rana` ×1000,測試鎖住),spec 文字下次動 docs 時
  同步補 `× 1000`,避免未來重寫 / 移植時再照抄一次。
- 同類結構掃描結果:repo 內無其他「ratio 進 EMA」的指標鏈(sector vol_ratio / amount_share
  是直接比值無 EMA 縮放慣例),無同型潛在 bug。
- KG 維持:±100 thrust 閾值台股 ~1000 issues 未校準(spec §9 known gap,V2.5 backtest 校準)。
