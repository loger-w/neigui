# Feature: $ARGUMENTS

(若 $ARGUMENTS 為空,先問我要做什麼功能再繼續。)

共通鐵則套用 `~/.claude/CLAUDE.md`。自主模式契約見 `~/.claude/commands/auto.md`(下稱 /auto)。
Phase 細節放在 `~/.claude/harness/refs/`,各 phase 就地指路 —— 不到那個 phase 不必讀。

## 核心原則(全程適用)

- **Artifacts 釘檔**:每 phase 產物寫到 `.claude/feat/<slug>/`,跨 session 可 resume。
  superpowers 的產物落點與「設計文件先 commit」要求**顯式覆寫**,操作面見 `refs/sp-overrides.md`。
- **Review 輪數(2026-07-26 實證改版,依據見 RATIONALE)**:spec review 預設 **1 輪**、
  code review **1 輪深度優先**;加輪條件見各 phase,無其他重跑。Tech pivot(換架構重做)
  **必須先向 user 回報並取得批准**。此條顯式覆寫 superpowers 的「repeat until approved」。
- **Finding 處置分級**:spec review 的 P0/P1 → 先機械反證(grep / Read 可查證者),站得住就修;
  修不動或與 SC 互斥才走 `receiving-code-review` 三分類。P2 彙總計數,不逐條處理。
  code review 維持 receiving 全紀律(該環節誤報率實測 24%,把關有效;spec reviewer 實測
  99.6% 被 accept,逐條 receiving 是儀式)。
- **P1 帶額度退場**:Phase 1/2 退出條件「無 P0 且 P1 ≤ 2(入 Known Risks)」,**顯式覆寫**
  鐵則 G 的「無 P0/P1」— 餘 P1 已具名落檔追蹤,非默默放掉。
- **失敗類型分流**:Phase 7 失敗依類型(goal 漏 / design 漏 / impl 漏 / test 漏)回對應 phase。
  **分流敘述只在 FAIL 時寫;通過的 SC 不逐條聲明 N/A**(全 N/A 分流段落是實測空轉樣態)。
- **回退記帳**:任何回退(Phase N 失敗回上游)在 state.json `rollbacks` append 一筆
  `{sc, from, to, reason}`(Phase -1 豁免)。**同一 SC 出現第 2 筆 → 停下升級回 Phase 0/1**
  (meta-cycle)。
- **state.json 為唯一資料源**:**每完成一個 phase 立即回寫 `current_phase` / `completed_phases`**。
- **讀檔紀律**:同 phase 要讀的多支 refs / 檔案在**單一 message 平行 Read**(turn 數是實測
  第二大成本因子)。codebase 的架構 / 檔案關係 / caller 類問題,`graphify-out/graph.json`
  存在時**先 `graphify query "<問題>"`(直接跑 CLI,不載入 skill)**,query 答不了再 Grep / Read。

## Phase -1:工作區隔離 + artifact 釘定

依 `refs/feat-state.md` 執行三步(branch-lifecycle 開工節 → 建 artifact 目錄並排除版控 →
建 state.json,schema 在該 ref)。monorepo / 長隔離改呼叫 `superpowers:using-git-worktrees`,
worktree 路徑寫 state.json。

## Phase 0:Brainstorm + 可驗證性 gate + S/M/L 分流

1. 呼叫 `brainstorming`,**遵循 skill 的對話流程**(一次一問、2-3 方案、分節確認)。
   以下是疊在 skill 之上的**加值 gate**,不取代其流程。
   **提問姿態分流(2026-07-27 拍板)**:user 帶**已成形方案**(判準見 `refs/feat-phase0-2.md`,
   拿不準預設模糊 idea)→ 提問階段改用 `grilling` 姿態(逐分支決策樹、一次一題、每題附
   建議答案;事實自查環境,決策問 user),「提 2-3 方案」縮成「確認 user 方案 + 至多一個
   counter-proposal」,拷問至共識、**user 拍板後**直進 SC gate。模糊 idea → 照現行
   brainstorming 不變。兩路共識同樣落 `brainstorm.md`,SC gate / S/M/L 分流照常。
   **疊 /auto 不豁免拍板**:已成形方案的 grilling 共識拍板視同 auto.md「仍必停」清單
   (blocker 不是 gate),不因自主模式自問自答續跑;規格來自 user 撰寫 / 已拍板**文件**者
   不觸發本分流,照 auto.md 預核准替代條件走。
