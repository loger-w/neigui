# brainstorm — warrant-iv-drift(權證引波亂調整偵測)

日期:2026-07-11。前置:`phase0-probe.md`(資料源實測,同目錄)。

## 0. 決策來源(/auto 預核准紀錄)

- **回溯深度 = 60 交易日**:user 2026-07-11 AskUserQuestion 拍板。
- **UI = 展開區 bid/ask IV 時序圖 + 全表 drift 中性標記欄**:user 同日拍板。
- FinMind 用量疑慮已答覆並確認:主資料走 TWSE/TPEx 直抓零配額;標的價首選 MI_INDEX 內建欄(`underlying_close` 已在 normalize 取出),全程可零 FinMind。
- 其餘為實作選擇(內部可逆),依 /auto 契約標 `[auto-default]`。

## 1. Goal

單檔權證的歷史 bid/ask 反解 IV 時序,偵測發行商**長期遞增/遞減**的引波調整(突發單日暴增屬事件,不觸發)。呈現在既有 WarrantSelector(equity mode 權證 tab):

1. 全表新增中性 drift 標記欄(長期遞減 / 長期遞增 / —)。
2. row 展開區新增 bid/ask IV 時序圖(與既有分點明細並列)。

**中性文案鐵則**:不寫「惡意」「坑殺」等指控性文字,只呈現統計事實(遞減/遞增/穩定/資料不足)。

## 2. 方案比較(儲存 + 計算擺位)

### 方案 A:per-day distilled archive + 每日預算 drift(採用)

- 每日 snapshot build 時同步落 `warrant_iv_history/YYYY-MM-DD.json`(每權證 distill:bid/ask/close/underlying_close + **當場反解好的 iv_bid/iv_ask**),檔案 immutable、~1-2MB/日。
- 60 交易日 backfill = 一次性背景任務,冪等(檔案存在跳過)。
- Drift 對序列做一次 pass,結果 merge 進 snapshot 給全表欄;展開圖走新 endpoint 讀序列。
- 優:讀取端輕(IV 預算好)、archive 不可變好 cache、往後每日零增量請求(同源已在抓)。
- 劣:多一份 distill 檔案格式要維護。

### 方案 B:存 raw、on-demand 反解 + on-demand drift

- 只存 raw bid/ask,請求時反解 60 日 × 全 underlying 權證 IV。
- 優:儲存最簡。劣:每次冷請求 CPU + 60 檔 parse 秒級;drift 欄在快照層拿不到,前端要多一輪 fetch。棄。

### 方案 C:SQLite / DuckDB

- 違反專案「無 DB、filesystem JSON cache」既有架構(CLAUDE.md §5),為單一 feature 引儲存引擎不成比例。棄(不重開,`docs/decisions.md` 精神)。

`[auto-default: 方案 A | reason: 讀取輕 + 零增量請求 + 沿 utils.cache 既有 pattern;純內部儲存佈局,可逆]`

### Drift 演算法方向(常數實作期校準)

bid/ask IV 各自:**Theil-Sen(中位數斜率,天然抗單日 spike)+ 方向持續性檢定(符號一致比例)+ 最少有效點數門檻**。輸出 label ∈ {`declining`, `rising`, `stable`, `insufficient`} + slope 數值。單日暴增(事件)因 Theil-Sen 抗 outlier 不觸發。
`[auto-default: Theil-Sen + 持續性檢定 | reason: probe 已載明建議方向(user 讀過);OLS 斜率對 spike 敏感違反「突發不算」需求;純函式可逆]`

## 3. 成功條件(SC)

- **SC-1 每日 archive**:daily snapshot build 同步寫當日 distilled archive(每權證含反解好的 iv_bid/iv_ask),檔名帶日期、已存在不重寫。
  驗證:`python -m pytest -q tests/test_warrant_iv_history.py -k archive`(monkeypatch fetch,assert 檔案落地 + payload shape + 冪等)。
- **SC-2 60 交易日 backfill**:可觸發的背景 backfill,循序抓 TWSE/TPEx 歷史日、非交易日自動跳過(MI_INDEX stat OK 全表空)、冪等可中斷續跑。
  驗證:pytest(mock fetch 含非交易日 case);real-env 跑完後 `ls backend/data/cache/chip/warrant_iv_history/*.json | wc -l` ≥ 60(交易日檔數)。
- **SC-3 drift 純函式**:對 IV 序列輸出 {label, slope, n_valid};合成序列行為:單調遞減→`declining`、單調遞增→`rising`、平穩→`stable`、平穩+單日 spike→`stable`(不觸發)、有效點 < 門檻→`insufficient`。
  驗證:`python -m pytest -q tests/test_warrant_iv_drift.py`(上列 5 合成 case 各一測試)。
- **SC-4 snapshot merge**:`/api/warrants/{stock_id}` 每列新增 `iv_drift`(label|null)欄,契約向後相容(舊欄不動)。
  驗證:pytest routes test assert 欄位;`backend/tests_e2e/test_api_warrants.py` contract 補欄。
