# Harness RATIONALE — 規則的來歷

**執行期永不載入。** 只在兩種時機讀:meta-review、或準備改／刪某條 harness 規則之前。

存在理由:規則本體要短到能每輪帶著跑,但「為什麼有這條」不能弄丟 —— 沒有來歷的規則,下一個人(或下一輪的我)會以為它是贅文而刪掉,然後把同一個坑再踩一次。

格式:`[規則]` → 事件日期 / 實證內容 / **實際代價**。

**記錄紀律(2026-07-27 拍板)**:本檔與交接檔的計數類敘述(N 處 N 檔 / N passed)必附產生指令(diff / grep -c / pytest 輸出)並以其輸出回填,不憑修完的記憶枚舉 — 事故:ed58255 補記宣稱 7 處、內容只列 6 處,二輪復審靠 upstream diff 實數才抓到(e0a9bef 更正)。

---

## /feat

**[UI SC 可指認表述 + subsumed 限縮純 regression + 收尾 UI 驗收點 + Phase 4 (b) 必讀 design.md]**
2026-07-27 user 直接拍板(沿 07-26 前例不走排程 meta-review)。根因一條:e2e assertion 是模型從討論轉譯的,轉譯錯照樣綠 — user 原話「常常發現 AI 雖然會用測試環境 E2E 但結果根本不是使用者想要的畫面或功能」。四個缺口同根因(spec↔實作↔畫面的對照被成本優化與自動化綠燈架空):subsumed 條款讓轉譯錯的 e2e 頂替唯一人眼驗證;evidence/ 截圖無 user 過目點;UI SC 表述有轉譯歧義空間;Phase 4「diff 先落檔」讓 (b) 焦點的 design.md 對照變自由裁量。落點:feat.md Phase 0 SC gate / Phase 4 步驟 1 例外句 / Phase 6 步驟 2 限縮 + auto-verify v3.1.0 Subsumed 節 + refs/feat-phase8.md 步驟 4 UI 驗收點。還原 = 各處刪 2026-07-27 標記句。
2026-07-27 review 補修三處:auto-verify 限縮句補拍板標記(交接檔宣稱標記 ×1 實測 grep -c = 0,記錄紀律拍板同批即違反 — marker 還原路徑對該處失效,P1);Phase 7 步驟 3 例外欄補「僅純 regression SC 可標」限定(原無限定,Phase 6 錯誤 subsumed 在 Phase 7 機械欄檢查會放行,P2);Phase 4 (b) 例外句「SC / 介面節」改「SC 對應章節與接點節」(原詞彙不在 Phase 1 模板章節清單,行號圈定留有解釋空隙,P2)。/mod 側三槓桿缺口(可指認 SC 表述 / UI 驗收點缺席;subsumed 限縮經 auto-verify 已生效)記 next-time.md /mod 改版節,P2 不本批修。

**[Phase 0 提問姿態分流:已成形方案改 grilling 姿態 + /auto 不豁免拍板]**
2026-07-27 user 拍板。動機:brainstorming 是生成式(Claude 提 2-3 方案、寫 design doc),user 已帶成形方案(「我想用 X 做法加 Y」)時提案環節是儀式,真正需要的是對抗式拷問 — grilling 的逐分支決策樹、一次一題、每題附建議答案(skill 複製來歷見共通層 grill-me / grilling 條目;command 層指名本體 `grilling`,`grill-me` 薄殼是給人手打的)。兩者定位不衝突:brainstorming 生成式(提方案、產 design doc、接流程)、grilling 對抗式(拷問 user 既有方案,無產出無 gate),分流只換提問姿態,SC gate / brainstorm.md / S/M/L 全保留。原設計「/auto 跳過 grilling 照 brainstorming 走」(理由:每題等 user、自主模式永久停等)被 user 修正**反轉**:/auto 疊加也不豁免共識拍板,視同 auto.md「仍必停」— 寧可停等 user,不准模型自問自答無腦開發;規格來自 user 撰寫 / 已拍板文件者本就不觸發分流(該文件即拍板產物),照 auto.md 預核准替代條件。落點:feat.md Phase 0 步驟 1 分流句 + refs/feat-phase0-2.md 判準節。還原 = 兩處刪 2026-07-27 標記句(段落整段刪)。

### 顯式覆寫類(覆寫 superpowers 或共通鐵則,不是漏寫)

**[artifact 落點 `.claude/<type>/<slug>/`]**
覆寫 `superpowers:brainstorming` / `writing-plans` 的 `docs/superpowers/` 落點與「設計文件先 commit」要求。理由:artifact 統一釘在專案內,流程結束(Phase 8)才 commit,避免半成品設計文件散在主線歷史。

