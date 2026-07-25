# AI 開發 Harness — 完整規格(履歷素材 handoff)

> **這份文件的用途**:交給撰寫履歷 / 準備面試的 session 當唯一素材來源。所有數字都有 repo 內證據路徑(§8 索引),引用前不需要再回來問。撰寫時注意 §9 的誠實邊界。
> 最後更新:2026-07-07(契約斷鏈掃描後同步:condensed 預設 / tag 機驗 script 化 / 第 7 個主題 skill / 數字刷新)。v3 三件工程(強制層第一期 / 版控生命週期 / review agent 定義化)與 v2 審計重構均完成於 2026-07-06。

---

## 1. 定位與背景

- **一句話**:把 AI 輔助開發(Claude Code)包裝成一個有工程紀律的生產系統 —— 每個改動有可驗證的完成定義、流程有不可繞過的強制層、知識有分層儲存與 GC、流程本身有 issue tracker 並會自我改進;v3 起流程合規**不依賴模型自律**(動機見 §6.2)。
- **宿主專案**:neigui(台股籌碼 / 選擇權分析 dashboard),FastAPI + React 19 + TanStack Query + Playwright,solo 開發。
- **時間軸**:2026-06-22 起以此 harness 開發;2026-07-06 對 harness 本身完成 v2 審計重構 + v3 強制層三件工程(§6)。
- **規模數據**:app 版本 `0.22.0`(user-facing changelog 22+ 個 release);應用測試 **480 backend pytest + 585 frontend vitest + 62 Playwright e2e ≈ 1,100+**;**harness 自身有 154 個 pytest**(hooks 130 + 鏡像同步器 17 + pre-push 7;強制層有 bug 比沒有更糟);9 個 feature 以完整流程留痕交付。
- **組成**:全域鐵則(~/.claude/CLAUDE.md,8 條)+ 6 個 slash command(486 行)+ **9 個 Python hook / script(1,638 行 + 1,589 行測試)**+ 2 個流程 skill(auto-verify 驗證、branch-lifecycle 版控)+ **4 個 review agent 定義(115 行)**+ **`harness/refs/` 按需載入層(10 檔 388 行)**+ git pre-push 防線(repo 側)+ 7 個專案主題 skill + 三層 memory + 自我改進迴路。repo 內 `docs/harness/` 有全部鏡像。
- **2026-07-25 phase 分層改版**:phase 細節自 command 移入 `~/.claude/harness/refs/`,command 只留「觸發偵測」層(六檔總和 41,224 → 29,891 bytes,−27.5%);rationale 移入 `harness/RATIONALE.md`(執行期永不載入);載入帳由 `harness/load-manifest.json` 承載,`hooks/harness_load_estimate.py` 求和並驗 `harness/dispositions.json`。設計與驗收見 `docs/specs/harness-context-slimdown/`。
  > **這是注意力優化,不是成本優化 —— 命名別再誤導下一個人。** 事後以真實 token 量測(`docs/specs/harness-cost-research/`,45 個實驗):走到 Phase 3 的載入量 9,353 → 11,731 tokens,**貴 25.4%**,因為搬進 refs 是換位置不是刪掉,而跨 phase 分開讀還有每檔約 142 token 的固定開銷。真正的收益是 **phase 峰值**(Phase 3 −11.7% / Phase 8 −37.1%)與「Phase 4 時不必扛著 Phase 8.5 的規則」。成本熱點另有其人,見下條。
- **2026-07-26 成本熱點實測**(`docs/specs/harness-cost-research/`):對一次 opus session,槓桿排名是 (1) **prompt cache 命中**(同 token 數成本差 **9.5×**)、(2) **CLAUDE.md**(−8,826 tok/session,−20.4%)、(3) **turn 數**(每多一 turn 整個 context 再付一次)、(4) plugin 停用(−6.4%)、(5) command 檔瘦身(六檔合計 −4,846 tok,且單次只載入一支)。**改 harness 檔會讓下一個 session 的 cached prefix 失效** —— 集中改、不要一天散改五次,這條不需動任何檔案,效益高於本輪所有結構改動的總和。