- **SC-5 iv-history endpoint**:`/api/warrants/{warrant_id}/iv-history` 回 `{warrant_id, series:[{date, iv_bid, iv_ask}], drift:{label, slope_bid, slope_ask, n_valid}}`;無 archive 資料回空 series 不炸;錯誤走 `detail.error` 契約。
  驗證:pytest routes(正常/空/bad id 400);tests_e2e contract test。
- **SC-6 全表 drift 欄**:WarrantSelector 新欄,中性文案(`長期遞減`/`長期遞增`,stable/insufficient/null 顯示 `—`),不用紅綠方向色。
  驗證:vitest RTL(`WarrantSelector.test.tsx` 加 case:label 對映 + `expect(screen.queryByText(/惡意|坑/)).toBeNull()` 文案鎖)。
- **SC-7 展開區 IV 時序圖**:row 展開 fetch iv-history,bid/ask 兩線 SVG 時序圖(純渲染函式在 `lib/warrant-iv-svg.ts`,無 React 依賴);loading/error/空狀態(`無歷史引波資料`)繁中。
  驗證:vitest(svg 純函式單測 + hook 測試 + 元件狀態測試);DevTools MCP 真實截圖 `evidence/SC-7_*.png`。
- **SC-8 e2e**:`equity.spec.ts` 加 E12(drift 欄資料級 assertion)+ E13(展開區 IV 圖 svg 資料級 assertion);FAKE fixtures 走 `tests_e2e/fixtures/warrants/` 既有子目錄慣例。
  驗證:`cd e2e && npm test` 全綠(含新 E12/E13)。

## 4. Edge cases

1. **零成交/無報價日**:bid/ask None → 該日 IV None → 序列有洞;drift 用有效點數門檻擋(SC-3 `insufficient`)。
2. **bid > ask 倒掛(stale)**:該日視同無效點(沿 `_warrant_price_basis` 同判準)。
3. **重設型(is_reset)**:IV 不適用(既有慣例)→ archive 記 None,drift = `insufficient`,展開圖顯示空狀態。
4. **除權息調整型權證(backfill 近似)**:歷史 K/R 用現行值近似 → 調整日附近 IV 跳點;Theil-Sen 抗單點,UI 於展開區加一行中性註記(`歷史 IV 以現行條款近似`)。往後每日 archive 用當日條款,漸趨精確。
5. **新掛牌(< 門檻日數)**:`insufficient` → 表格 `—`。
6. **深價內/外反解失敗**(無套利界外)→ 該日 None,同 1 處理。
7. **TPEx 舊站舊年份欄名飄移**(「張數」vs「千股」)+ ETF 混入 `se=EW` 表 → normalize 按欄位位置/名稱容錯 + 按權證代號規則過濾;壞 row skip + warning(twse-tpex-conventions)。
8. **backfill 中斷/重跑**:檔案存在即跳過,重入安全;非交易日(全表空)寫 marker 或直接跳過不落檔(design 定)。
9. **FAKE_FINMIND e2e**:FAKE fetch 無視 date,backfill 在 FAKE 下無意義 → e2e 不觸發 backfill,fixture 直接提供 distilled archive 檔(design 定細節)。

## 5. Out of scope

- 歷史條款(K/R)精確重建 — 上游只有最新版,近似 + 註記(probe 已證)。
- 牛熊證 / 展延型(0999C/B/X/Y 另表,不在 0999/0999P universe)。
- 全市場 drift 掃描/排行頁(只做 per-underlying 表格欄 + per-warrant 展開圖)。
- 盤中即時 drift(EOD only)。
- DB 引入。
- 發行商層級彙總(哪家券商最常亂調)— 記 `docs/next-time.md` 候選。

## 6. E2E 歸屬(e2e-conventions 判準表)

| 改動 | 格 | 動作 |
|---|---|---|
| WarrantSelector UI(equity mode) | equity.spec.ts(E#) | 加 E12/E13 |
| 新 endpoint iv-history + snapshot 欄 | backend tests_e2e | `test_api_warrants.py` 補 contract |
| FAKE 層 | 直抓 service 子目錄 fixture 慣例 | `fixtures/warrants/` 下加 archive fixture |
| 視覺 | 不動 visual baseline(新增欄非 layout 大改) | 豁免,DevTools 截圖在 Phase 6 |

## 7. Scope 分級

**L**(跨前後端、預估 ≥ 10 檔:backend service/routes/tests ×4+,frontend 元件/hook/lib/types/tests ×6+,e2e ×2)。無鑑權/金流/安全邊界。Phase 1/2 各 max 3 輪 review。

## 8. Phase 3 前置備忘

- 前端 UI 動工前呼叫 `frontend-design` + `bencium-controlled-ux-designer`(user 常設指示,memory)。
- 檔數 > 15 可能性低於 goal_efficiency_mode 門檻,維持標準 TDD 三 commit;若 Phase 2 盤出 > 15 檔再啟用並回寫 state。