**[review 輪數上限 3]**(→ 2026-07-26 被「1 輪制」取代,見文末當日節;tech pivot 需 user 批准的條款保留)
覆寫 `superpowers:subagent-driven-development` 與 `requesting-code-review` 的「repeat until approved」無上限迴圈。理由:共通鐵則 G + token 經濟。**Tech pivot 想重置計數必須先取得 user 批准** —— 否則「換個方向重來」會變成繞過上限的後門。

**[P1 ≤ 2 帶額度退場]**
覆寫共通鐵則 G 的「無 P0/P1」退出條件。理由:餘下的 P1 已具名寫入 `## Known Risks` 落檔追蹤,不是默默放掉。沒有落檔就不適用這個放寬。

**[Phase 8 收尾走 branch-lifecycle 而非 `finishing-a-development-branch`]**
覆寫該 skill 的三選一互動。理由:solo 開發無 reviewer,user 已拍板收尾自動化。

### 實證類

**[state.json 每完成 phase 立即回寫]**
2026-07-06 審計:9 個 feature 中有 3 個的 state 與實際 artifact 不同步。
2026-07-25 補充:`harness-stop-audit.py` 只在「HEAD commit 晚於 last_updated」時 block,而 Phase -1/0/1/2/5/6/7 都不產 commit —— hook 在這些 phase 完全不觸發。**這條不能因為「有 hook 擋」而刪掉**,hook 只蓋住了產 commit 的 phase。

**[SC gate 要標驗證窗口(anytime / 盤中 / 特定交易日)+ 窗口外降級策略]**
2026-07-18:週六跑一個「僅盤中可驗」的 spike,觸發降級鏈,直到 design review 階段才被抓到。
代價:驗證方式重新設計一輪。所以窗口判定要在 Phase 0 就做完,不留給 review 補抓。

**[延續型 feature 必先掃前輪 design/brainstorm 的 user 指示與慣例語句]**
2026-07-18:沿用前輪架構時只取了架構、沒取指示,前輪 design 明載的設計 skill 指示沒帶入本輪,user 中途提醒才補跑。
**代價:重工 3 張證據截圖。**

**[Phase 2 預設 condensed,`per_file` 降為 opt-in]**
2026-07-06 meta-review:per-file MD 實測**零回讀**,condensed 走完全程,token 成本差一個量級。
2026-07-25 覆核:7 個有記錄的 `phase_2_mode` 全部 = condensed,0 個 per_file —— 這次瘦身可援引為前例(user 已有一次成功的 token 導向瘦身)。

**[`[green]` tag 只掛在有對應 `[red]` 的 commit;同步產物不掛 TDD tag]**
2026-07-18:慣性把 `[green]` 掛在同步產物(e2e spec 補寫 / changelog / 版本 pin / build-gate 修 / flake 修)上共 4 次,Phase 8 tag 驗證 FAIL。
**代價:cherry-pick 重建 5 個 commit。**

**[`/code-review` 預設 medium 檔位,xhigh 留給 user 顯式要求]**
2026-07-06:xhigh 全量掃描產出 52 個候選,其中真 P1 僅 1 條。

**[Phase 4 dispatch / 快篩紀律 (a)(b)(c)(d)]**
2026-07-11 meta-review 同根因收斂,單一區塊吸收了 6 條獨立 improvement entry。根因一句話:**minimal-model finder 對「機械事實」與「prompt 內排除契約」皆不可靠,把關責任在 main agent 不在 finder。**
- (c) 效能類 claim 要 runtime 證據 —— 2026-07-18:haiku 推算「不痛」而回空,主 agent 實測 280 檔約 10 分鐘。
- (d) reviewer dispatch 註明「純文字回傳 JSON,勿呼叫 ReportFindings」—— 該工具結果不會到達主 agent,誤用需 SendMessage 追討一輪。
  **2026-07-25 起作廢**:改用 Workflow 的 `agent(prompt, {schema})` 強制結構化回傳(本輪審計實測 12/12 agent 零格式失敗),此條不再需要。
  **2026-07-27 更正:並未全廢** — schema 強制只覆蓋 Workflow dispatch 路徑,review-protocol.md B 節仍保留 (d) 並限縮到 **ad-hoc Agent dispatch**(typed reviewer 由 tools 白名單天然擋掉)。上一行的「作廢」只適用 Workflow 情境;meta-review 別依本條把 review-protocol 的活規則當死條文刪。