## 2. 分層架構

```
全域鐵則(8 條,跨專案)
  └─ 流程指令 /feat /bug /mod /refactor /perf + /auto 自主模式契約
       ├─ 驗證 skill auto-verify(形狀偵測,單一 source of truth)
       ├─ 版控 skill branch-lifecycle(開工/收尾/異常,五 command 共用)
       ├─ review agent 定義 ×4(專屬 criteria + 唯讀 tools 固化;立場 /
       │                        severity / JSON schema / 輸出鐵則共用
       │                        harness/refs/reviewer-preamble.md,首行 Read)
       └─ harness/refs/ 按需載入層(phase 細節 / review 協定 / 規模分流,
                                command 只留觸發偵測 + 指路)
            └─ 專案知識層:CLAUDE.md(12k,每 session 必讀)
                          + 7 主題 skill(按需載入)
                          + decisions.md + next-time.md
─────────────────────────────────────────────
強制層(hooks,5 個掛載事件,process-level enforcement)
  PreToolUse:繞過攔截 / 危險操作(Bash+PowerShell;push 確認已於 2026-07-18 除役)
  SessionStart + UserPromptSubmit:進行中流程狀態注入(每回合錨定)
  Stop:回合末審計(state 回寫 / 收件匣義務),可 block
  PostToolUse:自動 format
  + git pre-push hook(repo 側,跑全套測試,模型完全無關)
自我改進迴路(.claude/feat/ 全程證據 + feat-improvements.md 收件匣 + meta-review)
```

## 3. 各層細節

### 3.1 全域鐵則(`~/.claude/CLAUDE.md`,8 條)

A. **觀察優先**:動手前先看(bug 先穩定重現、mod 先 grep 全 caller、perf 先 profile);root cause 沒釐清不能提交。
B. **Scope 紀律**:順手想改的寫進 backlog 不動手;三類動作(🔴 行為改 / 🟢 新功能 / 🔵 純重構)分開 commit。
C. **測試紀律**:TDD 紅先行;沒測試保護的 code 先寫 characterization test;既有測試紅 = 行為合約被打破,不是改 assertion 的理由。
D. **證據要求**:完成必附指令輸出 / 測試數字 / 截圖;禁止「應該可以」收尾;自動化全綠 ≠ Done,還要真實環境 + 回到動機核對。
E. **禁止繞過**:--no-verify / skip 測試 / 改 assertion 硬過 / mock 掉真實依賴 / 重啟當 fix / catch 後純 log 吞錯 —— 全列黑名單(並由 hooks 在 process 層強制,見 3.5)。
F. **失敗 3 次上限**:修不過 3 次必須停,回報「哪步 + 完整錯誤 + 試過的 3 種策略與各自失敗原因 + 推測根因」;禁止「繼續試試看」。
G. **Sub-agent 紀律**:fresh context 必須明確傳入 goal/spec/criteria;review criteria 結構化(checklist + JSON);loop max 3 輪 + P0/P1/P2 分級;資源預設最低 effort,難 judge 才升級且說明理由(v3 起 criteria 與 effort 固化進 agent 定義,見 3.7)。
H. **Git 推送紀律**:**2026-07-18 起 push / merge 全自動**(user 拍板,取代 2026-07-07「merge ask = 單一確認點」;push-gate hook 同日除役,見 3.5)— 所有 push 與 `gh pr merge` 不需確認;推 main / force 附 commit 清單告知即可。

### 3.2 Slash commands(6 個)

**`/feat` — 10-phase 新功能流程**(核心):

