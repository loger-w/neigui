# Change Spec — mod/broker-flows-date-picker

> Tracker:repo 未設 issue tracker(無 issue / `ready-for-agent` label / `docs/agents/`),
> 沿 repo 既有 /mod 慣例落本檔;tickets 在同目錄 `tickets/`。
> 對齊紀錄:grilling 兩輪(Q1–Q10)+ seams 確認,2026-09-24 user 拍板。

## Problem Statement

分點反查只能看「最新資料日」的買賣超排行。使用者想回頭看某分點在特定交易日(例如某檔股票
異動當天)買賣了哪些股票,目前做不到 —— 後端早已支援 `date` 參數,但前端從未開放
(原 feat 以 YAGNI 劃界)。

## Solution

分點反查標頭加一個與個股 / 選擇權頁同款的日期欄位(沿用專案主題 `DateField`,風格一致)。
未選日期時行為與現況完全相同(最新模式);選了日期就查該日,休市日沿用既有回退標註;
點股票跳個股頁時,個股頁日期同步到該資料日。

## User Stories

1. 身為分點追蹤者,我想在分點反查選一個過去日期,以便看該分點當天買賣超了哪些股票。
2. 身為分點追蹤者,我想不選日期時照舊看到最新資料日,以便日常使用不多一步操作。
3. 身為分點追蹤者,我想日期欄位在未選時顯示今天,以便知道目前是「最新」查詢。
4. 身為分點追蹤者,我想選回今天就回到最新模式,以便不需要另找「重置」按鈕。
5. 身為分點追蹤者,我想選到休市日時看到「{查詢日} 尚無資料,顯示 {資料日}」,以便知道實際顯示的是哪天。
6. 身為分點追蹤者,我想「資料日 MM-DD」照舊顯示實際資料日,以便一眼核對。
7. 身為分點追蹤者,我想換另一個分點時日期保持不變,以便同一天比較多個分點。
8. 身為分點追蹤者,我想先選日期再選分點,以便以「日」為主軸查詢。
9. 身為分點追蹤者,我想從常用分點 chip 帶入時也沿用已選日期,以便快速橫向比較。
10. 身為分點追蹤者,我想切到別的 mode 再回來時已選日期仍在,以便跳去個股頁看完回來不必重選。
11. 身為分點追蹤者,我想在已選日期下點某檔股票時,個股頁日期跟著變成該資料日,以便直接看那天的主力券商與泡泡圖。
12. 身為分點追蹤者,我想在最新模式下點股票時個股頁日期照舊不動,以便既有動線不變。
13. 身為分點追蹤者,我想選的過去日期前後都沒資料時看到「所選日期前後無分點資料(休市或超出資料範圍)」,以便不被「尚未上料 21:00」誤導。
14. 身為分點追蹤者,我想最新模式下資料未上料時仍看到原本的「分點資料尚未上料(每交易日約 21:00 更新)」,以便知道晚點再來。
15. 身為分點追蹤者,我想無法選到未來日期,以便不做無意義查詢。
16. 身為鍵盤輸入使用者,我想逐位輸入年份 / 日期時不會每按一鍵就發查詢或閃錯誤,以便順暢打字。
17. 身為分點追蹤者,我想在已選日期下按「重新整理」只重抓該日,以便修正該日資料。
18. 身為手機使用者,我想日期欄位在 375 寬時自動換行不溢出,以便手機可用。
19. 身為螢幕閱讀器使用者,我想日期欄位有「選擇日期」可及名稱,以便知道用途。

## Implementation Decisions

- **後端不動**:`/api/broker/daily-flows` 既有 `date` 語意(非法日 400、未來日 clamp、≤3 weekday 回退、
  過去日 cache 永久、全空 503)原樣沿用;錯誤契約不變。
- **api 層**:分點反查的 api 方法參數順序對齊同檔 sibling 慣例 `(id, date?, refresh?, options?)`;
  `date` 缺省 → 不帶 query param(最新模式請求形狀與現況逐字相同)。
- **hook**:`useBrokerDailyFlows` 加尾端選用參數 `date: string | null = null`;queryKey 納入 date
  (每個 (分點, 日期) 各自前端快取);null → 不帶 date。
- **Panel 狀態模型**:
  - 已提交日期 `flowsDate: string | null`(null = 最新模式),`useSessionState` 持久化
    (新 key,與既有 `flows-selected` 並列);換分點不重置。
  - 輸入草稿 `draft`(欄位 value;初值 = `flowsDate ?? 今天`)。草稿變動後 300ms debounce,
    僅當草稿為完整日期且 `2000-01-01 ≤ draft ≤ 今天` 才提交;提交值 = 今天 → null(回最新),
    否則該日。不合格草稿不提交;失焦時若草稿不合格則還原為已提交值的顯示。
  - 欄位 `max` = 今天、`min` = 2000-01-01(與防護下限一致;非資料下限)。
- **版面**:標頭列順序 搜尋框 → 已選徽章 → **日期欄位** → 資料日 → 截斷註記 → 重新整理(靠右);
  日期欄位常駐(未選分點也顯示);`aria-label="選擇日期"`;沿用 `DateField` 不另做樣式。