**[test-gap finding 補 lock test:改壞／還原一律用 Edit 成對操作,禁 `git checkout` / `git restore`]**
2026-07-11:用 git 還原時連同掃掉同檔尚未 commit 的 review fix。
**代價:實證損失後補。**

**[同檔混類 finding:fix 先落地先 commit,refactor 類後動]**
2026-07-11:一次 `git add` 全檔混 commit。
**代價:被迫 `reset --soft` + 成對還原重上。**

**[artifact commit 的 `.gitignore` skip 分支]**
2026-07-11 copycat 專案實證(該專案 `.gitignore` 排除 `.claude/`)。neigui 本身 0 次觸發。

**[`sc_cycle_counts` 稀疏記帳]**
2026-07-06:實測多數 feature 全零,舊 run 卻留著 13-14 個全零 SC 條目 = 死重量。改為首次回退才建條目。

**[wave 模式的「全 SC 有 wave 歸屬」由 main agent 判,不在 script]**
`check_feat_tags.py` 明文寫此判定屬半語意,script 只列 wave→SC 對映。**不要以為 hook 驗過了。**

---

## /mod

**[Phase 1 caller map 落檔 `current-state.md`]**
reviewer 是 fresh context,只吃檔案路徑 —— 對話裡整理的表傳不進去。實測 14/14 個 mod run 都確實產出此檔。

**[🔴 行為改動:先改既有測試讓它紅 → 再改實作讓它綠]**
這是共通鐵則 E「禁止改測試 assertion 讓它通過」的**唯一合法順序**。`test-driven-development` skill 只教「新測試紅先行」,不涵蓋「既有測試該變」的情況;模型的預設行為是先改 implementation 再修壞掉的 assertion —— 正好是被禁的樣態。

---

## /refactor

**[紅時預設 refactor 改錯;例外是測試在測 implementation detail,若真是則停下切 /mod]**
共通鐵則 C 只寫「預設動到不該動的」,沒有這個例外分支與出口。刪掉它,鐵則 E 的「除非該 assertion 已事前標為該變」就失去唯一授權來源,模型只能硬改 assertion。

**[Phase 5 blast radius:grep 動到的命名／signature 所有 caller]**
共通鐵則 A 的 caller grep 只掛在 Mod 那一行,Refactor 那行寫的是「測試覆蓋盤點」。而改名／改 signature 正是 refactor 主業。

---

## /perf

**[root bottleneck vs「順便也慢」的旁支]**
`superpowers:systematic-debugging` 只有 Form Single Hypothesis / 一次一變數,**沒有「佔比是否夠大」的主瓶頸判準** —— 那是 perf 特有。刪掉會去優化只佔幾 % 的旁支。

**[3 輪 profile 定位不到 → 可能是分散式慢、無單一 bottleneck,該重新定義目標]**
共通鐵則 F 的觸發詞是「修不過 3 次」,不涵蓋「3 輪定位不到」;且 F 只要求回報,沒有這條 perf 專屬 routing。

**[Phase 6「結果跟優化前完全一樣」+ 大量輸入 edge case]**
`auto-verify` 只寫 happy + 2 edge(空／錯誤／邊界)+ 抽 2 個未改功能,沒有「與優化前一致」也沒有大量輸入。刪掉則 Phase 3 的行為白名單無驗收點,靜默改輸出會過關。

---

## /bug

**[Phase 5 blast radius]**
共通鐵則 A 只把 caller grep 綁在 Mod,不含 Bug。且 Done、自主模式退出條件、失敗 routing 三處都指向本 phase 產出的 regression 抽樣。

**[Phase 4 commit 標 🔴]**
共通鐵則 B 明文把「emoji 前綴的強制範圍」委派給流程 command 檔,未定義處不強制。刪掉這條,非 neigui 專案就完全失去強制。

---

## /auto

**[方向性抉擇判定準則(候選選項互換,SC 集合／out of scope／對外契約任一需改寫 → 停)]**
這是必停閘門的定義本身。**識別觸發的規則無法延後載入** —— 不知道自己踩到了,就不會去讀那份 reference。

**[Review loop finding 處置免問 user]**
`superpowers:receiving-code-review` 反而規定「不明確／架構級要 STOP 問 user」,branch-lifecycle 也沒寫免問。這條授權**只存在於本行**。

**[必停清單「花錢或對外發布」的 push / `gh pr merge` 除外括號]**
共通鐵則 H 只說 push / merge 自動,**沒說它不屬於「對外發布」**。刪掉括號,必停清單會自我矛盾,/auto 會停在 push 前。

