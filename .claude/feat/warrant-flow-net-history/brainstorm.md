# Brainstorm — warrant flow 外部淨額時序化(warrant-flow-net-history)

> 規格來源:`docs/prompts-backlog.md` B2(user 撰寫拍板之 prompt,2026-07-18 由 /auto 指示執行)
> → `superpowers:brainstorming` user-approval HARD-GATE 走 /auto 替代條件:視為預核准。
> 三個拍板點 prompt 已內嵌傾向,本檔採納並標 `[auto-default]`。

## 目標

權證分點 tab 目前只有單日快照(mod/warrant-flow-external-net)。把 summary 的認購/認售
外部淨額拉成 per-day 時序(近 20 交易日雙線圖),回答「外部人這陣子在持續加碼還是撤退」。

## 拍板點決議

1. **資料成本策略 = (iii) 混合** `[auto-default: (iii) | reason: prompt 內嵌傾向;user /auto 指示執行]`
   - 預設 GET = **cache-only**(掃既有 `warrant_flow_<stock>_<date>.json` result cache,零 FinMind 請求)。
   - **惰性補建僅由顯式動作觸發**(前端「重新整理」→ `backfill=true`),單次最多補 **K=3** 個缺日
     (新→舊優先)`[auto-default: K=3 | reason: 單日冷建 ≈ 201 req,3 日 ≈ 600 req ≈ 配額 10%,
     可重複點按累積補齊;tab 切換絕不自動觸發大量補建]`。
   - 每日值**直接取 result cache payload 的 `summary.external_net`,口徑零重算**(prompt 鐵則)。
2. **UI 落點 = flow tab summary 條下方新時序區塊**(top15 之上,恆顯不摺疊)
   `[auto-default: 新區塊 | reason: summary 級資料屬 tab 級 context;WarrantIvHistory 展開式
   是 per-warrant row context 樣板,語意不合]`
3. **v1 只做 summary 級雙線(認購/認售)**,per-warrant 時序 out of scope `[auto-default: 同意]`

### 附帶決議

- **query param 用 `backfill=true`,不重用 `refresh=true`** `[auto-default | reason: 跨檔契約
  「refresh=true = 跳 cache 全重抓」對 history 字面義 = 20 日 × 201 req ≈ 4000 req,誤觸即燒滿
  配額;新名隔離語意,design.md 記 divergence]`
- **雙線配色 = 中性線型區分(ink 實線 = 認購、ink-muted 虛線 = 認售)+ 零軸參考線**
  `[auto-default | reason: 線的 series 身分 ≠ 方向,bull/bear 只該表達方向;數值方向由
  零軸上下位置表達,對齊 WarrantIvHistory 中性樣板]`
- **非交易日槽位判定**:cache-only 掃描無法區分「缺建」vs「假日」→ 掃描窗 = 最近 30 個
  weekday;backfill 時 dump 空的日子寫 **non-trading marker cache**(避免每輪重試);
  x 軸只畫已知交易日(等距 trading-day index)。細節進 design.md。

## SC(成功條件)

- **SC-1 backend history endpoint**:`GET /api/warrants/{stock_id}/flow/history` 回近 20 交易日
  槽位 series(每槽 `{date, call, put}`,call/put = `{trade_value, external_net}`,值取自
  result cache `summary`,零重算)+ `missing_count`。
  驗:`backend/tests/test_warrant_flow_history.py` pytest(cache 命中日值 == 快照 summary 值)。
- **SC-2 cache-only 零請求**:預設(無 backfill)呼叫不打任何 FinMind API。
  驗:pytest stub 記帳 assert `dump_calls == [] and report_calls == []`。
- **SC-3 bounded backfill**:`backfill=true` 最多冷建 3 個缺日、新→舊;已建日絕不重建。
  驗:pytest stub 記帳(缺 5 日場景 assert 只建最近 3 日;重複呼叫續補下 3 日)。
- **SC-4 前端時序區塊**:flow tab summary 下方雙線 SVG(認購/認售),null 日畫斷點不補 0
  (SC-C 紀律延伸:斷點 = 線段分割,不是 0 值)。
  驗:`lib/warrant-flow-history-svg` 純函式 vitest(null 日 → segments 分割)+ RTL 元件測試。
- **SC-5 累積提示**:`missing_count > 0` → 顯示「已累積 N/20 日」+ 補建 CTA 文案;
  已建 < 2 日 → 不畫線只顯提示。驗:RTL(兩態文案 assertion)。
- **SC-6 e2e 資料級 assertion**:equity.spec.ts 新 E# — FAKE 下時序區塊存在且資料級斷言
  (points/日期數對 fixture,非 visibility-only)。驗:`cd e2e && npm test` 該 E# 綠。
- **SC-7 中性配色鎖**:時序線不套 bull/bear class(series ≠ 方向)。
  驗:vitest assertion(線 stroke class ∈ ink 色階)。

## Edge cases(≥3)

1. **已建 0-1 日**(功能剛上線):不畫線,顯示「資料累積中(已累積 N/20 日)」+ CTA。
2. **null 日**:該日 result cache 存在但某 kind `external_net` 為 None(no_volume / 全對映失敗)
   → 該線該日斷點;連續 null → 多段線。兩 kind 獨立斷點。
3. **假日 / 補班掃描**:週六日不入槽;backfill 遇 dump 空(假日)寫 marker 不佔槽也不再重試。
4. **retention 邊緣**:20 交易日 ≈ 28-30 曆日,貼著 `_RESULT_RETAIN_DAYS = 30` — 最舊槽可能被
   cleanup 掃掉造成左端永久缺口 → design 需處理(候選:retention 30 → 45)。
5. **backfill 途中 upstream 失敗**(402/502):已建缺日各自獨立落 cache,partial 保留;
   endpoint 回 502,前端顯示錯誤但既有已建資料下次 GET 照畫。
6. **標的無權證 / 無任何已建日**:區塊顯示累積提示(不炸、不隱藏整個 tab)。
7. **換 symbol**:hook queryKey 帶 stockId,切換即換資料;不殘留前一標的曲線。

## Out of scope

- per-warrant 外部淨額時序(v1 明確排除,prompt 拍板)
- 背景排程 / daemon 自動補建(策略 (ii) 落選)
- 時序天數參數化(v1 固定 20)
- top15 分點 / 明細表的時序化
- 舊 cache payload 格式遷移(cache version 不 bump — 只讀不寫舊格式欄位)

## E2E 判準結論(e2e-conventions 表)

- equity mode UI 新區塊 → **`e2e/specs/equity.spec.ts` 加 E#**(資料級 assertion)。
- 新 backend endpoint → **`backend/tests_e2e/test_api_warrants.py` contract test 必補**;
  前端 hook 消費 → live-contract L# schema 驗證一併評估(design 定)。
- FAKE 資料注入:backfill 型 feature → **distilled 層注入**(`fixtures/warrant_flow/` 子目錄
  多日 summary series,service FAKE 分支直讀 + 複製查詢語意),原始組裝路徑由 pytest 縮樣
  fixture 覆蓋(warrant_iv_history 樣板)。

## S/M/L 分流

**L**:跨前後端,預估 ≥ 8 檔(service + route + 2 條 backend test 檔 + api client + hook +
svg lib + component + e2e spec + fixture)。Phase 1/2 各 max 3 輪 review。