| Phase | 內容 | 關鍵 gate |
|---|---|---|
| -1 | 工作區隔離 | 呼叫 branch-lifecycle 開工節 + artifact 目錄 + state.json 初始化 |
| 0 | Brainstorm | **SC 可驗證性 gate**:每條成功條件編號 SC-N 且必附驗證方式;量化條件必附「單位 + 量法指令」;S/M/L 規模分流 |
| 1 | 設計 spec | dispatch `design-reviewer` agent(P0/P1/P2 JSON),max 3 輪,退出條件「無 P0 且 P1≤2 進 Known Risks」;criteria 含動態 trace,固化在 agent 定義 |
| 2 | 實作 spec | **預設 condensed**(單一 PLAN.md,對它單發 `impl-spec-reviewer`);per_file 逐檔 dispatch 降為 opt-in(L 級高風險面才用,2026-07-06 實證 token 成本差一個量級) |
| 3 | TDD | `[red]` → `[green]` 兩 commit 各帶 tag(`[refactor]` 2026-07-25 起降為「有重構才加」,不列強制順序);test-infra 修正與新 case 分流 |
| 4 | 自評 code-review | 雙焦點(impl bug + missing-from-spec);>10 findings 先 dedup;lock test 走 mutation 抽驗帶 `[lock]` tag |
| 5 | 自動化驗證 | 呼叫 auto-verify(指令組優先讀專案 `.claude/harness.json`,與 pre-push 共用單一來源) |
| 6 | 真實環境驗證 | 依 feature shape 分流;infra 失敗有標準 fallback 路徑 |
| 7 | 回頭核 goal | **強制結構化證據表**:每 SC 一列;出現「N/A」「應該可以」直接判未完成 |
| 8 | 收尾 | TDD tag 機驗 script 化(`check_feat_tags.py`,配對 / 豁免規則固化 + 自帶 pytest)+ artifact commit + **branch-lifecycle 收尾節 PR 收尾(push → PR → review 補齊 → 自動 merge;2026-07-18 起無 merge 確認)**(顯式覆寫底層 skill 的三選一互動) |
| 8.5 | 沉澱 | 知識依目的地規則分流 + 強制 GC + 流程瑕疵寫收件匣 + meta-review 觸發檢查 |

**`/bug` /mod /refactor /perf**:核心紀律同 v2(重現→紅測試→反向驗證 / caller map→行為白名單 / why gate→characterization / 量化目標→profile 歸因);**v3 起四流程一律 Phase 0 開分支(fix/ mod/ refactor/ perf/ prefix)+ Done 後自動收尾**,版控規則不再重抄、全引 branch-lifecycle。
**`/auto` 自主模式契約**:退出條件可機械判定;自動敲定的決策標 `[auto-default]` 供 audit;push / PR / merge 全自動(2026-07-18 拍板,取代 2026-07-07「merge 確認框 = 唯一必停檢查點」)、破壞性操作永遠停。

**跨 command 統一設計**:相同 skeleton、P0/P1/P2 severity 語言、明文覆寫聲明(凡與底層方法論 skill 衝突處,顯式寫「覆寫 + 理由」)。

### 3.3 流程 skills(單一 source of truth 模式 ×2)

- **auto-verify(84 行)**:專案形狀 → 驗證指令來源對照表;feature shape → 真實環境驗證方式表;指令組優先讀專案 `.claude/harness.json`(與 git pre-push 共用,消雙源)。command 檔只寫「呼叫」不重抄。
- **branch-lifecycle(v3 新增;2026-07-07 v2:PR 收尾取代 local merge 預設,`docs/specs/harness-pr-lifecycle/design.md`)**:開工節(不在 main 停下問 → fetch 同步 → prefix 對照表開分支)/ 收尾節(Done+全綠 gate → 漂移判準 → review 補齊 → push 分支 + 開 PR → `--rebase` 自動 merge,2026-07-18 起無確認框;離線 fallback local ff)/ 異常表十列(rebase 衝突、分岔、撞名、不在 main、放棄、main 領先等;merge deny 列已隨全自動化移除)。**這份設計經自家 design-reviewer agent 兩輪 review 收斂**(§5 story 7)。