**[退出條件 3 次不成立 → 套鐵則 F]**
鐵則 F 管的是「任一步驟修不過 3 次」;每一步都過、但頂層退出條件永遠不成立的自主迴圈不在其射程。這是 /auto 唯一的全域上限。

**[退出條件成立後停下總結,列出所有 `[auto-default]`]**
`[auto-default]` 標記散在各 artifact,這是唯一把它們推到 user 眼前的出口。省掉的不是格式,是通知。

---

## auto-verify

**[harness.json stale 偵測:verify 陣列任一 cwd 不存在 → 整檔視為 stale]**
2026-07-11 copycat 專案實證(殘留模板指向不存在的目錄)。

**[驗證／長跑指令不得接管線後綴]**
2026-07-11 copycat **兩度**實證:pipeline 把 exit code 換成末端指令的,紅燈顯示成假綠燈 —— ruff 紅著 commit、backfill 崩掉卻顯示成功。

**[驗證指令與 commit 禁止同一 shell 鏈]**
上一條的姊妹條(同族 = exit code 完整性)。2026-07-18 neigui 實證:PowerShell `;` 不看 exit code、Windows PowerShell 5.1 亦無 `&&`,`vitest ...; git commit ...` 會紅著 commit。
**代價:事後補 commit 修。**

**[表格單一 source of truth,command 不重抄]**
2026-07-06 為去除雙源 drift 而定。

---

## branch-lifecycle

**[設計依據]**
開工節與漂移處理:`docs/specs/harness-git-lifecycle/design.md`(2026-07-06)。
收尾節:`docs/specs/harness-pr-lifecycle/design.md`(2026-07-07 user 拍板,PR 收尾取代 local merge 預設)。
兩份皆在 neigui repo。

**[Detached HEAD / main 被其他 worktree 占用時,基準點一律取 `origin/main`]**
2026-07-18:以 rebase-merge 之後的 stale local main 開分支,中途才發現。
**代價:被迫 rebase + 全套 gate 重跑。**

**[收尾 gate 要檢查證據檔不得 untracked]**
2026-07-11 **兩度**實證:merge 之後才發現截圖／evidence 檔沒進版控。
**代價:被迫在 main 上補尾巴 commit。**

**[pre-push 測試紅的 triage:單獨重跑紅檔,綠 = 負載型 flake,可重推一次]**
2026-07-07 / 2026-07-11 兩度實證負載型 flake,且不限 backend。

**[merge 方式一律 `--rebase`]**
squash 會壓掉三類分離 commit 與 TDD tag,`git log --grep` 的機械驗證會失效。linear history 與舊的 local ff 等價。

**[push / merge 全自動]**
2026-07-18 user 拍板,取代 2026-07-07 的「單一確認點」。push-gate hook 同時除役。

---

## 共通層

**[hooks 已機械擋掉的,不必在 prompt 重複要求]**
- `block-no-verify.py`(PreToolUse: Bash|PowerShell):擋 `--no-verify` / `--skip-hooks` / `--no-gpg-sign` / `core.hooksPath`
- `safety-hooks.py`:擋 bulk `git add .` / `-A` / `--all`、`rm -rf`、秘密檔
- 模型連嘗試都會被 exit 2 擋回,寫在 prompt 裡是純負擔。

**[protect-harness.py 暫時停用]**
2026-07-25 user 指示:solo 開發下,改 harness 本體每次跳 ask 只是摩擦。hook 檔與其 pytest 保留,僅移除 `settings.json` 註冊。還原片段見 `docs/specs/harness-context-slimdown/design.md` §8.1。
原始設計目的:防「被 prompt injection 的 agent 靜默弱化強制層」。停用期間這道防線不存在。

