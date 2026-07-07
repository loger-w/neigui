# Harness PR 收尾流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 五個流程 command 的收尾從「local ff merge」改為「push 分支 → 開 PR → review 補齊 → hook 單一確認 → auto-merge 到底」,依 `docs/specs/harness-pr-lifecycle/design.md`。

**Architecture:** 改動集中在 harness 三層 — 強制層(`harness-push-gate.py` 放行嚴格格式的流程分支 push)、流程層(`branch-lifecycle` 收尾節改版,五 command 引用它不重抄)、規則層(鐵則 H + `/auto` 必停清單修訂)。最後 `docs/harness/` 鏡像同步 + repo commit。

**Tech Stack:** Python 3(hook,stdlib only)+ pytest;其餘是 Markdown 規則檔。

## Global Constraints

- Source of truth 在 `~/.claude/`(非 git repo,Task 1-4 不 commit);`docs/harness/` 是鏡像,只在 Task 5 用 `cp` 同步後 commit 進 neigui repo。
- Hook 修改必須 fail-closed:任何不匹配放行格式的 push 一律 `ask`(design §4)。
- 放行 regex 僅接受**單獨一條**顯式指令 `git push -u origin <prefix>/<slug>`,prefix ∈ {feat, fix, mod, refactor, perf},slug = `[a-z0-9][a-z0-9-]*`;串接指令 / force / main / bare push 全部照舊 ask。
- merge 一律 `gh pr merge --rebase --delete-branch`(squash 會壓掉三類 commit 與 TDD tag)。
- 所有規則檔文字用 Traditional Chinese,沿用各檔既有格式(表格 / 條列風格不重排)。
- hook 測試綠是完成前 gate(SPEC:強制層有 bug 比沒有更糟)。

---

### Task 1: harness-push-gate hook — 放行流程分支 push + merge 確認點文案

**Files:**
- Modify: `C:\Users\USER\.claude\hooks\harness-push-gate.py`
- Test: `C:\Users\USER\.claude\hooks\tests\test_harness_push_gate.py`

**Interfaces:**
- Produces: hook 對 `git push -u origin <五 prefix>/<slug>`(fullmatch)輸出 `permissionDecision: "allow"`;對 `gh pr merge` 輸出 ask + reason 含「單一確認點」;其餘 push 行為不變(ask)。Task 2 的收尾節步驟 4/6 依賴此行為。

- [ ] **Step 1: 寫紅測試**

在 `test_harness_push_gate.py` 檔尾追加(檔頭 import 區補 `import pytest`):

```python
@pytest.mark.parametrize("prefix", ["feat", "fix", "mod", "refactor", "perf"])
def test_flow_branch_push_allowed(prefix):
    assert ask_decision(run_hook(f"git push -u origin {prefix}/pr-lifecycle")) == "allow"


def test_flow_branch_push_with_force_asks():
    assert ask_decision(run_hook("git push -u origin feat/x --force")) == "ask"


def test_non_flow_prefix_push_asks():
    assert ask_decision(run_hook("git push -u origin experiment/x")) == "ask"


def test_bare_push_asks():
    assert ask_decision(run_hook("git push")) == "ask"


def test_compound_flow_branch_push_asks():
    assert ask_decision(run_hook("git commit -m x; git push -u origin feat/x")) == "ask"


def test_uppercase_slug_asks():
    assert ask_decision(run_hook("git push -u origin feat/X")) == "ask"


def test_merge_reason_mentions_confirmation_point():
    res = run_hook("gh pr merge 12 --rebase")
    out = json.loads(res.stdout)["hookSpecificOutput"]
    assert out["permissionDecision"] == "ask"
    assert "確認點" in out["permissionDecisionReason"]
```

- [ ] **Step 2: 跑測試確認紅**

Run: `python -m pytest tests/test_harness_push_gate.py -q`(cwd `C:\Users\USER\.claude\hooks`)
Expected: 新增 11 個 test FAIL(5 個 allow 案例回 "ask"、merge reason 無「確認點」字樣),既有 9 個 PASS。

- [ ] **Step 3: 改 hook 實作**

`harness-push-gate.py` 三處修改:

(a) module docstring 第二段後補一行(鐵則 H 修訂註記):