### 3.4 專案知識層(三層記憶架構的專案側)

同 v2:CLAUDE.md(12k chars,每 session 必讀契約)+ 7 主題 skill(FinMind 配額真相 / market pipeline GIL 教訓 / cancel 五環鏈 / e2e fixture 架構含判準表 / 前端測試 / 前端版面 / changelog 詞例,條目全帶 code 錨點 + 寫入前強制 GC)+ `docs/decisions.md`(採納與刻意不採納)。v3 新增專案插槽 `.claude/harness.json`(驗證指令機器可讀,pre-push / auto-verify / 未來 harness-check 共用)。

### 3.5 Hooks(process-level 強制層,Python,1,638 行 + 1,589 行 pytest)

定位:**prompt 裡的規則是建議,hook 是強制** —— 依據 protocol-model-dependency 實證(§6.2),文字指令的遵循率高度依賴模型檔次,hook 不依賴。v3 從 3 hooks / 2 事件擴到 **7 hooks / 5 事件**(後續再加 `check_feat_tags.py` 機驗 script,共 8 檔):

- **`block-no-verify.py`**:擋 20+ 種 git hook 繞過路徑(字面 / 語意 / 重組三類,含 gh api server-side commit、plumbing escape、printf 拼裝 flag);hooksPath 規則唯讀放行、攔設值與 unset。
- **`safety-hooks.py`**:危險 rm -rf 白名單制、**secrets 不進 context**(擋 cat/grep 讀 .env/credentials;PowerShell 面擋 Get-Content/Select-String 讀與 Set-Content/Out-File 寫)、bulk git add、curl|bash、chmod 777。
- **`format-on-edit.py`**:PostToolUse 自動 format。
- **`harness-context.py`(v3)**:SessionStart + UserPromptSubmit 注入「進行中 /feat 的 slug / phase / 下一個 gate / state 回寫狀態」— 弱模型長對話後遺忘流程位置,每回合重新錨定(soft reminder 機制);無進行中 feature 零輸出。
- **`harness-stop-audit.py`(v3)**:Stop 事件審計兩件可機驗的事 — state.json 落後最新 commit(且該 commit 未含 state 變更,排除 false positive)→ **block 一次**令回寫;Phase 8.5 收件匣義務未履行 → systemMessage 提醒(不 block,「無瑕疵」是合法結果不可機驗真偽)。`stop_hook_active` 防無限迴圈。
- **`harness-push-gate.py`(v3;2026-07-18 停用,2026-07-25 連同其測試檔一併刪除)**:曾將 `git push` / `gh pr merge` 強制跳 user 確認框(鐵則 H 硬攔後盾,fail-closed)。user 拍板 push / merge 全自動後先移除註冊,再於 context 瘦身改版中退役 —— 測試檔以相對路徑執行 hook 本體,兩檔必須一起移除。雙工具 matcher 教訓(Bash + PowerShell)由 block-no-verify / safety-hooks 延續。
- **`harness_lib.py`(v3)**:共用庫 — state.json 探索(active 判定:未 paused / 未 merge / 8.5 未完成 / 未 archived)、lagging 判定(git show 對 root commit 也正確)、Windows cp950 → UTF-8 stdio 強制。2026-07-25 新增 `refs_for_phase()`(讀 `load-manifest.json` 的 `phase` 欄產生,不手抄);**`PHASE_GATES` 刻意不加第三欄** —— `for p, gate in PHASE_GATES` 是兩元素解包,加欄必 ValueError 而被 harness-context 的兩層 except 吞掉,整段注入會靜默消失,已用測試釘住。
- **`harness_load_estimate.py`(2026-07-25)**:讀 `harness/load-manifest.json` 求和主 agent 窗口 / subagent context 載入量(`--profile` / `--scope` / `--worst` / `--before --after`),並以 `--verify-dispositions` 驗 `harness/dispositions.json`。`<superpowers>` 佔位符以 **profile 宣告的 `project_root`** 解析,禁用 process cwd(腳本住在 hooks/,用 cwd 會解到非在役的舊版本);manifest 列了不存在的檔一律 exit 非 0,不靜默略過。
- **git `pre-push` hook(repo 側,110 行)**:讀 `.claude/harness.json` 跑全套測試(479 pytest + 585 vitest + build),任一紅拒 push;user 手動 `git config core.hooksPath` 啟用一次,**Claude 被 block-no-verify 擋著動不了這條防線** — 防線保護自己。
- **fail-open/closed 分層**:注入/審計 hook 內部錯誤 → 警告放行(輔助設施不癱瘓工作);push-gate 在役期間 fail-closed(寧可多問一次;已除役)。
- **`protect-harness.py`(2026-07-25 起停用註冊)**:solo 開發下改 harness 本體每次跳 ask 只是摩擦。hook 檔與其 pytest 保留、照常綠;還原片段見 `docs/specs/harness-context-slimdown/design.md` §9。**Known Risk**:停用期間「防被 prompt injection 的 agent 靜默弱化強制層」這道防線不存在。
- **hooks 自身 TDD**:154 個 pytest(hooks 130 + 鏡像同步器 17 + pre-push 7;subprocess 餵 stdin JSON fixture 驗 exit code / 輸出),紅燈階段抓到 3 個真環境 bug(§5 story 6)。

