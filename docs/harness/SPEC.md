# AI 開發 Harness — 完整規格(履歷素材 handoff)

> **這份文件的用途**:交給撰寫履歷 / 準備面試的 session 當唯一素材來源。所有數字都有 repo 內證據路徑(§8 索引),引用前不需要再回來問。撰寫時注意 §9 的誠實邊界。
> 最後更新:2026-07-06(harness v2 審計重構完成日)。

---

## 1. 定位與背景

- **一句話**:把 AI 輔助開發(Claude Code)包裝成一個有工程紀律的生產系統 —— 每個改動有可驗證的完成定義、流程有不可繞過的強制層、知識有分層儲存與 GC、流程本身有 issue tracker 並會自我改進。
- **宿主專案**:neigui(台股籌碼 / 選擇權分析 dashboard),FastAPI + React 19 + TanStack Query + Playwright,solo 開發。
- **時間軸**:2026-06-22 起以此 harness 開發;2026-07-06 對 harness 本身做了一次完整審計與 v2 重構(§6)。
- **規模數據**:app 版本 `0.21.3`(user-facing changelog 21+ 個 release);測試 **480 個 backend pytest + 585 個 frontend vitest + 62 個 Playwright e2e ≈ 1,100+**;9 個 feature 以完整流程留痕交付。
- **組成**:全域鐵則(~/.claude/CLAUDE.md)+ 6 個 slash command(435 行)+ 3 個 Python hook(637 行)+ 1 個驗證 skill + 6 個專案主題 skill(180 行)+ 三層 memory + 自我改進迴路。repo 內 `docs/harness/` 有全部鏡像。

## 2. 分層架構

```
全域鐵則(8 條,跨專案)
  └─ 流程指令 /feat /bug /mod /refactor /perf + /goal 自主模式契約
       └─ 驗證 skill auto-verify(形狀偵測,單一 source of truth)
            └─ 專案知識層:CLAUDE.md(12k,每 session 必讀)
                          + 6 主題 skill(按需載入)
                          + decisions.md(選型決策)+ next-time.md(scope 出口)
─────────────────────────────────────────────
強制層(hooks,PreToolUse 攔截,prompt 之外的 process-level enforcement)
自我改進迴路(.claude/feat/ 全程證據 + feat-improvements.md 流程收件匣 + meta-review)
```

## 3. 各層細節

### 3.1 全域鐵則(`~/.claude/CLAUDE.md`,8 條)

A. **觀察優先**:動手前先看(bug 先穩定重現、mod 先 grep 全 caller、perf 先 profile);root cause 沒釐清不能提交。
B. **Scope 紀律**:順手想改的寫進 backlog 不動手;三類動作(🔴 行為改 / 🟢 新功能 / 🔵 純重構)分開 commit。
C. **測試紀律**:TDD 紅先行;沒測試保護的 code 先寫 characterization test;既有測試紅 = 行為合約被打破,不是改 assertion 的理由。
D. **證據要求**:完成必附指令輸出 / 測試數字 / 截圖;禁止「應該可以」收尾;自動化全綠 ≠ Done,還要真實環境 + 回到動機核對。
E. **禁止繞過**:--no-verify / skip 測試 / 改 assertion 硬過 / mock 掉真實依賴 / 重啟當 fix / catch 後純 log 吞錯 —— 全列黑名單(並由 hooks 在 process 層強制,見 3.5)。
F. **失敗 3 次上限**:修不過 3 次必須停,回報「哪步 + 完整錯誤 + 試過的 3 種策略與各自失敗原因 + 推測根因」;禁止「繼續試試看」。
G. **Sub-agent 紀律**:fresh context 必須明確傳入 goal/spec/criteria;review criteria 結構化(checklist + JSON);loop max 3 輪 + P0/P1/P2 分級;資源預設最低 effort,難 judge 才升級且說明理由。
H. **Git 推送紀律**:push 前必列 commit 清單 + 目標 branch 給 user 確認;自主模式不豁免。

### 3.2 Slash commands(6 個)

**`/feat` — 10-phase 新功能流程**(核心,~200 行):

