# Harness 改版 review 交接(2026-07-27 四 command 同步批)

> 給新 session 的 review 入口。review 對象 = 本批 commit(四 command 同步 + 掃描 P2 收尾),
> 依據在 `~/.claude/harness/RATIONALE.md` /mod 節「四 command 同步批」條目(/refactor /bug
> /perf 節各有指路行),review 前先讀。真實檔在 `~/.claude/`,repo 內 `docs/harness/` 是鏡像
> (`python scripts/sync-harness-mirror.py --check` 驗漂移,review 當下應「全部一致」)。
>
> 前批經驗(連兩批應驗):**復審重點不是「有沒有做」,是「同步本身有沒有抄出新矛盾」**——
> 本批是把 /feat 條文「翻譯」到四支 command,翻譯錯位(feat 專屬語彙殘留 / 兩檔指涉錯開)
> 是最可能的 fix-induced 樣態。
>
> 本批不需要 fresh CLI process:全是流程時載入的檔。/clear 開新對話即可。

## 本批範圍(user 拍板脈絡)

user 2026-07-27 拍板「B:/mod 對齊新版 /feat,並直接同步修 /bug /refactor /perf」——
即 next-time 積壓的四條列管項 + 07-26 一致性掃描 P2 清單(scratchpad 實存,已逐條清點)。
同日稍早同 session 另有兩個 commit(`114371c` grilling 補修復審、`15e14f8` 收件匣 5 條
全批拍板),各有自己的記錄,非本檔對象。

## 改動落點

- **mod.md ×5**:Phase 1 graphify query 起點句(動態用法仍必 grep)/ Phase 2 提問姿態
  分流句(判準複用 `refs/feat-phase0-2.md`,判定記錄落 change-spec.md,/auto 不豁免)+
  成功條件補「畫面可指認」表述 / Phase 3 輪數 **max 2 → 預設 1 輪 + accepted P0 限縮加輪**
  / Phase 5 **刪 inline 完工自查 checklist** + round JSON 落檔 + 白名單對照必讀 /
  Phase 8 補收尾 UI 驗收點。
- **refactor.md ×2**:Phase 3 輪數同制;Phase 5 補 graphify 句。
- **bug.md ×1**:Phase 2 補 graphify 句。
- **perf.md ×1**:Done 補 check_feat_tags 行(掃描 #21,四流程唯獨 perf 漏)。
- **scope-tiers.md**:/mod M/L 輪數統一(對齊 /feat 07-26 制)。
- **review-protocol.md ×3**:A2 限縮輪推廣(#10)/ A 節退出條件註 / C 節 fix 迴圈消歧
  (#11)+ **round JSON 落檔義務**(25 個非 /feat run 零結構化 review 記錄)。
- **change-spec-reviewer / refactor-plan-reviewer**:補限縮輪節(#23,仿 design-reviewer)。
- **load-manifest.json**:mod-M 補 grilling + feat-phase0-2 條件條目;feat-L 補 auto-wave
  條件條目(#14)+ SDD `_note` 補句(#13)。
- **feat-phase0-2.md**:判準節補 /mod 接入行。**feat-phase3.md**:executing-plans 缺席
  fallback 註(#17)。**auto.md ×3**:例外句 / 必停清單第 4 項 / 建議表 /mod 行擴及 /mod。
- **dispositions.json ×2 rows**:「Max 2 輪」→「限縮加輪」;「完工自查 checklist」核心 → 刪
  (absent 檢查)。
- 掃描 P2 清點:#18 #19 #20 判 moot(skill 複製後去前綴引用已有效);#9 #12 #15 #16 #22
  已由先前批次修;P0 #1 與 P1 #2-#8 全數先前已修(#7 #8 即本批 mod 兩條)。

## Review 角度建議(對抗式)

- **/mod 輪數改制是無實證裁量**:/feat 的 1 輪制有 41 run artifact 實證,/mod 側 round JSON
  為零(這正是本批要修的)— 改制依據是「對齊」不是「量測」。裁決:落檔義務先行、日後可
  覆核的安排站不站得住;還是該保守維持 max 2 直到有 /mod 數據。
- **分流句翻譯錯位**:feat-phase0-2.md 判準節通篇 feat 語彙(「feat.md Phase 0 步驟 1
  例外句為準」「落 brainstorm.md」),/mod 讀者靠新增的一行接入行轉譯 — 夠不夠;mod.md
  分流句自帶的例外句(「僅條件 1 成立之例外同 ref」)與 ref 縮減句的 /auto 規則在 mod
  情境是否成立(ref 寫的是 `[auto-default]` + brainstorm.md)。
- **兩支 reviewer 的限縮輪節是仿寫**:refactor-plan-reviewer 的限縮範圍(「變更步驟與直接
  依賴的相鄰步驟」)是本批新擬、無實證;change-spec-reviewer 照抄 design-reviewer 模式。
  檢查與各自 criteria 的互斥面。
- **round JSON 落檔義務的成本面**:C 節要求無 artifact 目錄「就地建立」— 小 S 級 run 的
  額外儀式;/bug /refactor /perf 的目錄慣例(`.claude/<flow>/<slug>/`)只有部分 command
  檔頭有寫。
- **auto.md 例外句三檔鏈**:auto.md「以各該 command 分流句為準」↔ feat-phase0-2 L30
  「以 feat.md Phase 0 步驟 1 例外句為準」(未同步改)↔ mod.md 分流句 — 三處對讀有無
  斷鏈或兩說。
- **graphify 句 ×3 一致性**:mod / refactor 帶「動態用法仍必 grep」防線,bug 的版本沒帶
  (bug Phase 5 另有 blast radius grep)— 刻意或漏。
- **dispositions「完工自查 checklist」row 語意翻轉**(核心 → 刪)的記錄正當性 — v12 原判
  「實測模型做不到(仍留)」被本批推翻,note 有無把兩層歷史都留住。

## 機械驗證(2026-07-27 實跑輸出)

- `python scripts/sync-harness-mirror.py --check` → 全部一致。
- `harness_load_estimate.py --verify-dispositions` → VIOLATIONS n=0。
- hooks `python -m pytest tests -q` → 137 passed(基準 137,本批未動 hooks)。
- `grep -c "2026-07-27"`:mod.md = 7 / bug.md = 1 / refactor.md = 2 / perf.md = 1 /
  auto.md = 5 / scope-tiers.md = 1 / review-protocol.md = 3 / feat-phase0-2.md = 5 /
  feat-phase3.md = 1 / change-spec-reviewer.md = 1 / refactor-plan-reviewer.md = 1 /
  load-manifest.json = 5。

## 已知未修(不要當新發現回報)

- CLAUDE.md 瘦身輪(收件匣 A2)scheduled 未開 — 本批(四 command 同步)完成即觸發提醒,
  列管 next-time.md。
- graphify docs/skills 語意層(C4)另行評估中。
- 收件匣已歸零(5 條 07-27 全批拍板,見 `15e14f8`);/mod 側列管四條已全銷。

## 還原路徑(復審判定要退回時)

- 鏡像:git revert 本批 commit。真實檔 `~/.claude/`:各處刪 2026-07-27 標記句;
  mod.md / refactor.md 輪數句還原為「Max 2 輪」原文(見 git 歷史);mod.md Phase 5 補回
  inline 完工自查 checklist 原句;dispositions ×2 rows / load-manifest 條目還原見 git 歷史;
  兩支 reviewer 刪限縮輪節 + 「限縮輪(round 2)」改回「round ≥ 2」。
- 逐條退回時:對應落點刪句 + RATIONALE /mod 節該條目內劃掉並註明,mirror 重跑 `--fix`。