### 3.6 三層記憶架構

同 v2:專案 CLAUDE.md(每 session 全量,嚴控 12k)/ 主題 skills(trigger 常駐、本體按需)/ memory(帳號級,語意 recall)。沉澱目的地規則寫死在 /feat Phase 8.5,配強制 GC。

### 3.7 Review agent 定義層(v3 新增,4 檔 115 行 + 共用 preamble)

- **動機**:四個 dispatch 點的 criteria checklist 原寫在 command 文字,靠 main agent「記得抄進 prompt」— 又一個弱模型會漏的自律點。定義化後 dispatch 降級為「指名 agent type + 傳檔案路徑」。
- **四檔**:`design-reviewer`(/feat P1,effort medium)/ `impl-spec-reviewer`(/feat P2,low)/ `change-spec-reviewer`(/mod P3,medium)/ `refactor-plan-reviewer`(/refactor P3,low)。effort 分級依鐵則 G:judge-heavy 才升 medium 且註明理由。
- **共用前言(2026-07-25 抽出)**:對抗立場(找問題不是背書、不確定標 P2 不准沉默)+ severity 定義 + **輸出鐵則(final message = 純 JSON array,main agent 直接 parse 落檔)**+ finding 欄位 schema + 雙欄 location + cross-round 檢查,四檔原本各抄一份,現統一在 `harness/refs/reviewer-preamble.md`,agent 檔首行 Read 它(四者 `tools` 含 `Read`,可行)。**是去重防 drift,不是省主 agent 窗口** —— agent 檔只在被 dispatch 時載入,屬 subagent context。
- **每檔仍固化**:專屬 criteria(從 command 搬入,逐項寫「檢什麼 + 怎麼算違反」)+ `tools: Read, Grep, Glob` 唯讀(reviewer 不准改檔案,工具層鎖死)+ 不鎖 model(inherit session — 弱模型時代自然跟降,不硬編強模型)。`design-reviewer` 的 neigui domain criteria 留原檔(該 agent 的 tools 白名單無 `Skill`,叫不到專案 skill)。
- **round ≥ 2 的 cross-round 檢查**(上輪 fix 是否引入新問題)寫進 agent 輸入規格;round 上限 / receiving 分類 / 退出條件留在 command(流程控制不是 reviewer 的事)。
- **首發實戰**(§5 story 7):smoke test 當天抓到 branch-lifecycle 設計的真 P0。

