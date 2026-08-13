# progress — feat/bubble-streak-screenshot

Plan: .claude/feat/bubble-streak-screenshot/implementation/PLAN.md(design.md v3 為真相源)

執行模式:L 級 → 各包 dispatch implementer(顯式 opus);包序列:A(backend)→
B(前端資料層)→ C(UI)→ D(截圖)→ E(e2e + changelog)。互斥可平行但
worktree 依賴複製成本高於收益,採序列 [auto-default]。

| 包 | 狀態 | commits | review |
|---|---|---|---|
| baseline | 綠 | -(backend 689P/1S、frontend 1038P) | - |
| A backend | done | cf74bcd [red] → 1595ec6 [green] | gate 27P+ruff 0;main 複核 20+7P;IDE 診斷判殘影;tag 核過 |
| B 資料層 | done | bdf0c9b [red] → 6a5d858 [green] | gate 30P+build 0;全案 vitest 1045P;tag 核過;api 語法採 method(對齊 chipBrokersWindow,design 括號已預授權) |
| C UI | done | 30cb242 [red]🔴 → 1fc5c82 [green]🔴 → 497507b [red]🟢 → 1ec93cf [green]🟢 | gate 98P+build 0;全案 1062P;tag 核過(🔴/🟢 分離);額外 R8 refresh-gate 測試 accepted;R15 fallback 未觸發待 Phase 6 1280px 實測 |
| D 截圖 | done | 72c93ad [red] → f036d20 [green] | gate 99P+build 0;全案 1078P;tag 核過;useContainerSize mock 改 vi.hoisted 可控(test-infra,既有案零影響)+ svgToPngBlob fail-fast guard(防禦非吞錯)皆 accepted |
| E e2e+changelog | done(帶 1 blocker) | 848c9b1(selectors 防撞)/ 1b4723a(E43/E44)/ c4fbedc(changelog v0.48.0) | E43/E44 單跑 2 passed 7.6s;驗紅 mutation 2 failed(E43 Received "500"、E44 Received 正確檔名)→ Edit 還原後綠;equity+navigation 整跑 46 passed / **1 failed = E39(既有 spec)** |
| E39 fix(R15 fallback) | done | 112a766 | selector 移統計行右端;equity 41P 全綠;1280px header 量測見結案節 |
| review fix 波(round 1) | done | f8867b4 [red] → f3700b3 [green] / a069d7d [lock] / 281fe84(e2e) | 10/10 findings;pytest 721P + ruff 0 + vitest 1091P + build 0 + equity e2e 42P(新 E45);mutation 六連驗過;changelog 判同 ship event 不加條目;self_review_head = 281fe84 |

## 收尾後追記(2026-08-13)

- PR #70 rebase merge → main 4011cda;8.5 沉澱 2bd868e;next-time P2 8eec1f4。
- **User 過目:通過**(「可以了 沒問題」)— SC-4 / SC-7 雙層驗收(AI 截圖 + user 過目)完成。
- 追加(user 要求,流程外 🔴 紅先行):preset 擴為 1/2/3/4/5/10/20(4225e34 紅 →
  b849f42 綠;changelog 同 ship event 併入;vitest 110P / build 0 / equity e2e 42P)。
- 試用 dev server(:8000 / :5175)已關閉。

## E 包驗紅紀錄(PLAN R6 驗紅義務)

- E43 mutation:`toHaveText("500")` → `toHaveText("100")` → 紅
  `Expected: "100" / Received: "500"`(證實明細列真的是聚合值,非偽綠)。
- E44 mutation:檔名斷成 `bubble_2330_2026-06-25.png` → 紅
  `Received: "bubble_2330_2026-06-26.png"`。
- 兩者皆以 Edit 還原(未用 git checkout/restore),還原後 `-g "E43|E44"` 2 passed。

## [已結案] Blocker:E39 紅 — R15 工具欄寬度預算失守(Task C 引入,非 Task E)

**結案(commit 112a766)**:R15 fallback 已擇定並落地 — BubbleDaysSelector 移中欄
統計行(bubble-stats-row)右端(ml-auto),截圖鈕留工具欄。1280px header 高度:
無選取 319→106px / 選2分點 437→224px / solo 391→226px;solo 切換高度變動 46→2px
(E39 紅因消除)。`npx playwright test specs/equity.spec.ts` 41 passed(E39/E43/E44
全綠)、vitest 104P、build 0。selector 淨成本三態一致 +27px;殘餘 +32px 來自
截圖鈕(可接受,Phase 6 視覺驗收再核)。

以下為原始記錄(保留追溯):

- 現象:`equity.spec.ts` E39 在 1280×720 穩定紅(repeat×2 皆紅),
  `bubble-solo-badge` 第三次點擊後不出現。
- 二分定位:`git checkout da71ce1`(本 feature 開工前)同一 spec **綠**;
  回 HEAD 紅 → 由 Task A-D 引入。
- 根因(量測,bubble-header boundingBox @1280 viewport,面板寬 669px):
  | | 無選取 | 選 2 分點 | solo 開 |
  |---|---|---|---|
  | da71ce1(前) | — | 165px | 167px |
  | HEAD(後) | 319px | 437px | 391px |
  工具欄多了 BubbleDaysSelector(5 顆)+「截圖」鈕 ≈ +170px,lg 斷點中欄
  `minmax(0,1fr)` 被壓成約一字寬 → 中欄統計文字與「輸入區間/截圖」直排、
  header 撐高 2.6 倍、圖區從 ~397px 壓到 125px。solo 切換使 header 高度
  變動 46px → E39 用一次算好的 circle 座標連點三次時目標已位移。
- 證據截圖:`implementation/e39-toolbar-wrap-1280.png`。
- 這正是 design §3 [R15] 預留的情境,預先拍板的 fallback =
  **「selector 移中欄統計行右端」**;屬 Task C 檔案(ChipBubbleView.tsx)+
  design §6.1 驗證義務,未在 E 包內擅自改(scope 紀律)。
- 修好後需重跑:`npx playwright test specs/equity.spec.ts`(E39 應回綠)。
