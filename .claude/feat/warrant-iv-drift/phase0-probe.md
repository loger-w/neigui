# warrant-iv-drift — Phase 0 probe 結果(2026-07-11 實測)

**Feature**: 權證選擇器加「歷史買賣引波亂調整偵測」— 單檔權證的 bid/ask 反解 IV 時序,偵測發行商長期遞減/遞增(突發暴增屬事件,不算)。
**流程狀態**: Phase 0 probe 完成,**停在 user 拍板點**(user 於 /auto 啟動問答指定:probe 完回報再定資料策略)。branch `feat/warrant-iv-drift` 已開(自 main@df83b90),state.json 已初始化。

## Probe 結論:兩市場歷史買賣價皆可得,零 FinMind 配額

### 上市 — TWSE MI_INDEX(RWD,帶 date 參數回溯)

`GET https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=0999|0999P&response=json`

| date | type | rows | size | 耗時 | 買賣價欄 |
|---|---|---|---|---|---|
| 20260610 | 0999(認購) | 26,990 | 4.5MB | 10.3s | ✓ 最後揭示買/賣價+量 |
| 20260610 | 0999P(認售) | 2,462 | 0.4MB | 9.1s | ✓ |
| 20260310 | 0999 | 29,540 | 4.8MB | 10.1s | ✓ |
| 20250711 | 0999 | 26,325 | 4.1MB | 11.2s | ✓ |
| 20230712 | 0999 | 20,291 | 3.1MB | 8.3s | ✓(**回溯 ≥3 年**) |

每交易日 2 發(0999 + 0999P)。20 欄權證表,fields 數比對取表(見 skill `twse-tpex-conventions`)。

### 上櫃 — TPEx 舊站 php(OpenAPI 無歷史,此端點有)

`GET https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d=<民國Y/MM/DD>&se=EW`

| date | rows | size | 耗時 | 欄位 |
|---|---|---|---|---|
| 2026-06-10 | 1,009 | 144KB | 0.07s | 17 欄含 最後買價/買量/最後賣價/賣量 |
| 2025-07-11 | 965 | — | — | 同 |
| 2023-07-12 | 910 | — | — | 同(**回溯 ≥3 年**;舊年份「張數」欄名作「千股」) |

注意:`se=EW` 混含 ETF(如 00679B)→ 需按權證代號規則過濾。echo_date 確認回的是指定日。`stat` 為小寫 `"ok"`(與 TWSE `"OK"` 大小寫不同)。TLS 同 TPEx OpenAPI:py ssl 需 `verify_flags &= ~VERIFY_X509_STRICT`(skill 樣板)。

### 成本估算

- 回溯 60 交易日:TWSE 120 發(循序 ~20 分鐘,一次性背景)+ TPEx 60 發(<1 分鐘)。
- 往後累積:現有 `services/warrants.py::_build_snapshot` 每日已抓同源(MI_INDEX 兩發 + TPEx 三發),加一步 per-day archive(distill 出每權證 bid/ask/close)幾乎零成本。現行快照為單一 `warrants_snapshot_latest.json` 覆寫,**不留歷史** — 需新 per-day archive 檔。
- 儲存:distill 後每日每權證一筆(bid/ask/close),60 日 × ~3 萬檔 → 建議按權證分組或按日壓縮 JSON,量級 MB 等級,無壓力。

### 已知限制(要寫進 brainstorm 的 out-of-scope / 標註)

- 條款端點(t187ap37_L / tpex_warrant_issue)**只有最新版** → 歷史 IV 反解用現行 K(履約價)/ R(行使比例)近似;調整型(除權息調整 / Reset)權證在調整日附近 IV 失真。對 drift 偵測影響小,UI 標註即可。
- 歷史標的價 S:可用 FinMind `TaiwanStockPrice`(既有接入)或同 MI_INDEX payload 的「標的收盤價」欄(probe 未逐欄驗,實作期確認)。

## 待 user 拍板(下個 session 開場先問)

1. **回溯深度**:60 交易日(建議)/ 120 交易日 / 不回溯只累積。
2. **UI 呈現**:row 展開區加 bid/ask IV 時序圖 + 全表加 drift 中性標記欄(建議)/ 只展開區詳情不加欄。
3. (brainstorm 期再細化)drift 判定演算法:建議方向 = 對 bid/ask IV 各做 rolling 線性斜率 + 持續性檢定,排除單日 spike(事件);門檻常數實作期校準,中性文案(不寫「惡意」,寫「長期遞減/遞增」)。

## Resume 指引

新 session 下 `/feat` 續作或 `/auto <退出條件> /feat 權證引波亂調整偵測(resume feat/warrant-iv-drift)`;先讀本檔 + state.json,從「待 user 拍板」的兩問開始,拍板後進 brainstorm(superpowers:brainstorming)寫 brainstorm.md。probe 原始輸出在本 session scratchpad(不可跨 session),關鍵數字已全數落於本檔。
