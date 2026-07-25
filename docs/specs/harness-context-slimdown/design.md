# Harness Context 瘦身改版 — design v1

- 日期:2026-07-25
- 範圍:`~/.claude/commands/{feat,mod,perf,refactor,auto,bug}.md` + `~/.claude/skills/{auto-verify,branch-lifecycle}` + `~/.claude/agents/*.md`(四個 reviewer)
- 不在範圍:常駐層(user / 專案 CLAUDE.md、MEMORY.md)、`chore.md`、superpowers plugin 本體
- 前置審計:12 agents 唯讀審計 + 3 路對抗覆核(推翻 20 條判定),證據見本檔 §2

---

## 1. 目標與成功條件

**動機**:一輪 L 級 `/feat` 在讀到第一行 source code 之前,已載入約 118 KB 的 instruction 文字。其中大部分與當下 phase 無關,同時稀釋注意力並吃掉窗口。

| SC | 成功條件 | 驗證方式 |
|---|---|---|
| SC-1 | 六個 command 檔總 bytes ≤ 16 KB(現況 41.2 KB) | `Get-ChildItem ~/.claude/commands -Filter *.md \| Measure-Object Length -Sum`(排除 `chore.md`) |
| SC-2 | 一輪 L 級 `/feat` 的 instruction 載入 ≤ 60 KB(現況 ~118 KB) | 本輪交付一支新腳本 `~/.claude/hooks/harness_load_estimate.py`:吃一份「該流程會載入的檔案清單」求 bytes 和,輸出 before/after 對照表。清單本身是人工維護的宣告(§4.2 那張表),腳本只負責求和與比對 |
| SC-3 | §6 保留清單 27 條規則,改版後逐條可在新結構中定位 | 逐條 `Grep` 新檔案樹,產出 27 列對照表,無一條 `NOT FOUND` |
| SC-4 | 既有 hook 測試全綠 | `python -m pytest ~/.claude/hooks/tests -q`(現況 7 個測試檔) |
| SC-5 | `/code-review` 死路徑消滅 | `Grep -r "/code-review" ~/.claude/{commands,skills,agents}` 命中數 = 0(rationale 側檔除外) |
| SC-6 | 新流程在真實環境跑得通 | 用一個真實 `/mod` 或 `/bug` 小案子跑完整流程,附 commit 清單 + 驗證輸出 |
| SC-7 | `neigui/docs/harness/` 鏡像與 `~/.claude/` 一致 | 逐檔 byte 比對腳本,差異數 = 0 |

**驗證窗口**:全部 anytime,無盤中限定。

---

## 2. 證據基準

### 2.1 量測

| 層 | 現況 bytes |
|---|---|
| 六個 command | 41,224(feat 20,938 佔 51%)|
| 共用 skill(auto-verify + branch-lifecycle) | 13,323 |
| 四個 reviewer agent | 8,242 |
| superpowers(L 級 /feat 會點名的) | 83,700 |
| **L 級 /feat 一輪合計** | **~118 KB** |

### 2.2 三個實測發現(決定設計方向)

**F1 — `/code-review` 主路徑不可執行。** agent 無法自行觸發該 user-triggered CLI(`feat-improvements.md` 兩個專案同根因、未結案)。`feat.md:74-79`、`mod.md:33`、`branch-lifecycle:40` 三處圍繞它寫了 3.4 KB 契約,且形成 branch-lifecycle → mod → feat 的三段跳交叉引用(skill 反向依賴 command,最脆的耦合方向)。

**F2 — 靠 prompt 自律的規則實測失守,靠 script 機驗的守得住。** neigui 749 commits:

| 規則 | 實測命中 | 機械 gate |
|---|---|---|
| `[red]` / `[green]` | 44 / 59 | 有(`check_feat_tags.py`)|
| `[refactor]`(TDD 第三段) | 7 | gate 有,規則沒人跑 |
| `[lock]` + mutation 抽驗 | 2 | 無 |
| 三類 emoji 全庫 | 336 / 749 = 45%,近 100 筆降至 48% | /feat 有、/mod 無 |
| `/mod batch-ui-polish` 單一 run | 16 commit **全零** emoji | 無 |

