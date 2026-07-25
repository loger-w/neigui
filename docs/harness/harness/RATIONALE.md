# Harness RATIONALE — 規則的來歷

**執行期永不載入。** 只在兩種時機讀:meta-review、或準備改／刪某條 harness 規則之前。

存在理由:規則本體要短到能每輪帶著跑,但「為什麼有這條」不能弄丟 —— 沒有來歷的規則,下一個人(或下一輪的我)會以為它是贅文而刪掉,然後把同一個坑再踩一次。

格式:`[規則]` → 事件日期 / 實證內容 / **實際代價**。

---

## /feat

### 顯式覆寫類(覆寫 superpowers 或共通鐵則,不是漏寫)

**[artifact 落點 `.claude/<type>/<slug>/`]**
覆寫 `superpowers:brainstorming` / `writing-plans` 的 `docs/superpowers/` 落點與「設計文件先 commit」要求。理由:artifact 統一釘在專案內,流程結束(Phase 8)才 commit,避免半成品設計文件散在主線歷史。

**[review 輪數上限 3]**
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

**[prompt cache 命中是最大的單一成本因子 —— 比任何 context 瘦身都大]**
同一條件連跑 4 次 opus,token 數完全相同(43,360),成本在 **$0.2075 / $0.0218** 之間來回 —— **9.5 倍**。
官方定價 cache write = 1.25× base input、read = 0.1×,理論比值 12.5×,實測相符。
cache 是**逐位元組的 prefix 比對**,所以**改任何一個進 prompt 的 harness 檔,下一個 session 就從 read 掉回 write**。
**操作規則:harness 改動集中在一個時間窗改完,不要一天散改五次。這條不需動任何檔案,效益高於整輪結構改動的總和。**

**[成本熱點排名(一次 opus session)]**
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