### 3.8 自我改進迴路

- **全程留痕**:`.claude/feat/<slug>/` 每個 feature 的 brainstorm → design(版本化 changelog)→ review round JSON → 驗證 JSON → 截圖 → state.json。9 個 feature 全套 commit 進 repo。
- **流程收件匣**(`feat-improvements.md`):流程自我回報瑕疵(schema 化),明文觸發規則;2026-07-06 meta-review 20 條全落地後歸零。
- **v3 的迴路閉合證據**:Stop hook 上線第一個回合就 block 並翻出 6 個已出貨 feature 的 state 收尾欠帳(正是 v2 審計自承的「3/9 不同步」全名單)— 強制層自動收割了自我改進迴路先前只能人工發現的欠帳。

## 4. 量化成果總表

| 指標 | 數字 |
|---|---|
| 交付 | 9 features 全流程留痕、app v0.22.0(22+ releases)、~1,100+ 應用測試(480 pytest / 585 vitest / 62 e2e) |
| Harness 自身品質 | 9 hooks / script(1,638 行)+ 154 個 harness pytest;TDD 紅燈抓到 3 個環境級 bug(git root-commit、cp950、CRLF shebang) |
| Context 工程 | 常駐 context 35k → 12,207 chars(**-65%**),61 條 lesson 遷移零技術遺失 |
| Review loop 實效 | 抓到行為級 bug:Max Pain look-ahead bias、transient 鎖進 24h cache、None 排序 crash、naive/aware datetime、wrong-reason-green 測試;**v3 agent 化首日再抓 branch-lifecycle 設計 P0 ×1 + cross-round P1 ×2** |
| 自我改進 | 20 條流程瑕疵提案 meta-review 全落地;Stop hook 上線首回合自動翻出 6 個 state 欠帳 |
| 防繞過 | 20+ 種 git hook 繞過路徑封鎖(Bash+PowerShell 雙 matcher);pre-push 全套測試防線(user 手動 push 也過)。push 確認框已於 2026-07-18 依 user 拍板除役 |
| E2E 基建 | FAKE_FINMIND 三層 fixture + 後端時鐘凍結 + MANIFEST drift 防護,CI 零外部依賴 |

## 5. War stories(面試展開用,細節齊全)

1. **Cancel 鏈五環驗證**:取消要穿過 browser → vite proxy(掛 `res.on("close")` + `proxyReq.destroy()`)→ uvicorn disconnect → route task cancel → 共用 inflight dedup(`asyncio.shield` + subscriber refcount,否則一個斷線毒殺所有共乘請求)。表面修好只證明第一環 —— 最終用 FinMind `user_info.user_count` 當 side-channel(先量 idle drift 去噪)驗證取消傳到最後一環。生產第五環:Vercel ~30s 超時,長計算與 request 生命週期脫鉤。
2. **Look-ahead bias**:Max Pain 命中率回測用結算當天 OI,命中率 90%+ 是假的(結算前 OI 已 collapse)。修正為一律 T-1,寫進跨檔契約。sub-agent design review 在設計階段抓到。
3. **量測單位事故 → 流程免疫**:SC 寫「≤ 50 KB」沒寫 gzip 前後,5 個 phase 白跑。修的不是 feature 是流程:SC gate 從此強制「單位 + 量法指令」。
4. **GIL 假綠**:1.5GB JSON 用 `asyncio.to_thread` 包 `json.load`,sleep-mock 測試全綠,真實環境凍 6.35s(`json.load` 單一 C call 不放 GIL)。教訓:mock 測不到 GIL,必須真檔探針;解法 chunked JSONL。
5. **Harness 自我審計(v2)**:4 平行蒐證 agent + 4 adversarial 驗證 agent,發現常駐 context 60% 是情境性知識、8 處 command 與方法論矛盾、收件匣 20 條無人收割 —— 全數裁決落地。
6. **強制層自己也要 TDD**:v3 三個 hook 的紅燈階段連抓 3 個「弱模型環境下會靜默壞掉」的 bug — `git diff-tree` 對 root commit 輸出空(state 審計會誤判)、Windows pipe 預設 cp950(hook 印繁中直接 crash)、sh shim CRLF shebang 在 Git Bash 無法執行(`.gitattributes` 鎖 LF)。強制層有 bug 比沒有更糟,154 個 pytest 是防線的防線。
7. **Reviewer agent 首發抓 P0 + cross-round 抓 fix 的 fix**:agent 定義化完成當天,`design-reviewer` smoke test 對剛寫好的 branch-lifecycle 設計回傳 5 findings — 其中 P0 是「主線漂移路徑的重驗跑在 merge 前的純新 main 上,merge 後的組合狀態從沒被驗過」(harness 核心承諾在最常見情境失效)。round 2 的 cross-round 檢查再抓到 round 1 fix 自己引入的 PR 永久分岔問題。兩輪收斂,漂移判準操作化為 `git merge-base --is-ancestor`。「固化 criteria 有用」不是自述,是它上線第一天就修正了同一天寫的設計。
8. **Stop hook 上線第一擊**:註冊後的第一個回合結束就 block —— 抓到的正是 v2 審計自承「state 3/9 不同步」的完整欠帳名單(6 個已出貨 feature 從未收尾)。處置時不偽造 completed_phases,而是擴充 `archived` 語意(誠實標記「已出貨但流程未留痕」)。文字規則連強模型都會漏,機械層第一天就自動收割。