```python
"""PreToolUse(Bash|PowerShell) hook: git push / gh pr merge 強制 user 確認。

鐵則 H(push 前列 commit 清單給 user 確認)的機械後盾:permissionDecision
"ask" 無視 session permission mode 強制跳 prompt — 模型忘了列清單,user 也
必然看到 push 指令本身。Fail-closed(design §4):內部錯誤仍回 ask。

2026-07-07 修訂(harness-pr-lifecycle design):流程分支 push(嚴格 fullmatch
單獨指令)放行;gh pr merge 的 ask 框升格為 PR 收尾單一確認點。
"""
```

(b) `PUSH_PATTERNS` 定義後追加:

```python
FLOW_BRANCH_PUSH = re.compile(
    r"^git\s+push\s+-u\s+origin\s+(?:feat|fix|mod|refactor|perf)/[a-z0-9][a-z0-9-]*$"
)
MERGE_PATTERN = re.compile(r"\bgh\s+pr\s+merge\b")

ASK_REASON = (
    "鐵則 H:push main / --force / 非流程分支 push 需 user 本人確認。"
    "若尚未列出 origin/<branch>..HEAD commit 清單與目標 branch,先列給 user。"
)
MERGE_ASK_REASON = (
    "PR 收尾單一確認點:試用完功能按 allow 即 merge 到底(rebase merge + 刪分支 + 拉回 main);"
    "deny 則流程停下收 feedback。"
)
ALLOW_REASON = "流程分支 push(PR 收尾自動步驟)— 鐵則 H 2026-07-07 修訂放行。"
```

(舊的 `ASK_REASON` 常數定義刪除,由上面新文字取代。)

(c) `emit_ask` 旁新增 `emit_allow`,`main()` 的判斷改為三分支:

```python
def emit_allow(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "permissionDecisionReason": reason,
                }
            },
            ensure_ascii=False,
        )
    )
```

`main()` 內原本的:

```python
        if is_push(command):
            emit_ask(ASK_REASON)
        return 0
```

改為:

```python
        if FLOW_BRANCH_PUSH.fullmatch(command.strip()):
            emit_allow(ALLOW_REASON)
        elif MERGE_PATTERN.search(command):
            emit_ask(MERGE_ASK_REASON)
        elif is_push(command):
            emit_ask(ASK_REASON)
        return 0
```

(`PUSH_PATTERNS` 保持原樣 — `gh pr merge` pattern 留著也無妨,`MERGE_PATTERN` 分支在它之前攔到;fail-closed 的 `except` 分支完全不動。)

- [ ] **Step 4: 跑測試確認全綠**

Run: `python -m pytest tests/test_harness_push_gate.py -q`(cwd `C:\Users\USER\.claude\hooks`)
Expected: 20 passed(9 既有 + 11 新增)。

- [ ] **Step 5: 跑 hooks 全套測試防 regression**

Run: `python -m pytest tests/ -q`(cwd `C:\Users\USER\.claude\hooks`)
Expected: 全綠(≈ 88 tests,77 既有 + 11 新增)。

---

### Task 2: branch-lifecycle 收尾節改版

**Files:**
- Modify: `C:\Users\USER\.claude\skills\branch-lifecycle\SKILL.md`

**Interfaces:**
- Consumes: Task 1 的 hook 行為(放行格式、merge ask 框)。
- Produces: 收尾節步驟 1-7 + 異常表 + 自主模式節;五 command 檔(Task 4)引用「呼叫收尾節」不重抄。`self_review_head` 讀取位置:/feat state.json、/mod change-spec.md 末尾(Task 4 寫入端)。

- [ ] **Step 1: frontmatter version bump + description 更新**

`version: "1.0.0"` → `version: "2.0.0"`;frontmatter `description` 改為:

```
分支生命週期單一 source of truth:開工(主線同步 + 開分支)與收尾(push → PR → review 補齊 → 單一確認 → auto-merge;離線 fallback local merge)。/feat /bug /mod /refactor /perf 的第一個 phase 與 Done 全過後呼叫。
```

- [ ] **Step 2: 開頭設計依據行補新 design 引用**

原「設計依據:`docs/specs/harness-git-lifecycle/design.md`(neigui repo,2026-07-06 user 拍板)」→

```
設計依據:開工節與漂移處理 `docs/specs/harness-git-lifecycle/design.md`(2026-07-06);收尾節 `docs/specs/harness-pr-lifecycle/design.md`(2026-07-07 user 拍板,PR 收尾取代 local merge 預設)。
```