2. **SC gate**:每條成功條件編號 `SC-1, SC-2…`,強制附「驗證方式」一行(指令 / 測試名 /
   截圖步驟)。**量化 SC(size / time / count)必附 measurement unit + 量法指令** —
   `size ≤ 50 KB` 不合格,要寫 `size ≤ 50 KB(gzip 後;量法 curl --compressed | wc -c)`。
   **驗證有外部時效窗口的 SC(僅盤中可驗 / 僅特定交易日可跑)必標「驗證窗口」**
   (anytime / 盤中 / 特定日)**+ 窗口外的降級策略** — Phase 0 就決定,不留給 review 補抓。
   **UI / 畫面類 SC 必寫成「畫面可指認」表述**(位置 / 文字 / 顏色 / 元素)—
   `顯示分點排行` 不合格,要寫 `頁面右上出現「分點排行」tab,點入後表格首欄為分點名稱(繁中)`。
   e2e assertion 與截圖驗收都以此表述為準,轉譯不留歧義空間(2026-07-27 拍板:e2e 綠 ≠
   user 要的畫面,根因是 assertion 轉譯歧義)。
   寫不出 → 該條不合格(gate 不是建議)。
3. 寫 `brainstorm.md`;寫入要求與「沿用前輪設計時的跨輪約束掃描」見 `refs/feat-phase0-2.md`。
4. **S/M/L 分流**(寫 `state.json.scope`):判準見 `refs/scope-tiers.md`。

## Phase 1:設計 spec(M/L: 1 輪 + 條件加輪;S: 跳過)

1. 呼叫 `writing-plans` 寫 `design.md`:架構 / 檔案組織 / 資料流 / 邊界 / 接點;
   每條 SC-N 對應設計章節;標版本 v1(後續改 → v2…,檔頭保留 changelog)。
2. Review 依 `refs/review-protocol.md` A 節 dispatch `design-reviewer`,**預設 1 輪**。
3. **加輪條件(至多 1 次)**:round 1 有 accepted P0 → 修復後補一輪**限縮 review**:
   dispatch prompt 只指向 changelog / amendment 段落,審「fix 是否改出新矛盾 / 漏更新
   交叉引用」,不重掃全文(實證:round 2 的 P0 幾乎全是 round-1 fix 自己造成的)。
4. **退出條件**:無 P0 且 P1 ≤ 2(餘 P1 逐條寫入 design.md `## Known Risks`)→ 進 Phase 2。
   限縮輪後仍有 P0 → 結構化回報(剩哪些 P0 + 為何 suggested_fix 被拒 + 推測根因),
   user 三選一:[1] 縮 scope 回 Phase 0 /[2] tech pivot(user 批准後輪數歸零)/
   [3] 接受 P0 寫入 `## Known Risks`。

## Phase 2:Implementation spec(單一 condensed PLAN.md;S: 簡化版)

1. 寫 `implementation/PLAN.md`,每檔一節 3-5 行;粒度要求與 Phase 3 對齊規則見
   `refs/feat-phase0-2.md`。(`per_file` 模式已廢除 — 7/7 run 全選 condensed,0 次使用。)
2. Review 依 `refs/review-protocol.md` A 節:對 PLAN.md dispatch **單一** `impl-spec-reviewer`
   (逐節視同逐檔套 criteria),**固定 1 輪**(round 2 實測 0 條 accepted P0/P1)。
   accepted P0/P1 修入 PLAN.md 即進 Phase 3,不重跑 review。
3. finding 暗示問題在 design → 回 Phase 1(記 rollbacks)。

## Phase 3:TDD + 文件同步 + commit 三分類

