# Harness 強制層補強(v3)— 設計

> 日期:2026-07-06
> 動機:harness 目前約九成機制靠「模型自律遵循文字指令」,換弱模型(如 Opus 4.x)時遵循率會崩。
> 實證依據:gggodlin.github.io/blog/protocol-model-dependency — 同一份文字指令 Fable 5 遵循、Opus 12 sessions 遵循率 0%;加 hook(UserPromptSubmit 注入 + Stop 審計)後回到 ~37%。
> 上一輪 harness 工程:`docs/specs/harness-improvement/design.md`(2026-07-06 v2 審計,本設計是其後續)。

## 0. 目標與範圍決策(user 拍板)

| 決策點 | 選擇 |
|---|---|
| 「真正的自動化」定義 | **流程合規不靠模型自律** — 把 gate / 回寫 / 確認搬到 hook 與 script 層,非提升 /goal 自主完成度 |
| 適用範圍 | **通用骨架 + 專案插槽** — hook 本體在 `~/.claude/` 通用,專案特化檢核由 `.claude/harness.json` 提供,無 config 優雅降級 |
| 驗證 gate 強制點 | **雙層** — Claude PreToolUse hook(快,只管 Claude)+ git pre-push hook(慢,絕對繞不過,user 手動 push 也跑) |
| 方案形狀 | **C:分期** — 第一期注入+審計+雙層 push gate;第二期只 script 化三個高風險 gate;之後憑弱模型實測遵循率決定是否續建 |

### 誠實邊界:gate 分兩種

- **可機驗**(測試綠不綠、tag 配對、state.json 回寫、檔案存在):可完全搬出模型 → 本設計的範圍。
- **語意判斷**(SC 品質、review finding 真偽、brainstorm 深度):永遠靠模型智力,弱模型時代品質必然下降。harness 能保證的是「一定被執行 + 留痕可稽核」,不是品質。此為殘餘風險,明示不掩蓋。

## 1. 現況盤點(2026-07-06)

機械強制僅 3 點:`block-no-verify.py` / `safety-hooks.py`(PreToolUse Bash)、`format-on-edit.py`(PostToolUse)。**UserPromptSubmit / Stop / SessionStart 掛載點全空** — 文章實證最有效的兩個位置未使用。

靠模型自律且已有失效前科(在 Fable 5 上)的機制:state.json 回寫(3/9 不同步)、review 輪數上限(一次跑到 6 輪)、subagent 模式下「commit 前 cat next-time.md」靜默失效。鐵則 H(push 前確認)無任何 hook 後盾。

## 2. 第一期 — 注入 + 審計 + 雙層 push gate

### 2.1 `harness-context.py`(SessionStart + UserPromptSubmit)

- 從 cwd 找 `.claude/feat/*/state.json`,取**進行中**者:`paused == null` 且 **非已完成**(完成判定:`final_merge_sha` 存在 或 `completed_phases` 含 8.5)。多個進行中取 `last_updated` 最新。
- 有 → 注入 additionalContext:`slug / branch / current_phase / 下一 gate 名稱 / last_updated`;若 state 落後(見 2.2 同款判定)加「先回寫 state.json」提醒。
- 無進行中 feature → 靜默(exit 0 無輸出),不污染一般 session。
- phase → gate 名稱對照表寫死在 hook(描述 user-global /feat 流程,屬通用骨架)。
- UserPromptSubmit 每回合注入 = 文章的 soft reminder 機制;弱模型長對話後遺忘,每回合重新錨定。

### 2.2 `harness-stop-audit.py`(Stop)

- 僅在有進行中 feature 時運作。檢查:
  - **state.json 回寫**:HEAD commit 晚於 `last_updated` **且**最近 commit 不含該 feature 的 state.json 變更(排除「回寫後收尾 commit」的 false positive)→ block 一次,stderr:「先回寫 state.json 再結束回合」。
  - **收件匣義務**:`current_phase == 8.5` 且尚未完成(8.5 不在 completed_phases)、feat-improvements.md 無新 entry 亦無「本輪無瑕疵」標記 → stderr 提醒(**不 block** — 「無瑕疵」是合法結果,真偽不可機驗)。
- `stop_hook_active` 防無限迴圈:block 一次後放行。

### 2.3 `harness-push-gate.py`(PreToolUse Bash)

- 偵測 `git push`(含 `--force` 變體、`gh pr merge`)→ 回 `permissionDecision: "ask"`:強制跳 permission prompt 給 user 本人,無視 session permission mode。模型忘了列 commit 清單,user 也必然看到 push 指令。
- stderr 同時提醒模型:「push 前先列 `origin/<branch>..HEAD` 清單」。
- 純攔截、不依賴 state.json,跨專案通用。鐵則 H 從純文字升為硬攔。

### 2.4 git `pre-push` hook(專案層)