- [ ] **Step 3: 整段替換「## 收尾節」**(原步驟 1-6 全刪,開工節不動):

```markdown
## 收尾節(各 command Done 條件全過後、最終回報前呼叫)

1. **Gate**:該 command 的 Done 條件全過 + auto-verify 全綠。沒過不准進收尾(收尾不是逃生門)。
2. 在分支上 `git fetch origin` 檢查兩件事:
   - **origin/main 動了沒**(判準:`git merge-base --is-ancestor origin/main HEAD` 成立 = 未動):未動 → 續;**動了(漂移路徑)** → `git switch main` + `git pull --ff-only` → 切回分支 `git rebase main`(衝突 → `git rebase --abort` 停下回報)→ 在 rebase 後的分支上**重跑 auto-verify 自動化節**;紅 → 停下回報,分支保留。
   - **local main 領先 origin/main 沒**(判準:`git rev-list --count origin/main..main` > 0):領先 → 停下要求先推平(走鐵則 H 的 main push 確認)— 否則 PR merge 後 origin/main 與 local main 永久分岔。全 PR 模式下 main 只從 GitHub 拉,「領先未推」應收斂為異常狀態。
3. **Review 補齊**(merge 前對完整 diff 的最終 code review;2026-07-07 拍板「補齊缺口不重跑」):
   - /bug /refactor /perf:跑 `/code-review`(medium)→ `superpowers:receiving-code-review` 逐條分類 → P0/P1 修完才進步驟 4(3 輪上限,超限依鐵則 F 回報)。P2 彙總計數不逐條 receiving,疑似行為級例外展開(同 /mod Phase 5 輸出契約)。
   - /feat /mod:讀自評結束時記錄的 `self_review_head`(/feat 在 state.json;/mod 在 change-spec.md 末尾)→ `git rev-list <self_review_head>..HEAD` 非空才對增量 diff 補一輪 medium `/code-review`;為空 → 沿用自評結果不重跑。
4. `git push -u origin <prefix>/<slug>` — **單獨一條指令下**(push-gate 對此嚴格 fullmatch 格式放行;與其他指令串接、帶額外 flag 都會 fail-closed 跳確認)。
5. `gh pr create`,body 四段:變更摘要 / review 結果摘要(finding 數 + 分類)/ 驗證證據(測試數字、截圖路徑)/ 試用指引。同分支已有 open PR → push 已更新它,跳過 create。
6. **單一確認點**:回報 PR URL + review 摘要 + 試用指引後,**同一 turn 直接發** `gh pr merge --rebase --delete-branch` — push-gate 的 ask 確認框就是「是否 merge」提示,user 可掛著慢慢試用:
   - **allow** → GitHub rebase merge + 遠端 / 本地分支刪除 → `git switch main` + `git pull --ff-only`,收尾完成。
   - **deny** → 流程停下收 feedback;修正後 push 更新同一 PR,重新進本步驟。
   - merge 方式一律 `--rebase`:保留三類分離 commit 與 TDD tag(squash 會壓掉,`git log --grep` 機械驗證失效);linear history 與舊 local ff 等價。
7. **Fallback(無遠端 / 離線 / gh 未認證)**:`git switch main` → `git merge --ff-only <prefix>/<slug>` → `git branch -d <prefix>/<slug>`,回報註明 fallback 原因 + main 領先 origin N 個 commit 可 push。
```

- [ ] **Step 4: 異常處理表追加四列**(既有列不動):

```markdown
| merge 確認 deny | 分支與 PR 保留,停下收 feedback;修正後 push 更新 PR 重發 merge |
| `gh pr create` 撞同分支既有 open PR | 沿用該 PR(push 已更新它),直接進單一確認點 |
| `gh pr merge --rebase` 被 GitHub 拒(不可 rebase) | 停下回報,不自動改 merge 方式 |
| local main 領先 origin/main | 停下要求先推平(鐵則 H main push 確認)後再續收尾 |
```

- [ ] **Step 5: 整段替換「## 自主模式(/auto)」**:

```markdown
## 自主模式(/auto)

收尾 gate 全綠即自動走 PR 收尾(push 分支 / 開 PR / review 補齊全自動,不停);**`gh pr merge` 的 hook 確認框 = 必停檢查點**(2026-07-07 拍板,取代 2026-07-06「local merge 自動、push 必停」)。離線 fallback 的 local merge 同樣自動。
```

