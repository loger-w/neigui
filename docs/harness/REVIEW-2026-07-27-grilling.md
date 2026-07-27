# Harness 改版 review 交接(2026-07-27 grilling 批次)

> 給新 session 的 review 入口。真實檔在 `~/.claude/`,repo 內 `docs/harness/` 是鏡像
> (`python scripts/sync-harness-mirror.py --check` 驗漂移,review 當下應「全部一致」)。
> 改動依據在 `~/.claude/harness/RATIONALE.md` /feat 節「Phase 0 提問姿態分流」條目 +
> 共通層「grill-me / grilling 複製為 user skill」條目,**review 前先讀這兩條**,
> 不憑本檔摘要重推。
>
> 本批**不需要 fresh CLI process**:改動全是流程時載入的檔(feat.md / refs / RATIONALE);
> 兩支 skill 是本批之前已複製的背景(非本批變更),/clear 開新對話即可。

## 本批 commits(neigui main)

| commit | 內容 |
|---|---|
| `9372ee4` | 前一批(e2e 意圖對齊)復審結果 — P1 標記句 + P2 三條補修(**已 review,非本批對象**) |
| `8b72906` | **本批主體**:/feat Phase 0 接入 grilling 提問姿態分流 |

不入 git 的背景(直接看 `~/.claude/skills/`):`grilling/SKILL.md` + `grill-me/SKILL.md`
兩支自 mattpocock/skills(MIT)原文照抄,複製來歷在 RATIONALE 共通層,**不是本批改動**,
但分流條文依賴它們存在。

## 改動摘要(review 對象 = 8b72906 的四個落點)

拍板脈絡:user 帶已成形方案時,brainstorming 的「提 2-3 方案」是儀式;改用 grilling
對抗式拷問(逐分支決策樹、一次一題、每題附建議答案)。**user 中途修正過一次設計**:
原案「/auto 跳過 grilling 照 brainstorming 走」被反轉為「/auto 疊加也不豁免共識拍板,
寧可停等 user 不准自問自答」— RATIONALE 條目記有這條決策軌跡。

1. **feat.md Phase 0 步驟 1 分流句**:已成形方案 → grilling 姿態,2-3 方案縮成
   「確認 + 至多一 counter-proposal」,user 拍板後直進 SC gate;模糊 idea 照舊;
   兩路共識都落 brainstorm.md。**疊 /auto 不豁免拍板**(視同 auto.md「仍必停」),
   已拍板文件不觸發分流(照 auto.md 預核准替代條件)。
2. **refs/feat-phase0-2.md 新增判準節**(檔首):兩條件(指名做法 / 可開決策樹)+
   三邊界例 + 「拿不準預設模糊 idea」+ 分流只換問法的操作細節。
3. **RATIONALE.md /feat 節**:來歷條目(含 /auto 反轉軌跡),還原 = 刪標記句。
4. **next-time.md**:mirror 評估項補註 grilling / grill-me 兩支同屬無 VCS(順手記錄)。

Phase 1-8 / 兩支 skill 本體 / hooks / auto.md 均零改動。

## Review 角度建議(對抗式,不是背書)

- **「視同 auto.md 仍必停」是單邊宣稱**:auto.md 本批零改動,其「仍必停」清單仍只有
  三項(破壞性 / scope / 花錢),grilling 拍板不在其中 — 條文只存在 feat.md 側。
  檢查:/feat + /auto 的執行路徑一定會讀 feat.md Phase 0(此時例外句生效)還是可能
  只憑 auto.md 契約推進?若成立,單落點是否該視為缺口(auto.md 補一行 vs 維持
  「feat.md 就地覆寫」慣例)。
- **auto.md 建議表的張力**:表列「/feat S 級 ✓ 全自動」— 帶已成形方案的 S 級 /auto
  run 現在會在 Phase 0 停等拍板,✓ 的「全自動」承諾與新例外句矛盾與否;要不要在表
  加註,還是「停等也算自動流程的一部分」站得住。
- **「呼叫 brainstorming」與「grilling 姿態」的歧義**:步驟 1 首句仍是「呼叫
  brainstorming 遵循 skill 對話流程」,分流句說「提問階段改用 grilling 姿態」—
  執行者會讀成 (a)「brainstorming 框架內換問法」還是 (b)「改呼叫 grilling 不呼叫
  brainstorming」?若 (b),brainstorming 的 user-approval HARD-GATE 與 design doc
  接軌是否被靜默跳過。兩支 skill 逐字對讀裁決。
- **判準的實際裁量**:「拿不準預設模糊」是安全預設,但反向風險是分流永不觸發
  (執行者一律裝拿不準省得等拍板)— 判準兩條件 + 邊界例是否足以讓「明顯已成形」
  的 case 無從遁逃;或需要「同時滿足兩條即必走,不留拿不準出口」的更硬措辭。
- **延續型 feature 與分流的互動**:feat-phase0-2.md 現在檔首是分流判準節,其後是
  「延續型 feature 前輪指示掃描」— 帶已成形方案且延續前輪時兩節都適用,有無順序
  或衝突(前輪指示說走 brainstorming、本輪方案已成形時聽誰的)。
