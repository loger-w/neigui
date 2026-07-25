# Harness Context 瘦身改版 — design v2

- 日期:2026-07-25
- 範圍:`~/.claude/commands/{feat,mod,perf,refactor,auto,bug}.md` + `~/.claude/skills/{auto-verify,branch-lifecycle}` + `~/.claude/agents/*.md`(四個 reviewer)
- 不在範圍:常駐層(user / 專案 CLAUDE.md、MEMORY.md)、`chore.md`、superpowers plugin 本體

## Changelog

**v2(2026-07-25)** — 5 lens 對抗審視(15 agents)回收 39 條存活 finding、0 條被推翻,其中 2 條 P0。逐條修正,主要變更:

| 變更 | v1 錯在哪 |
|---|---|
| **保留 reviewer「輸出鐵則」不刪**(P0) | v1 理由「Workflow schema 已強制」不成立 — 四個 reviewer 走 Agent-tool `subagent_type` dispatch,不經 Workflow;且 finding 欄位 schema 只寫在那四段裡,刪掉全 harness 無處定義 |
| **刪掉「放寬 `[refactor]` 配對」整條**(P0) | `check_feat_tags.py` 從未有此規則(實測 L76/L80 只計數、零 assertion)。反倒 `[lock]` **有**強制(L86-91 驗 body 含 `mutation-verified`)— §2.2 F2 表 gate 欄寫反了 |
| 停止點名 → 改用 `skillOverrides` 機械關閉 | 「不點名就不載入」不成立:plugin enabled、description 常駐,`using-superpowers` 明令「1% 可能適用就必須 invoke」 |
| 節省重算 102.8 KB → 62.0 KB | v1 的 47,990 含 12,891 bytes 從未命中的條件分支,是虛帳;且 118 KB 的計帳邊界未定義 |
| P1 原則補機械觸發點 | v1 只有原則宣示,正是它自己 P2 判定失守的「第三種狀態」。改用現成的 `PHASE_GATES` + `harness-context.py` 每回合注入 |
| SC-7 改用既有 `scripts/sync-harness-mirror.py --check` | 鏡像早有同步器,v1 當成手動步驟;且現行鏡像是**改名的部分鏡像**,byte 全等必然失敗 |
| SC-4 基準改 109 passed / 8 檔,並同步處置 push-gate 測試 | v1 寫 7 檔;移走 hook 會讓 `test_harness_push_gate.py` 的 17 個 test 全紅 |
| §7.2 補 commit range 來源 | `--state` 是 required、range 來自 `start_sha`;非 feat 流程無 state.json,只換分支 prefix 跑不起來 |
| 撤回 §6 #26、修正 §5.3 | `perf.md:5` 與 `refactor.md:5` 逐字相同,#26 判刪與 #9 判留互斥;且刪 `L1-3` 會讓 `$ARGUMENTS` 進不了 prompt |

---

## 1. 目標與成功條件

**動機**:一輪典型 L 級 `/feat` 在讀到第一行 source code 之前,已載入約 **102.8 KB** 的 instruction 文字。其中大部分與當下 phase 無關,同時稀釋注意力並吃掉窗口。

| SC | 成功條件 | 驗證方式 |
|---|---|---|
| SC-1 | 六個 command 檔總 bytes ≤ 16 KB(現況 41,224) | `Get-ChildItem ~/.claude/commands -Filter *.md \| Where-Object { $_.Name -ne 'chore.md' } \| Measure-Object Length -Sum` |
| SC-2 | 典型 L 級 `/feat` 載入 ≤ 66 KB(現況 102.8 KB) | 新腳本 `~/.claude/hooks/harness_load_estimate.py`,吃 §4.3 的**逐檔清單**求和,輸出 before/after 對照。清單是宣告,腳本只負責求和與比對 |
| SC-3 | §6 保留清單逐條在新結構中可定位 | 逐條 Grep 新檔案樹,產出對照表,無一條 `NOT FOUND` |
| SC-4 | hook 測試全綠,基準不退步 | `cd ~/.claude/hooks && python -m pytest tests -q` = **109 passed**(現況實測)。步驟 9 退役 push-gate 後基準改為 **92 passed / 7 檔**(扣掉該檔 17 個 test),須明確記錄而非默默變動 |
| SC-5 | `/code-review` 死路徑消滅 | `Grep -r "/code-review" ~/.claude/{commands,skills,agents}` 命中數 = 0 |
| SC-6 | 新流程真實環境跑得通 | 用一個真實 `/mod` 或 `/bug` 小案子跑完整流程,附 commit 清單 + 驗證輸出 |
| SC-7 | 鏡像同步器涵蓋新路徑且回報一致 | 先擴 `scripts/sync-harness-mirror.py` 的 `DIR_MAPS` 收 `~/.claude/harness/`(含 `refs/`)與 `skills/*/references/`,再跑 `python scripts/sync-harness-mirror.py --check` exit 0 |
| SC-8 | `skillOverrides` 真的擋掉 SDD | 改完後開新 session,確認 available-skills 清單不再列 `subagent-driven-development`;截圖或清單輸出為證 |

