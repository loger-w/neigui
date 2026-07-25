# Feature: $ARGUMENTS

(若 $ARGUMENTS 為空,先問我要做什麼功能再繼續。)

共通鐵則套用 `~/.claude/CLAUDE.md`。自主模式契約見 `~/.claude/commands/auto.md`(下稱 /auto)。
Phase 細節放在 `~/.claude/harness/refs/`,各 phase 就地指路 —— 不到那個 phase 不必讀。

## 核心原則(全程適用)

- **Artifacts 釘檔**:每 phase 產物寫到 `.claude/feat/<slug>/`,跨 session 可 resume。
  superpowers 的產物落點與「設計文件先 commit」要求**顯式覆寫**,操作面見 `refs/sp-overrides.md`。
- **Receiving 紀律**:所有 RECEIVING feedback(sub-agent JSON / review 協定 finding / 環境問題)
  一律過 `superpowers:receiving-code-review` 分類 `accepted` / `rejected_with_reason` /
  `needs_more_context`,絕不照單全收。
- **Review 輪數上限 3**:**顯式覆寫** superpowers 的「repeat until approved」無上限迴圈。
  **Tech pivot(換架構重做)想重置計數 → 必須先向 user 回報並取得批准**,不准自行續跑超限。
- **P1 帶額度退場**:Phase 1/2 退出條件「無 P0 且 P1 ≤ 2(入 Known Risks)」與 Phase 4 的單輪
  退場條件,**顯式覆寫**鐵則 G 的「無 P0/P1」— 餘 P1 已具名落檔追蹤,非默默放掉。
- **失敗類型分流**:Phase 7 失敗不是無腦回 Phase 3,依失敗類型(goal 漏 / design 漏 /
  impl 漏 / test 漏)回對應 phase。
- **跨 phase meta-cycle**:同 SC 單 phase 回退 ≥ 2 次或跨 phase 累計 ≥ 3 次 → 升級回 Phase 0/1,
  計數寫 `state.json.sc_cycle_counts`(Phase -1 豁免)。
- **state.json 為唯一資料源**:**每完成一個 phase 立即回寫 `current_phase` / `completed_phases`**。
- **Findings 量大先收斂**:任何 review 收回 > 10 findings → 先 group-by-file dedup + severity
  rank,合併成單一 round JSON 再處理,不逐條原樣 list。

## Phase -1:工作區隔離 + artifact 釘定

依 `refs/feat-state.md` 執行三步(branch-lifecycle 開工節 → 建 artifact 目錄並排除版控 →
建 state.json,schema 在該 ref)。monorepo / 長隔離改呼叫 `superpowers:using-git-worktrees`,
worktree 路徑寫 state.json。

## Phase 0:Brainstorm + 可驗證性 gate + S/M/L 分流

1. 呼叫 `superpowers:brainstorming`,**遵循 skill 的對話流程**(一次一問、2-3 方案、分節確認)。
   以下是疊在 skill 之上的**加值 gate**,不取代其流程。
2. **SC gate**:每條成功條件編號 `SC-1, SC-2…`,強制附「驗證方式」一行(指令 / 測試名 /
   截圖步驟)。**量化 SC(size / time / count)必附 measurement unit + 量法指令** —
   `size ≤ 50 KB` 不合格,要寫 `size ≤ 50 KB(gzip 後;量法 curl --compressed | wc -c)`。
   **驗證有外部時效窗口的 SC(僅盤中可驗 / 僅特定交易日可跑)必標「驗證窗口」**
   (anytime / 盤中 / 特定日)**+ 窗口外的降級策略** — Phase 0 就決定,不留給 review 補抓。
   寫不出 → 該條不合格(gate 不是建議)。
3. 寫 `brainstorm.md`;寫入要求與「沿用前輪設計時的跨輪約束掃描」見 `refs/feat-phase0-2.md`。
4. **S/M/L 分流**(寫 `state.json.scope`):判準見 `refs/scope-tiers.md`。

## Phase 1:設計 spec(L: max 3 輪;M: 1 輪;S: 跳過)

1. 呼叫 `superpowers:writing-plans` 寫 `design.md`:架構 / 檔案組織 / 資料流 / 邊界 / 接點;
   每條 SC-N 對應設計章節;標版本 v1(後續改 → v2…,檔頭保留 changelog)。
2. Review 迴圈依 `refs/review-protocol.md` A 節(dispatch `design-reviewer` → 落檔 →
   receiving 分類 → 重跑)。
3. **退出條件**:該輪無 P0 **且 P1 ≤ 2**(餘 P1 逐條寫入 design.md `## Known Risks`)→
   reset `phase_1: 0`,進 Phase 2。