| Phase | 內容 | 關鍵 gate |
|---|---|---|
| -1 | 工作區隔離 | branch + artifact 目錄 + state.json 初始化(記 start_sha) |
| 0 | Brainstorm | **SC 可驗證性 gate**:每條成功條件編號 SC-N 且必附驗證方式;量化條件必附「單位 + 量法指令」;S/M/L 規模分流 |
| 1 | 設計 spec | sub-agent review(P0/P1/P2 JSON),max 3 輪,退出條件「無 P0 且 P1≤2 進 Known Risks」;criteria 含動態 trace(真實輸入紙上跑資料流找 race) |
| 2 | 逐檔實作 spec | >15 檔自動切 condensed 模式(流程成本意識) |
| 3 | TDD | 紅/綠/重構 commit 各帶 tag `[red]`/`[green]`/`[refactor]`;test-infra 修正與新 case 分流 |
| 4 | 自評 code-review | 雙焦點(impl bug + missing-from-spec);>10 findings 先 dedup;明文單輪退場條件;lock test 走 mutation 抽驗(改壞→紅→還原→綠)帶 `[lock]` tag |
| 5 | 自動化驗證 | 呼叫 auto-verify(tsc/vitest/pytest/ruff/build 全綠) |
| 6 | 真實環境驗證 | 依 feature shape 分流(web→DevTools 截圖 / API→curl edge cases);infra 失敗(token 過期、MCP 斷線)有標準 fallback 路徑,不算 SC 失敗 |
| 7 | 回頭核 goal | **強制結構化證據表**:每 SC 一列(實作行號 / 測試名 / 真實環境證據路徑 / regression 抽樣);出現「N/A」「應該可以」直接判未完成;失敗依類型四分流回對應 phase |
| 8 | 收尾 | **TDD 序列機械化驗證**:`git log --grep` 驗 [red] 先於 [green],配對失敗回去 rebase;artifact commit 進 repo |
| 8.5 | 沉澱 | 知識依目的地規則分流(skill / CLAUDE.md / memory)+ 強制 GC + 流程瑕疵寫收件匣 + meta-review 觸發檢查 |

**`/bug`**:穩定重現 → 單一假說驗證(一次一變數,對齊 systematic-debugging 方法論)→ 紅測試先行 → 最小修改 → blast radius → **反向驗證**(stash 改動 → 紅測試該紅回來,還綠 = 測試沒抓到 bug 要重寫)。
**`/mod`**:caller map(含動態用法 grep)→ **既有行為白名單**(比新行為優先驗證)→ diff 級 spec 三類標記 → 🔵→🔴→🟢 順序施工。
**`/refactor`**:why gate(寫不出「為什麼是現在」就停)→ characterization test → 每步 <100 行保綠 → 行為零差異驗證。
**`/perf`**:量化目標 gate(沒數字直接擋)→ profile 假說一次驗一個 → 一策略一 commit(可歸因)→ 同方法重量測 + 其他 metric 無退化。
**`/goal` — 自主模式契約**:退出條件必須可機械判定;設計選擇可自動敲定但逐項標 `[auto-default: 選擇|理由]` 供事後 audit;push/PR/merge/破壞性操作永遠停;大量檔數可切 wave batch commit(`[waveN]` tag,body 列 SC 歸屬)。

**跨 command 統一設計**:相同 skeleton(核心紀律/Phases/失敗 routing/Done/禁止清單)、P0/P1/P2 severity 語言、明文覆寫聲明(凡與底層方法論 skill 衝突處,顯式寫「覆寫 + 理由」,如 3 輪上限覆寫「repeat until approved」)。

### 3.3 auto-verify skill

單一 source of truth:專案形狀(fullstack/frontend-only/CLI/worker…)→ 驗證指令來源對照表;feature shape(web/API/CLI/TUI/Electron…)→ 真實環境驗證方式表。command 檔只寫「呼叫 auto-verify」不重抄表格(消除雙源 drift)。含 infra 失敗 fallback 與「已被 e2e 覆蓋則不重複驗」的 subsumed 判定。

### 3.4 專案知識層(三層記憶架構的專案側)

