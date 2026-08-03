# /feat Phase 3 細節:實作模式、多 task 紀律、失敗回退

## 實作模式(2026-08-03 拍板:一律 dispatch,main session 不自寫實作)

**不分案件大小,實作一律 dispatch implementer subagent(顯式 `model: opus`)** — main
session(fable)只做 spec / routing / 拍板 / review 裁決,不自寫實作 code。
「≤ 2 檔 main agent 自己 TDD」路徑退役(主 session 換 fable 後自寫 code 是最貴路徑,
且統一 dispatch 後 ledger / review gate 紀律無例外)。

| 條件 | 模式 |
|---|---|
| 多檔獨立 task | 逐 task dispatch implementer(一次一個,紀律見下節) |
| 單檔 / 小案 | 同樣 dispatch 單一 implementer(prompt 帶該 task 的 spec 節 + 介面 + 全域約束) |
| 長時間 / 跨 session | dispatch + `progress.md` ledger + checkpoint(紀律 2;`superpowers:executing-plans` 缺席之 fallback 同) |

模式唯一,免確認;`progress.md` ledger 自此**一律必要**(不再限多 task 案)。

## 多 task dispatch 的三條紀律

Workflow tool 提供**機制**(fan-out / pipeline / schema),**不提供流程紀律**。以下三條
是必要補充,缺任一條就會重現已知的昂貴失敗:

### 1. 每個 task 後就 review,不是全部做完才 review

每個 task 的迴圈是「dispatch implementer → 該 task 的 review gate → fix loop → 標完成」。
review gate 同時要 spec 合規**與**品質兩個判定,缺一不算過。implementer 的自評不能取代
這個 review。

fix loop 有上限;達上限仍有未處理 finding → **逐條裁決並記錄**(哪條判定為誤報、哪條真
但可延後、哪條是 load-bearing)。load-bearing 的未解 finding → **停下回報**,不准帶著它
往下一個 task 走 —— 後面每個 task 都會疊在這個缺陷上。**靜默丟棄 finding 一律禁止。**

### 2. 跨 compaction 的 ledger 檔(不能只靠 todo)

對話記憶不保證撐過 compaction。**進度寫在檔案裡**,不是只寫在 todo 清單:
`.claude/feat/<slug>/progress.md`,第一行寫它對應的 plan 檔路徑。

每個 task 完成追加一行(task 編號 / commit 範圍 / review 結果);fix round 也逐輪追加。
compaction 之後,**信 ledger 與 `git log`,不信自己的印象**。

> 這條的代價是實測最貴的一種:失去進度的 controller 會把**整批已完成的 task 重新
> dispatch 一次**。

### 3. 禁止並行 dispatch implementer

review / 唯讀分析可以並行,**實作不行**(檔案衝突)。一次一個 implementer。

### dispatch prompt 的內容邊界

dispatch prompt 只描述**這一個 task**,不描述 session 歷史。不要把前幾個 task 的累積摘要
貼進後面的 dispatch。fresh subagent 只需要:它的 task、它會碰到的介面、全域約束。

產物用**檔案路徑**交接,不用貼內容 —— 貼進 prompt 的東西會在你自己的 context 裡常駐到
session 結束,而且每一輪都重讀一次。

**next-time.md 代查(全 dispatch 制的配套)**:`docs/next-time.md` 的 checkpoint 代查由
main session 在每 task dispatch 前執行(feat.md Phase 3 步驟 4;fresh implementer 不知道
該檔存在)— /mod /bug /refactor /perf 沿用。

**Commit / tag 歸屬(2026-08-03,全 dispatch 制的配套)**:commit 由 implementer 下,
但 dispatch prompt **必附**該 task 的 commit tag 規則([red]/[green] 配對 + 🔴🟢🔵 三類,
摘自 feat.md Phase 3 / mod.md Phase 4);main session 在每 task 的 review gate 一併核 tag,
Phase 8 機械驗證前就攔(fresh implementer 不知道 tag 規則,漏附 = Phase 8 FAIL 後
線性重建 commit 的前科重演)。

## 新發現 case 的處置

先回 Phase 2 文件追加(只追加不重跑 review)再寫紅。

**test-infra 例外**:selector / matcher / jsdom 行為修正(非新 SC 行為)可同階段直接 patch
測試檔,commit body 註 `test-infra-fix: <reason>`,不回 Phase 2。

## 失敗回退(禁止「就地改 code 不更新上游文件」)

回退發生當下記 state.json `rollbacks`(feat.md 核心原則「回退記帳」)。

| 情況 | 回到 |
|---|---|
| (a) 介面 / 資料流無法實作 | Phase 1(快速路徑:只 review 變更段落) |
| (b) signature 細節錯 | Phase 2 |
| (c) edge case 沒列 | Phase 0 補 SC |
