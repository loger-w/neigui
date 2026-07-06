# Harness 改善設計(2026-07-06)

> 目標:解決三個痛點 —— (1) 流程執行品質、(2) 知識沉澱機制、(3) context 膨脹。
> 審計方法:4 個平行蒐證 agent(流程執行證據 / memory 審計 / §9 過期檢查 / command-skill 重複檢查)+ 主線直讀全部 command / hooks / skill 檔。
> 總結論:骨架是好的,問題在「迴路沒閉合」—— 流程會自我回報瑕疵但沒人收割;知識會沉澱但沒有 GC;規則寫了「落實後可刪」但刪除從未發生。

## 0. 審計關鍵數據

| 項目 | 數據 |
|---|---|
| 專案 CLAUDE.md 每 session 全載 | ~35,000 chars,其中 §9 Lessons Learned 佔 60%(21,256 chars,~40 條)、§8 佔 9% |
| §8 升級路線 | P0(TanStack Query)/ P1(forwardRef、noUncheckedIndexedAccess)/ P2(pyright)**全部已落實**,依其自訂規則該刪未刪 |
| §9 條目品質 | 全部 code 參照仍存在(0 dead refs);但 9 條 stale 候選 + 6 組重複對 |
| feat-improvements.md 收件匣 | **20 條提案(4 條 P1)**,兩個同族 3+ 條家族已達 meta-review 觸發門檻,從未執行 |
| Command ↔ superpowers skill 矛盾 | 8 處直接矛盾(方法論對撞級) |
| 流程執行證據(9 features) | Review 抓到的是行為級 bug(look-ahead bias / cache pin / None sort crash),非空轉;但 state.json 3/9 與 artifact 不同步、e2e-tests 6 輪超限、txo 帶 5 P1 退出 Phase 1 |
| Memory(13 檔) | 健康:0 孤兒、0 dead ref;2 條該升 user-global、FinMind rate limit 三處數字不一致(5/8/15) |

---

## 1. Workstream A:Context 重整(§9 拆成 project skills)

### 1.1 新增 6 個 project skill

位置 `C:\side-project\trash-cmoney\.claude\skills\<name>\SKILL.md`,隨 repo commit。
description 寫明 trigger(常駐 context 的只有 description 一行,本體按需載入)。

| Skill | 收納 §9 條目 | description trigger 要旨 |
|---|---|---|
| `finmind-conventions` | FinMind API 接入 2 條、共用 window 設計 3 條、6000 req/hr 配額真相(自 cancel 段抽出) | 接新 FinMind dataset / 寫 probe 腳本 / 設計 fan-out endpoint / 評估冷載入成本時 |
| `market-pipeline` | Market snapshot 6 條、universe filter 4 條、breadth 4 條、sector aggregation 6 條、amount share 3 條、hot-path 3 條(GC 後約 20 條) | 動 market snapshot / EOD compute / breadth / heatmap / universe 任何一段時 |
| `cancel-chain` | API cancel 傳導 5 環、inflight shield/refcount、EOD 背景化(6 條中歸 cancel 主題者) | 改 cancel 鏈任一環 / 排查 prd 502 / CancelledError / 新增可能 >30s endpoint 時 |
| `e2e-conventions` | FAKE_FINMIND 三層、clock.today、痛點註解、fixture rotation、selector snapshot、**:8000/-​-reload 三條合併為一條** | 寫/改 Playwright spec、real-env 驗證 backend 改動前 |
| `frontend-testing` | vi.spyOn 慣例、無 jest-dom/user-event、RTL selector 過鬆、Radix Tabs jsdom、TanStack retry 終態 | 寫 component / hook 的 vitest 測試時 |
| `frontend-conventions` | 響應式/字級縮放 5 條、useContainerSize 2 條、PIL crop 截圖 1 條 | 新元件 / SVG renderer / 響應式 / container query 改動時 |

**跨界條目歸屬判例**(實作時照此):條目有兩個 trigger 時歸「較早需要它的那個」;`:8000/--reload` 合併條目歸 `e2e-conventions`(dev-loop 驗證是主場景),`cancel-chain` 交叉引用一行。

### 1.2 搬遷時同步 GC(逐條動作)