---

### Task 3: 鐵則 H 修訂 + /auto 必停清單

**Files:**
- Modify: `C:\Users\USER\.claude\CLAUDE.md`
- Modify: `C:\Users\USER\.claude\commands\auto.md`

**Interfaces:**
- Consumes: Task 1 hook 行為(放行格式)、Task 2 收尾節(單一確認點語意)。

- [ ] **Step 1: CLAUDE.md 鐵則 H 整段替換**

原文:

```markdown
## H. Git 推送紀律
- push 前必列 `origin/<branch>..HEAD` commit 清單 + 目標 branch 給我確認;「push」≠「直推 main」。自主模式(/auto)不豁免。
```

改為:

```markdown
## H. Git 推送紀律
- 流程分支 push(單獨指令 `git push -u origin <feat|fix|mod|refactor|perf>/<slug>`,PR 收尾用)屬自動步驟,不必停。
- 其他 push(main / `--force` / 非流程分支)前必列 `origin/<branch>..HEAD` commit 清單 + 目標 branch 給我確認;「push」≠「直推 main」。
- `gh pr merge` = PR 收尾單一確認點(push-gate hook ask 框,試用完按 allow 即 merge 到底)。自主模式(/auto)不豁免。
```

- [ ] **Step 2: auto.md「仍必停」清單前兩條替換**

原文:

```markdown
### 仍必停(自動模式不豁免)
- `git push` / PR 建立(push 前列 commit 清單 + 目標 branch 給 user 確認)
- **merge 不必停**(2026-07-06 拍板):`branch-lifecycle` 收尾 gate 全綠即自動 local merge(可逆;push 仍必停,有 push-gate 硬攔)
```

改為:

```markdown
### 仍必停(自動模式不豁免)
- `gh pr merge`(PR 收尾單一確認點:hook ask 框,試用完按 allow 即 merge 到底 — 2026-07-07 拍板,取代舊「push / PR 建立必停 + local merge 自動」)
- push main / `--force` push(列 commit 清單 + 目標 branch 確認;流程分支 push 屬收尾自動步驟不必停,有 push-gate 嚴格 fullmatch 把關)
```

- [ ] **Step 3: auto.md 建議用法表 /feat 中段自動列更新**

原:`| /feat 中段自動 | `/auto Phase 7 結構化表格全綠 /feat <desc>`(保留 PR 決策) |`
改:`| /feat 中段自動 | `/auto Phase 7 結構化表格全綠 /feat <desc>`(merge 確認天然停在收尾) |`

---

### Task 4: 五個 command 檔措辭 + self_review_head 寫入端

**Files:**
- Modify: `C:\Users\USER\.claude\commands\feat.md`
- Modify: `C:\Users\USER\.claude\commands\mod.md`
- Modify: `C:\Users\USER\.claude\commands\bug.md`
- Modify: `C:\Users\USER\.claude\commands\refactor.md`
- Modify: `C:\Users\USER\.claude\commands\perf.md`

**Interfaces:**
- Produces: `self_review_head` 寫入端(/feat state.json 欄位、/mod change-spec.md 末尾行),與 Task 2 收尾節步驟 3 的讀取端對齊。

- [ ] **Step 1: feat.md Phase 4 補記 sha 步驟**

Phase 4 第 5 條(inline 完工自查 checklist)後追加第 6 條:

```markdown
6. 自評收斂後把當下 HEAD sha 寫入 state.json `self_review_head`(收尾節 review 增量判準:`self_review_head..HEAD` 非空才補增量 review)
```

- [ ] **Step 2: feat.md state.json schema 加欄位**

schema JSON 中 `"last_commit_sha": null, "final_merge_sha": null,` 該行改為:

```json
  "last_commit_sha": null, "final_merge_sha": null, "self_review_head": null,
```

- [ ] **Step 3: feat.md Phase 8 收尾描述改版**

第 1 條原文:

```markdown
1. 收尾路徑:**預設走 `branch-lifecycle` 收尾節**(自動 local merge + 刪分支)— **顯式覆寫** `superpowers:finishing-a-development-branch` 的三選一互動,理由:solo 無 reviewer,user 2026-07-06 拍板自動化。user 事先指定 PR → 走收尾節 PR 路徑。執行順序:步驟 2 tag 驗證 → 步驟 3 artifact commit → 收尾節 merge
```