1. 呼叫 `test-driven-development`。實作模式表、多 task dispatch 的三條紀律、
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
4. **next-time.md 鉤子**:Phase 3 開工前 cat `docs/next-time.md` 一次,順手改動衝動隨時寫入
   (Phase 8 收尾前會再 cat 一次)。**Subagent 模式下 main agent 在每 task dispatch 前代查**
   (fresh context 的 subagent 不知道檔案存在)。
   (「每次 commit 前 cat」實測執行率 17%,改 checkpoint 制。)
5. 套鐵則 F:同一輪 red → green 修不過 3 次 → 停下回報三策略 + 推測根因。

## Phase 4:自評 — 單輪深度優先 → receiving → 依層級回對應 phase

1. 依 `refs/review-protocol.md` B 節跑 code review(**預設 medium 檔位**;全量掃描保留給 user
   顯式要求;lens 差異化 + verify **同輪內完成**),**雙焦點**:(a) implementation bug;
   (b) **missing-from-spec** — 回看 design.md 交叉確認「spec 機制在 impl 有沒有 spec 沒提到的
   副作用」。寫 `code-review-round-1.json`。
   - **輸出契約**:round JSON 只逐條展開 P0/P1;P2 慣例 / 風格類彙總為 `p2_summary`
     (計數 + 主題一行),**不逐條 receiving**。例外:P2 中疑似行為級(資料正確性 / 時序 /
     邊界)照常展開。
   - **Diff 先落檔**:main agent 先 `git diff <start_sha>..HEAD > review-diff.txt`,finder
     prompt 指向該檔,需要脈絡才開全檔(subagent 重複讀 design.md / 全源檔實測佔 /feat
     成本大宗)。**例外(2026-07-27 拍板):(b) 焦點必讀 design.md 的 SC 對應章節與接點節**
     (章節名以 design.md 實際結構為準,main agent 圈定行號範圍)— spec 對照不受
     「按需才開檔」裁量,dispatch prompt 直接附行號範圍。
2. 呼叫 `receiving-code-review` 對每條 finding 分類(code review 全紀律,
   見核心原則「Finding 處置分級」)。
3. accepted 依層級回對應 phase:spec 漏 → Phase 1/2 改文件 / impl 漏 → Phase 3 / test 漏 →
   Phase 3 紅先行(鐵則 C)。**test-gap finding 的 lock test 與 mutation 抽驗操作見
   `refs/feat-phase4-fix.md`**。
   **同檔混類 finding(fix + refactor 同一檔)**:fix 先落地先 commit(必要時分批 add / Edit),
   refactor 類後動 — 不准一次 `git add` 全檔混 commit。
4. **退場條件**:accepted 修完 + 自動化測試綠 → 出場,**不重跑全量 review**。fix 波及原
   findings 之外的檔案 → main agent 對該增量 diff 機械快篩(grep / 相關測試),不 dispatch。
5. 自評收斂後把當下 HEAD sha 寫入 state.json `self_review_head`(收尾節判增量 review 的唯一依據)。

## Phase 5:自動化驗證

1. 呼叫 `auto-verify` skill — 專案形狀偵測與驗證指令來源**以該 skill 為單一 source of truth**。
   偵測不到驗證指令 → 停下問。
2. 任一步紅 → 鐵則 F 3 次上限;回退時記 rollbacks(可歸 SC 的填 sc,不可歸填 `_unscoped`)。
3. 每輪輸出 `automated-verification-round-<N>.json`(step / command / exit_code / stderr_tail /
   hypothesis / strategy_tried);全綠寫 summary 進 `automated-verification.md` 才進 Phase 6。

## Phase 6:真實環境驗證

1. 呼叫 `auto-verify` skill 的「真實環境驗證」節(feature shape 分流表以 skill 為準)。
2. **Subsumed 判定**:feature shape = web 且該 SC 已有 Playwright e2e 覆蓋(Phase 5 跑過真
   backend + 真 browser)→ 該 SC 標 `subsumed by Phase 5`,不重複 DevTools MCP 截圖。
   **限縮(2026-07-27 拍板):只適用純 regression SC** — 本輪新增 / 改動的 UI SC 第一輪
   一律真截圖(e2e assertion 是模型轉譯的,轉譯錯照樣綠;新畫面首次人眼驗證不可被頂替)。