**驗證窗口**:全部 anytime,無盤中限定。

---

## 2. 證據基準

### 2.1 量測(明訂計帳邊界)

v1 最大的帳目問題是沒定義「一輪載入」包含什麼。本版分兩層:

- **邊界 A = 本輪可控層**:六個 command + 兩個共用 skill + 該輪會用到的 reviewer agent + refs。這是本 spec 能改的全部。
- **邊界 B = 整輪實載**:A + 該輪實際會 invoke 的 superpowers skill。

典型 L 級 `/feat` 現況:

| 項目 | bytes | 備註 |
|---|---|---|
| feat.md | 20,938 | |
| branch-lifecycle + auto-verify | 13,323 | |
| design-reviewer + impl-spec-reviewer | 4,689 | change-spec / refactor-plan 不在 /feat 路徑 |
| **邊界 A 小計** | **38,950** | |
| brainstorming / writing-plans / TDD / receiving / verification | 35,818 | 無條件載入 |
| subagent-driven-development | 28,077 | Phase 3「≥3 檔且彼此獨立」— L 級幾乎必中 |
| **邊界 B 典型合計** | **102,845** | |
| (條件式,典型不計)dispatching 6,078 / worktrees 6,813 / finishing 7,022 | 19,913 | 最壞情況 122,758 |

v1 寫的「~118 KB」是把「只取 feat.md 那一組帳」(20,938 + 13,323 + 83,700 = 117,961)與四列相加(146,489)混用的結果,兩者都不是可驗的邊界。本版一律用邊界 B 典型 = **102,845**。

### 2.2 三個實測發現

**F1 — `/code-review` 主路徑不可執行。** agent 無法自行觸發該 user-triggered CLI(`feat-improvements.md` 兩個專案同根因、未結案)。`feat.md:74-79`、`mod.md:33`、`branch-lifecycle:40` 三處圍繞它寫了 3.4 KB 契約,且形成 branch-lifecycle → mod → feat 三段跳交叉引用(skill 反向依賴 command,最脆的耦合方向)。

**F2 — 靠 prompt 自律的規則實測失守,靠 script 機驗的守得住。** neigui 749 commits:

| 規則 | 實測命中 | 機械 gate(**v2 修正**)|
|---|---|---|
| `[red]` / `[green]` 配對 | 44 / 59 | **有** — `check_feat_tags.py` L100-117 |
| `[lock]` + mutation 抽驗 | 2 | **有** — L86-91 強制 body 含 `mutation-verified` |
| `[refactor]`(TDD 第三段) | 7 | **無** — L76/L80 只計數,零 assertion |
| 三類 emoji 全庫 | 336 / 749 = 45%,近 100 筆降至 48% | /feat 有、**/mod 無** |
| `/mod batch-ui-polish` 單一 run | 16 commit **全零** emoji | 無 |

> v1 把 `[refactor]` 與 `[lock]` 的 gate 欄寫反,並據此提出「放寬一條不存在的規則」。這是 v1 唯一會導致空轉工時的錯誤。

其他 never-fired:`per_file` 0/7、meta-cycle 升級 0 次真正執行、`infra_fail` 2/16、`/perf` benchmark 入庫 5 run 只 2 支 script 且不在任何 gate。
**`worktree_path` 16/16 = null 不列入** — 實測 `git worktree list` 有 2 個活躍 worktree,該欄位只是沒回寫,不能推論 worktree 沒在用。

**F3 — 兩條未結案 improvement 的共同根因是「規則落點錯」。** 規則寫在 Phase 8,需要它的時刻在 Phase 4/6。代價:cherry-pick 重建 5 commit(07-18)、線性重建 8 commit(07-21)。

### 2.3 兩輪審視的方法論教訓

第一輪審計 151 條判定被推翻 28 條(18.5%);第二輪對 v1 spec 的審視 39 條存活、**0 條被推翻**。兩輪的錯誤同型:

1. **半覆蓋當全覆蓋** — 拿只寫了一半的來源當刪除理由
2. **配置外推** — 拿 A 配置(workflow ad-hoc agent 帶 StructuredOutput)的實測去推論 B 配置(typed agent,tools 白名單只有 Read/Grep/Glob)
3. **互斥判定原封抄進處置表** — v1 §2.3 自己寫了「套用前必須先統一」,結果 §6 #9 與 #26 照樣互斥

**紀律:凡標「可刪 / 被 X 覆蓋」者,必須逐句對照來源檔,且確認來源與目標是同一配置。**

---

## 3. 設計原則

### P1 — 觸發偵測留核心,處置細節可延後(**附機械觸發點**)

> 「識別觸發的規則無法延後載入 — 不知道自己踩到了,就不會去讀那份 reference。」

每條規則只問:這是**讓我認出情況**,還是**認出後怎麼做**?前者留核心,後者進 ref。