其他 never-fired:`per_file` 模式 0/7、`worktree_path` 16/16 = null、meta-cycle 升級 0 次真正執行、`infra_fail` 2/16、`/perf` benchmark 入庫 5 run 只 2 支 script 且不在任何 gate。

**F3 — 兩條未結案 improvement 的共同根因是「規則落點錯」。** 規則寫在 Phase 8,需要它的時刻在 Phase 4/6。實際代價:cherry-pick 重建 5 commit(07-18)、線性重建 8 commit(07-21)。

### 2.3 對抗覆核

三路覆核共檢 151 條判定:upheld 123(81%),**推翻 28 條**(9 + 9 + 10)。錯誤集中兩類:(a) 拿只覆蓋一半的來源做 `REDUNDANT_SHARED`(鐵則 A 的 caller grep 只掛 Mod、`systematic-debugging` 無主瓶頸判準、`auto-verify` 無 migration、`receiving-code-review` 反而要求停下問);(b) 把「模型實測做不到」的規則誤判 `MODEL_NATIVE`(F2 的數據直接反證)。另發現兩個審計員對同構段落給出互斥判定(feat 檔頭 KEEP vs mod 檔頭 MODEL_NATIVE、refactor L5 REDUNDANT vs perf L5 KEEP)— 套用前必須先統一。逐條處置見 §6。

---

## 3. 設計原則

### P1 — 觸發偵測留核心,處置細節可延後

> 「識別觸發的規則無法延後載入 — 不知道自己踩到了,就不會去讀那份 reference。」(對抗覆核原句)

每條規則只問一句:這是**讓我認出情況**,還是**認出後怎麼做**?

- 前者留核心一句(含「認出後去讀哪個 ref」的指標)
- 後者整段進 ref

範例:`feat.md:76` 的 finder 快篩紀律(1,000 bytes,全檔最長單段)→ 核心只留「finder claim 進 receiving 前,main agent 先機械快篩(細節:`refs/review-protocol.md`)」。

### P2 — 能被 hook / script 機驗的,不寫進 prompt 要求自律

F2 是直接證據。做對的樣板已存在兩個:`check_feat_tags.py`(feat.md 明寫「規則本檔不重抄」)與四個 reviewer agent 固化 criteria。本次推廣此樣板。

推論:**規則要嘛有 gate,要嘛承認它是建議**。第三種狀態(寫在 prompt 裡當 Done 條件但無人驗)是最壞的 — 佔 token 又給假保證。

### P3 — Rationale 與規則分離

feat.md 20.9 KB 中約 4.5 KB 是括號內日期實證敘事。規則留祈使句;「為什麼」進 `harness/RATIONALE.md`,只在 meta-review 讀。保留最多 10 字的 why 子句(影響判斷時),刪除事件敘事。

---

## 4. 目標架構

references 放 **`~/.claude/harness/refs/`**。刻意不放 `commands/` 或 `skills/` 底下 — 那兩處會被 Claude Code 掃描成 slash command / skill,其 description 反而進常駐清單,與目標相反。

```
~/.claude/
  commands/
    feat.md          20,938 →  ~5,500
    mod.md            5,215 →  ~2,000
    perf.md           4,159 →  ~1,800
    refactor.md       3,698 →  ~1,600
    bug.md            3,503 →  ~1,600   (含新增 artifact 義務)
    auto.md           3,711 →  ~2,600   (覆核警告:不可砍至 1.35K)
    chore.md          1,856 →  不動
  harness/
    refs/
      review-protocol.md    ~2,200   吸收三處 3.4 KB 重複,改寫為 Workflow 驅動
      scope-tiers.md          ~800   feat + mod 的 S/M/L 合一
      sp-overrides.md         ~600   三條 superpowers 顯式覆寫
      feat-phase0-2.md      ~1,800
      feat-phase3.md        ~1,200
      feat-phase4-fix.md    ~1,200   含 [lock] / mutation / 禁 git checkout
      feat-phase8.md        ~1,500
      feat-state.md           ~800   state.json schema + 稀疏記帳
    RATIONALE.md            ~9,000   執行期永不載入
  skills/
    auto-verify/SKILL.md    5,859 →  ~3,200
    branch-lifecycle/
      SKILL.md              7,464 →  ~3,000
      references/exceptions.md      ~2,500   異常表 11 列 + flake triage
  agents/
    _reviewer-preamble.md     ~900
    design-reviewer.md      2,483 →  ~1,000   (neigui domain criteria 移專案層)
    impl-spec-reviewer.md   2,206 →    ~700
    change-spec-reviewer.md 1,838 →    ~700
    refactor-plan-reviewer.md 1,715 →  ~600
```