## 6. Harness 審計與演進(方法論亮點)

### 6.1 v2 審計重構(2026-07-06 上午)

- **方法**:4 平行蒐證 agent(9 feature 執行證據 / memory 有效性 / 61 條 lesson 逐條 grep 驗錨點 / command 與方法論 skill 矛盾比對)+ 4 adversarial 驗證 agent(內容零遺失 / 20 提案落點逐字存在 / 交叉引用全解析 / 8 矛盾已解)。
- **修正**:知識層拆按需載入(-65%)、矛盾逐條裁決、自主模式書面契約化、meta-review 掛進 Done checklist。

### 6.2 v3 強制層工程(2026-07-06 下午,三件)

- **動機(外部實證)**:protocol-model-dependency 一文實測 — 同一份文字指令,Fable 5 遵循、Opus 4.x 12 sessions 遵循率 0%;加 hook(注入 + 審計)後回 ~37%。盤點本 harness:機械強制僅 3 hooks,約九成機制靠模型自律,且 state 3/9 不同步、review 跑 6 輪超限等失效前科**發生在強模型上**。結論:文字規則 = 建議,hook = 強制。
- **件一 · 強制層第一期**:注入(SessionStart/UserPromptSubmit)+ Stop 審計 + 雙層 push gate(PreToolUse ask + git pre-push 跑全套測試;**PreToolUse 那層已於 2026-07-18 除役,只剩 pre-push**)+ 專案插槽 `.claude/harness.json`。設計原則:可機驗的 gate 搬出模型;語意判斷(SC 品質、review 深度)誠實標注為殘餘風險。第二期(phase-exit 檢核 script 化 + state 自動回寫)依 rollout 觀察後啟動。
- **件二 · 版控生命週期**:四流程補自動開分支、收尾自動 merge + 刪分支、主線同步判準、merge 移出 /goal 必停清單(local merge 可逆 + push 仍硬攔)。
- **件三 · Review agent 定義化**:criteria 出 command、入 agent 定義;dispatch 從「組 prompt」降級為「指名」。
- 完整證據:`docs/specs/harness-enforcement/`、`harness-git-lifecycle/`、`harness-review-agents/`(各含 design + evidence)。

## 7. 對映通用工程概念(給履歷措辭用)