- **CLAUDE.md(12,207 chars)**:只放每 session 必讀的契約 —— 啟動/驗證指令表、e2e spec 判準表、Python/React 風格、跨檔契約(API error shape、TXO domain 鐵則)、版本管理規則、skill 索引。
- **6 個主題 skill**(`.claude/skills/`,trigger 寫進 description 由 harness 自動掛載):
  - `finmind-conventions`:Bearer 認證、共用 250-day window 設計(inflight dedup + invalidation 時序)、**配額真相(瓶頸是 6000 req/hr rolling window 不是 per-second rate,實測一檔冷載入 ~360 requests → 每小時只能冷載 ~16 檔)**、test 基建。
  - `market-pipeline`(最大,22 條):tick snapshot 含指數列陷阱、per-day loop、cache key 共用要 lock 常數+公式同構、**json.load 持 GIL 不放(1.5GB 檔凍 event loop 6.35s,to_thread 救不了,解法 chunked JSONL)**、None-safe 排序定式、threshold 邊界單獨測。
  - `cancel-chain`:五環取消傳導鏈(browser abort → vite proxy destroy → uvicorn disconnect → route task cancel → inflight dedup refcount;prd 第五環 Vercel 30s 超時)+ **驗收方法:用上游 API 用量計數器當 side-channel 驗到最後一環**。
  - `e2e-conventions`:FAKE_FINMIND 三層 fixture 架構(MANIFEST 顯式對映 + drift 防護測試)、後端時鐘凍結(`clock.today()` indirection + timebomb test)、selector 必對 page snapshot、fixture 日期寫死前驗星期。
  - `frontend-testing`:vi.spyOn 慣例、無 jest-dom 的替代寫法、Radix Tabs jsdom 陷阱、TanStack retry 終態測試。
  - `frontend-conventions`:root font-size + 全 rem 縮放、container query px/rem 選擇邏輯、useContainerSize 恆存 wrapper 陷阱、觸控 pointer-coarse。
- **條目品質規格**:每條有 code 錨點 + Trigger 條件;寫入前強制 GC(合併/翻新/刪同主題舊條目);含數字必標日期;date-bound 必寫失效條件。
- `docs/decisions.md`:採納與**刻意不採納**的選型決策(防止重開已結案討論,如「不上狀態管理 library 因 server state 已進 TanStack Query」)。

### 3.5 Hooks(process-level 強制層,Python,637 行)

定位:**prompt 裡的規則是建議,PreToolUse hook 是強制** —— AI 忽略不了。被擋時 exit 2 + stderr 把理由回饋給 agent 令其改走正路(不是 silent fail)。

- **`block-no-verify.py`**(216 行):經 adversarial review 強化,擋 20+ 種 git hook 繞過路徑,分三類:
  - 字面類:`--no-verify` / `--no-gpg-sign` / `--skip-hooks` / `commit.gpgsign=false`
  - 語意類:`core.hooksPath` 覆寫、`GIT_CONFIG_*` env 注入、HUSKY/pre-commit 環境變數、git plumbing(`commit-tree`/`update-ref` 跳過 porcelain hooks)、`.git/hooks/` 寫入、**`gh api` server-side commit(完全繞過本地 hook)**、libgit2 系 API commit
  - 重組類:brace expansion(`--no{,}-verify`)、printf 拼裝 flag、ANSI-C `$'...'` 編碼、shell 變數拼接(AND 條件:變數含 `--no`/`-verify` 且同指令有 `git commit`)、空引號對切割(`--no""-verify` 先 normalize 再比對)