### 4.1 最大槓桿:不點名該 skill

檔案大小不是最大宗。`feat.md` Phase 3 點名的四個 superpowers skill 才是:

| 被點名的 skill | bytes | 替代 | 依據 |
|---|---|---|---|
| `subagent-driven-development` | 28,077 | 內建 Workflow tool | Workflow 提供確定性 fan-out / pipeline / schema 強制回傳 |
| `dispatching-parallel-agents` | 6,078 | 內建 Workflow tool | 同上 |
| `using-git-worktrees` | 6,813 | 內建 `EnterWorktree` / `ExitWorktree` | `worktree_path` 實測 16/16 = null |
| `finishing-a-development-branch` | 7,022 | `branch-lifecycle` 收尾節 | feat.md 已顯式覆寫它,卻仍點名 → 照樣載入 |

**合計 47,990 bytes,不必改動任何 plugin 檔,只要停止點名。**

### 4.2 載入量估算

| 情境 | 現況 | 改版後 | 降幅 |
|---|---|---|---|
| /feat L 級全跑 | ~118 KB | ~57 KB | −51% |
| /feat S 級 | ~70 KB | ~31 KB | −56% |
| /mod M 級 | ~48 KB | ~24 KB | −50% |
| /bug 一輪 | ~35 KB | ~26 KB | −26% |

`/bug` 降幅最小 — 它本來就薄,省的全在共用層;剩餘大宗是 `systematic-debugging`(9.5 KB)與 `test-driven-development`(9.0 KB),兩者 load-bearing 且屬 plugin,不在本輪範圍。

---

## 5. 逐檔處置

### 5.1 feat.md(20,938 → ~5,500)

**留核心**:檔頭骨架、四條核心原則(receiving 分類 / 3 輪上限 / P1≤2 退場 / 失敗類型分流)、SC gate 完整版(含驗證窗口 — 台股盤中限定驗證是專案特有 load-bearing)、S/M/L 一行 + ref 指標、Phase 骨架十行、TDD tag 判準、Phase 4 雙焦點 + P2 彙總契約 + `self_review_head` 寫入、Phase 7 五欄證據表、state 回寫一行、Done 一句。

**進 ref**:Phase -1 setup、延續型 feature 掃前輪指示、Phase 1/2 review 迴圈細節、實作模式表、Phase 3 失敗回退表、Phase 4 快篩四條 + 修 finding 操作、Phase 8 收尾操作、Phase 8.5 沉澱、state schema。

**刪**:`superpowers:using-git-worktrees` 分支、`subagent-driven-development` / `dispatching-parallel-agents` 點名、`finishing-a-development-branch` 點名、`git add` 的「不要 `-A`」(`safety-hooks.py` 已機械 deny)、鐵則 F 重述、「等使用者確認」(brainstorming HARD-GATE 已有)、自主模式建議節、所有日期實證敘事(~4.5 KB → RATIONALE)。

**改寫**:Phase 4 步驟 1 由「跑 `/code-review`」改為「依 `refs/review-protocol.md` 跑 Workflow 驅動 review」(F1)。

### 5.2 mod.md(5,215 → ~2,000)

留:Phase 1 caller map 落檔義務(reviewer 是 fresh context,只吃檔案路徑)、Phase 2 行為白名單、Phase 4 三類順序 🔵→🔴→🟢 與「🔴 先改既有測試讓它紅」(鐵則 E 改 assertion 禁令的唯一合法通道)、Phase 5 inline 自查、Phase 6「不該紅 → 不改 assertion」、Phase 7 白名單逐條 + migration 真實環境、Phase 8 白名單打勾 + migration 可逆。
刪:開工括號步驟、S/M/L 重寫(→ `refs/scope-tiers.md`)、自主模式建議節(退出條件範例移入 auto.md 表)、SC gate 重述(留交叉引用)、禁止清單與鐵則 B/E 重疊條、收尾括號說明。

### 5.3 perf.md(4,159 → ~1,800)