**v1 缺陷**:只有原則宣示,靠「核心每 phase 尾寫一行『進入時先 Read ref』」的自律 —— 那正是 P2 判定為失守的「第三種狀態」。

**v2 機械觸發**:`harness_lib.py` 的 `PHASE_GATES`(L26-38)已經是每 phase 一行的 gate 表,而 `harness-context.py` 註冊在 SessionStart + UserPromptSubmit,**每回合都會把「目前 phase + 該 phase 的 gate」注入 context**。本輪為 `PHASE_GATES` 每列**加一欄 ref 絕對路徑**,由該 hook 一併注入。ref 的載入從自律變成每回合提示。

範例注入內容:
```
[harness] 進行中 /feat:<slug>(branch feat/<slug>)
目前 phase:4 — 此 phase 的 gate:自評 code-review:雙焦點 + 單輪退場條件
此 phase 的 ref:~/.claude/harness/refs/review-protocol.md(尚未讀過就先 Read)
```

### P2 — 能被 hook / script 機驗的,不寫進 prompt 要求自律

F2 是直接證據。做對的樣板已存在兩個:`check_feat_tags.py` 與四個 reviewer agent 固化 criteria。

推論:**規則要嘛有 gate,要嘛承認它是建議**。第三種狀態(寫在 prompt 當 Done 條件但無人驗)最壞 —— 佔 token 又給假保證。

### P3 — Rationale 與規則分離

feat.md 20.9 KB 中約 4.5 KB 是括號內日期實證敘事。規則留祈使句;「為什麼」進 `~/.claude/harness/RATIONALE.md`,只在 meta-review 讀。保留最多 10 字的 why 子句(影響判斷時),刪除事件敘事。

**前提**:`~/.claude` 本身不是 git repo,`neigui/docs/harness/` 鏡像是唯一版控副本。RATIONALE.md 必須進鏡像同步範圍,否則被移出的 4.5 KB 沒有回退路徑(見 §8 步驟 7)。

---

## 4. 目標架構