4. **3 輪上限後仍有 P0** → 結構化回報(剩哪些 P0 + 為何 suggested_fix 被拒 + 試過的方向 +
   推測根因),user 三選一:[1] 縮 scope 回 Phase 0 /[2] 換技術方向重寫(**計次歸零需 user
   此處批准**)/[3] 接受 P0 寫入 `## Known Risks`。

## Phase 2:Implementation spec(L: max 3 輪;M: 1 輪;S: 簡化版)

1. **模式選擇**(寫 `state.json.phase_2_mode`):**預設 `condensed`**;`per_file` 降為 opt-in。
   兩者的粒度要求與 Phase 3 對齊規則見 `refs/feat-phase0-2.md`。
2. Review dispatch 依 `refs/review-protocol.md` A 節:`condensed` → 對 PLAN.md dispatch
   **單一** `impl-spec-reviewer`(逐節視同逐檔套 criteria);`per_file` → 用
   `superpowers:dispatching-parallel-agents` fan-out 每檔一個。
3. 退出條件:全檔無 P0 且 P1 ≤ 2(進 Known Risks)→ reset 進 Phase 3。
4. 3 輪上限後仍有 P0 → [1] 縮 scope 回 Phase 0 /[2] finding 暗示問題在 design → escalate
   回 Phase 1(計次歸零需 user 批准)/[3] 接受寫入 Known Risks,Phase 7 表格 regression 欄必涵蓋。

## Phase 3:TDD + 文件同步 + commit 三分類

1. 呼叫 `superpowers:test-driven-development`。實作模式表、多 task dispatch 的三條紀律、
   失敗回退表見 `refs/feat-phase3.md`。
   **本流程不呼叫 `superpowers:subagent-driven-development`** — 改用 Workflow / 逐 task
   dispatch,該 skill 的流程紀律(每 task review gate、跨 compaction ledger、禁並行 implementer)
   已摘寫進上述 ref。
2. **TDD commit 各帶 tag**(Phase 8 機械化驗證):
   - 紅測試:`git add <測試檔>` + `🟢 test(<area>): add failing test for SC-N [red]`
   - 實作到綠:`git add <實作檔>` + `🟢 feat(<area>): implement SC-N [green]`
     (body 註 `red→green for <red-sha>`)
   - Refactor:`🔵 refactor(<area>): ... [refactor]` — **有重構才加**,不列強制順序
   - **goal_efficiency_mode**(見 auto.md):可改 wave batch,單 `[waveN]` tag
   - **Tag 判準**:`[green]` 只掛在有對應 `[red]` 的 commit;同步產物(e2e spec 補寫 /
     changelog / 版本 pin / build-gate 修 / flake 修)**不掛 TDD tag**,只用 🟢/🔵/🔴 分類
3. 新發現 case 的處置與 test-infra 例外見 `refs/feat-phase3.md`。
4. **next-time.md 鉤子**:每次 commit 前 cat `docs/next-time.md`,順手改動衝動寫進去或拆獨立
   commit。**Subagent 模式下 main agent 在每 task dispatch 前代查**(fresh context 的
   subagent 不知道檔案存在)。
5. 套鐵則 F:同一輪 red → green 修不過 3 次 → 停下回報三策略 + 推測根因。

## Phase 4:自評 — 雙焦點 → receiving → 依層級回對應 phase

1. 依 `refs/review-protocol.md` B 節跑 code review(**預設 medium 檔位**;全量掃描保留給 user
   顯式要求),**雙焦點**:(a) implementation bug;(b) **missing-from-spec** — 回看 design.md
   交叉確認「spec 機制在 impl 有沒有 spec 沒提到的副作用」。寫 `code-review-round-<N>.json`。
   - **輸出契約**:round JSON 只逐條展開 P0/P1;P2 慣例 / 風格類彙總為 `p2_summary`
     (計數 + 主題一行),**不逐條 receiving**。例外:P2 中疑似行為級(資料正確性 / 時序 /
     邊界)照常展開。
2. 呼叫 `superpowers:receiving-code-review` 對每條 finding 分類。
3. accepted 依層級回對應 phase:spec 漏 → Phase 1/2 改文件 / impl 漏 → Phase 3 / test 漏 →
   Phase 3 紅先行(鐵則 C)。**test-gap finding 的 lock test 與 mutation 抽驗操作見
   `refs/feat-phase4-fix.md`**。
   **同檔混類 finding(fix + refactor 同一檔)**:fix 先落地先 commit(必要時分批 add / Edit),
   refactor 類後動 — 不准一次 `git add` 全檔混 commit。