留:量化目標 gate 三件(現況數字 / 目標 threshold / 可重現量測步驟)、「root bottleneck 不是旁支」判準(`systematic-debugging` 無此條)、3 輪定位不到 → 重新定義目標、cache invalidation 三欄、一策略一 commit、Phase 5 量其他不該退化的 metric、Phase 6「結果跟優化前完全一樣」+ 大量輸入 edge。
刪:`L5` 指標句、`L1-3`「先問目標數字」(與 L13/L18 三重)、禁止清單重疊條、auto-verify 抽樣數重述。
改寫:Done 的「benchmark 入庫」→ 見 §7.3。

### 5.4 refactor.md(3,698 → ~1,600)

留:Why? gate、characterization test 義務、每步保持綠 + 100 行拆分門檻、「紅時預設 refactor 改錯」的 **implementation-detail 例外與切 /mod 出口**(鐵則 E「事前標為該變」的唯一授權來源)、Phase 5 grep caller blast radius(鐵則 A 的 caller grep 只掛 Mod)、砍 dead code 查動態用法、大爆炸禁令。
刪:收尾括號步驟與日期、自主模式建議節、auto-verify 抽樣數重述、鐵則 B/E 重疊條。

### 5.5 bug.md(3,503 → ~1,600)

留:穩定重現 gate、一次一假說、紅測試先行、最小修改、`🔴` commit 標記(鐵則 B 明文把 emoji 強制範圍委派給 command)、Phase 5 blast radius(鐵則 A 不含 Bug)、Phase 8 反向驗證、Phase 9 留尾巴。
刪:鐵則 F 全文重寫(改一句引用)、自主模式建議節、禁止清單重疊條。
**新增**:`.claude/bug/<slug>/repro.md` 落檔義務(見 §7.4)。

### 5.6 auto.md(3,711 → ~2,600)

覆核明確警告 1,350 bytes 目標過激。**auto.md 幾乎全是 load-bearing 政策**,且它本身已是按需載入。

留:退出條件語法與機械可判要求、退出條件成立後總結並列出所有 `[auto-default]`、3 次不成立上限(鐵則 F 只管單步驟,不涵蓋頂層迴圈)、自動核准範圍、**方向性抉擇判定準則**(觸發偵測,不可延後)、review loop 免問授權(`receiving-code-review` 反而要求停下問)、必停三類含 push/merge 除外括號(§H 只說 push 自動,沒說它不算「對外發布」)、各流程建議用法表(turn 1 把模糊需求轉成機械退出條件的唯一來源)。
移入:mod S/M 級退出條件範例(現表缺此列)。
進 ref:`goal_efficiency_mode` 整節(僅 /auto + >15 檔成立)。
壓縮:疊加內建 `/goal` 段落壓成兩行。

### 5.7 auto-verify(5,859 → ~3,200)

刪:「何時呼叫」整節(反向硬編碼各 command phase 號 → drift 源,且 skill 被呼叫時已在該 phase)、「與 verification-before-completion 職責邊界」整節(壓成開頭一行)、「紀律邊界」整節、`dispatching-parallel-agents` 點名。
留:五步驟表、harness.json 優先序 + stale 偵測、**三條 shell 紀律**(管線後綴吃 exit code / 驗證與 commit 不同 shell 鏈 / PowerShell 5.1 無 `&&`)、非 monorepo 形狀表、真實環境 shape 表、subsumed 判定、infra fallback。
移 rationale:三條 shell 紀律的實證括號。

### 5.8 branch-lifecycle(7,464 → ~3,000 + refs 2,500)

進 `references/exceptions.md`:異常處理表 11 列、pre-push flake triage、`gh pr create` 失敗路徑、rebase 拒絕處置。
刪:溯源段(L11)、「2026-07-18 拍板取代 2026-07-07」沿革(寫了兩次)、「自主模式」節(收尾第 6 步已無條件全自動,該節在描述一個不存在的差異)。
改寫:步驟 3 Review 補齊改為引用 `refs/review-protocol.md`,只保留自己特有的 `self_review_head..HEAD` 增量判準 — 消滅 skill 反向依賴 command 的耦合。

### 5.9 四個 reviewer agent(8,242 → ~3,900)