**[superpowers plugin 停用 + 6 支複製為 user skill(2026-07-26,同日兩段決策)]**
第一段(user 拍板「先不複製」):`settings.json` `enabledPlugins."superpowers@claude-plugins-official": false`,13 支 description + SessionStart 全文注入(using-superpowers ~5KB)退出常駐層。
第二段(同日 user 改口「想繼續沿用」):**複製 6 支高頻 skill 到 `~/.claude/skills/`** — brainstorming / writing-plans / test-driven-development / receiving-code-review / verification-before-completion / systematic-debugging(來源:plugin cache 的 marketplace clone;**上游更新不會自動同步,要更新需手動重複製**)。harness 全部引用已去 `superpowers:` 前綴(commands / refs / branch-lifecycle / auto-verify / user CLAUDE.md / load-manifest 路徑)。**未複製的殘留引用**(using-git-worktrees ×2 / finishing-a-development-branch ×2 / executing-plans ×1 / subagent-driven-development ×1 負向)都是條件式罕用項,呼叫失敗依內建 gate 執行。淨省:SessionStart 注入 + 8 支未複製 description;新增成本:6 支 description(~350 tok)。還原 = enabledPlugins 改回 true + 刪除 6 個複製目錄(避免同名衝突)。
2026-07-27 review 補修:複製件**內文**殘留的 `superpowers:` 交叉引用已清(7 處 3 檔 — systematic-debugging 2 處去前綴指向複製件;writing-plans 4 處 = REQUIRED SUB-SKILL ×3 改「執行方式由呼叫方流程決定」(消除與 feat.md「不呼叫 SDD」的衝突指示)+ worktree context 文案 1 處改指 branch-lifecycle;writing-good-tests 1 處刪舉例)。(拆帳 2026-07-27 二輪復審以 upstream diff 實數更正:原記「writing-plans 3 處」漏列 worktree 文案處。)**日後從上游重複製會把死指標帶回來,重複製後必重跑 `grep -rn "superpowers:" ~/.claude/skills/<6支>`。**
複製機制備註:6 個目錄各含 `.orphaned_at`(ms timestamp,與 marketplace clone 目錄 `temp_git_*` 的時間戳僅差 3 秒)— 樣態指向 plugin 停用時 CLI 的 skill orphan 自動機制,非純手動 cp。無害;還原(刪目錄)不受影響,但「重複製」時留意 CLI 可能再產此標記檔。

**[grill-me / grilling 複製為 user skill(2026-07-27)]**
來源:`mattpocock/skills` repo(MIT),`skills/productivity/grill-me/SKILL.md` + `skills/productivity/grilling/SKILL.md`,原文照抄未改動。grill-me 是薄殼(`disable-model-invocation: true`,只能 `/grill-me` 手動呼叫,轉發 grilling);grilling 是本體(對計畫做對抗式逐題審問,決策樹逐分支收斂,每題附建議答案),description 含 'grill' trigger 可被模型自動觸發。用途:計畫/設計的壓力測試,定位在 brainstorming 提問階段的強化候選(user 預告將納入 /feat)。上游更新不自動同步,重複製 = 重抓 raw 兩檔覆蓋。還原 = 刪 `~/.claude/skills/grill-me/` 與 `~/.claude/skills/grilling/` 兩目錄。

**[harness-push-gate.py 是死檔]**
未註冊於 settings.json,內文仍寫著已於 2026-07-18 廢止的「PR 收尾單一確認點」政策。任何人(或模型)重讀該檔會得到過期規則。

---

## 2026-07-25 本輪瘦身的實證(規則變更依據)

**[靠 prompt 自律的規則實測失守,靠 script 機驗的守得住]**
neigui 749 commits:`[red]` 44 / `[green]` 59 / `[refactor]` **7** / `[waveN]` 42 / `[lock]` **2**;三類 emoji 336/749 = **45% 且在下降**(近 100 筆 48% vs 第 200-400 段 54%)。
`/mod batch-ui-polish`(2026-07-21)連續 **16 個 commit 零 emoji** —— 因為 `check_feat_tags.py` 只驗 /feat 的 state.json,/mod 沒有機械 gate。
**結論:規則要嘛有 gate,要嘛承認它是建議。第三種狀態(寫在 prompt 當 Done 條件但無人驗)最壞 —— 佔 token 又給假保證。**

**[never-fired 清單]**
`per_file` 0/7、`worktree_path` 16/16 = null、meta-cycle 升級 0 次真正執行、`infra_fail` 2/16、`[lock]` 2/749、`[refactor]` 7/749、`/perf` benchmark 入庫 5 run 只 2 支 script 且不在任何 gate。

**[規則落點錯 = 重工]**
兩條未結案 improvement 同根因:規則寫在 Phase 8,需要它的時刻在 Phase 4/6。
**代價:tag 寫錯 cherry-pick 重建 5 commit(07-18)、豁免文法在 Phase 6 讀不到而線性重建 8 commit(07-21)。**

**[對抗覆核的價值]**
本輪審計 151 條判定被推翻 28 條(18.5%)。錯誤集中兩類:(a) 拿只覆蓋一半的來源當「已完全覆蓋」的刪除理由;(b) 把「模型實測做不到」的規則誤判成「模型原生會做」。
**教訓:凡標 REDUNDANT_* 者,必須逐句對照來源檔再刪。**

---