改為:

```markdown
1. 收尾路徑:**預設走 `branch-lifecycle` 收尾節**(push → PR → review 補齊 → merge 確認 → auto-merge;2026-07-07 拍板)— **顯式覆寫** `superpowers:finishing-a-development-branch` 的三選一互動,理由:solo 無 reviewer,user 拍板自動化。執行順序:步驟 2 tag 驗證 → 步驟 3 artifact commit → 收尾節
```

第 4 條原文:

```markdown
4. 非預設路徑(user 指定才走):**PR**(`/code-review --comment` 落 Phase 4 已分類 findings + 收尾節 PR 路徑)/ **保留 branch**(state.json 標 `paused: <reason>`,不 merge)。merge 規則(一律 ff)在 branch-lifecycle,不重抄
```

改為:

```markdown
4. 非預設路徑(user 指定才走):**保留 branch**(state.json 標 `paused: <reason>`,不 push 不 merge)。PR 已是預設收尾;merge 規則在 branch-lifecycle,不重抄
```

- [ ] **Step 4: feat.md 自主模式建議措辭**

原:`- 保留 PR 決策、中段自動:`/auto Phase 7 結構化表格全綠 /feat <desc>``
改:`- 中段自動(merge 確認天然停在收尾):`/auto Phase 7 結構化表格全綠 /feat <desc>``

原:`- **L 級不建議全自動**(Phase 0 對齊 + Phase 8 PR 決策價值高)`
改:`- **L 級不建議全自動**(Phase 0 對齊 + 收尾 merge 確認前人工試用價值高)`

- [ ] **Step 5: mod.md Phase 5 補記 sha + Done 行**

Phase 5 條目末尾(`→ inline 完工自查 checklist(測試齊全 / 三類 commit 分明 / 文件同步)`之後)追加:

```
→ 自評收斂後把當下 HEAD sha 追記到 change-spec.md 末尾一行 `self_review_head: <sha>`(收尾節 review 增量判準)
```

Done 節原文:`**全過後呼叫 `branch-lifecycle` 收尾節**(自動 merge 回 main + 刪分支),再做最終回報。`
改:`**全過後呼叫 `branch-lifecycle` 收尾節**(push → PR → merge 確認 → auto-merge),再做最終回報。`

- [ ] **Step 6: bug.md / refactor.md / perf.md Done 行**(三檔同一句替換)

原:`**全過後呼叫 `branch-lifecycle` 收尾節**(自動 merge 回 main + 刪分支),再做最終回報。`
改:`**全過後呼叫 `branch-lifecycle` 收尾節**(push → PR → review 補齊 → merge 確認 → auto-merge),再做最終回報。`

(/bug /refactor /perf 無自評階段,收尾節會補跑 `/code-review`,故此三檔多「review 補齊」字樣。)

---

### Task 5: 鏡像同步 + repo 文件更新 + commit

**Files:**
- Modify: `docs/harness/`(鏡像 cp)
- Modify: `docs/harness/README.md`
- Modify: `docs/harness/SPEC.md`
- Modify: `docs/specs/harness-git-lifecycle/design.md`(補「已被取代」註記)

**Interfaces:**
- Consumes: Task 1-4 完成後的 `~/.claude/` 原檔。

- [ ] **Step 1: cp 鏡像同步**(在 repo root,Git Bash):

```bash
cp ~/.claude/commands/{feat,bug,mod,perf,refactor,auto}.md docs/harness/commands/
cp ~/.claude/hooks/harness-push-gate.py docs/harness/hooks/
cp ~/.claude/hooks/tests/test_harness_push_gate.py docs/harness/hooks/tests/
cp ~/.claude/skills/branch-lifecycle/SKILL.md docs/harness/skills/branch-lifecycle.md
cp ~/.claude/CLAUDE.md docs/harness/global-rules.md
```

- [ ] **Step 2: diff 驗證鏡像零 drift**(SC-6):

```bash
diff --strip-trailing-cr docs/harness/skills/branch-lifecycle.md ~/.claude/skills/branch-lifecycle/SKILL.md && echo OK
```

Expected: `OK`(其餘檔案 cp 直拷本就一致,抽驗此檔即可)。

- [ ] **Step 3: README.md 三處更新**

(a) 分層架構圖版控 skill 描述(原「開工(主線同步 + prefix 分支)/ 收尾(自動 merge + 刪分支)/ 異常處理」與「(單一 source of truth;merge 不必停、push 必停)」):