- **`safety-hooks.py`**(167 行):白名單思維的破壞性操作攔截:
  - `rm -rf` 僅擋危險目標(`/`、`~`、`.git`、系統目錄、`..`);`node_modules`/`dist`/cache 明確放行(有 negative test)
  - **secrets 不進 context**:擋 cat/grep/xxd 等讀 `.env`/credentials/*.pem(讀出來就進 LLM 對話 = AI 時代新增洩漏面);也擋重導向寫入 secrets 檔
  - bulk `git add`(`.`/`-A`/`--all`)強制 selective staging;`curl|bash` 遠端執行;`chmod 777`
- **`format-on-edit.py`**:PostToolUse 自動 format。

### 3.6 三層記憶架構

| 層 | 載入時機 | 放什麼 |
|---|---|---|
| 專案 CLAUDE.md | 每 session 全量 | 契約、風格、指令表(嚴控 12k) |
| 主題 skills | description 常駐、本體按 trigger 載入 | code-anchored 累積慣例 |
| memory(帳號級) | 語意相關時 recall | 訂閱層級、user 偏好、名單類會過時資訊(13 檔,附「為何不進 CLAUDE.md」理由) |

沉澱目的地規則寫死在 /feat Phase 8.5,配強制 GC —— 知識庫只增不減就是垃圾場。

### 3.7 自我改進迴路

- **全程留痕**:`.claude/feat/<slug>/` 每個 feature 有 brainstorm.md → design.md(版本化 changelog)→ review round JSON(severity 分佈 + 逐條 resolution)→ 驗證 JSON → 真實環境截圖 → state.json(phase 進度 + 失敗計數)。9 個 feature 全套,commit 進 repo。
- **流程收件匣**(`feat-improvements.md`):每次 /feat 收尾自我回報流程瑕疵(schema:phase / severity / source / proposed_fix),明文觸發規則(P0 立即、同族 3 條強烈建議 meta-review)。
- **Meta-review**:2026-07-06 首次執行,20 條提案(4 P1)全數裁決落地(§6)。

## 4. 量化成果總表

| 指標 | 數字 |
|---|---|
| 交付 | 9 features 全流程留痕、app v0.21.3(21+ releases)、~1,100+ 測試(480 pytest / 585 vitest / 62 e2e) |
| Context 工程 | 常駐 context 35k → 12,207 chars(**-65%**),61 條 lesson 遷移零技術遺失(逐條驗證) |
| Review loop 實效 | 抓到行為級 bug:Max Pain 命中率 look-ahead bias、transient 失敗被鎖進 24h cache、None 排序 crash、naive/aware datetime TypeError、wrong-reason-green 測試 |
| 自我改進 | 20 條流程瑕疵提案(流程自己回報)→ meta-review 全落地;8 處與底層方法論的矛盾逐條裁決 |
| 防繞過 | 20+ 種 git hook 繞過路徑在 process 層封鎖 |
| E2E 基建 | FAKE_FINMIND 三層 fixture + 後端時鐘凍結 + MANIFEST drift 防護,CI 零外部依賴、deterministic |

## 5. War stories(面試展開用,細節齊全)

1. **Cancel 鏈五環驗證**:使用者中斷請求後,取消要穿過 browser → vite proxy(預設不轉發 abort,要掛 `res.on("close")` + `proxyReq.destroy()`)→ uvicorn disconnect → route task cancel → 共用 inflight dedup(無 shield 時一個斷線請求會毒殺所有共乘請求 → 裸 500;解法 `asyncio.shield` + subscriber refcount)。表面修好時 DevTools 顯示 `ERR_ABORTED`,**但那只證明第一環** —— 最終用 FinMind `user_info.user_count` 當 side-channel(打未快取 fan-out → abort → 看計數器停在哪,先量 idle drift 去噪)驗證取消真的傳到最後一環。生產環境還有第五環:Vercel rewrite ~30s 超時,>30s 的長計算必須與 request 生命週期脫鉤(背景 task + pending 旗標)。
2. **Look-ahead bias**:Max Pain 命中率回測用結算當天的 OI 算,命中率 90%+ —— 結算前 OI 已 collapse,是用未來資訊。修正為一律取 T-1 日,並寫進跨檔契約防再犯。sub-agent design review 在設計階段抓到。
3. **量測單位事故 → 流程修正**:SC 寫「≤ 50 KB」沒寫 gzip 前後,跑到實作階段才發現實際 130KB(raw),5 個 phase 白跑。事後不是只修這個 feature,而是**修流程**:SC gate 從此強制「單位 + 量法指令」。體現「事故 → 流程免疫」的迴路。
4. **GIL 假綠**:1.5GB JSON cache 用 `asyncio.to_thread` 包 `json.load` 以為不卡 event loop,單元測試(sleep mock)全綠 —— 但 `time.sleep` 會釋放 GIL 而 `json.load` 是單一 C call 不釋放,真實環境凍 6.35s。教訓:**mock 測不到 GIL 行為**,必須真檔探針;解法 chunked JSONL 把 stall 上界壓到單 chunk ~100-150ms。
5. **Harness 自我審計**(§6):流程對流程自己開刀,是「工具也是產品」的最強證明。

## 6. 2026-07-06 Harness 審計與 v2 重構(方法論亮點)

- **方法**:4 個平行蒐證 agent(9 個 feature 的執行證據統計 review 輪數與 severity 分佈 / memory 有效性 / 61 條 lesson 逐條 grep 驗 code 錨點存活 / command 與底層方法論 skill 的重複與矛盾比對)+ 4 個 adversarial 驗證 agent(重構後驗內容零遺失、20 條提案落點逐字存在、交叉引用全解析、8 矛盾已解)。
- **發現**:常駐 context 60% 是情境性知識(每次全載但當下用不到);自我改進收件匣累積 20 條無人收割(觸發規則存在但沒有執行機制);8 處 command 與方法論 skill 直接矛盾(如「列 3 個假說」vs「一次驗一個」);state 回寫 3/9 不同步;文件中同一參數出現 3 個互相矛盾的數字(實際 code 是第 4 個值)。
- **修正**:知識層拆按需載入(-65%)、矛盾逐條裁決(遵從方法論或顯式覆寫+理由)、自主模式從口頭慣例升級成書面契約、meta-review 掛進 Done checklist 讓迴路閉合。
- 完整審計證據:`docs/specs/harness-improvement/design.md`。

## 7. 對映通用工程概念(給履歷措辭用)

| Harness 機制 | 通用概念 |
|---|---|
| SC 可驗證性 gate / 結構化證據表 | Acceptance criteria testability、Definition of Done |
| TDD tag + git log 機驗 | 可稽核的流程合規(不靠自由心證) |
| Hooks 強制層 | Defense in depth、policy as code |
| secrets 不進 context | AI 時代的資料外洩面治理 |
| 三層記憶 + GC | Knowledge management、context/token 成本工程 |
| S/M/L 分流、review 輪數上限 | 流程成本意識、退出條件設計 |
| /goal 契約 + [auto-default] 標記 | AI 自主性邊界、human-in-the-loop 設計 |
| 收件匣 + meta-review | Continuous process improvement(流程有 bug tracker) |
| 蒐證→裁決→驗證的審計工程 | Evidence-based 決策、adversarial verification |

## 8. 證據索引(repo 內路徑)

| 素材 | 路徑 |
|---|---|
| 架構總覽 + cheat sheet | `docs/harness/README.md` |
| 6 commands + 3 hooks + auto-verify 鏡像 | `docs/harness/{commands,hooks,skills}/`、`docs/harness/global-rules.md` |
| 生效中的專案知識層 | `CLAUDE.md`、`.claude/skills/*/SKILL.md` |
| 9 個 feature 全程證據 | `.claude/feat/<slug>/`(brainstorm / design / review JSON / evidence 截圖 / state.json) |
| 審計 + v2 重構設計 | `docs/specs/harness-improvement/design.md` |
| 選型決策 | `docs/decisions.md` |
| GitHub | `github.com/loger-w/neigui`(以上全部已 push) |

## 9. 誠實邊界(履歷措辭時勿越線)

- Solo side project,無團隊協作 / 無外部 API consumer —— 不要寫成團隊流程或生產服務治理。
- 測試數字是「測試函式 / test block 數」的靜態統計(480 + 585 + 62),不是 coverage %;不要寫成覆蓋率。
- 「20+ 種繞過路徑」指 hook 的攔截 pattern 類別數,依據是 `block-no-verify.py` 的規則清單(4 substring + 13 regex + 4 AND 條件)。
- Harness 綁定 Claude Code 生態(hooks / skills / slash commands 是其機制);寫履歷時表述為「基於 Claude Code 的 agent 工程」,不要抽象成自研框架。
- 早期執行有瑕疵(state 不同步 3/9、一次 review 跑 6 輪超限)—— 這些在 §6 審計中發現並修正,可以當亮點講,但不要宣稱「流程從第一天就完美執行」。