- 檢入 `scripts/git-hooks/pre-push`;user **手動一次性** `git config core.hooksPath scripts/git-hooks` 啟用。Claude 被 `block-no-verify.py` 擋著改不了 hooksPath — 正好保證它動不了這條防線。
- 讀 `.claude/harness.json` 的 `verify` 陣列逐條跑(pytest + vitest + build),任一紅拒絕 push。e2e 不進 pre-push(太慢,留流程 gate)。
- 成本:user 手動 push 也要等(估 1-3 分鐘);緊急時 user 本人 `git push --no-verify` 永遠可用(hook 只實質約束 Claude)。

### 2.5 專案插槽 `.claude/harness.json`(neigui 首例)

```json
{
  "verify": [
    { "name": "backend",        "cwd": "backend",  "cmd": "python -m pytest -q" },
    { "name": "frontend-test",  "cwd": "frontend", "cmd": "npm test" },
    { "name": "frontend-build", "cwd": "frontend", "cmd": "npm run build" }
  ]
}
```

- pre-push 與第二期 `harness-check` 共用此檔。
- **消除雙源**:auto-verify skill 改為「指令組優先讀 `.claude/harness.json`,skill 內表格降為無 config 專案的 fallback」。

## 3. 第二期 — 三個高風險 gate script 化

通用骨架 `harness-check`(`~/.claude/bin/`,鏡像進 `docs/harness/`):

| 子命令 | 行為 |
|---|---|
| `phase-exit 5` | 讀 `harness.json` verify 陣列逐條執行,寫 `.claude/feat/<slug>/automated-verification-round-N.json`(每條 exit code + output 摘尾),全綠 exit 0。feat.md Phase 5 改寫:「執行 harness-check,只允許用它的輸出當證據」 |
| `phase-exit 8` | `git log <start_sha>..HEAD` 機驗 TDD tag 配對([green] 前有 [red]),內建既有豁免規則([lock]+mutation-verified、[waveN]、test-infra-fix:、Phase 6 real-env finding),fail 列違規 commit |
| `push-check` | state 狀態機:進行中 feature 且 `current_phase < 8` → exit 1;push-gate hook 同步升級為「檢核不過直接 deny」(第一期為 ask)。檢核通過或無進行中 feature 時**仍維持 ask**(鐵則 H 的 user 確認不因 phase 達標而豁免) |

- **phase-exit 通過時由 script 自動回寫 state.json**(completed_phases / current_phase / last_updated)— 回寫脫離模型之手,治本消滅不同步。
- **feat.md 同步修改**:Phase 5 / 8 刪除模型側回寫指令避免雙寫;其餘 phase 仍由模型回寫(由 2.2 審計兜底)。

## 4. 降級與錯誤處理

| 情境 | 行為 |
|---|---|
| 注入 / 審計 hook 內部錯誤 | stderr 警告 + fail-open(輔助設施不癱瘓工作) |
| push-gate hook 內部錯誤 | fail-closed 維持 `ask`(寧可多問一次) |
| 無 `harness.json` | pre-push 警告後放行;`phase-exit 5` 直接 fail 並指示建 config |
| 無 state.json(非 /feat session) | 注入 / 審計完全靜默 |

## 5. 測試策略

- 新 hooks / harness-check 附 pytest(`~/.claude/hooks/tests/`):stdin JSON fixture 餵入,驗 exit code / stdout JSON / block 行為。強制層有 bug 比沒有更糟。
- 鏡像同步:`docs/harness/` 照 README 既有指令擴充(新 hooks + bin + tests)。

## 6. 驗收標準

| SC | 條件 | 驗法 |
|---|---|---|
| SC-1 | 有進行中 feature 的 repo 開 session → 注入含 slug/phase/gate | fixture 餵 hook,assert stdout |
| SC-2 | state.json 落後且最近 commit 不含 state 變更 → Stop block 一次;含 state 變更 → 不 block | fixture 兩例 |
| SC-3 | Claude 執行 `git push` → permission prompt 必出現 | 真實環境操作一次 |
| SC-4 | 任一測試紅時 push → pre-push 拒絕;全綠放行 | 真實 repo 各跑一次 |
| SC-5 | `phase-exit 5` 測試紅 exit 1 / 綠 exit 0 且寫 JSON + state.json 前進 | 真實跑 |
| SC-6 | `phase-exit 8` 缺 [red] 配對 fail;豁免 tag pass | fixture git log |
| SC-7 | 無 state.json 專案 → 注入/審計零輸出 | fixture |

## 7. Rollout

1. 第一期(2.1–2.5)上線 → 用 1-2 個真實 feature 觀察,收件匣照常回報摩擦點。
2. 第二期(§3)→ feat.md 同步改版。
3. 未來換弱模型時,以實測遵循率決定是否把其餘 phase 檢核續 script 化(不為「未來可能」預建 — 鐵則 B)。