## 2026-07-26 成本效率實測(45 個實驗,`neigui/docs/specs/harness-cost-research/`)

> ⚠️ **本節的前兩條在同日的 round 2 被推翻,見下一節。** 保留原文是因為「為什麼會排錯」比排名本身耐用。

**[prompt cache 命中是最大的單一成本因子 —— 比任何 context 瘦身都大]**(← round 2 推翻)
同一條件連跑 4 次 opus,token 數完全相同(43,360),成本在 **$0.2075 / $0.0218** 之間來回 —— **9.5 倍**。
官方定價 cache write = 1.25× base input、read = 0.1×,理論比值 12.5×,實測相符。
cache 是**逐位元組的 prefix 比對**,所以**改任何一個進 prompt 的 harness 檔,下一個 session 就從 read 掉回 write**。
~~操作規則:harness 改動集中在一個時間窗改完。~~ ← **撤回**,見下一節。

**[成本熱點排名(一次 opus session)]**(← round 2 推翻前兩名)
1. cache 命中 9.5× / 2. CLAUDE.md −8,826 tok(−20.4%) / 3. turn 數(每多一 turn 整個 context 再付一次,實測 +51,826 tok) / 4. plugin 停用 −2,768 tok / 5. 六個 command 檔合計 −4,846 tok 且單次只載入一支。
**上一輪把力氣全放在第 5 名,而第 2 名被 §10 明文劃在 scope 外。**

**[refs 分層對單輪成本是負的]**
走到 Phase 3:改版前讀 feat.md 一支 = 9,353 tok;改版後讀 7 支 = 11,731 tok,**+25.4%**。
機制:搬進 refs 是換位置不是刪掉,加上拆檔的固定開銷(**每檔約 142 prompt token,output token ×3** —— 模型會逐檔敘述)。
**它是注意力優化(phase 峰值 Phase 3 −11.7% / Phase 8 −37.1%),不是成本優化。**

**[bytes 是有效的 token 代理]**
12 個中文 markdown 檔(3.3KB-21KB)實測 **0.455 tok/byte**,全距 [0.441, 0.468]。
拿 bytes 當 SC 門檻是站得住的 —— SC-1 的 bytes 降幅與實測 token 降幅只差 1.4 個百分點。

**[兩條被推翻的假說]**
(a) **劑量反應不線性**:關 1/2/4/8 支專案 skill = +1/+13/−54/−82 token。照線性外推會得出「多關幾支省上千 token」的錯誤方向 —— skill 清單根本不是熱點。
(b) **prompt 大小不是模型無關的**:同一探針 haiku 40,194 / opus 43,358 / sonnet 55,064。用便宜模型量絕對值再套到貴模型上會錯 37%。

**[方法論:反常是訊號]**
兩次靠反常救回結論 —— 「基準(讀 1 行檔)比處置(讀 11KB 檔)貴」揭穿一整批權限 artifact(15 個實驗作廢重跑);「每 token 成本差 2.5 倍」追出上面那條 cache 發現。
陽性對照兩次擋下錯誤外推:SC-8 要有「已知會生效」的對照才能排除「headless 忽略設定」;H2 要有劑量反應才能擋下線性外推。

---

## 2026-07-26 成本效率實測 round 2(66 個實驗 + 303 個真實 session,`neigui/docs/specs/harness-cost-research/round2/`)

**[探針的形狀決定結論的形狀 —— 這是本輪最耐用的一條]**
Round 1 的 45 個實驗全用「回 OK」的**單次 API call** 探針。那種 session 裡開場 prompt 就是全部成本,所以任何影響開場 prompt 的東西都顯得極重要。真實 `/feat` 有 **344 個 turn**,開場只佔 1/344 的權重。
Round 2 換了分母:直接讀 303 個真實 session 的 transcript(每則 assistant 訊息都帶完整 usage),還原總花費 **$6,640**。**同一批效應,換一個分母,排名整個翻過來。**
**規則:量成本效率時,探針的 turn 數必須與被優化的對象同一個量級。**

**[真實成本解剖]**
cache read **54.7%**($3,634)> cache write **36.0%** > output **9.0%** > uncached input 0.4%。命中率已經 **95.3%**,不是待優化項。
成本的 **85.2% 落在 >100 turn 的 session**(只佔 19.5% 的 session 數),且在 session 內單調上升(後半段佔 62%)。
常駐層(turn 1 的 prompt,中位 55,828 tok)只佔平均每 turn prompt(244,892 tok)的 **24.1%**。