| Harness 機制 | 通用概念 |
|---|---|
| SC 可驗證性 gate / 結構化證據表 | Acceptance criteria testability、Definition of Done |
| TDD tag + git log 機驗 | 可稽核的流程合規(不靠自由心證) |
| Hooks 強制層(5 事件)+ pre-push 防線 | Defense in depth、policy as code、runtime guardrails |
| 注入 + 回合末審計 | Context anchoring、閉環監控(觀測 → 回饋 → 矯正) |
| secrets 不進 context | AI 時代的資料外洩面治理 |
| branch-lifecycle(短命分支 + ff + 自動收尾) | Trunk-based development 的 solo 變體 |
| Review agent 定義化(criteria/schema/唯讀工具固化) | Structured prompting、least-privilege、review rubric as code |
| 三層記憶 + GC | Knowledge management、context/token 成本工程 |
| S/M/L 分流、review 輪數上限 | 流程成本意識、退出條件設計 |
| /auto 契約 + [auto-default] 標記 | AI 自主性邊界、human-in-the-loop 設計 |
| 收件匣 + meta-review | Continuous process improvement(流程有 bug tracker) |
| 蒐證→裁決→驗證的審計工程 | Evidence-based 決策、adversarial verification |

## 8. 證據索引(repo 內路徑)

| 素材 | 路徑 |
|---|---|
| 架構總覽 + cheat sheet | `docs/harness/README.md` |
| 6 commands + 8 hooks / script(含 tests)+ 2 流程 skill + 4 agent 鏡像 | `docs/harness/{commands,hooks,skills,agents}/`、`docs/harness/global-rules.md` |
| 生效中的專案知識層 | `CLAUDE.md`、`.claude/skills/*/SKILL.md`、`.claude/harness.json` |
| git pre-push 防線 | `scripts/git-hooks/`(sh shim + Python + pytest) |
| 9 個 feature 全程證據 | `.claude/feat/<slug>/`(brainstorm / design / review JSON / evidence / state.json) |
| v2 審計設計 | `docs/specs/harness-improvement/design.md` |
| v3 強制層(design + 4 份 SC 證據) | `docs/specs/harness-enforcement/` |
| v3 版控生命週期(design 含兩輪 review changelog) | `docs/specs/harness-git-lifecycle/design.md` |
| v3 agent 定義化(design + 兩輪 review JSON 證據) | `docs/specs/harness-review-agents/` |
| 選型決策 | `docs/decisions.md` |
| GitHub | `github.com/loger-w/neigui`(以上全部已 push) |

## 9. 誠實邊界(履歷措辭時勿越線)

- Solo side project,無團隊協作 / 無外部 API consumer —— 不要寫成團隊流程或生產服務治理。
- 測試數字是「測試函式 / test block 數」的靜態統計,不是 coverage %。
- 「20+ 種繞過路徑」指 hook 攔截 pattern 類別數(依 block-no-verify.py 規則清單)。
- **「0% → 37%」是外部文章(protocol-model-dependency)的實證,不是本 harness 的量測**;本 harness 的弱模型遵循率尚無統計數字,v3 目前只有機制級證據(Stop hook 首日抓 6 筆欠帳、reviewer agent 首發抓 P0)—— 可以講機制與首日實效,不要宣稱「遵循率提升 X%」。
- 語意判斷類 gate(SC 品質、review finding 品質)仍靠模型智力,弱模型時代品質必然下降;harness 保證的是「必被執行 + 留痕可稽核」,不是品質 —— v3 設計文件明文承認此邊界。
- Harness 綁定 Claude Code 生態(hooks / skills / commands / agents 是其機制);表述為「基於 Claude Code 的 agent 工程」,不要抽象成自研框架。
- 早期執行瑕疵(state 3/9 不同步、review 跑 6 輪超限)在 v2 審計發現、v3 以機械層根治(Stop 審計 + 未來 phase-exit 自動回寫)—— 可當「發現 → 修流程 → 機械化免疫」的演進亮點講,不要宣稱從第一天就完美。
