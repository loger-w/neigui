# /feat Phase 0 / Phase 2 細節

## Phase 0:延續型 feature 的前輪指示掃描

**延續型 feature(沿用前輪 design / 架構)**:必先掃前輪 `design.md` / `brainstorm.md`
的 user 指示與慣例語句(grep「user 指示」「呼叫」及 skill 名),逐條轉入本輪
`brainstorm.md` 的「執行約束」節。

只取架構不取指示會漏跨輪約定。

## Phase 0:brainstorm.md 的寫入要求

- 後續修改必標 `[amendment YYYY-MM-DD: <原因>]`
- ≥ 3 個 edge cases
- out of scope 節
- 對應 SC 旁只標 `cycle-count: [see state.json]`(state.json 為唯一資料源)

## Phase 2:模式選擇的落地細節

**預設 `condensed`** —— 單一 `implementation/PLAN.md`,每檔一節 3-5 行(動什麼 / 新增或
變更的 signature / 失敗測試清單對應 SC-N)。

`per_file`(逐檔 `implementation/<file>.md`:signature / 輸入輸出範例 / 失敗測試清單)
**降為 opt-in**:僅 L 級且該檔屬高風險面(安全邊界 / 共用 util / 對外 API / hot path)
才逐檔寫。

## Phase 3 對齊規則(取代舊「ad-hoc 對齊」)

落地發現 PLAN.md 該節粒度不足 → **就地補 signature 細節並標 `[phase-3 補註]`,不回頭
重跑 review**;介面級衝突仍走 Phase 3 失敗回退表(見 `feat-phase3.md`)。