```
│   開工(主線同步 + prefix 分支)/ 收尾(push → PR → review 補齊 →
│   merge 確認 → auto-merge;離線 fallback local merge)/ 異常處理
│   五個流程 command 共用(單一 source of truth;merge 確認 = 唯一必停點)
```

(b) hooks 層 `harness-push-gate.py` 描述行:

```
│   harness-push-gate.py  — 流程分支 push 放行(嚴格 fullmatch);
│                           push main / force / gh pr merge 強制 user 確認
│                           (鐵則 H 硬化;merge ask = PR 收尾單一確認點)
```

(c) cheat sheet `/auto` 列(原「push / PR 仍會停下來問;merge 收尾 gate 全綠即自動」):

```
| 想全自動跑到某個檢查點 | `/auto <退出條件> /feat <目標>`(收尾自動 push + 開 PR;merge 確認框仍會停) |
```

- [ ] **Step 4: SPEC.md 現行行為描述五處更新**

- L49 鐵則 H 行:`H. **Git 推送紀律**:流程分支 push(PR 收尾)自動;push main / force / merge 前必列清單給 user 確認;自主模式不豁免(v3 起有 push-gate hook 硬攔後盾,見 3.5;2026-07-07 起 merge ask = PR 收尾單一確認點)。`
- L66 Phase 8 列的「**branch-lifecycle 收尾節自動 merge + 刪分支**」→「**branch-lifecycle 收尾節 PR 收尾(push → PR → review 補齊 → merge 確認 → auto-merge)**」
- L70 `/auto` 行的「**merge 不必停**(v3 拍板:收尾 gate 全綠即自動,local merge 可逆)、push/PR/破壞性操作永遠停」→「**merge 確認框 = 唯一必停檢查點**(2026-07-07 拍板;流程分支 push / 開 PR 自動)、破壞性操作永遠停」
- L77 branch-lifecycle 條目的收尾節括號內容改為「(Done+全綠 gate → 漂移判準 → review 補齊 → push 分支 + 開 PR → merge 確認框 → `--rebase` auto-merge;離線 fallback local ff)」,行尾補「2026-07-07 v2:PR 收尾取代 local merge 預設(`docs/specs/harness-pr-lifecycle/design.md`)」
- L92 push-gate 條目行尾補:「2026-07-07 起:流程分支 push(嚴格 fullmatch)放行,merge ask 升格為 PR 收尾單一確認點。」

- [ ] **Step 5: 舊 design 補取代註記**

`docs/specs/harness-git-lifecycle/design.md` 標題下第一段前插入:

```markdown
> **2026-07-07 更新**:收尾節設計已被 [`harness-pr-lifecycle/design.md`](../harness-pr-lifecycle/design.md) 取代(PR 收尾成為預設);本檔的開工節與漂移處理仍有效。
```

- [ ] **Step 6: 跑鏡像側 hook 測試**(鏡像自帶 tests,防 cp 漏檔):

Run: `python -m pytest docs/harness/hooks/tests/test_harness_push_gate.py -q`(cwd repo root)
Expected: 20 passed。

- [ ] **Step 7: Commit(repo)**

```bash
git add docs/harness/ docs/specs/harness-git-lifecycle/design.md docs/specs/harness-pr-lifecycle/plan.md
git commit -m "chore(harness): 五流程收尾改預設 PR(push→PR→review 補齊→單一確認→auto-merge)— 鏡像同步"
```

(此 commit 不 push;下次任一流程走新收尾時自然驗證 SC-1。)

---

## 驗收對照(design §9)

| SC | 驗證方式 | 所在 Task |
|---|---|---|
| SC-1 | 下次任一流程收尾實測(一次 hook 確認框) | 落地後首次流程實戰 |
| SC-2 | `pytest tests/test_harness_push_gate.py` 20 綠 | Task 1 |
| SC-3 | 收尾節步驟 3 讀 `self_review_head`,rev-list 空則跳過 | Task 2 + 4(規則層,實戰驗證) |
| SC-4 | 收尾節步驟 6 deny 分支 + 異常表 | Task 2(規則層) |
| SC-5 | 收尾節步驟 7 fallback | Task 2(規則層) |
| SC-6 | Task 5 Step 2 diff = 空 | Task 5 |