**[新的槓桿排名]**
1. **model 選擇** —— 同一題 fable-5 $0.687 vs opus-5 $0.145 = **4.74×**,語料 **76.6% 花在 fable-5**。牌價只解釋一半。**牌價便宜 ≠ 總成本低**:sonnet-5 牌價最低卻比 opus-5 貴 49%(探索了 2.1× context)。
2. **turn 數** —— 同 5 個檔拆成 5 個 turn:prompt **3.08×**、成本 **+29%**。對策是「同 phase 的 refs 用單一 message 平行 Read」,零檔案改動,比 round 1 建議的「合併成一支檔」更直接。
3. **effort** —— `xhigh` 是 `medium` 的 **2.10×**。(反常:`low` 比 `medium` 貴 18%,n=2 未定論 —— 推測 low 少想一步、多繞幾次工具賠回去。所以是往 medium 收斂,不是往 low 壓。)
4. output 指令 —— 天花板就是 output 佔比 **9.0%**。
5. 常駐層瘦身 —— 整份專案 CLAUDE.md **$67 / 1.0%**。常駐層最大一塊是**動不了的內建 tool schema(57.8%)**,CLAUDE.md 只 14.3%,skill 清單 7.0%。

**[撤回:集中改 harness 檔]**
實測失效是**局部**的(40k prefix 只重寫後段 14-19k,前 26k 的 system prompt + tool schema 不動)、**一次性**的(改回去立刻恢復全命中,乾淨/髒兩個狀態各有 entry 並存)、且按**狀態**計價不按次數計價 —— 配對複製顯示同一個 git 狀態第二次出現就全命中。一次約 **$0.37**,對中位 $97.93 的 `/auto` session 是 **0.4%**。

**[cache TTL 不是問題]**
寫入後隔 1s / 90s / 400s(跨過 5 分鐘)再打,三次**全部完全命中**。這條管道用 1h TTL(語料佐證:1h 佔 write 的 38.5%)。「長流程跨 phase 等待會掉出快取」的擔憂不成立。

**[CLAUDE.md 逐節可獨立定價]**
逐節刪除的 Δ 加總 −5,791 tok,整份全刪 −5,774 tok,**差 0.3%** → 沒有交互作用,那張價目表就是全部。tok/char 中位 **0.55**(round 1 獨立管道量到 0.56,互相複現)。

**[三條被推翻的假說]**
(a) **cache TTL 5 分鐘** → 實測 ≥6.7 分鐘。
(b) **常駐層最大單項是 CLAUDE.md** → 是內建 tool schema,4 倍於它。
(c) **委派 subagent 比自己做便宜** → 對小任務反而 **2.16×**(subagent 要自付一份常駐層,coordinator 還要再讀一次回報)。委派的收益是**平行**與 **context 隔離**,不是省錢。語料裡 subagent 佔 55% turn 但只佔 20.6% 成本 —— 每 turn 便宜是真的,但那不等於「多派幾個會省錢」。

**[方法論:陽性對照又擋下兩次]**
(1) 三次「什麼都不改」的對照裡有一次也失效 —— 若沒做這個對照,那批 n=1 的歸因會被全盤採信。
(2) 配對複製的第 1 輪完美支持「改檔 → 失效」,第 2、3 輪直接推翻。**只跑一輪就會發表一條反過來的操作規則。**

---

## 2026-07-26 /feat 改版:review 輪數與條文使用率實證(41 run artifact + 16 session transcript)

證據檔:`scratchpad/artifact-analysis.md` + `scratchpad/transcript-analysis.md`(session 級,已滅失則以本節數字為準)。分析方法:opus agent 掃 `.claude/{feat,mod,bug,perf,refactor}/` 全部 41 個 run 的 state.json / round JSON,+ 559 個 transcript 篩出 16 個完整 /feat session 交叉稽核。

**[spec review 降 1 輪制;design review 加輪限縮為 amendment diff-review]**
- 26 個 round≥2 的 review 檔,10 個(38%)產出 0 條 accepted P0/P1,4 個字面是 `[]`。
- impl-spec round 2:4 輪 5 條 finding,accepted P0/P1 = **0**,100% P2 → Phase 2 固定 1 輪。
- design round 2/3 扣掉兩個異常大案(e2e-tests、txo-chip-framework,前者是 tech-pivot 正當案例)後:9 run 12 輪只有 14 條 accepted P0/P1,**reviewer 真正新抓的獨立 P0 只 1 條**;且 round 2 相當比例在修 round-1 fix 自己造成的傷(rationale 欄自承)→ 加輪只審 changelog/amendment。
- code review round 2:3/14 跑到,唯一有價值的一次是 user 手動換 xhigh workflow 重跑(`phase_4_revisit`)——**輪數不是變因,方法深度才是** → 單輪深度優先(lens + verify 同輪)。
- 成本錨點:單次 code-review round 實測 51 agent / 2.81M token(p1-universe-filter 留檔)。