references 放 **`~/.claude/harness/refs/`**。刻意不放 `commands/` / `skills/` / `agents/` 底下 —— 這三處都會被 Claude Code 掃描,其 description 反而進常駐清單,與目標相反。**reviewer preamble 同理放 refs/,不放 agents/**。

```
~/.claude/
  commands/
    feat.md          20,938 →  ~5,500
    mod.md            5,215 →  ~2,000
    perf.md           4,159 →  ~1,800
    refactor.md       3,698 →  ~1,600
    bug.md            3,503 →  ~1,600   (含新增 artifact 義務)
    auto.md           3,711 →  ~2,600
    chore.md          1,856 →  不動
  harness/
    RATIONALE.md            ~9,000   執行期永不載入(已於本輪先行建立)
    refs/
      reviewer-preamble.md  ~1,400   立場 + severity + **finding 欄位 schema** + cross-round
      review-protocol.md    ~2,200   吸收三處 3.4 KB 重複,改寫為 Workflow 驅動
      scope-tiers.md          ~800   feat + mod 的 S/M/L 合一
      sp-overrides.md         ~600   superpowers 顯式覆寫三條
      feat-phase0-2.md      ~1,800
      feat-phase3.md        ~1,600   **含從 SDD 移植的三條紀律**
      feat-phase4-fix.md    ~1,200   條件式:收到 test-gap finding 才載
      feat-phase8.md        ~1,500
      feat-state.md           ~800
      auto-wave.md            ~500   條件式:goal_efficiency_mode
  skills/
    auto-verify/SKILL.md    5,859 →  ~4,000
    branch-lifecycle/
      SKILL.md              7,464 →  ~4,800
      references/exceptions.md      ~1,500   條件式:撞到異常才載
  agents/                            四檔各刪共用前言,**輸出鐵則移入 refs/reviewer-preamble.md 不刪**
    design-reviewer.md      2,483 →  ~1,500   (neigui domain criteria **留在本檔**)
    impl-spec-reviewer.md   2,206 →    ~800
    change-spec-reviewer.md 1,838 →    ~800
    refactor-plan-reviewer.md 1,715 →  ~700
```

> `agents/*.md` 的瘦身收益是**去重防 drift,不是省 token** —— agent 檔全文只在該 agent 被 dispatch 時載入,一次一個。誠實記在這裡,不計入 SC-2。

### 4.1 最大槓桿:機械關閉 SDD,而非「不點名」

v1 的假設「停止點名 → 不會載入」**不成立**:superpowers plugin 為 enabled,四個 skill 的 description 常駐於 available-skills 清單,且 `using-superpowers` 明令「1% 可能適用就必須 invoke」。Phase 3 的「≥3 檔且彼此獨立」正中 `subagent-driven-development` 的 description。

**v2 做法**:用 `settings.json` 既有的 `skillOverrides` 機械關閉(現有樣板:`web-design-guidelines` / `bencium-innovative-ux-designer` 皆設 `"off"`)。

| skill | bytes | 處置 | 前提 |
|---|---|---|---|
| `subagent-driven-development` | 28,077 | `skillOverrides: "off"` | **必須先把三條紀律移植進 `refs/feat-phase3.md`**(見下)|
| `dispatching-parallel-agents` | 6,078 | 不動 | 實測條件分支(per_file 0/7),典型不載入 → 關掉省不到,且 `auto-verify:48` 仍指涉它 |
| `using-git-worktrees` | 6,813 | 不動 | 實測有 2 個活躍 worktree;且 `EnterWorktree` 契約要求「被 user 或 CLAUDE.md 明確指示」才可用,全刪指標反而沒人授權 |
| `finishing-a-development-branch` | 7,022 | 不動 | 是否真的載入未經證實,不列為節省 |

**淨節省 = 28,077 − 400(移植成本)= 27,677 bytes**,而非 v1 宣稱的 47,990。

#### 從 SDD 移植的三條紀律(缺一不可)

Workflow tool 提供機制(fan-out / pipeline / schema),**不提供 SDD 的流程紀律**。關掉 SDD 前必須把下列三條寫進 `refs/feat-phase3.md`:

1. **每 task 後的 review gate + fix loop** — 不是全部做完才 review
2. **跨 compaction 的 ledger 檔** — SDD 原文稱此為「the single most expensive failure observed」
3. **禁止並行 dispatch implementer**(review / 唯讀分析可並行,實作不行)

### 4.2 `/mod` `/bug` `/refactor` 的載入

三者不載入 SDD、不載入 design/impl reviewer,現況與改版後:

| 流程 | 現況(邊界 B)| 改版後 | 降幅 |
|---|---|---|---|
| /mod M 級 | 5,215 + 13,323 + 1,838 + brainstorming 10,047 + TDD 9,015 = 39,438 | 2,000 + 8,800 + 800 + 19,062 = 30,662 | −22% |
| /bug | 3,503 + 13,323 + systematic-debugging 9,465 + TDD 9,015 = 35,306 | 1,600 + 8,800 + 18,480 = 28,880 | −18% |
| /refactor | 3,698 + 13,323 + 1,715 + TDD 9,015 = 27,751 | 1,600 + 8,800 + 700 + 9,015 = 20,115 | −28% |

降幅比 /feat 小,因為它們本來就薄,剩餘大宗是 load-bearing 且屬 plugin 的 superpowers skill。誠實記錄,不美化。

### 4.3 SC-2 的逐檔清單(典型 L 級 /feat,改版後)

| 檔案 | bytes | 條件 |
|---|---|---|
| `commands/feat.md` | 5,500 | 無條件 |
| `harness/refs/scope-tiers.md` | 800 | Phase 0 |
| `harness/refs/sp-overrides.md` | 600 | Phase 0 |
| `harness/refs/feat-phase0-2.md` | 1,800 | Phase 0-2 |
| `harness/refs/feat-state.md` | 800 | Phase -1 |
| `harness/refs/feat-phase3.md` | 1,600 | Phase 3 |
| `harness/refs/review-protocol.md` | 2,200 | Phase 1/2/4 |
| `harness/refs/feat-phase8.md` | 1,500 | Phase 8 |
| `agents/design-reviewer.md` | 1,500 | Phase 1 |
| `agents/impl-spec-reviewer.md` | 800 | Phase 2 |
| `harness/refs/reviewer-preamble.md` | 1,400 | Phase 1/2 |
| `skills/auto-verify/SKILL.md` | 4,000 | Phase 5/6 |
| `skills/branch-lifecycle/SKILL.md` | 4,800 | Phase -1 / 8 |
| superpowers 保留五支 | 35,818 | 無條件 |
| **小計(典型)** | **63,118** | |
| `harness/refs/feat-phase4-fix.md` | 1,200 | 條件:test-gap finding |
| `skills/branch-lifecycle/references/exceptions.md` | 1,500 | 條件:撞到異常 |
| **最壞情況** | **65,818** | |

SC-2 門檻 66 KB 對應**最壞情況**,留 182 bytes 餘裕 —— 餘裕很薄,實作時任一檔超標就會 FAIL,這是刻意的。

---

## 5. 逐檔處置

### 5.1 feat.md(20,938 → ~5,500)

**留核心**:檔頭骨架(含 auto.md 契約指標)、四條核心原則、SC gate 完整版(含驗證窗口)、S/M/L 一行 + ref 指標、Phase 骨架十行、TDD tag 判準、Phase 4 雙焦點 + P2 彙總契約 + `self_review_head` 寫入、**Phase 6 失敗回退 (a)(b)(c) + real-env round JSON 產物要求**、Phase 7 五欄證據表、state 回寫一行、**commit 前 cat `docs/next-time.md`(含 subagent 由 main agent 代查的規則)**、Done 一句。

> 後兩項 v1 在 §6 判「feat 核心」但 §5.1 兩張清單都沒列到 —— v2 明確補列。

**進 ref**:Phase -1 setup、延續型 feature 掃前輪指示、Phase 1/2 review 迴圈細節、實作模式表、Phase 3 失敗回退表、Phase 4 快篩四條 + 修 finding 操作、Phase 8 收尾操作、Phase 8.5 沉澱、state schema。

**刪**:`superpowers:subagent-driven-development` 點名(改 `skillOverrides` + 移植三條紀律)、`git add` 的「不要 `-A`」(`safety-hooks.py` 已 deny)、鐵則 F 重述、「等使用者確認」(brainstorming HARD-GATE 已有)、自主模式建議節、所有日期實證敘事(→ RATIONALE)。

**不刪**(v1 誤判):`using-git-worktrees` / `finishing-a-development-branch` 的指標句。

**改寫**:Phase 4 步驟 1 由「跑 `/code-review`」改為「依 `refs/review-protocol.md` 跑 Workflow 驅動 review」(F1)。

### 5.2 mod.md(5,215 → ~2,000)

留:檔頭 L5 指標句、Phase 1 caller map 落檔義務、Phase 2 行為白名單、Phase 4 三類順序 🔵→🔴→🟢 與「🔴 先改既有測試讓它紅」、Phase 5 inline 自查、Phase 6「不該紅 → 不改 assertion」、Phase 7 白名單逐條 + migration 真實環境、Phase 8 白名單打勾 + migration 可逆。
刪:開工括號步驟、S/M/L 重寫(→ `refs/scope-tiers.md`)、自主模式建議節(退出條件範例移入 auto.md 表)、SC gate 重述、禁止清單與鐵則 B/E 重疊條、收尾括號說明。

### 5.3 perf.md(4,159 → ~1,800)

留:**L1 標題與 `$ARGUMENTS` 插槽、L3 空參數提問**(perf.md 只有這兩處 `$ARGUMENTS`,刪掉使用者輸入的 metric 進不了 prompt)、檔頭 L5 指標句、量化目標 gate 三件、「root bottleneck 不是旁支」判準、3 輪定位不到 → 重新定義目標、cache invalidation 三欄、一策略一 commit、Phase 5 量其他不該退化的 metric、Phase 6「結果跟優化前完全一樣」+ 大量輸入 edge。
刪:L3 中與 Phase 1 gate 三重的「目標數字是多少」重述(只刪重述,保留提問句本身)、禁止清單與鐵則重疊條。
**改寫**:`perf.md:17` 目前顯式指涉 auto-verify 的「何時呼叫」節(該節將被刪)→ 改寫成自帶「baseline 量測前先跑 auto-verify 自動化節」,不留懸空指涉。
**撤回 v1 誤判**:perf.md 沒有「auto-verify 抽樣數重述」這句(實測零命中),該刪除項取消。

### 5.4 refactor.md(3,698 → ~1,600)

留:檔頭 L5 指標句、Why? gate、characterization test 義務、每步保持綠 + 100 行拆分門檻、「紅時預設 refactor 改錯」的 implementation-detail 例外與切 /mod 出口、Phase 5 grep caller blast radius、砍 dead code 查動態用法、大爆炸禁令。
刪:收尾括號步驟與日期、自主模式建議節、auto-verify 抽樣數重述(`refactor.md:19`,**此處確實存在**)、鐵則 B/E 重疊條。

### 5.5 bug.md(3,503 → ~1,600)

留:檔頭 L5 指標句、穩定重現 gate、一次一假說、紅測試先行、最小修改、`🔴` commit 標記、Phase 5 blast radius、Phase 8 反向驗證、Phase 9 留尾巴。
**裁決 `bug.md:19`**(v1 漏判):該行的「抽 2 個沒改的相關功能」與 auto-verify:62 重複 → **刪重述,保留 /bug 特有的「重走 Phase 1 重現步驟,現在不會發生」**。
刪:鐵則 F 全文重寫(改一句引用)、自主模式建議節、禁止清單重疊條。
新增:`.claude/bug/<slug>/repro.md` 落檔義務(見 §7.4)。

### 5.6 auto.md(3,711 → ~2,600)

覆核明確警告 1,350 bytes 目標過激。auto.md 幾乎全是 load-bearing 政策,且它本身已是按需載入。

留:退出條件語法、退出條件成立後總結並列出所有 `[auto-default]`、3 次不成立上限、自動核准範圍、**方向性抉擇判定準則**(觸發偵測,不可延後)、review loop 免問授權、必停三類含 push/merge 除外括號、各流程建議用法表。
移入:mod S/M 級退出條件範例(現表缺此列)。
進 ref:`goal_efficiency_mode` 整節 → `refs/auto-wave.md`(含「全 SC 有 wave 歸屬屬半語意判定,不在 script」)。
壓縮:疊加內建 `/goal` 段落壓成兩行。

### 5.7 auto-verify(5,859 → ~4,000)

> v1 目標 3,200 不可達:具名刪除節實測僅 1,096 bytes(何時呼叫 396 + 職責邊界 408 + 紀律邊界 149 + dispatching 句 143)。v2 目標下修並補列 rationale 壓縮來源。

刪:「何時呼叫」整節(反向硬編碼各 command phase 號,drift 源)、「與 verification-before-completion 職責邊界」整節(壓成開頭一行)、「紀律邊界」整節、`dispatching-parallel-agents` 點名句。
**明列保留**(v1 漏列,三條皆有下游依賴):
- `L26` E2E 是 harness.json 之外的條件 gate
- `L46` 偵測不到驗證指令 → 停下問
- `L62` happy + ≥2 edge + **抽 2 個沒改功能**(`refactor.md:19` 反向依賴此數)
其餘保留:五步驟表、harness.json 優先序 + stale 偵測、三條 shell 紀律、非 monorepo 形狀表、真實環境 shape 表、subsumed 判定、infra fallback。
移 rationale:三條 shell 紀律的實證括號(~700 bytes)+ 散文壓縮(~500 bytes)→ 達 ~4,000。

### 5.8 branch-lifecycle(7,464 → ~4,800 + refs 1,500)

> v1 目標 3,000 不可達:具名刪除實測 1,997 bytes(異常表 1,319 + 溯源段 400 + 自主模式節 278)。

進 `references/exceptions.md`:異常處理表 11 列、pre-push flake triage、`gh pr create` 失敗路徑、rebase 拒絕處置。
刪:溯源段、「2026-07-18 取代 2026-07-07」沿革(寫了兩次)、「自主模式」節(收尾第 6 步已無條件全自動,該節在描述不存在的差異)。
改寫:步驟 3 Review 補齊改為引用 `refs/review-protocol.md`,只保留 `self_review_head..HEAD` 增量判準 —— 消滅 skill 反向依賴 command 的耦合。

### 5.9 四個 reviewer agent(8,242 → ~3,800)

**v1 的 P0 錯誤已修正:「輸出鐵則」不刪。**

理由:四個 reviewer 走 Agent-tool `subagent_type` dispatch(`feat.md:39` / `feat.md:49` / `mod.md:26` / `refactor.md:15`),**不經 Workflow `agent(prompt, {schema})`**;其 frontmatter `tools: Read, Grep, Glob` 也與本輪審計用的 workflow ad-hoc agent 是不同配置。且 finding 的欄位 schema(`id` / `severity` / `location` 雙欄 `{file, section}` / `problem` / `suggested_fix` / `rationale`)**只寫在那四段裡**,四個 command 明文說「schema 固化在 agent 定義」—— 刪掉則全 harness 無處定義,round JSON 產不出來。

處置:抽 `harness/refs/reviewer-preamble.md`,內含立場三條 + P0/P1/P2 severity 定義 + **finding 欄位 schema + 雙欄 location** + round≥2 cross-round 檢查。四個 agent 檔首行寫「開始前先 Read `~/.claude/harness/refs/reviewer-preamble.md`」(四者 tools 白名單含 Read,可行)。

**不移專案層**(v1 誤判):`design-reviewer` 的 neigui domain criteria 留在本檔。理由:該 agent 的 tools 白名單沒有 Skill,fresh-context subagent 無法 invoke 專案 skill;且 `protect-harness.py` 守 `~/.claude/agents/` 但不守專案 `.claude/skills/`,外移等於同時失去讀取路徑與防弱化守備。

---

## 6. 保留清單

SC-3 驗收清單。**v2 修正**:#26 撤回(perf L5 = 檔頭指標句,與 #9 互斥);#2 / #8 的落點已補進 §5.1 留核心清單。

| # | 規則 | 落點 |
|---|---|---|
| 1 | state.json 每 phase 回寫 | feat 核心一行 |
| 2 | Phase 6 失敗回退 (a)(b)(c) + real-env round JSON | feat 核心(§5.1 已明列)|
| 3 | 🔴 先改既有測試讓它紅 | mod 核心 |
| 4 | inline 完工自查 checklist | mod 核心 |
| 5 | migration 真實環境驗證 | mod 核心 |
| 6 | Phase 8 白名單打勾 + migration 可逆 | mod 核心 |
| 7 | /mod S/M 退出條件範例 | auto.md 表(新增列)|
| 8 | commit 前 cat next-time.md + subagent 代查 | feat 核心(§5.1 已明列)|
| 9 | 檔頭「共通鐵則 + auto.md 契約指標」 | **五個 command 檔頭各一行,零例外** |
| 10 | implementation-detail 例外 + 切 /mod 出口 | refactor 核心 |
| 11 | refactor Phase 5 grep caller blast radius | refactor 核心 |
| 12 | 「與優化前完全一樣」+ 大量輸入 edge | perf 核心 |
| 13 | 砍 dead code 前查動態用法 | refactor 禁止節 |
| 14 | root bottleneck vs 旁支判準 | perf 核心 |
| 15 | 3 輪定位不到 → 重新定義目標 | perf 核心 |
| 16 | 收尾呼叫句本體 | 五個 command Done 尾 |
| 17 | 方向性抉擇判定準則 | auto 核心(觸發偵測)|
| 18 | review loop finding 免問授權 | auto 核心 |
| 19 | push/merge 不屬「對外發布」除外句 | auto 核心 |
| 20 | 退出條件 3 次不成立上限 | auto 核心 |
| 21 | wave 歸屬屬半語意判定 | `refs/auto-wave.md` |
| 22 | 各流程建議用法表 | auto 核心 |
| 23 | /bug Phase 5 blast radius | bug 核心 |
| 24 | /bug `🔴` commit 標記 | bug 核心 |
| 25 | 退出條件成立後列出所有 `[auto-default]` | auto 核心(一句)|
| 26 | ~~perf L5 指標句可刪~~ | **撤回** — 與 #9 互斥,perf L5 就是那一行 |
| 27 | perf「先問目標數字」 | 只刪與 Phase 1 gate 三重的重述,**保留 L1 標題 + L3 空參數提問** |
| 28 | reviewer finding 欄位 schema + 雙欄 location | `refs/reviewer-preamble.md`(**v2 新增**,原本是 P0 遺漏)|
| 29 | SDD 的 ledger / 每 task review gate / 禁並行 implementer | `refs/feat-phase3.md`(**v2 新增**,關 SDD 的前提)|
| 30 | auto-verify 的 E2E 條件 gate / 偵測不到停下問 / 抽 2 個沒改功能 | auto-verify 保留(**v2 新增**)|
| 31 | perf.md:17 對 auto-verify「何時呼叫」節的指涉 | 改寫成自帶語句(**v2 新增**)|

---

## 7. 四項拍板決議

### 7.1 `[refactor]` 與 `[lock]` — 降為選配 + 進 reference

- TDD 核心只留 `red → green` 兩 commit。`[refactor]` 改為「有重構才加」,不列強制順序。
- `[lock]` + mutation 抽驗 + 禁 `git checkout` 還原 + 同檔混類分批 commit → `refs/feat-phase4-fix.md`,收到 test-gap finding 才載入。
- **不動 `check_feat_tags.py`。** v1 寫「同步放寬:不再要求 `[green]` 後必有 `[refactor]`」是對現況的錯誤宣稱 —— 該 script 從未有此規則(L76/L80 僅計數)。照 v1 做會為不存在的行為寫紅測試 + 改 hook,純空轉。
- 注意:`[lock]` 進 ref 後,script 對 `[lock]` commit 的 `mutation-verified` 強制(L86-91)**照常有效** —— 規則移到 ref 不等於 gate 消失,兩者不衝突。

### 7.2 /mod emoji — 擴充 hook 機驗

`check_feat_tags.py` 推廣到 `/mod` `/bug` `/refactor`。**v1 只說「改依分支 prefix」,不足以實作** —— 現行 script 的 commit 掃描範圍完全來自 `state.start_sha`,`--state` 是 `required=True`,缺 `start_sha` 直接 `return 2`,而非 feat 流程沒有 state.json。

v2 具體改法:

1. `--state` 由 required 改 optional
2. 新增 `--since <sha>`;兩者皆缺時,range 起點 fallback 為 `git merge-base origin/main HEAD`(分支點)
3. 流程型別由當前分支 prefix 判定(`feat/` `mod/` `fix/` `refactor/` `perf/`),決定套哪組判準
4. 非 feat 流程先以 **warning 模式**上線(exit 0 + 印警告)
5. 紅先行:先補 `tests/test_check_feat_tags.py` 的對應 case(現行 13 個 case 無任何 `--since` / prefix 相關斷言)

升為 block 的觀察指標:**連續 10 個非 /feat 流程收尾中,warning 誤報數 = 0**。誤報一次即重置計數並修判準。

### 7.3 /perf benchmark — 改寫成可驗

- Done 條件改為「before/after 量測指令寫進 `optimize-plan.md` 且可重跑」—— 這是 5/5 實際做到的事。
- benchmark script 入庫降為條件式:「該 metric 需長期監控才做」,且若入庫則必須進 `harness.json` 或 pytest suite(否則不算數)。

### 7.4 /bug — 補最小落檔義務

- 新增 `.claude/bug/<slug>/repro.md` 單檔:重現步驟 / root cause 實驗記錄 / Phase 8 反向驗證輸出。
- 不加 state.json(bug 流程短,不需跨 session resume)。
- 成本約 +150 bytes,換到招牌紀律可稽核。

---

## 8. 遷移步驟

1. 建 `~/.claude/harness/refs/`,先寫 refs(內容從既有 command 剪下,不重寫)。**`RATIONALE.md` 已於本輪先行建立。**
2. 逐檔改寫 command(一檔一 commit)
3. 改寫 auto-verify + branch-lifecycle(+ 建 `references/exceptions.md`)
4. 抽 `refs/reviewer-preamble.md`,四個 agent 檔改為首行 Read 它(**輸出鐵則移入,不刪**)
5. 擴 `harness_lib.PHASE_GATES` 加 ref 路徑欄 + 改 `harness-context.py` 一併注入(紅先行:先改 `tests/test_harness_lib.py` / `test_harness_context.py`)
6. 擴 `check_feat_tags.py`(§7.2 五步,紅先行)
7. **擴 `scripts/sync-harness-mirror.py` 的 `DIR_MAPS`** 收 `~/.claude/harness/`(含 `refs/`)與 `skills/*/references/`,再跑 `--check`。不改腳本會得到「全部一致」的假綠,而 refs 與 RATIONALE.md 從未進鏡像 —— `~/.claude` 不是 git repo,鏡像是唯一版控副本
8. 更新 `docs/harness/SPEC.md`(23 KB,描述舊架構)與 `docs/harness/README.md`
9. 退役死檔 `hooks/harness-push-gate.py`(未註冊於 settings.json、內文與現行全自動政策矛盾)→ **連同 `hooks/tests/test_harness_push_gate.py` 一起移除**(該測試以相對路徑執行該 hook,只移 hook 會讓 17 個 test 全紅)。SC-4 基準同步從 109 改記為 92 passed / 7 檔
10. 設 `skillOverrides: {"subagent-driven-development": "off"}`,**前提是步驟 1 已把三條紀律移植進 `refs/feat-phase3.md`**
11. SC-1..SC-8 逐條驗證

---

## 9. 風險與 Known Risks

| 風險 | 處置 |
|---|---|
| ref 該載入時沒載入 | §3 P1 的機械觸發:`PHASE_GATES` 加 ref 路徑欄,由 `harness-context.py` 每回合注入。非 /feat 流程無 state.json → hook 不觸發,**Known Risk:/mod /bug /refactor 的 ref 載入仍靠自律**,列入下輪 |
| 關掉 SDD 後流程紀律流失 | §4.1 三條紀律移植為關閉前提;SC-8 驗證關閉生效,SC-6 真實跑一輪驗紀律仍在 |
| Workflow 驅動 review 未經真實流程驗證 | SC-6;本輪兩次審計已是同形態實測(12 + 15 agents,schema 零失敗)|
| `check_feat_tags.py` 擴充引入 false positive | 紅先行 + warning 模式 + 連續 10 次零誤報才升 block |
| 鏡像同步遺漏導致 rationale 無回退路徑 | 步驟 7 先擴 `DIR_MAPS` 再 `--check`;SC-7 綁該腳本 exit code |
| SC-2 餘裕僅 182 bytes | 刻意留薄。任一檔超標即 FAIL,強制回頭砍而非放寬門檻 |
| 鐵則 A/B/E 的半覆蓋(鐵則 B 缺 next-time.md 檔名與時機) | 本輪不動常駐層 → command 側保留該條;**Known Risk:記入 `feat-improvements.md`,下輪常駐層改版處理** |
| `protect-harness.py` 停用期間無防弱化守備 | 見 §8.1;本輪結束後建議還原 |

---

## 8.1 暫時停用 `protect-harness.py`(2026-07-25,user 指示)

Solo 開發下,改 harness 本體時每次跳 ask 確認框只是摩擦。本輪起從 `~/.claude/settings.json` 移除其兩處註冊(**hook 檔本身保留不刪**,`hooks/tests/test_protect_harness.py` 照常綠)。

停用後不再有確認框的範圍:`~/.claude/hooks/**`、`~/.claude/settings*.json`、`~/.claude/agents/**`、`**/.claude/harness.json`、`**/.git/hooks/**`、`**/scripts/git-hooks/**`。
不受影響:`block-no-verify.py`(deny)、`safety-hooks.py`(deny)、`harness-stop-audit.py`(Stop block)全部照常運作。

還原方式 — 把下列兩個物件加回 `settings.json` 的 `hooks.PreToolUse` 陣列:

```json
{ "matcher": "Bash|PowerShell",
  "hooks": [{ "type": "command", "command": "python C:/Users/USER/.claude/hooks/protect-harness.py" }] },
{ "matcher": "Write|Edit|MultiEdit",
  "hooks": [{ "type": "command", "command": "python C:/Users/USER/.claude/hooks/protect-harness.py" }] }
```

(原本第一個是併在既有 `Bash|PowerShell` 群組的 hooks 陣列末端,第二個是獨立群組。)

**Known Risk**:該 hook 的設計目的是防「被 prompt injection 的 agent 靜默弱化強制層」。停用期間這道防線不存在;若本輪之後有大量 WebFetch / 外部內容進入 session,建議還原。

---

## 10. Out of Scope

- 常駐層(user CLAUDE.md / 專案 CLAUDE.md / MEMORY.md)重組 —— user 明確劃界,下一輪。注意 user 已自行開始(專案 CLAUDE.md §0 刪 21 行,未提交)
- superpowers plugin 檔本體 —— 只改「是否 enabled」,不改內容
- `chore.md`
- neigui 專案 skills(`.claude/skills/*`)
- `/code-review` 能否被 agent 觸發的上游問題 —— 本輪繞過(改 Workflow),不追上游
- `dispatching-parallel-agents` / `using-git-worktrees` / `finishing-a-development-branch` 的關閉 —— 證據不足,不動
