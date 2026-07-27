# Review 協定

本檔是 harness 內**所有 review 動作的單一協定**。/feat Phase 1 / Phase 2 / Phase 4、
/mod Phase 5、branch-lifecycle 收尾步驟 3 都引用它。

> 既有的 review CLI 是 user-triggered 的,agent 無法自行觸發。本協定是 agent 可執行的
> 等價路徑,不依賴那條 CLI。

## A. Spec review(/feat Phase 1、Phase 2;/mod Phase 3;/refactor Phase 3)

1. 用對應的 typed reviewer agent type dispatch(`design-reviewer` /
   `impl-spec-reviewer` / `change-spec-reviewer` / `refactor-plan-reviewer`)。
   傳**檔案路徑**不傳內容 —— reviewer 是 fresh context,對話裡的表傳不進去。
   Criteria / severity / JSON schema 固化在 agent 定義,dispatch prompt 不重抄。
2. round 2 一律為**限縮輪**(round 1 有 accepted P0 才發生;dispatch prompt 只指
   changelog / amendment / 變更段落,審 fix 是否改出新矛盾 — 2026-07-26 /feat 實證,
   2026-07-27 推廣 /mod /refactor),另傳上一輪 review JSON 路徑 + 本輪 changelog 摘要
   (cross-round 檢查)。
3. 回傳 JSON 落檔 `<review-type>-review-round-<N>.json`。
4. main agent 對 finding **先機械快篩**(grep / Read 可直接查證的 claim 先反證,誤報記
   REFUTED);餘下的處置粒度由各 command 定義 —— /feat:P0/P1 站得住就修,修不動或與 SC
   互斥才走 `receiving-code-review` 三分類,P2 彙總;/mod /refactor:逐條
   receiving 三分類(`accepted` / `rejected_with_reason` / `needs_more_context`),附
   `resolution` 欄位。
5. 是否重跑 review 由各 command 定義,**預設不重跑**(2026-07-26 實證:spec review round 2
   的新增 accepted P0/P1 趨近零,見 RATIONALE)。

**退出條件與輪數由各 command 自訂**(/feat Phase 1 為 1 輪 + P0 觸發限縮加輪、Phase 2 固定
1 輪、無 P0 且 P1 ≤ 2;/mod /refactor Phase 3 為預設 1 輪 + accepted P0 觸發限縮加輪、
無 P0/P1 — 2026-07-27 對齊)。本協定不覆寫。

## B. Code review(/feat Phase 4;/mod Phase 5;收尾補齊)

**檔位預設 medium**;全量掃描保留給 user 顯式要求。

> **雙焦點與 round JSON 的輸出契約由呼叫方 command 定義**(feat.md Phase 4 / mod.md
> Phase 5),本檔不重抄 —— 同一份契約放三個地方必然漂移。

### 執行方式

dispatch **≥ 2 個角度真差異化的 lens finder**(Workflow fan-out 或平行 Agent 皆可),
結果彙整成單一 `code-review-round-<N>.json`。

**Diff 先落檔**:main agent 先把待審 diff 寫成單一檔(如
`git diff <base>..HEAD > <artifact>/review-diff.txt`),finder prompt 指向該檔 + 需要的
spec 檔路徑;finder 需要脈絡才開全源檔。(實證:subagent 之間重複讀 design.md / diff /
全源檔佔 /feat Read 成本的大宗 —— 52% 的 subagent Read 是重複讀。)

Lens 經驗值:mature codebase 上 test_coverage lens 命中率最高;correctness /
consistency 易產生會被 refute 的風格建議 —— lens prompt 要角度**真**差異化,不是換句話說。

### Dispatch / 快篩紀律(四條)

minimal-model finder 對「機械事實」與「prompt 內排除契約」皆不可靠 —— **把關在 main agent
不在 finder**:

- **(a)** finder prompt 的排除清單(已文件化慣例 / 刻意 pattern)放 prompt **開頭**並要求
  輸出前對照自檢。此為降噪手段,**不可依賴**。
- **(b)** candidate 進 receiving / verifier dispatch 前,main agent **先機械快篩**:
  grep / Read 可直接查證的 claim(pragma / import / 行號 / 檔案存在)先反證,誤報直接記
  REFUTED 不 dispatch verifier;命中排除清單者彙總計數丟棄,不逐條 receiving。
- **(c)** **效能類 claim 要 runtime 證據**:dispatch 效能 lens 時 main agent 把已有 runtime
  量測(server log / 實測耗時)注入 finder prompt;無量測數據 → 效能判定由 main agent
  實測直判,**不採信 finder 的量級推算**。
- **(d)** **ad-hoc dispatch 的 reviewer prompt 固定註明「以純文字回傳 JSON,勿呼叫
  ReportFindings」**(該工具結果不會到達主 agent)。typed reviewer agent 已由 tools
  白名單天然擋掉,此條管的是 ad-hoc dispatch。

### Verify / skeptic 階段

進 verify 前,先摘 design.md changelog 的 accepted findings + rationale **注入 verify
prompt**,避免 refute 掉事後看來合理的設計收窄。

## C. 收尾補齊(branch-lifecycle 步驟 3)

merge 前對**完整 diff** 的最終 review。原則是「補齊缺口不重跑」:

- /bug /refactor /perf:跑一輪 B 節的 code review(medium)→ receiving 逐條分類 →
  P0/P1 修完才進 push。fix 迴圈 3 輪上限(**review 本身不重跑**),超限依鐵則 F 回報。
- **round JSON 落檔義務(2026-07-27 拍板)**:C 節 review 的 `code-review-round-<N>.json`
  一律落檔該流程 artifact 目錄(`.claude/<flow>/<slug>/`,無目錄則就地建立)—
  25 個非 /feat run 零結構化 review 記錄,輪數實證無從做起。
- /feat /mod:讀自評結束時記錄的 `self_review_head`(/feat 在 state.json;/mod 在
  change-spec.md 末尾)→ `git rev-list <self_review_head>..HEAD` 非空才對**增量 diff**
  補一輪 medium review;為空 → 沿用自評結果不重跑。
  **欄位缺失 / null** → 保守視同有增量,補跑一輪(無法證明 diff 已被 review 過就 review),
  並順手回填欄位。
