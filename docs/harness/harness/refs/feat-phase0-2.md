# /feat Phase 0 / Phase 2 細節

## Phase 0:提問姿態分流 —「已成形方案」判準(2026-07-27 拍板)

同時滿足兩條 → 已成形方案,提問階段改 `grilling` 姿態(command 層直接指名本體 `grilling`;
`grill-me` 薄殼是給人手打的):

1. user 的需求敘述**指名了做法**(技術選型 / 資料流 / 落點檔案 / UI 形式至少一項),
   不只是目標 —「加個 X 功能」只有目標,不算。
2. 該做法有可逐分支追問的具體決策點(能開拷問決策樹)。

邊界例:

- 「我想用 TanStack Query 重寫 useBrokerHistory,signal 直傳」→ 已成形(指名做法)。
- 「分點頁面載入太慢,幫我改善」→ 模糊 idea(只有目標)。
- 「加一個 heatmap tab,吃現有 market snapshot 資料」→ 已成形(UI 形式 + 資料源指名)。

**拿不準 → 預設模糊 idea 走 brainstorming**(生成式是安全預設;grilling 對模糊輸入會空轉)。
條件 1 成立、僅條件 2 不成立(方案完整到無開放決策點)時走 brainstorming,但「提 2-3 方案」
的縮減照樣適用(確認 + 至多一個 counter-proposal,不硬湊)— 對已完全想好的 user 重演提案
儀式即本分流要消除的痛點(2026-07-27 review 補修)。

分流只換「怎麼問」,其餘零差異:

- grilling 姿態 = 逐分支決策樹、一次一題、每題附建議答案;**事實**(檔案現況 / 既有實作)
  自查環境不問 user,**決策**才逐條問、等答覆。
- 「提 2-3 方案」縮成「確認 user 方案 + 至多一個 counter-proposal」— 有明顯更優解才提,
  沒有不硬湊。
- 共識落 `brainstorm.md`、SC gate、S/M/L 分流照常。
- 疊 /auto:拍板不豁免,以 feat.md Phase 0 步驟 1 例外句為準。

## Phase 0:延續型 feature 的前輪指示掃描

**延續型 feature(沿用前輪 design / 架構)**:必先掃前輪 `design.md` / `brainstorm.md`
的 user 指示與慣例語句(grep「user 指示」「呼叫」及 skill 名),逐條轉入本輪
`brainstorm.md` 的「執行約束」節。

只取架構不取指示會漏跨輪約定。

## Phase 0:brainstorm.md 的寫入要求

- 後續修改必標 `[amendment YYYY-MM-DD: <原因>]`
- ≥ 3 個 edge cases
- out of scope 節
- **分流判定記錄(2026-07-27 review 補修)**:一行記「已成形 / 模糊」判定 + 命中(或未中)
  哪條判準 — 分流有無被考慮必須事後可稽核,防「一律裝拿不準」靜默不觸發
- SC 旁**不標**任何 cycle-count 註記(2026-07-26 起回退改記 state.json `rollbacks`,
  讀法 filter by sc;state.json 為唯一資料源)

## Phase 2:PLAN.md 粒度

單一 `implementation/PLAN.md`,每檔一節 3-5 行(動什麼 / 新增或變更的 signature /
失敗測試清單對應 SC-N)。高風險面的檔(安全邊界 / 共用 util / 對外 API / hot path)
該節放寬到完整 signature + 輸入輸出範例,**仍寫在 PLAN.md 同一檔內**。

(`per_file` 逐檔 spec 模式已於 2026-07-26 廢除:7/7 run 全選 condensed,0 次使用。)

## Phase 3 對齊規則(取代舊「ad-hoc 對齊」)

落地發現 PLAN.md 該節粒度不足 → **就地補 signature 細節並標 `[phase-3 補註]`,不回頭
重跑 review**;介面級衝突仍走 Phase 3 失敗回退表(見 `feat-phase3.md`)。
