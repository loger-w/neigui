# Harness 改版 review 交接(2026-07-27 grilling 批補修復審)

> 給新 session 的 review 入口。review 對象 = **d177c08**(grilling 批 review 的
> 2 P1 + 4 P2 補修),不是 8b72906(分流主體,已對抗式 review 過,結論在
> `REVIEW-2026-07-27-grilling.md` Review 結果節)。真實檔在 `~/.claude/`,repo 內
> `docs/harness/` 是鏡像(`python scripts/sync-harness-mirror.py --check` 驗漂移,
> review 當下應「全部一致」)。
>
> 依據:`~/.claude/harness/RATIONALE.md` /feat 節「Phase 0 提問姿態分流」條目的
> **「2026-07-27 review 補修六處」行**(該條目正文是前批主體,補修行才是本批),
> review 前先讀。復審的核心問題不是「補修有沒有做」(diff 可機械核),而是
> **「補修本身有沒有修出新矛盾」**— 前批經驗:round 2 的 P0 幾乎全是 round-1 fix
> 自己造成的。
>
> 本批不需要 fresh CLI process:全是流程時載入的檔。/clear 開新對話即可。

## 本批 commits(neigui main)

| commit | 內容 |
|---|---|
| `8b72906` | 分流主體(**已 review,非本批對象**) |
| `d177c08` | **本批對象**:2 P1 + 4 P2 補修,6 檔 +35/-1 |

## 補修落點(六條 finding → 五個真實檔 + 交接檔一節)

1. **auto.md 替代條件段例外句**(P1):「/feat Phase 0 判定已成形方案時,
   『無文件但無方向性抉擇 → 推進』不適用,grilling 共識拍板必停」。
2. **feat-phase0-2.md 寫入要求「分流判定記錄」條**(P1):brainstorm.md 一行記
   判定 + 命中哪條判準。
3. **auto.md 建議表 /feat S 級停等註**(P2)。
4. **load-manifest.json feat-L Phase 0 grilling 條件條目**(P2;feat-L-before
   baseline profile **刻意不動**)。
5. **next-time.md /mod 側接入項**(P2,新增第三條 /mod 列管項)。
6. **feat-phase0-2.md 判準節「條件 1 單獨成立仍縮提案」句**(P2)。

另:RATIONALE 補修行 + REVIEW-2026-07-27-grilling.md「Review 結果」節(記錄面)。

## Review 角度建議(對抗式,重點審 fix-induced 新矛盾)

- **落點 6 是行為改動不是補丁,且可能造出新的兩檔兩說**:縮減句讓「條件 1 成立、
  條件 2 不成立」的 case 在 brainstorming 路內覆寫「Propose 2-3 approaches」checklist,
  但 feat.md 分流句仍寫「模糊 idea → 照現行 brainstorming **不變**」— ref 檔說縮、
  command 檔說不變。裁決:feat.md 已指路「判準見 refs/feat-phase0-2.md」,ref 細節
  優先慣例站不站得住;還是 feat.md 該補半句(這正是本批修 auto.md 的同型問題,
  修法標準要一致)。
- **落點 1 的落點選擇**:例外句放在「自動核准範圍」的替代條件 bullet 內,auto.md
  「仍必停」清單本體仍是三項(破壞性 / scope / 花錢)。只掃清單的執行者仍看不到
  第四種停;且「疊加內建 /goal」節的優先序句(「必停清單…優先於續跑」)背書的是
  清單本體,例外句不在其中。裁決:替代條件段是判 brainstorm 停等的實際查詢點,
  例外句就地已夠;還是清單本體該 +1 項。
- **落點 2 修的是「可稽核」不是「必稽核」**:分流判定記錄條自己也無機械承接
  (Phase 8 / check_feat_tags 不驗 brainstorm.md 內容)— 本 harness 已知樣態:
  寫入要求類條文執行率可低至 17%。裁決:等 meta-review 抽查即可,還是這條 P1
  只修了半套(要不要進 Phase 8 機械驗證,代價是 hooks 改動)。
