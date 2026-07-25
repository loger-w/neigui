# Harness Context 瘦身改版 — design v3

- 日期:2026-07-25
- 範圍:`~/.claude/commands/{feat,mod,perf,refactor,auto,bug}.md` + `~/.claude/skills/{auto-verify,branch-lifecycle}` + `~/.claude/agents/*.md`(四個 reviewer)+ 為達成上述所需的 hook / 腳本改動
- 不在範圍:常駐層(user / 專案 CLAUDE.md、MEMORY.md)、`chore.md`、superpowers plugin 檔本體

## Changelog

**v3(2026-07-25)** — 第 2 輪 5 lens 審視回收 40 條存活 finding、0 條被推翻。分析兩輪 79 條的性質後做**結構性改版**,不只補洞。

第 1 輪的 finding 多是「規則判斷錯」;第 2 輪幾乎全是**spec 裡寫死的衍生數字與交叉引用對不上**(測試數 17 vs 20、基準 92 vs 89、載入小計的組成、KB 未定義、§5 與 §6 兩張表漂移)。

根因:**spec 把「該由指令算出來的東西」寫成了斷言**。每個衍生數字都是一條可以錯的宣稱,改一處要同步 N 處 —— 違反了本 spec 自己 §3 P2「能機驗的不要靠人寫」。再補一輪數字只會生出第三批數字錯誤。

v3 三項結構改動:

| 改動 | 消滅的問題類型 |
|---|---|
| **SC 表只寫「量法指令 + 門檻」,不寫預期答案** | 測試數、passed 數、bytes 小計這類衍生數字全部不再出現在 spec |
| **載入帳改由 `harness/refs/load-manifest.json` 承載**,spec 只定義欄位語意 | 主 agent 窗口 vs subagent context 混算、「最壞情況」同名兩義、三流程帳漏項 |
| **§5 逐檔處置與 §6 保留清單合併為單一表** | 兩表逐條對齊必然漂移(#16 無落點、#2/#8 落點對不上、mod Phase 3 兩表皆漏) |

v3 同時修正的實質問題:

| 修正 | v2 錯在哪 |
|---|---|
| `skillOverrides` 改用 **`user-invocable-only`** 而非 `off` | 官方 changelog L1778:`off` 對模型與 `/` 都隱藏 → 逃生門一起焊死。`user-invocable-only` 只對模型隱藏,省 context 又保留手動 invoke |
| skillOverrides 對 **plugin skill 是否生效列為未驗**,SC-8 為前置 gate + 備案 | v2 拿兩個「個人 skill」樣板外推到 plugin skill,是本 spec 自己點名的「配置外推」錯型 |
| `/code-review` 處置補齊 **5 處**(feat.md:10 / :74、mod.md:33、bl:40 / :41) | v2 只處置 2 處,而 feat.md:10 在 §5.1 被列為「原封保留」→ SC-5 恆 FAIL |
| F2 表「三類 emoji /feat 有 gate」改為**無** | hooks 零 emoji 檢查;`check_feat_tags.py` 只掃四個方括號 tag。§7.2 因此補「新增 emoji checker」與「三個 command 加呼叫點」兩步 |
| 步驟 7 改為**修 `build_pairs` 支援 glob** | `DIR_MAPS` 的來源欄當實體路徑用,寫 `skills/*/references` 會 `is_dir()` False 被靜默 continue → `--check` 假綠,正是該步要消滅的東西 |
| PHASE_GATES 的 ref 欄改 **`list[str]`**,並**新增** `refs_for_phase()` 不動 `gate_for_phase()` | 單一 ref 欄放不下 1-to-N(Phase 0 需 3 支);直接擴 tuple 會讓 `for p, gate in ...` ValueError → hook fail-open 靜默停注入 |
| Phase -1 的 ref 指標**留在 feat.md 核心,不靠 hook** | Phase -1 時 state.json 尚未建立,`find_active_feature` 回 None,hook 根本不觸發 |
| §8.1 改記為**已執行** | v2 寫成待辦,但該步驟本輪已完成 |
| 補 mod.md Phase 3(change-spec-reviewer dispatch + max 2 輪) | v2 §5.2 留/刪兩張清單與 §6 都漏了它 |

---

## 0. 本 spec 的自我約束

**不得在本文件寫入任何「由量測或計數得出的數字」。** 需要數字的地方一律寫成:量法指令 + 我選定的門檻。理由見 Changelog 根因段。

例外:門檻本身(我選的,不是量出來的)、以及 §2.2 那三張已固化在 RATIONALE.md 的歷史實證表。

---

## 1. 目標與成功條件

**動機**:一輪典型 L 級 `/feat` 在讀到第一行 source code 之前,已載入大量與當下 phase 無關的 instruction,同時稀釋注意力並吃掉窗口。

所有門檻以 **bytes** 表達(不用 KB,避免 10^3 / 2^10 歧義)。

| SC | 門檻 | 量法(改版前後各跑一次,附輸出) |
|---|---|---|
| SC-1 | 六個 command 檔總和 ≤ **16,000 bytes** | `Get-ChildItem ~/.claude/commands -Filter *.md \| Where-Object { $_.Name -ne 'chore.md' } \| Measure-Object Length -Sum` |
| SC-2 | 典型 L 級 `/feat` 的**主 agent 窗口**載入 ≤ **66,000 bytes** | `python ~/.claude/hooks/harness_load_estimate.py --profile feat-L --scope main` |
| SC-2b | 同上,**subagent context** 另計,無門檻,只要求有數字 | `... --scope subagent` |
| SC-3 | §5 處置表每一列的落點都能定位 | `python ~/.claude/hooks/harness_load_estimate.py --verify-dispositions`,輸出 `NOT FOUND` 數 = 0 |
| SC-4 | hook 測試不退步 | 改版前:`cd ~/.claude/hooks && python -m pytest tests -q`(記錄輸出)。步驟 9 退役 push-gate 後:`python -m pytest tests -q` 的 passed 數應等於「改版前 passed 數 − `pytest tests/test_harness_push_gate.py --collect-only -q` 的計數」。**兩個數字都由指令產生,spec 不寫死** |
| SC-5 | `/code-review` 命中數 = **0** | `Grep -rn -- "/code-review" ~/.claude/{commands,skills,agents}`(現況 5 處 4 檔,全部列入 §5 處置表)|
| SC-6 | 新流程真實環境跑得通 | 用一個真實 `/mod` 或 `/bug` 小案子跑完整流程,附 commit 清單 + 驗證輸出 |
| SC-7 | 鏡像同步器涵蓋新路徑且回報一致 | 先完成步驟 7,再跑 `python scripts/sync-harness-mirror.py --check` → exit 0。**且須先證明它不是假綠**:故意改壞一個 `harness/refs/*.md` 再跑,必須 exit 1 |
| SC-8 | **前置 gate** — `skillOverrides` 對 plugin skill 生效 | 設定後開新 session,確認 available-skills 清單不再列 `superpowers:subagent-driven-development`,且 `/superpowers:subagent-driven-development` 仍可手動叫用。**未通過則 §4.1 整條作廢,走 §4.1 備案** |

**驗證窗口**:全部 anytime。

---

## 2. 證據基準

### 2.1 計帳邊界(定義,不含數字)

- **主 agent 窗口**:command 檔 + 由主 agent `Read` 的 refs + 主 agent `Skill` 呼叫的 skill。這是 SC-2 唯一計算對象。
- **subagent context**:reviewer agent 檔 + 其首行 Read 的 preamble。獨立 context,**不佔主 agent 窗口**,SC-2b 另計。
- **條件式**:只在特定分支才載入的檔(如 `feat-phase4-fix.md`、`branch-lifecycle/references/exceptions.md`)。manifest 以 `condition` 欄標記,estimate 腳本以 `--worst` 決定是否計入。

「最壞情況」= 該 profile 下所有 `condition` 項全部命中。全 spec 只有這一個定義。

### 2.2 三個實測發現

**F1 — `/code-review` 主路徑不可執行。** agent 無法自行觸發該 user-triggered CLI(`feat-improvements.md` 兩個專案同根因、未結案)。現況 5 處引用形成 branch-lifecycle → mod → feat 的三段跳交叉引用(skill 反向依賴 command,最脆的耦合方向)。

**F2 — 靠 prompt 自律的規則實測失守,靠 script 機驗的守得住。**(數字已固化於 `~/.claude/harness/RATIONALE.md`「2026-07-25 本輪瘦身的實證」節,此處只記結論與 gate 現況)

| 規則 | 機械 gate 現況 |
|---|---|
| `[red]` / `[green]` 配對 | **有** — `check_feat_tags.py` |
| `[lock]` body 含 `mutation-verified` | **有** — 同上 |
| `[refactor]` TDD 第三段 | **無** — 只計數,零 assertion |
| 三類 emoji 🔴🟢🔵 | **無** — hooks 內零 emoji 檢查(v2 誤記為「/feat 有」) |

> v2 在此表把 `[refactor]` 與 `[lock]` 的 gate 欄寫反,並據此提出「放寬一條不存在的規則」;又誤記 emoji 有 gate,導致 §7.2 少了最關鍵的實作步驟。兩次都是同型錯誤:**沒讀 script 就描述 script 的行為**。

**F3 — 兩條未結案 improvement 的共同根因是「規則落點錯」**:規則寫在 Phase 8,需要它的時刻在 Phase 4/6。代價已記於 RATIONALE.md。

### 2.3 三輪審視的方法論教訓

| 錯型 | 出現輪次 | 防法 |
|---|---|---|
| **半覆蓋當全覆蓋** — 拿只寫了一半的來源當刪除理由 | 1、2 | 凡標「可刪 / 被 X 覆蓋」必須逐句對照來源檔 |
| **配置外推** — 拿 A 配置實測推論 B 配置 | 1、2 | 明確寫出「來源配置」與「目標配置」,不同即列為未驗 |
| **互斥判定** — 同構內容在不同節相反處置 | 1、2 | §5 單一表,消除跨表對齊 |
| **描述 script 行為卻沒讀 script** | 2 | 凡描述既有程式行為,evidence 必須是行號 |
| **寫死衍生數字** | 2 | §0 自我約束 |

> **審視紀律**:審視者只准唯讀分析既有文字檔與跑既有測試。**禁止逆向工程二進位檔、禁止探查 harness 權限機制的內部實作** —— 第 2 輪有一個 verify agent 因此被安全政策標記,其結論不予採信。要判定執行期行為,用「設定後開新 session 觀察」這類黑箱實測(即 SC-8 的做法)。

---

## 3. 設計原則

### P1 — 觸發偵測留核心,處置細節可延後(附機械觸發)

> 「識別觸發的規則無法延後載入 — 不知道自己踩到了,就不會去讀那份 reference。」

每條規則只問:這是**讓我認出情況**,還是**認出後怎麼做**?前者留核心,後者進 ref。

**機械觸發**:`harness_lib.py` 的 `PHASE_GATES` 已是每 phase 一行的 gate 表,`harness-context.py` 註冊在 SessionStart + UserPromptSubmit,每回合注入「目前 phase + gate」。本輪:

- `PHASE_GATES` 每列加一欄 **`list[str]`**(一個 phase 可對多支 ref)
- **新增** `refs_for_phase()`,**不動** `gate_for_phase()` 的回傳型別 —— 既有兩個測試斷言的是 gate 字串,零影響
- `harness-context.py` 在既有三行**之後追加**第四行,不取代任何一行(第三行 `last_updated` 是 `state_is_lagging` 警告的錨)

**已知限制**:Phase -1 時 state.json 尚未建立,`find_active_feature` 回 None,hook 不觸發。因此 **Phase -1 的 ref 指標寫在 feat.md 核心,不靠 hook**。同理 `/mod` `/bug` `/refactor` 無 state.json → 該機制只涵蓋 `/feat`,其餘仍靠核心檔內的指標句(列入 §9 Known Risk)。

### P2 — 能被 hook / script 機驗的,不寫進 prompt 要求自律

F2 是直接證據。**規則要嘛有 gate,要嘛承認它是建議**;第三種狀態(寫在 prompt 當 Done 條件但無人驗)最壞 —— 佔 token 又給假保證。

### P3 — Rationale 與規則分離

規則留祈使句;「為什麼」進 `~/.claude/harness/RATIONALE.md`(本輪已建立),只在 meta-review 讀。保留最多 10 字的 why 子句(影響判斷時),刪除事件敘事。

**前提**:`~/.claude` 不是 git repo,`neigui/docs/harness/` 鏡像是唯一版控副本。RATIONALE.md 必須進鏡像同步範圍,否則被移出的敘事無回退路徑(步驟 7)。

---

## 4. 目標架構

references 放 **`~/.claude/harness/refs/`**。刻意不放 `commands/` / `skills/` / `agents/` —— 這三處都會被掃描,description 反而進常駐清單。**reviewer preamble 同理放 refs/,不放 agents/**。

檔案樹只標**目標上限**(我選的門檻),不標估算值:

```
~/.claude/
  commands/          目標:六檔總和 ≤ 16,000(SC-1)
    feat.md  mod.md  perf.md  refactor.md  bug.md  auto.md
    chore.md         不動
  harness/
    RATIONALE.md               執行期永不載入(已建立)
    refs/
      load-manifest.json       載入帳的唯一資料源(§4.2)
      reviewer-preamble.md     立場 + severity + finding 欄位 schema + 雙欄 location + cross-round
      review-protocol.md       吸收三處 /code-review 重複,改寫為 Workflow 驅動
      scope-tiers.md           feat + mod 的 S/M/L 合一
      sp-overrides.md          superpowers 顯式覆寫三條
      feat-phase0-2.md
      feat-phase3.md           含從 SDD 摘寫的三條紀律
      feat-phase4-fix.md       條件式:收到 test-gap finding
      feat-phase8.md
      feat-state.md            Phase -1 引用(指標留 feat.md 核心)
      auto-wave.md             條件式:goal_efficiency_mode
  skills/
    auto-verify/SKILL.md
    branch-lifecycle/SKILL.md
      references/exceptions.md 條件式:撞到異常
  agents/                      四檔抽共用前言;**輸出鐵則移入 preamble,不刪**
```

### 4.1 機械關閉 SDD(SC-8 為前置 gate)

「停止點名 → 不會載入」**不成立**:plugin enabled 時 skill description 常駐,`using-superpowers` 明令「1% 可能適用就必須 invoke」,而 Phase 3 的「≥3 檔且彼此獨立」正中 `subagent-driven-development` 的 description。

**做法**:`settings.json` 設 `skillOverrides: {"<key>": "user-invocable-only"}`。

- 選 `user-invocable-only` 不選 `off`:官方 changelog 記載 `off` 對模型與 `/` 都隱藏(逃生門焊死),`user-invocable-only` 只對模型隱藏 —— 省 context 又保留 `/superpowers:subagent-driven-development` 手動入口。
- **key 格式未驗**:現有兩個樣板都是個人 skill(裸名),SDD 是 plugin skill(清單顯示帶 `superpowers:` 前綴)。這正是本 spec 點名的「配置外推」錯型,**不得憑推論寫死**。步驟 10 先實測裸名與前綴兩種,SC-8 通過才算數。

**備案(SC-8 未通過時)**:不關 SDD,改為在 `feat.md` Phase 3 寫一行負向指示(「本流程不呼叫 `subagent-driven-development`,改用 Workflow;紀律見 `refs/feat-phase3.md`」),並接受該 skill 仍佔 context —— 此時 SC-2 門檻放寬至 **94,000 bytes**,並在 `feat-improvements.md` 記一條待解。

**其餘三支不動**,理由逐一具名:

| skill | 為何不動 |
|---|---|
| `dispatching-parallel-agents` | 條件分支(per_file,實測未用);且 `feat.md:49` 仍指涉它 —— §5 表已註明不刪該指涉,故此前提成立 |
| `using-git-worktrees` | 實測有活躍 worktree,只是 state 欄位沒回寫;且 `EnterWorktree` 契約要求「被 user 或 CLAUDE.md 明確指示」才可用,刪指標反而沒人授權 |
| `finishing-a-development-branch` | `feat.md:112` 保留其指標句(§5 表),依「description 常駐 + 1% 必用」模型它會在 Phase 8 載入 → **必須列入 manifest 的 `condition` 項**,不得從帳上憑空消失 |

#### 關閉 SDD 前必須先移植的三條紀律

Workflow tool 提供機制(fan-out / pipeline / schema),**不提供 SDD 的流程紀律**。這三條的來源是 plugin skill 檔、不是 command 檔,所以是**摘寫不是剪下**(步驟 1b):

1. **每 task 後的 review gate + fix loop** — 不是全部做完才 review
2. **跨 compaction 的 ledger 檔** — SDD 原文稱此為「the single most expensive failure observed」
3. **禁止並行 dispatch implementer**(review / 唯讀分析可並行,實作不行)

### 4.2 載入帳:`load-manifest.json`

spec 不列載入數字。改由 manifest 承載,`harness_load_estimate.py` 讀它求和。

```json
{
  "profiles": {
    "feat-L": [
      { "path": "commands/feat.md",                    "scope": "main" },
      { "path": "harness/refs/scope-tiers.md",         "scope": "main", "phase": 0 },
      { "path": "agents/design-reviewer.md",           "scope": "subagent", "phase": 1 },
      { "path": "harness/refs/feat-phase4-fix.md",     "scope": "main", "phase": 4,
        "condition": "收到 test-gap finding" },
      { "path": "<superpowers>/finishing-a-development-branch/SKILL.md",
        "scope": "main", "phase": 8, "condition": "Phase 8 若仍被 invoke" }
    ],
    "mod-M": [], "bug": [], "refactor": [], "perf": []
  }
}
```

欄位語意:
- `scope`:`main`(計入 SC-2)/ `subagent`(計入 SC-2b)
- `phase`:載入時機,供 `refs_for_phase()` 產生 PHASE_GATES 的 ref 欄(**單一資料源,不手抄兩份**)
- `condition`:有此欄即為條件式;`--worst` 時計入,否則不計

腳本模式:`--profile <name> --scope <main|subagent> [--worst]` 求和;`--before/--after` 對照;`--verify-dispositions` 掃 §5 表落點。

---

## 5. 逐檔處置表(單一資料源,取代 v2 的 §5 + §6)

欄位:**處置** = `核心` / `ref` / `刪` / `改寫`;**驗收** = SC-3 逐列定位的依據。
只列需要決策的項目;未列出者一律「照原樣留在核心」。

### 5.1 feat.md

| 規則 / 段落 | 處置 | 落點 / 說明 |
|---|---|---|
| 檔頭骨架 + 共通鐵則與 auto.md 契約指標 | 核心 | 五個 command 一致,零例外 |
| 核心原則:receiving 分類 / 3 輪上限 / P1≤2 退場 / 失敗類型分流 | 核心 | |
| 核心原則中的 `/code-review` 字樣(第 10 行) | **改寫** | 改指 `refs/review-protocol.md`,不點名 CLI(SC-5)|
| SC gate 完整版(含驗證窗口 + 降級策略) | 核心 | 專案特有,盤中限定驗證 |
| S/M/L 分流 | ref | `refs/scope-tiers.md`(與 mod 合一)+ 核心一行指標 |
| Phase -1 setup + state 初始化 | ref | `refs/feat-state.md`;**指標句留核心**(hook 此時不觸發)|
| 延續型 feature 掃前輪指示 | ref | `refs/feat-phase0-2.md` |
| Phase 1/2 review 迴圈細節 | ref | `refs/review-protocol.md` |
| Phase 2 模式選擇(condensed 預設 / per_file opt-in) | 核心 | 預設反轉是實測一個量級的 token 差 |
| 實作模式表 + Phase 3 失敗回退表 | ref | `refs/feat-phase3.md` |
| **SDD 三條紀律(ledger / 每 task review gate / 禁並行 implementer)** | **ref(新增)** | `refs/feat-phase3.md`;來源是 plugin skill,摘寫非剪下 |
| TDD tag 判準 | 核心 | `check_feat_tags.py` 直接吃 |
| commit 前 cat `docs/next-time.md` + subagent 代查 | 核心 | fresh-context subagent 不知該檔存在 |
| Phase 4 步驟 1 的 `/code-review`(第 74 行) | **改寫** | 改為依 `refs/review-protocol.md` 跑 Workflow 驅動 review |
| Phase 4 雙焦點 + P2 彙總契約 | 核心 | missing-from-spec 模型不會自己做 |
| Phase 4 快篩四條 | ref | `refs/review-protocol.md` |
| Phase 4 修 finding 操作(`[lock]` / mutation / 禁 git checkout / 同檔混類) | ref | `refs/feat-phase4-fix.md`(條件式)|
| `self_review_head` 寫入 | 核心 | 收尾判增量 review 的唯一依據 |
| **Phase 6 失敗回退 (a)(b)(c) + real-env round JSON 產物** | 核心 | auto-verify 無此路由與產物契約 |
| Phase 7 五欄證據表 | 核心 | 最終 gate,不准 N/A |
| state.json 每 phase 回寫 | 核心(一行) | hook 只在產 commit 的 phase 觸發,不能靠它 |
| Phase 8 收尾操作 + artifact commit | ref | `refs/feat-phase8.md` |
| Phase 8.5 沉澱 | ref | `refs/feat-phase8.md` |
| `superpowers:subagent-driven-development` 點名 | **刪** | 改 `skillOverrides` + 三條紀律移植(SC-8 為前置)|
| `superpowers:using-git-worktrees` / `finishing-a-development-branch` 指標句 | 核心 | v2 誤判為可刪;後者須列入 manifest `condition` |
| `git add` 的「不要 `-A`」 | 刪 | `safety-hooks.py` 已 deny |
| 鐵則 F 重述 / 「等使用者確認」 | 刪 | 前者共通層、後者 brainstorming HARD-GATE |
| 自主模式建議節 | 刪 | 100% 字面重複,只留 auto.md |
| 所有日期實證敘事 | 刪 | → RATIONALE.md(已建立)|
| Done 一句 + 收尾呼叫句 | 核心 | |

### 5.2 mod.md

| 規則 / 段落 | 處置 | 落點 / 說明 |
|---|---|---|
| 檔頭指標句 | 核心 | |
| Phase 1 caller map 落檔 `current-state.md` | 核心 | reviewer fresh context 只吃檔案路徑 |
| Phase 2 不能破壞的既有行為白名單 | 核心 | 比新行為更重要 |
| **Phase 3 `change-spec-reviewer` dispatch + max 2 輪退出條件** | 核心 | v2 兩張表都漏了它 |
| Phase 3 diff 級 spec 三類標記 | 核心 | |
| Phase 4 三類順序 🔵→🔴→🟢 與「🔴 先改既有測試讓它紅」 | 核心 | 鐵則 E 改 assertion 禁令的唯一合法通道 |
| Phase 5 的 `/code-review`(第 33 行) | **改寫** | 依 `refs/review-protocol.md` |
| Phase 5 inline 完工自查 checklist | 核心 | 實測模型做不到,非 MODEL_NATIVE |
| Phase 6「不該紅 → 不改 assertion」 | 核心 | |
| Phase 7 白名單逐一檢查 + migration 真實環境 | 核心 | auto-verify 全文無 migration |
| Phase 8 白名單打勾 + migration 可逆 | 核心 | /mod 唯一終局對帳點 |
| S/M/L 重寫 | ref | `refs/scope-tiers.md` |
| 自主模式建議節 | 刪 | 退出條件範例**移入 auto.md 表**(該表現缺 S/M 列)|
| SC gate 重述 / 開工括號步驟 / 收尾括號說明 | 刪 | |
| 禁止清單與鐵則 B/E 重疊條 | 刪 | 保留流程特有條 |
| Done 一句 + 收尾呼叫句 | 核心 | |

### 5.3 perf.md

| 規則 / 段落 | 處置 | 落點 / 說明 |
|---|---|---|
| 第 1 行標題 + `$ARGUMENTS` 插槽、第 3 行空參數提問 | 核心 | 全檔只有這兩處 `$ARGUMENTS`,刪掉 metric 進不了 prompt |
| 檔頭指標句 | 核心 | 與其餘四檔一致(v2 曾誤判可刪)|
| 量化目標 gate 三件 | 核心 | |
| 「root bottleneck 不是旁支」判準 | 核心 | systematic-debugging 無此判準 |
| 3 輪定位不到 → 重新定義目標 | 核心 | 鐵則 F 不涵蓋 |
| cache invalidation 三欄 / 一策略一 commit | 核心 | |
| Phase 5 量其他不該退化的 metric | 核心 | |
| Phase 6「結果跟優化前完全一樣」+ 大量輸入 edge | 核心 | auto-verify 無此兩項 |
| 第 17 行對 auto-verify「何時呼叫」節的指涉 | **改寫** | 該節將刪;改成自帶「baseline 量測前先跑 auto-verify 自動化節」 |
| 第 3 行中與 Phase 1 gate 三重的「目標數字」重述 | 刪 | 只刪重述,保留提問句 |
| 自主模式建議節 / 禁止清單重疊條 | 刪 | |
| Done 一句 + 收尾呼叫句 | 核心 | |

### 5.4 refactor.md

| 規則 / 段落 | 處置 | 落點 / 說明 |
|---|---|---|
| 檔頭指標句 / Why? gate / characterization test 義務 | 核心 | |
| 每步保持綠 + 100 行拆分門檻 + 大爆炸禁令 | 核心 | |
| 「紅時預設 refactor 改錯」的 implementation-detail 例外與切 /mod 出口 | 核心 | 鐵則 E「事前標為該變」的唯一授權來源 |
| Phase 5 grep caller blast radius | 核心 | 鐵則 A 的 caller grep 只掛 Mod |
| 砍 dead code 前查動態用法 | 核心 | 與 Phase 5 是不同動作、不同失敗模式 |
| Phase 3 `refactor-plan-reviewer` dispatch + max 2 輪 | 核心 | |
| 第 19 行 auto-verify 抽樣數重述 | 刪 | 此處確實存在重述 |
| 收尾括號步驟與日期 / 自主模式建議節 / 鐵則重疊條 | 刪 | |
| Done 一句 + 收尾呼叫句 | 核心 | |

### 5.5 bug.md

| 規則 / 段落 | 處置 | 落點 / 說明 |
|---|---|---|
| 檔頭指標句 / 穩定重現 gate / 一次一假說 / 紅測試先行 | 核心 | |
| 最小修改 + `🔴` commit 標記 | 核心 | 鐵則 B 把 emoji 強制範圍委派給 command |
| Phase 5 blast radius | 核心 | 鐵則 A 不含 Bug |
| Phase 8 反向驗證 | 核心 | 模型原生不會做 |
| Phase 9 留尾巴 | 核心 | |
| 第 19 行「抽 2 個沒改的相關功能」 | 刪 | 與 auto-verify 重複;**保留 /bug 特有的「重走 Phase 1 重現步驟」** |
| 鐵則 F 全文重寫 | 改寫 | 改成一句引用 |
| 自主模式建議節 / 禁止清單重疊條 | 刪 | |
| **`.claude/bug/<slug>/repro.md` 落檔義務** | **核心(新增)** | 見 §7.4 |
| Done 一句 + 收尾呼叫句 | 核心 | |

### 5.6 auto.md

| 規則 / 段落 | 處置 | 落點 / 說明 |
|---|---|---|
| 退出條件語法 + 機械可判要求 | 核心 | |
| 退出條件成立後總結、列出所有 `[auto-default]` | 核心 | 唯一把標記推到 user 眼前的出口 |
| 3 次不成立上限 | 核心 | 鐵則 F 只管單步驟,不涵蓋頂層迴圈 |
| 自動核准範圍 | 核心 | |
| **方向性抉擇判定準則** | 核心 | 觸發偵測,不可延後 |
| review loop finding 免問授權 | 核心 | receiving-code-review 反而要求停下問 |
| 必停三類 + push/merge 除外括號 | 核心 | 鐵則 H 沒說 push 不算「對外發布」 |
| 各流程建議用法表 | 核心 | turn 1 把模糊需求轉成機械退出條件的唯一來源 |
| /mod S/M 級退出條件範例 | **移入**(自 mod.md) | 現表缺此列 |
| `goal_efficiency_mode` 整節 + wave 歸屬半語意判定 | ref | `refs/auto-wave.md` |
| 疊加內建 `/goal` 段落 | 改寫 | 壓成兩行 |

目標 bytes 不設硬門檻 —— 具名可壓縮來源有限,強壓會犧牲 load-bearing 政策。以 SC-1 的六檔總和統一把關即可。

### 5.7 auto-verify

| 段落 | 處置 | 說明 |
|---|---|---|
| 「何時呼叫」整節 | 刪 | 反向硬編碼各 command phase 號 = drift 源;skill 被呼叫時已在該 phase。**同時改寫 perf.md:17 的指涉**(§5.3)|
| 「與 verification-before-completion 職責邊界」整節 | 改寫 | 壓成開頭一行 |
| 「紀律邊界」整節 | 刪 | 兩條分別重複就近原則與鐵則 D |
| `dispatching-parallel-agents` 點名句 | 刪 | 註:§4.1 判「不動該 skill」的前提改引 `feat.md:49`,不再依賴此句 |
| E2E 是 harness.json 之外的條件 gate | **保留** | 下游依賴 |
| 偵測不到驗證指令 → 停下問 | **保留** | |
| happy + ≥2 edge + **抽 2 個沒改功能** | **保留** | `refactor.md:19` / `bug.md:19` 反向依賴此數 |
| 五步驟表 / harness.json 優先序 + stale 偵測 / 三條 shell 紀律 / 形狀表 / 真實環境 shape 表 / subsumed / infra fallback | 保留 | |
| 三條 shell 紀律的實證括號 | 刪 | → RATIONALE.md |

### 5.8 branch-lifecycle

| 段落 | 處置 | 說明 |
|---|---|---|
| 異常處理表 + pre-push flake triage + `gh pr create` 失敗路徑 + rebase 拒絕 | ref | `references/exceptions.md`(條件式)|
| 溯源段 + 「2026-07-18 取代 2026-07-07」沿革(兩處) | 刪 | → RATIONALE.md |
| 「自主模式」節 | 刪 | 收尾第 6 步已無條件全自動,該節描述不存在的差異 |
| 步驟 3 的 `/code-review`(第 40 行) | **改寫** | 引用 `refs/review-protocol.md` |
| 步驟 3 的 `/code-review`(第 41 行,`self_review_head` 判準句) | **改寫** | 保留判準,把 CLI 名改成 protocol 引用(SC-5)|
| 開工節 + prefix 表 + 收尾六步 | 保留 | |

### 5.9 四個 reviewer agent

| 項目 | 處置 | 說明 |
|---|---|---|
| 立場三條 + severity 定義 + **finding 欄位 schema + 雙欄 location** + cross-round 檢查 | **移入** `refs/reviewer-preamble.md` | **不刪**。四個 command 明文說「schema 固化在 agent 定義」,刪掉則全 harness 無處定義。四者 `tools` 含 `Read`,首行 Read 可行 |
| 各自的 Criteria 差異段 | 留原檔 | |
| `design-reviewer` 的 neigui domain criteria | **留原檔** | 該 agent `tools` 白名單無 `Skill`,無法 invoke 專案 skill(v2 另引「protect-harness 守 agents/」為由 —— 該 hook 本輪已停用,理由撤銷,只留白名單理由)|

> 本節收益是**去重防 drift,不是省主 agent 窗口** —— agent 檔只在該 agent 被 dispatch 時載入,且屬 subagent context(SC-2b)。

---

## 6. 四項拍板決議

### 6.1 `[refactor]` 與 `[lock]` — 降為選配 + 進 reference

- TDD 核心只留 `red → green` 兩 commit;`[refactor]` 改為「有重構才加」,不列強制順序。
- `[lock]` + mutation 抽驗 + 禁 `git checkout` + 同檔混類分批 commit → `refs/feat-phase4-fix.md`(條件式)。
- **不為此動 `check_feat_tags.py`** —— 該 script 從未要求 `[green]` 後必有 `[refactor]`(只計數)。v2 曾寫「同步放寬」,是對現況的錯誤宣稱。
- `[lock]` 的 `mutation-verified` 強制**照常有效**:規則移進 ref 不等於 gate 消失。

### 6.2 /mod emoji — 擴充 hook 機驗

**前提更正**:hooks 目前**完全沒有** emoji 檢查(F2)。所以這不是「推廣既有 gate」,是「新增一個 gate 並推廣到三個流程」。實作步驟:

1. `check_feat_tags.py` 新增**三類 emoji checker**(掃 subject 開頭是否為 🔴/🟢/🔵 其一)
2. `--state` 由 required 改 optional;新增 `--since <sha>`;兩者皆缺時 range 起點 fallback `git merge-base origin/main HEAD`
3. 流程型別由當前分支 prefix 判定(`feat/` `mod/` `fix/` `refactor/` `perf/`),決定套哪組判準
4. **在 `mod.md` / `bug.md` / `refactor.md` 的收尾加呼叫點** —— 三檔目前零處提及 `check_feat_tags.py`,不加呼叫等於 checker 永不執行
5. 非 feat 流程先以 **warning 模式**上線(exit 0 + 印警告)
6. 紅先行:先補 `tests/test_check_feat_tags.py` 的新 case(`--since` / prefix / emoji 三組)。註:現有 TestMain 全部顯式帶 `--state`,把 required 改 optional **不會**讓既有 case 變紅,紅必須來自新增 case

升為 block 的觀察指標:**連續 10 個非 /feat 流程收尾中,warning 誤報數 = 0**。誤報一次即重置計數並修判準。

### 6.3 /perf benchmark — 改寫成可驗

Done 條件改為「before/after 量測指令寫進 `optimize-plan.md` 且可重跑」。benchmark script 入庫降為條件式(該 metric 需長期監控才做),且若入庫則必須進 `harness.json` 或 pytest suite。

### 6.4 /bug — 補最小落檔義務

新增 `.claude/bug/<slug>/repro.md`:重現步驟 / root cause 實驗記錄 / Phase 8 反向驗證輸出。不加 state.json。

---

## 7. 遷移步驟

0. **SC-8 前置實測**:設 `skillOverrides` 兩種 key 各試一次 + 開新 session 觀察。通過 → 續行;未通過 → 走 §4.1 備案並調整 SC-2 門檻
1. 建 `~/.claude/harness/refs/`,寫 refs(內容從既有 command 剪下)
   - **1b**:自 SDD SKILL.md **摘寫**三條紀律進 `refs/feat-phase3.md`(來源是 plugin skill,不是 command,無法剪下)
   - **1c**:寫 `refs/load-manifest.json`
2. 逐檔改寫 command(一檔一 commit)
3. 改寫 auto-verify + branch-lifecycle(+ 建 `references/exceptions.md`)
4. 抽 `refs/reviewer-preamble.md`,四個 agent 檔改為首行 Read 它(**輸出鐵則移入,不刪**)
5. `harness_lib.py`:`PHASE_GATES` 加 `list[str]` ref 欄 + **新增** `refs_for_phase()`(不動 `gate_for_phase()`);`harness-context.py` 追加第四行(不取代既有三行)。ref 欄由 manifest 的 `phase` 產生,不手抄。紅先行
6. `check_feat_tags.py` 擴充(§6.2 六步,紅先行)
7. **修 `scripts/sync-harness-mirror.py` 的 `build_pairs` 支援 glob 目錄**(現行把 `src_rel` 當實體路徑,`skills/*/references` 會 `is_dir()` False 被靜默 continue = 假綠),再擴 `DIR_MAPS` 收 `harness/`、`harness/refs/`、`skills/*/references/`,同步擴 `ORPHAN_SCOPES`,補該腳本的測試。驗收見 SC-7(含故意改壞驗它不是假綠)
8. 更新 `docs/harness/SPEC.md` 與 `README.md`
9. 退役 `hooks/harness-push-gate.py` + `hooks/tests/test_harness_push_gate.py`(後者以相對路徑執行前者,只移一個會全紅)。註:兩檔已在 `sync-harness-mirror.py` 的 `EXCLUDED`,鏡像不受影響。SC-4 基準依指令輸出更新
10. 套用 SC-8 驗過的 `skillOverrides` key
11. SC-1..SC-8 逐條驗證,附指令輸出

---

## 8. 風險與 Known Risks

| 風險 | 處置 |
|---|---|
| SC-8 未通過 → §4.1 整條作廢 | 步驟 0 為前置 gate;備案已具名(負向指示 + SC-2 放寬至 94,000)|
| ref 該載入時沒載入 | §3 P1 機械注入。**Known Risk**:只涵蓋 `/feat`(其餘流程無 state.json,hook 不觸發);Phase -1 亦不涵蓋。兩者靠核心檔內指標句,列入下輪 |
| 關掉 SDD 後流程紀律流失 | 步驟 1b 為關閉前提;SC-6 真實跑一輪驗紀律仍在 |
| Workflow 驅動 review 未經真實流程驗證 | SC-6;本輪三次審視已是同形態實測 |
| `check_feat_tags.py` 擴充 false positive | 紅先行 + warning 模式 + 連續 10 次零誤報才升 block |
| 鏡像同步假綠 | 步驟 7 先修 `build_pairs`;SC-7 含「故意改壞必須 exit 1」的反向驗證 |
| 鐵則 A/B/E 半覆蓋(鐵則 B 缺 next-time.md 檔名與時機) | 本輪不動常駐層 → command 側保留該條;**Known Risk**:記入 `feat-improvements.md`,下輪處理 |
| `protect-harness.py` 停用期間無防弱化守備 | 見 §9;本輪結束後建議還原 |

---

## 9. `protect-harness.py` 停用(2026-07-25,user 指示,**已執行**)

Solo 開發下,改 harness 本體時每次跳 ask 確認框只是摩擦。本輪**已從** `~/.claude/settings.json` 移除其兩處註冊;hook 檔與 `hooks/tests/test_protect_harness.py` 均保留(該測試直呼 hook 檔、與註冊無關,照常綠)。

停用後不再有確認框的範圍:`~/.claude/hooks/**`、`~/.claude/settings*.json`、`~/.claude/agents/**`、`**/.claude/harness.json`、`**/.git/hooks/**`、`**/scripts/git-hooks/**`。
不受影響:`block-no-verify.py`(deny)、`safety-hooks.py`(deny)、`harness-stop-audit.py`(Stop block)。

還原方式 — 把下列兩個物件加回 `settings.json` 的 `hooks.PreToolUse`:

```json
{ "matcher": "Bash|PowerShell",
  "hooks": [{ "type": "command", "command": "python C:/Users/USER/.claude/hooks/protect-harness.py" }] },
{ "matcher": "Write|Edit|MultiEdit",
  "hooks": [{ "type": "command", "command": "python C:/Users/USER/.claude/hooks/protect-harness.py" }] }
```

(第一個原本併在既有 `Bash|PowerShell` 群組的 hooks 陣列末端,第二個是獨立群組。)

**Known Risk**:該 hook 原設計目的是防「被 prompt injection 的 agent 靜默弱化強制層」。停用期間這道防線不存在。新落點 `harness/refs/` 本來就不在其保護樣式內。

---

## 10. Out of Scope

- 常駐層重組 —— user 明確劃界,下一輪(user 已自行開始:專案 CLAUDE.md §0 刪 21 行,未提交)
- superpowers plugin 檔本體 —— 只改 `skillOverrides`,不改內容
- `chore.md`、neigui 專案 skills
- `/code-review` 能否被 agent 觸發的上游問題 —— 本輪繞過,不追上游
- `dispatching-parallel-agents` / `using-git-worktrees` / `finishing-a-development-branch` 的關閉 —— 理由見 §4.1 表