| 動作 | 條目 |
|---|---|
| 刪除(純流程史,無 code 錨點) | 「Multi-lens review 值得跑滿 12 條」、「split-vote 拆 fix 成分」(其精神已內化進 Workstream B 的 Phase 4 規則) |
| 合併 | :8000 zombie 殺 + :8000 查 CommandLine + --reload watcher 失效 → 單一「dev server :8000 驗證前檢查」條目(新結論為準) |
| 刪過期數字、留規則 | 冷啟動 257s / 30.24s / warm 36.8s(已被 /perf 翻新)、excluded_count 347/58/55 快照數字 |
| date-bound 改寫 | 「過 2026-07-15 TXO 結算後立紅」改為描述失效條件不綁日期;fixture rotation 具體日期(06-26/27)移入 e2e skill 並標「每季 rotation 後更新此行」 |
| 上收正文 | `foreign/dealer/trust` 鍵名一行併入 §4 跨檔契約;「App.tsx mode ternary」與 §3「hidden > 條件 render」互相加註層級差異(tab 內用 hidden、mode 級用 ternary) |

### 1.3 CLAUDE.md 本體改動

1. **§8 整節刪除**。「刻意不採納」表移到 `docs/decisions.md`(防止未來重提已否決方案),CLAUDE.md 留一行指引。
2. **§9 換成主題索引**(~10 行):每 skill 一行「什麼情境 → 用哪個 skill」。
3. **§3 seqRef 樣板段改寫**:現況是 TanStack Query(`useQuery` + signal),`seqRef` 段落已 stale(repo 僅剩 2 處殘留引用)。
4. **rate limit 數字統一**:§1「預設 5」/ §9「預設 8」/ memory「15」三處不一致 —— 實作時核實 `.env` 與 `rate_limiter.py` code default,以實際值統一改寫三處(memory 檔也更新)。
5. §0-§7 其餘不動。

**預期效果**:35k chars → 約 13k chars(-63%);拆出的知識總量不減,改為按需載入。

---

## 2. Workstream B:流程重構(thin command + 補跑 meta-review)

### 2.1 統一 command skeleton

五個 command 統一結構與編號體系(全部改用 Phase 編號,消滅「步驟 1-9 卻引用 Phase 1/2/3」):

```
# <Type>: $ARGUMENTS
共通鐵則引用(一行)
## 核心紀律(一句話)
## Phase 0..N(每 phase:做什麼 / 呼叫哪個 skill / gate 條件)
## 失敗 routing
## 自主模式(/goal)註記
## Done(可驗證條件)
## 禁止(本流程特有)
```

原則:**command 只寫「編排 + 專案無關的 gate + 對 skill 的覆寫」,不重抄 skill 內文**。要覆寫 skill 就顯式寫「覆寫 <skill>:<理由>」。

### 2.2 八處矛盾裁決

| # | 矛盾 | 裁決 | 落點 |
|---|---|---|---|
| 1 | bug.md「≥3 hypotheses」vs systematic-debugging「SINGLE hypothesis」 | 融合:候選假說清單可先列(調查廣度),驗證嚴格一次一個(遵從 skill) | bug.md |
| 2 | bug.md「3 次失敗 → 重列 hypotheses」vs skill「STOP + 質疑架構 + 找 user」 | 遵從 skill(與鐵則 F 本就一致) | bug.md 失敗 routing |
| 3 | feat.md 把 requesting-code-review 冒名當「自查 prep gate」 | Phase 4 改 inline 完工自查 checklist,不冒用 skill 名 | feat.md Phase 4 |
| 4 | 輪數上限 feat 3 / mod·refactor 2 / skill 無上限 | 保留 3 輪上限(鐵則 G 顯式覆寫 skill);mod/refactor 的 2 輪補退出條件「無 P0/P1」;tech pivot → 計數重置需 user 批准 | 全部 command |
| 5 | 文件落點 docs/superpowers/ vs .claude/feat/ | 保留 .claude/feat/<slug>/,顯式標 user preference 覆寫 | feat.md Phase -1 |
| 6 | writing-plans「執行模式由 user 選」vs feat.md 固定表 | 固定表為預設建議;非自主模式向 user 確認一次,自主模式直接採用並記 [auto-default] | feat.md Phase 3 |
| 7 | brainstorming 對話流程被壓縮成一步 | Phase 0 遵循 skill 對話流程;SC-N 編號 + 驗證方式是 command 加值 gate,分層寫明 | feat.md Phase 0、mod.md |
| 8 | auto-verify「何時呼叫」引用不存在的 Phase 6/7 | 五 command 統一 Phase 編號後,auto-verify 同步修正引用 | auto-verify SKILL.md |