- **/mod 側缺席(已知家族 +1)**:/mod Phase 2 也呼叫 brainstorming(聚焦四件事),
  user 帶已成形改法同樣有此痛點 — 分流沒進 mod.md。裁決:記入 next-time /mod 改版
  清單即可,還是 /mod 聚焦式 brainstorm 本來就接近 grilling、不需要。
- **grilling description 的自動觸發面**:grilling 的 description 含 "grill" trigger,
  模型可自動觸發(RATIONALE 共通層有記)— 在 /feat 之外或分流判準不成立時被
  description 觸發,與 feat.md 分流條文有無打架空間。
- **記錄紀律自指**:RATIONALE 新條目與本檔的計數敘述是否都附了產生指令實數
  (本檔機械驗證節的數字即產生指令輸出,見下)。

## 機械驗證(數字為 2026-07-27 實跑輸出)

- `python scripts/sync-harness-mirror.py --check` → 全部一致。
- `cd ~/.claude/hooks && python -m pytest tests -q` → 基準 130 passed(本批未動 hooks)。
- `grep -c "2026-07-27"`:feat.md = 5(前批 4 + 本批分流句 1)、feat-phase0-2.md = 1。
- `grep -c "grill-me" ~/.claude/commands/feat.md` = 0(command 層只指名本體 `grilling`;
  grill-me 僅出現在 ref 的「薄殼是給人手打的」說明句)。
- `grep -n "disable-model-invocation" ~/.claude/skills/grill-me/SKILL.md` → L4 = true。
- `git show --stat 8b72906` → 4 檔 +38/-1(feat.md +8 / RATIONALE +3 /
  feat-phase0-2.md +26 / next-time.md +2-1)。

## 已知未修(不要當新發現回報)

- 前批交接檔(REVIEW-2026-07-27.md)Review 結果節列的觀察 ×2(UI 驗收點無機械承接 /
  過目點在 merge 後)與 /mod 側三槓桿缺口(next-time 列管)。
- /mod 側 2 P1 + 15 P2(07-26 掃描,next-time.md 末節)。
- 收件匣 5 條未結案(07-25 ×2 + 07-26 ×3)。
- 8 支複製 skill 無 VCS(6 支改寫件 + grilling / grill-me 原文件;next-time mirror
  評估項已含)、dispositions.json 過期 rows、graphify 640 dangling edges、
  writing-plans L158 殘句。

## Review 結果(2026-07-27 對抗式復審,已補修)

無 P0,本批不退回。2 P1 + 4 P2 全數同日補修(細節以 RATIONALE /feat 節該條目補修行為準):

- **P1 auto.md 替代條件段兩檔兩說**:「無文件但無方向性抉擇 → 推進」與 feat.md「拍板必停」
  在口頭已成形方案 + 純實作級決策 case 正面矛盾(此 case 按 auto.md 方向性判定常不成立,
  不是 contrived)→ auto.md 補分流例外句。
- **P1 分流判定無落檔**:brainstorm.md 寫入要求原無「記分流判定」條,Phase 8 機械驗證也不碰
  brainstorm.md 內容;/auto 下判模糊可續跑、判已成形必停,誘因梯度單向指向靜默不觸發 →
  feat-phase0-2.md 寫入要求補一條。
- **P2 ×4**:auto.md 建議表 /feat S 級補停等註;load-manifest.json feat-L Phase 0 補 grilling
  條件條目(6 支複製時有同步 manifest 前例);next-time.md 補 /mod 側接入項(裁決:mod
  聚焦 brainstorm 只縮主題不換姿態,2-3 方案 checklist 仍強制,痛點同在,該記);判準節補
  「條件 1 單獨成立仍縮提案」句(全成形無決策點 case 原落回提案儀式 = 原痛點復發)。

檢定過不立案:brainstorming/grilling 歧義(讀法「框架內換問法」有文本支持 — 步驟 1 首句
無條件呼叫 brainstorming;拍板 gate 與 brainstorm.md 由分流句自身重申,兩 skill 逐字對讀
無衝突指示)、延續型互動(兩節正交:帶入什麼約束 vs 怎麼問;前輪掃描屬「事實自查」與
grilling 分工相容)、grilling description 自動觸發(判準不成立時被 trigger 只多問不傷 gate;
user 喊 grill 本來就是 user override)、記錄紀律(標記句三處齊、機械驗證數字重跑全吻合、
mirror 一致、hooks 130 passed)。

## 還原路徑(review 判定要退回時)

- 本批條文都帶「2026-07-27 拍板」標記句:git revert `8b72906`(鏡像)+ 真實檔
  `~/.claude/` 三處刪除 — feat.md 分流句段(步驟 1 內)、feat-phase0-2.md 判準節
  (整節)、RATIONALE /feat 節該條目(整段)。mirror 是單向 real→mirror,revert
  鏡像不會自動改真實檔。
- next-time.md 的補註句可留(純記錄,兩支 skill 仍在磁碟上)。
- 兩支 skill 目錄**不動**(複製屬前一動作,還原方式見 RATIONALE 共通層條目)。