- **錯誤文案**:`broker_flows_unavailable` 在 `flowsDate !== null` 時改顯示
  「所選日期前後無分點資料(休市或超出資料範圍)」;最新模式維持原文案。其他錯誤碼不變。
- **跳轉回呼**:`onPickStock(stockId, stockName, brokerId, date)` 新增第 4 參數 —
  `flowsDate !== null` 時傳該筆 payload 的 `as_of_date`(回退時即實際資料日),最新模式傳 null。
- **App 接線**:`handleFlowStockPick` 收到非 null date → 在 `handlePick` 與分點預選之後,
  標記「使用者指定日期」並設個股頁日期為該日(避免 auto-snap 覆寫);null → 現況不動。
- **changelog**:新功能 → MINOR `0.50.0`。
- **next-time**:記「FinMind 分點反查(trader-only 專用 path)歷史深度待 probe(帳號回 Sponsor 後)」。

## Testing Decisions

- 好測試 = 只斷外部行為(DOM 文字 / 可及名稱 / 對 api 的呼叫參數 / 回呼參數),不斷內部 state。
- **Seam S1(主)**:`BrokerFlowsPanel` 元件層 RTL + `vi.spyOn(api, ...)`(prior art:既有
  `BrokerFlowsPanel.test.tsx`;元件吃真 hook,日期傳導一併覆蓋)。涵蓋 US 1–10、13–17 的元件面。
- **Seam S2**:Playwright e2e(prior art:`equity.spec.ts` E30/E37、`navigation.spec.ts` N5)。
  - 新 E#:flows 選 2026-06-25 → 雙表 fixture 手算獨特值資料級斷言 → 點列跳個股頁 → 個股頁
    日期欄位 = 2026-06-25(US 11 唯一覆蓋點)。
  - N5 擴充:選日期 → 切 market → 切回 flows → 日期仍在。
  - FAKE fixture:既有 9600 trader fixture 追加 2026-06-25(Thu)rows,獨特值與 06-26 可區分;
    FAKE `_get` 依 date 過濾 → E30 不受影響;MANIFEST `_note` 同步。改 fixture 後清 `e2e/.cache`。
- 不新增 hook 層 / App.test seam;後端無改動不補 pytest / L#。
- **事前標為「該變」的既有 assertion**(鐵則 E 合法通道):
  1. `useBrokerDailyFlows.test.ts` 讀 refresh 參數的索引 `[1]` → `[2]`(api 參數順序對齊)。
  2. `BrokerFlowsPanel.test.tsx` `onPickStock` 呼叫參數加第 4 個 `null`(最新模式)。
  3. (實作期追記)`changelog.test.ts`「最新版本是 vX」釘選斷言 0.49.2 → 0.50.0 — repo 發版慣例
     每次 bump 必改(前例 95fb533),spec 階段漏列,ticket 03 實作時補記。

## Out of Scope

- 前 / 後一交易日 stepper(Q1 選 (a);flows mode 無交易日曆來源)。
- 後端任何改動(新錯誤碼、加大回退窗、開 trading calendar route)。
- 資料下限 min date(FinMind 深度未知,帳號目前 Free 無法 probe)。
- 多日區間彙總。

## Further Notes

- 環境:FinMind token 目前 Free(level 1),真實環境 trader-only path 全日期 400;real-env 驗證只能用
  本機過去日 cache(`bflow_9600_2026-07-20` / `bflow_9216_2026-07-21` / `bflow_9801_2026-07-21`)+ FAKE e2e。

### 既有行為白名單(不能破壞)

- W1 未選日期(預設)行為與請求形狀不變:不帶 `date` → 最新資料日;「資料日 MM-DD」;回退 banner 文案。
- W2 搜尋 combobox 全部行為(a11y activedescendant / 截斷提示 / echo 不誤查 / dash-insensitive)。
- W3 常用分點星號 + chips 一鍵帶入(localStorage,N6)。
- W4 已選分點跨 mode 還原(sessionStorage,N5)。
- W5 最新模式下點列跳轉 equity 總覽 + symbol 帶入 + 分點預選,個股頁日期不動(E30)。
- W6 重新整理鈕 → `refresh=true`,且只刷目前查詢。
- W7 錯誤碼繁中映射(最新模式文案不變)、`stock_count > 60` 截斷註記、空表「無買超 / 無賣超」。
- W8 active gate:未選分點不 fetch。
- W9 後端:非法日 400、未來日 clamp、過去日 cache 永久、今日 TTL、≤3 requests、全空 503、id 白名單。
- W10 手機 375 標頭列 flex-wrap 不溢出。

### Backward compat / migration

- 無資料格式 / API 契約變動;新增 sessionStorage key 缺值 → null(最新模式),舊 session 無痛。
- `onPickStock` 為 App 內部 prop,唯一 caller 同 commit 更新。
- 可逆性:revert 前端 commits 即回現況,無殘留資料。