### 2.3 Per-command 修繕清單

- **feat.md**:Phase 5/6 兩張 shape 表刪除 → 各一句「呼叫 auto-verify(表以 skill 為準)」;Phase 7 進入前加 state.json 一致性自檢(current_phase / completed_phases / 實際 artifact 對得上才進);schema 註記 phase_7 欄位語意(記錄用,不觸發計數)修正自相矛盾;sed/jq 腳本改用 PowerShell 等價或簡化。
- **bug.md**:編號統一 Phase 化;步驟 6 指名 auto-verify;反向驗證失敗的 escalate 條件補上(stash 後仍綠 → 測試重寫,計入鐵則 F 次數)。
- **mod.md**:白名單統一歸 Phase 2(brainstorm 產物),所有引用同步;S/L 判準對齊 feat 的 S/M/L(補 M 級);review 退出條件補「無 P0/P1」。
- **perf.md**:接上 skill —— profile 假說迴圈呼叫 systematic-debugging、行為驗證呼叫 auto-verify、回頭核呼叫 verification-before-completion;`optimize-plan.md` 落點定義為 `.claude/perf/<slug>/`;profile 找不到 bottleneck 的退出條件(3 輪 → 鐵則 F)。
- **refactor.md**:幻影 Phase 0 修正(Why gate 即 Phase 0,編號從 0 起);characterization test commit 標 🟢(新測試)與 refactor 🔵 分開;review 退出條件同上。
- **auto-verify SKILL.md**:修「何時呼叫」引用;加一段與 verification-before-completion 的職責邊界(auto-verify = 跑指令拿證據;v-b-c = 回頭核對動機與 SC)。

### 2.4 新建 `~/.claude/commands/goal.md`(自主模式契約)

`/goal` 過往只是 user 打的純文字慣例,無規格,導致兩條 inbox 提案。改為真 command:

- **語法**:`/goal <退出條件> <接續指令與參數>`,退出條件必須可機械判定(測試綠 / Phase N 完成 / metric 達標)。
- **自動核准範圍**:設計選擇採 own recommendation,逐項在 artifact 標 `[auto-default: <選擇> | reason: <理由>]` 供事後 audit;brainstorming HARD-GATE 替代條件 = 規格來自 user 拍板的文件(prompt 檔 / spec 檔)視為預核准,並記來源。
- **仍必停**:push / PR 建立 / merge / 破壞性操作 / scope 變更(對齊 memory「confirm before push」)。
- **goal_efficiency_mode**:寫入 `state.json.scope_overrides`,Phase 3 TDD commit 可改 wave batch(`[waveN]` tag),Phase 8 tag 驗證接受該替代(見 2.5 裁決 #2)。

### 2.5 20 條 inbox 提案逐條裁決

全部 accept(部分修改)。分四族 + 散件:

**族 1:Phase 8 tag 驗證對非 TDD-cycle commit false-fail(3 條 → 一次解)**

| # | 提案 | 裁決 |
|---|---|---|
| 2 | /goal 下 TDD 三 commit ceremony 不可行(P1) | accept:goal_efficiency_mode + `[waveN]` tag(見 2.4) |
| 17 | real-env design-amend commit 無 [red] 配對 | accept:🟢 + body 註 `Phase 6 real-env finding` 豁免配對 |
| 18 | Phase 4 lock test 天生無紅 | accept:新增第四類 tag `[lock]`(可為 0),body 須含 `mutation-verified`;Phase 8 grep 四類 |

**族 2:Phase 6 infra 失敗 fallback 缺失(3 條 → 一次解)**

| # | 提案 | 裁決 |
|---|---|---|
| 5 | 外部 API token 過期無標準 fallback(P1) | accept:infra_fail 標準 case 清單(token 過期 / MCP 斷線 / 外部 503)+ state.json 加 `phase_6_blocked_reason` |
| 11 | browser MCP 連不上無 fallback path(P1) | accept:fallback A(--isolated 重試)/ B(curl + RTL 替代覆蓋,UI 視覺標 next session 補)first-class |
| 3 | Playwright e2e 已含真實環境,Phase 6 重複 | accept:dispatch matrix 加「web + Playwright 已覆蓋該 SC → 標 subsumed by Phase 5」 |

**族 3:/goal 衝突(2 條 → goal.md 一次解)**:#9、#20 → accept,見 2.4。

**族 4:review 經濟性(5 條)**

| # | 提案 | 裁決 |
|---|---|---|
| 1 | L 級退出條件太嚴(6 輪 fatigue) | accept 修改:退出條件改「無 P0 且 P1 ≤ 2,餘 P1 逐條進 Known Risks」 |
| 4 | 25+ 檔 per-file MD 不實際 | accept:`phase_2_mode: per_file \| condensed_grid`,預估改動 >15 檔預設 condensed |
| 13 | >10 findings 無 dedup 流程 | accept:>10 條先 group-by-file dedup + severity rank 合併單一 JSON |
| 14 | Phase 4 單輪退場條件缺 | accept:「accepted ≤ 5 且無 P0 且 fix 後全綠 → 單輪退場;否則 round 2 verify」 |
| 15 | lens 命中率筆記 | accept:寫入 Phase 4 說明(mature codebase 上 test_coverage lens 命中率最高,lens prompt 必須角度差異化) |

**散件**

| # | 提案 | 裁決 |
|---|---|---|
| 6 | Phase 1 review 缺動態 trace lens | accept:review criteria 加「用真實輸入紙上 trace 主資料流(fetch→cache→invalidate→response)」 |
| 7 | Phase 4 雙焦點(impl bug + missing-from-spec) | accept:Phase 4 prompt 改雙焦點 |
| 8 | Phase 7 infra_fail 語法非 first-class | accept:表格允許 `infra_fail: <reason>`(對應 `phase_6_blocked_reason`) |
| 10 | test-infra fix 與新 case 未區分 | accept:selector/matcher 修正可同階段 patch,commit body 註 `test-infra-fix: <reason>`;SC 行為補測仍走 Phase 2 amendment |
| 12 | 量化 SC 無 measurement unit 保護(P1) | accept:Phase 0 SC gate 加「量化 SC 必附 unit + 量法指令」;Phase 1 review criteria 加對應檢查 |
| 16 | verify prompt 缺 design rationale | accept:Phase 4 verify 前先摘 design.md changelog 注入 skeptic prompt |
| 19 | subagent 模式 next-time.md 鉤子失效 | accept:main agent dispatch 前代查,有相關條目才塞進 dispatch prompt |

裁決落地後,`feat-improvements.md` 20 條逐條改標 `[resolved: <落點>]`,收件匣歸零。

### 2.6 next-time.md 集中

單一檔 `docs/next-time.md`(user 已拍板)。既有 3 檔(`docs/specs/{2026-06-29-chip-bubble-intraday-overlay,bubble-chip-ux,market-monitor-v2}/next-time.md`)內容併入(留 feature 來源標記),舊檔刪除。所有 command 引用寫死此路徑。

---

## 3. Workstream C:沉澱機制閉環

改寫 feat.md Phase 8.5(其他 command 的沉澱段同規則):

1. **目的地規則**(取代現行二分法):
   - code-anchored 專案慣例 → 對應主題 skill 檔(§1.1 的 6 個)追加條目
   - 每 session 必讀的契約 / 風格 → CLAUDE.md 正文(§2-§4)
   - 帳號 / 偏好 / 名單 / 跨專案 → memory
   - 流程瑕疵 → feat-improvements.md(不變)
2. **GC pass(寫入前強制)**:先搜同主題舊條目 → 合併 / 翻新 / 刪,不准只往上疊;含數字的條目必標日期;date-bound 條目必寫失效條件。
3. **meta-review 觸發檢查**:/feat Done checklist 加一項 —— 讀 inbox 統計同 phase / 同族條數,達門檻(P0 立即 / 同族 3+)就提醒 user 排 meta-review。
4. **memory 升級**:`feedback_confirm_before_push`、`feedback_subagent_effort_low` 兩條併入 user-global `~/.claude/CLAUDE.md`(§G 附近),memory 原檔標記已升級(保留指針或刪除)。

---

## 4. Harness showcase(履歷用)

user 需求:此專案將放進履歷,harness 本身要能在 repo 內展示。

1. **`docs/harness/README.md`**:harness 架構總覽 —— 分層圖(鐵則 → slash commands → skills → hooks → memory → workflow 證據)、設計理念(TDD 紅先行 / 3 輪上限 / 證據強制 / 自我改進迴路)、量化成果(9 features 全程留痕、review 抓到的行為級 bug 類型舉例、context 優化 35k→13k、20 條流程自我改進提案全數落地)。
2. **user-global 檔案鏡像**:`docs/harness/` 下放 commands(5+goal)、hooks(3 py)、auto-verify skill 的副本,README 註明 source of truth 在 `~/.claude/`、鏡像於每次 harness 改版時同步。
3. 專案內本來就有的展示材料點名:`.claude/feat/*`(9 個 feature 的 brainstorm→design→review rounds→evidence 全鏈)、`.claude/skills/`(A 拆出的 6 個)、`e2e/` 的 FAKE_FINMIND 三層架構。

---

## 5. 日常開發指令 cheat sheet(完工交付物)

完工後隨最終 command 定稿,先列骨架:

| 場景 | 指令 |
|---|---|
| 新功能 / 新頁面 | `/feat <目標>`(大功能);小改動看 S/M/L 分流自動降級 |
| 線上壞了 / 行為異常 | `/bug <現象>` |
| 改既有功能行為 / 介面 | `/mod <改什麼>` |
| 結構整理、行為不變 | `/refactor <為什麼>` |
| 有量化目標的變快 | `/perf <metric + 目標數字>` |
| 想全自動跑到某個點 | `/goal <退出條件> /feat <目標>`(新規格化) |
| 完成前驗證 | 各流程自動呼叫 auto-verify,不需手動 |
| 深度審查當前 diff | `/code-review`(或 `ultracode` 關鍵字開多 agent) |

---

## 6. 施工順序與驗收

| 步驟 | 內容 | 驗收證據 |
|---|---|---|
| A | 6 個 skill 建檔 + CLAUDE.md 重寫 + decisions.md | (a) 新 session skill 列表出現 6 個且 description 正確;(b) CLAUDE.md char 計數 ≤ 15k;(c) grep 全 repo 無指向已刪 §8/§9 段落的斷引用;(d) rate limit 三處數字一致(以核實值為準) |
| B+C | 5 command 重寫 + goal.md 新建 + auto-verify 修訂 + Phase 8.5 改寫 + inbox 歸檔 + next-time.md 集中 | (a) 交叉引用解析 checklist:所有 phase 編號 / skill 名 / 檔案路徑真實存在;(b) 8 矛盾逐條複核已解;(c) inbox 20 條全標 resolved;(d) 三個舊 next-time.md 已併入且刪除 |
| showcase | docs/harness/ + README + cheat sheet 定稿 | 鏡像檔與 source diff 為零;README 連結全部可達 |

**風險控制**:`~/.claude/` 下改動前逐檔留 `.bak`;repo 內改動分 commit(CLAUDE.md 重寫、skills 新增、docs/harness 各自獨立 commit,依專案 §6 慣例 type 用 `chore`/`docs`)。

## 7. Out of scope(本次不做)

- **B3(sc_cycle_counts 記帳機制砍除)**:state 回寫不穩有實證,但機制在後期 feature 運作改善;先觀察重構後一輪 /feat 再決定。
- **hooks 改動**:三個 hook 審計健康,不動。
- **memory domain 內容修訂**(warrant T+0 TODO、broker 名單年底複查):屬 domain 待辦,不在 harness 範圍。
- **superpowers plugin 本體**:只改我們這側的 command / skill,不 fork plugin。