3. **Infra_fail 標準 case 與 fallback 路徑以 `auto-verify` 真實環境節為準**。本流程只補記帳
   規則:不算 SC 回退,state.json 記 `phase_6_blocked_reason`;fallback 的 UI SC 註記寫進
   Phase 7 evidence 欄。
4. **real-env finding 的修復 commit 文法**:掛 `[green]` + body 註 `Phase 6 real-env finding`
   (`check_feat_tags.py` 豁免 (b)),**不掛 `[red][green]` 雙 tag**(掛錯實測要線性重建 commit)。
5. **失敗回退**(記 rollbacks):(a) 情境沒列 SC → 回 Phase 0 補 SC /(b) SC 有列
   design 沒兼顧 → 回 Phase 1 /(c) 測試漏 → 回 Phase 3 先寫紅。
6. 證據放 `evidence/`,檔名含 SC-N(例:`SC-2_login-empty-input.png`);每輪輸出
   `real-env-verification-round-<N>.json`。

## Phase 7:回頭核 goal — 結構化證據表 + meta-cycle

1. **進入前 state.json 一致性自檢**:`current_phase` / `completed_phases` 與實際 artifact
   (review JSON / evidence 檔)對得上;不符先補回寫再開始。
2. 呼叫 `verification-before-completion`,重新讀 brainstorm.md 不憑記憶。
3. **強制結構化表格**,固定落檔 **`phase7-verification.md`**(16 run 實測出現 9 種檔名,
   收斂為一)(每 SC-N 一列):

   | SC-N | 實作檔案:行號 | 自動化測試名 + pass count | real-env 證據路徑 | regression 抽樣對象 |
   |---|---|---|---|---|

   任一欄出現「N/A」「verified ✓」「應該可以」→ 直接視為未完成。**例外**:real-env 欄允許
   `infra_fail: <reason>`(須對應 state.json `phase_6_blocked_reason`)或
   `subsumed by Phase 5: <e2e spec#>`(僅純 regression SC 可標,與 Phase 6 限縮同判準;
   2026-07-27 拍板)。
4. **失敗類型四分流**(只寫 FAIL 的那條,通過不逐條聲明):(1) goal 沒被 design 涵蓋 →
   Phase 1 /(2) design 有實作沒做 → Phase 2/3 /(3) 實作有做測試漏 → Phase 3 先寫紅 /
   (4) goal 模糊互斥 → Phase 0 改寫 SC(舊 SC 的 rollbacks 記錄移 `docs/next-time.md` 備查,
   新 SC 從零起算)。
5. Meta-cycle:每次不通過記 rollbacks;同 SC 第 2 筆 → 強制升 Phase 0/1。
   兩輪仍不滿足 → 鐵則 F 找 user:[a] 改寫 SC /[b] 降 known-gap 寫 `docs/next-time.md` /
   [c] 繼續迭代。

## Phase 8 / 8.5:收尾與沉澱

依 `refs/feat-phase8.md`,順序為 tag 驗證 → artifact commit → `branch-lifecycle` 收尾節
(**顯式覆寫** `superpowers:finishing-a-development-branch` 的三選一互動),接著 Phase 8.5 的
(A) domain 學習落點 /(B) 流程瑕疵候選 /(C) meta-review 觸發檢查。
收尾前 cat `docs/next-time.md`;`graphify-out/` 存在且本輪動了 code → 收尾節前跑
`graphify <專案根> --update`(AST 增量,免 LLM)。

## Done

**Phase 8 完成 + Phase 8.5 (A)(B)(C) 都處理**才算結束:Phase 7 表格全綠 / Phase 8 tag 驗證過
+ artifact commit / 沉澱寫入 + meta-review 檢查,缺一不可。