抽 `_reviewer-preamble.md`:立場三條 + P0/P1/P2 severity 定義 + round≥2 cross-round 檢查。
**刪**「輸出鐵則:final message = 純 JSON array,無 markdown fence」整段 ×4 — Workflow 的 `agent(prompt, {schema})` 已強制結構化回傳並自動重試(本次審計實測 12/12 agent 零格式失敗)。
移專案層:`design-reviewer` criteria 10(neigui 籌碼 domain 陷阱)+ criteria 9 括號(uvicorn log level)→ neigui `.claude/skills/`。

---

## 6. 保留清單(覆核產出的逐條處置)

28 條推翻判定合併同源後得 27 列(#26/#27 為方向相反 — 原判 KEEP 被推翻為可刪)。這是 SC-3 的驗收清單:每條在新結構中必須有明確落點,或明確標記為已刪。

| # | 規則 | 原判 | 落點 |
|---|---|---|---|
| 1 | state.json 每 phase 回寫 | REDUNDANT_SHARED | feat 核心一行 |
| 2 | Phase 6 失敗回退 (a)(b)(c) + real-env round JSON | REDUNDANT_SHARED | feat 核心 |
| 3 | 🔴 先改既有測試讓它紅 | MODEL_NATIVE | mod 核心 |
| 4 | inline 完工自查 checklist | MODEL_NATIVE | mod 核心 |
| 5 | migration 真實環境驗證 | REDUNDANT_SHARED | mod 核心 |
| 6 | Phase 8 白名單打勾 + migration 可逆 | REDUNDANT_SHARED | mod 核心 |
| 7 | /mod S/M 退出條件範例 | REDUNDANT_SHARED | auto.md 表(新增列)|
| 8 | commit 前 cat next-time.md 的檔名與時機 | REDUNDANT_SHARED | feat 核心(subagent 代查規則)|
| 9 | auto.md 契約指標 | REDUNDANT_SHARED | 五個 command 檔頭各一行 |
| 10 | implementation-detail 例外 + 切 /mod 出口 | REDUNDANT_SHARED | refactor 核心 |
| 11 | Phase 5 grep caller blast radius | REDUNDANT_SHARED | refactor 核心 |
| 12 | 「與優化前完全一樣」+ 大量輸入 edge | REDUNDANT_SHARED | perf 核心 |
| 13 | 砍 dead code 前查動態用法 | REDUNDANT_SHARED | refactor 禁止節 |
| 14 | root bottleneck vs 旁支判準 | REDUNDANT_SHARED | perf 核心 |
| 15 | 3 輪定位不到 → 重新定義目標 | REDUNDANT_SHARED | perf 核心 |
| 16 | 收尾呼叫句本體 | RATIONALE_ONLY | 五個 command Done 尾 |
| 17 | 方向性抉擇判定準則 | DEFER_REFERENCE | auto 核心(觸發偵測)|
| 18 | review loop finding 免問授權 | REDUNDANT_SHARED | auto 核心 |
| 19 | push/merge 不屬「對外發布」除外句 | REDUNDANT_SHARED | auto 核心 |
| 20 | 退出條件 3 次不成立上限 | REDUNDANT_SHARED | auto 核心 |
| 21 | wave 歸屬屬半語意判定 | REDUNDANT_SHARED | auto ref(與 goal_efficiency_mode 同檔)|
| 22 | 各流程建議用法表 | DEFER_REFERENCE | auto 核心 |
| 23 | /bug Phase 5 blast radius | MODEL_NATIVE | bug 核心 |
| 24 | /bug `🔴` commit 標記 | REDUNDANT_SHARED | bug 核心 |
| 25 | 退出條件成立後列出所有 `[auto-default]` | MODEL_NATIVE | auto 核心(一句)|
| 26 | perf L5 指標句 | KEEP_CORE | **確認可刪** |
| 27 | perf「先問目標數字」 | KEEP_CORE | **確認可刪**(與 L13/L18 三重)|

---

## 7. 四項拍板決議

### 7.1 `[refactor]` 與 `[lock]` — 降為選配 + 進 reference

- TDD 核心只留 `red → green` 兩 commit。`[refactor]` 改為「有重構才加」,不列強制順序。
- `[lock]` + mutation 抽驗 + 禁 `git checkout` 還原 + 同檔混類分批 commit → `refs/feat-phase4-fix.md`,收到 test-gap finding 才載入。
- `check_feat_tags.py` 同步放寬:不再要求 `[green]` 後必有 `[refactor]`。**hook 改動需同步更新 `tests/test_check_feat_tags.py`**(紅先行)。

### 7.2 /mod emoji — 擴充 hook 機驗

- `check_feat_tags.py` 推廣到 `/mod` `/bug` `/refactor`:**不依賴 state.json**(F2 顯示只有 /feat 有 state.json),改依當前分支 prefix(`mod/` `fix/` `refactor/`)判定流程,驗該流程 Done 條件對應的 commit 分類。
- prompt 側因此可從「規則 + 理由」壓成一行「三類分開 commit,收尾由 `check_feat_tags.py` 機驗」。
- 這是 P2 原則的直接落地:規則從 prompt 移到 gate。

### 7.3 /perf benchmark — 改寫成可驗

- Done 條件改為「before/after 量測指令寫進 `optimize-plan.md` 且可重跑」— 這是 5/5 實際做到的事。
- benchmark script 入庫降為條件式:「該 metric 需長期監控才做」,並要求若入庫則必須進 `harness.json` 或 pytest suite(否則不算數)。

### 7.4 /bug — 補最小落檔義務

- 新增 `.claude/bug/<slug>/repro.md` 單檔:重現步驟 / root cause 實驗記錄 / Phase 8 反向驗證輸出。
- **不加 state.json**(bug 流程短,不需跨 session resume)。
- 成本約 +150 bytes,換到招牌紀律可稽核。

---

## 8. 遷移步驟

1. 建 `~/.claude/harness/refs/`,先寫 refs(內容從既有 command 剪下,不重寫)
2. 逐檔改寫 command(一檔一 commit,`🔵` 純結構 / `🔴` 行為改)
3. 改寫 auto-verify + branch-lifecycle(+ 建 `references/exceptions.md`)
4. 拆 reviewer preamble(觸發 `protect-harness.py` ask,預期並核准)
5. 擴充 `check_feat_tags.py`(紅先行:先改 `tests/test_check_feat_tags.py`)
6. 寫 `RATIONALE.md`(所有被移出的日期實證敘事)
7. **同步 `neigui/docs/harness/` 鏡像**(commands / agents / hooks / skills 全部;新增 `harness/refs/` 對應目錄)
8. 更新 `docs/harness/SPEC.md`(23 KB,描述舊架構)
9. 清理死檔:`hooks/harness-push-gate.py`(未註冊於 settings.json、內文與現行全自動政策矛盾)→ 移 `hooks/retired/`
10. SC-1..SC-7 逐條驗證

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

## 9. 風險與 Known Risks

| 風險 | 處置 |
|---|---|
| ref 該載入時沒載入(P1 判斷錯) | §6 保留清單逐條標「觸發偵測 or 處置細節」;核心每個 phase 尾必帶「→ 進入時先 Read `refs/xxx.md`」一行 |
| Workflow 驅動 review 未經真實流程驗證 | SC-6 用真實案子跑一輪;本次審計已是同形態實測(12 agents / schema 零失敗)|
| `check_feat_tags.py` 擴充引入 false positive,擋住合法 commit | 紅先行;新增的 /mod /bug /refactor 檢查先以 **warning 模式**上線(exit 0 + 印警告),觀察指標 = 「連續 10 個非 /feat 流程收尾中,warning 誤報數 = 0」才升為 block。誤報一次即重置計數並修判準 |
| 鏡像同步遺漏 | SC-7 腳本化 byte 比對 |
| user CLAUDE.md 鐵則 A/B/E 的半覆蓋問題(覆核 #8 指出鐵則 B 缺檔名與時機)| 本輪不動常駐層 → command 側保留該條;**Known Risk:記入 `feat-improvements.md`,下輪常駐層改版處理** |

---

## 10. Out of Scope

- 常駐層(user CLAUDE.md / 專案 CLAUDE.md / MEMORY.md)重組 — user 明確劃界,下一輪
- superpowers plugin 檔本體 — 只改「點不點名」,不改內容
- `chore.md`
- neigui 專案 skills(`.claude/skills/*`)
- `/code-review` 本身能否被 agent 觸發的上游問題 — 本輪繞過(改 Workflow),不追上游