4. **退場條件**:round 1 accepted ≤ 5 且無 P0 且 fix 後自動化測試全綠 → 可單輪退場;
   accepted > 5 或有 P0 → 強制 round 2 verify。loop max 3 輪。
5. 完成後跑 **inline 完工自查 checklist**(不呼叫 requesting-code-review — 該 skill 是
   dispatch reviewer 流程,不是自查):測試齊全 / commit 分類分明 / 文件同步 / known-risk 已標記。
6. 自評收斂後把當下 HEAD sha 寫入 state.json `self_review_head`(收尾節判增量 review 的唯一依據)。

## Phase 5:自動化驗證

1. 呼叫 `auto-verify` skill — 專案形狀偵測與驗證指令來源**以該 skill 為單一 source of truth**。
   偵測不到驗證指令 → 停下問。
2. 任一步紅 → 鐵則 F 3 次上限。失敗映射:可歸 SC-N → `sc_cycle_counts.SC-N.phase_5 += 1`;
   不可歸(global tsc error 等)→ `_unscoped.phase_5 += 1`。
3. 每輪輸出 `automated-verification-round-<N>.json`(step / command / exit_code / stderr_tail /
   hypothesis / strategy_tried);全綠寫 summary 進 `automated-verification.md` 才進 Phase 6。

## Phase 6:真實環境驗證

1. 呼叫 `auto-verify` skill 的「真實環境驗證」節(feature shape 分流表以 skill 為準)。
2. **Subsumed 判定**:feature shape = web 且該 SC 已有 Playwright e2e 覆蓋(Phase 5 跑過真
   backend + 真 browser)→ 該 SC 標 `subsumed by Phase 5`,不重複 DevTools MCP 截圖。
3. **Infra_fail 標準 case 與 fallback 路徑以 `auto-verify` 真實環境節為準**。本流程只補記帳
   規則:不算 SC 回退,`_unscoped.phase_6 += 1` + state.json 記 `phase_6_blocked_reason`;
   fallback 的 UI SC 註記寫進 Phase 7 evidence 欄。
4. **失敗回退**(依 cycle-count rule 記數):(a) 情境沒列 SC → 回 Phase 0 補 SC /(b) SC 有列
   design 沒兼顧 → 回 Phase 1 /(c) 測試漏 → 回 Phase 3 先寫紅。
5. 證據放 `evidence/`,檔名含 SC-N(例:`SC-2_login-empty-input.png`);每輪輸出
   `real-env-verification-round-<N>.json`。

## Phase 7:回頭核 goal — 結構化證據表 + meta-cycle

1. **進入前 state.json 一致性自檢**:`current_phase` / `completed_phases` 與實際 artifact
   (review JSON / evidence 檔)對得上;不符先補回寫再開始。
2. 呼叫 `superpowers:verification-before-completion`,重新讀 brainstorm.md 不憑記憶。
3. **強制結構化表格**(每 SC-N 一列):

   | SC-N | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據路徑 | regression 抽樣對象 |
   |---|---|---|---|---|

   任一欄出現「N/A」「verified ✓」「應該可以」→ 直接視為未完成。**例外**:real-env 欄允許
   `infra_fail: <reason>`(須對應 state.json `phase_6_blocked_reason`)或
   `subsumed by Phase 5: <e2e spec#>`。
4. **失敗類型四分流**:(1) goal 沒被 design 涵蓋 → Phase 1 /(2) design 有實作沒做 →
   Phase 2/3 /(3) 實作有做測試漏 → Phase 3 先寫紅 /(4) goal 模糊互斥 → Phase 0 改寫 SC
   (舊 SC 計數移 `docs/next-time.md`,新 SC 從 0 起算)。
5. Meta-cycle:每次不通過更新 sc_cycle_counts;同 SC 回退 ≥ 2 次 → 強制升 Phase 0/1。
   兩輪仍不滿足 → 鐵則 F 找 user:[a] 改寫 SC /[b] 降 known-gap 寫 `docs/next-time.md` /
   [c] 繼續迭代。

## Phase 8 / 8.5:收尾與沉澱

依 `refs/feat-phase8.md`,順序為 tag 驗證 → artifact commit → `branch-lifecycle` 收尾節
(**顯式覆寫** `superpowers:finishing-a-development-branch` 的三選一互動),接著 Phase 8.5 的
(A) domain 學習落點 /(B) 流程瑕疵候選 /(C) meta-review 觸發檢查。

## Done

**Phase 8 完成 + Phase 8.5 (A)(B)(C) 都處理**才算結束:Phase 7 表格全綠 / Phase 8 tag 驗證過
+ artifact commit / 沉澱寫入 + meta-review 檢查,缺一不可。