- **feat.md 本批零改動的一致性**:六條補修沒有任何一條動 feat.md — 檢查分流句
  引用鏈(「判準見 refs/feat-phase0-2.md」「視同 auto.md 仍必停」)在補修後是否
  仍指得準(auto.md 例外句反向引用「feat.md Phase 0 步驟 1 分流句」,雙向引用
  有無循環或斷鏈)。
- **next-time.md /mod 列管碎片化**:現在有三條 /mod 改版並行項(07-26 一併修 /
  07-27 e2e 一併補 / 07-27 grilling 一併議)— 該合併成一條還是維持分列(分列
  保留各自出處,合併降低漏讀)。純記錄面,P3 級。
- **RATIONALE 補修行的計數自指**:「六處」數的是 finding 數,落檔是五個真實檔
  (auto.md ×2 條 finding 同檔)— 敘述有無誤導;各 finding 的 P 級與 REVIEW
  結果節、本檔是否三處一致。
- **load-manifest baseline 不動的判斷**:feat-L-before 是 design v12 的改版前
  基準 profile,補 grilling 會污染 before/after 對照 — 這個「刻意不動」對不對。
- **標記句完備性**(還原路徑依賴):本批六個落點句是否**都**帶 2026-07-27 標記
  (機械驗證節的 grep 數即為此設計)。

## 機械驗證(數字為 2026-07-27 補修後實跑輸出)

- `python scripts/sync-harness-mirror.py --check` → 全部一致。
- `grep -c "2026-07-27" ~/.claude/commands/auto.md` = 2(例外句 + 建議表註)。
- `grep -c "2026-07-27" ~/.claude/harness/refs/feat-phase0-2.md` = 3(判準節標題 +
  縮減句 + 寫入要求條)。
- `grep -c "review 補修" ~/.claude/harness/refs/feat-phase0-2.md` = 2。
- `grep -c "grilling" ~/.claude/harness/load-manifest.json` = 1(feat-L Phase 0,
  含 condition 欄)。
- `grep -c "review 補修六處" ~/.claude/harness/RATIONALE.md` = 1。
- `grep -c "提問姿態分流" docs/next-time.md` = 1。
- hooks 本批零改動(基準 130 passed,前批實跑)。
- push 時 pre-push gate 全綠:pytest 687 passed 1 skipped / ruff 過 / vitest 954
  passed / build 過(d177c08 push 輸出)。

## 已知未修(不要當新發現回報)

- 前批(8b72906)review 檢定過不立案的四個角度(brainstorming/grilling 歧義 /
  延續型互動 / description 自動觸發 / 記錄紀律)— 結論在 grilling 交接檔 Review
  結果節,除非有新事證不重開。
- /mod 側三條列管項(見上,next-time.md)、收件匣 5 條未結案、8 支複製 skill
  無 VCS、dispositions.json 過期 rows、graphify 640 dangling edges、
  writing-plans L158 殘句。
- auto.md「仍必停」清單本體未 +1(見 Review 角度第二條 — 這是本批的**裁量結果**
  不是遺漏,復審可推翻)。

## 還原路徑(復審判定要退回時)

- `git revert d177c08`(鏡像 + repo docs)+ 真實檔 `~/.claude/` 四檔刪句:
  auto.md 例外句 + 建議表註、feat-phase0-2.md 縮減句 + 寫入要求「分流判定記錄」條、
  load-manifest.json grilling 條目、RATIONALE 補修行(整行)。
- next-time.md /mod 項與 REVIEW-2026-07-27-grilling.md「Review 結果」節可留
  (純記錄;若退回,結果節加一行「補修經復審退回」即可,不刪史)。
- 逐條退回(非全退)時:對應落點刪句 + RATIONALE 補修行內劃掉該條並註明,
  mirror 重跑 `--fix`。