**[Finding 處置分級:spec review 不逐條 receiving]**
design-reviewer 286 條 findings accepted 率 **99.6%**(只打回 1 條)、impl-spec 98.8% —— 逐條 receiving 已退化成蓋章儀式。code review lens finder 誤報率 24.3%(機械快篩 + verify 真的在把關)→ receiving 全紀律只留 code review;spec finding 改「機械反證 → 修;修不動才 receiving」。

**[廢除 per_file / Findings>10 收斂 / inline 完工自查 / sc_cycle_counts]**
- `per_file`:7/7 有記錄 run 全 condensed(07-25 已知,本輪 0 新增)→ 整個模式刪除,`phase_2_mode` 欄位隨刪。
- 「Findings > 10 先收斂」:11 個 session 有 >10 findings 的 round,執行 **0/11** → 刪。
- Phase 4 inline 完工自查 checklist:3/16,07-07 之後 10 個 session 全 0(靜默死亡);其檢查項由 Phase 5 gate / Phase 7 表格 / Phase 8 tag 驗證機械覆蓋 → 刪。(2026-07-27 review 註:機械覆蓋成立的是四項之三 —「文件同步」無機械承接,殘餘保障只有 Phase 3 標題級步驟與專案 CLAUDE.md §7 的 changelog 義務。實測 3/16 表示該項本來就沒被 checklist 保護,缺口為已知接受,非覆蓋宣稱的反例修正對象。)
- `sc_cycle_counts`:非零僅 5/16 且全在 07-02 前;之後回退有發生但全沒記帳(9/16 all-zero)→ per-phase counter 實測失守,改 `rollbacks` append log(發生當下記一筆,零回退零維護)。`pending_review_rounds` 14/16 全零、`blockers` 16/16 空,隨刪。
- 佐證通則(07-25 條的再驗證):「有落地檔或省事的條文活著(scope 16/16、Phase 7 表 15/16、subsumed 7/8),只存在對話中的條文死亡(收斂 0/11、自查 3/16)」。**新條文要嘛產 artifact,要嘛別寫。**

**[next-time.md 鉤子改 checkpoint 制]**
「每次 commit 前 cat」實測 25/143(17%),條文更新後最好單輪 6/14 —— 每 commit 頻率從未達成 → 改 Phase 3 開工前 + Phase 8 收尾前各一次。

**[Phase 7 固定檔名 phase7-verification.md;分流只寫 FAIL]**
16 run 出現 9 種檔名(條文沒指定);6 個檔有「全 N/A 分流聲明」空轉段(通過的 SC 逐條寫 Type(1)N/A…)。表格品質本身是好的(cell 內 N/A 0 次)。

**[graphify 接入(Phase 0-2 query 優先 + Phase 8 --update)]**
Phase 0-2 平均 77 tool call 中 16.4 次純 code 探索(57KB/session);但**槓桿在 reviewer subagent 的重複讀**(subagent Read 52% 是重複,3.13MB vs main agent 0.9MB)→ 同時上 review-protocol B 節「diff 先落檔」。query 用 CLI 直呼不載 skill(SKILL.md ~30KB,載一次抵掉省的)。

**[「重複讀 harness 檔」假設被推翻]**
harness refs + superpowers SKILL 在 16 session 合計重複讀 3 次 / 4KB(Skill 注入不走 Read)。**不要再往「不重讀 refs」方向優化** —— 重複讀的主體是 subagent 之間的 design.md / diff / 源檔。

**[dispositions.json 部分 rows 自本日起過期]**
該檔是 harness-context-slimdown(design v12 §5)的驗收快照,不隨動。本次改版使以下 present 檢查失效:`Review 輪數上限 3`、`group-by-file dedup`、`sc_cycle_counts`、`condensed`(字樣仍在但語境變)、`dispatching-parallel-agents`、`完工自查 checklist`(feat 側)。重跑 `harness_load_estimate.py` 的 SC-3 驗證前先讀本條。

**[mod/bug/perf/refactor 側零結構化 review artifact]**
25 個非 feat run 的 review 記錄退化成 change-spec.md 散文,「多輪 review 制度」實際只在 /feat 落地 —— 其他流程的同步改版列入下次處理(本輪 user 指示只動 /feat)。
