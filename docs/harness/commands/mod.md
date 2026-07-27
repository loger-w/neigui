# Mod: $ARGUMENTS

(若 $ARGUMENTS 為空,先問我要改什麼再繼續。)

共通鐵則套用 `~/.claude/CLAUDE.md`。自主模式契約見 `~/.claude/commands/auto.md`。

## 核心紀律
**改既有 feature 不是新做** — Caller map 完整 + 鐵則 B 三類分離 commit + Backward compat
評估,缺一不可。

## Phases

0. **Phase 0|工作區**:呼叫 `branch-lifecycle` 開工節 + 建 artifact 目錄
   `.claude/mod/<slug>/`(reviewer dispatch 是 fresh context,只吃檔案路徑 — 對話裡的表
   傳不進去)
1. **Phase 1|摸清現況**(不能跳):
   - **grep 所有 caller**(含動態用法:template string / reflection / 字串拼接 / 外部 caller);
     `graphify-out/` 存在時可先 `graphify query "<目標> 的 caller"` 當起點(直接跑 CLI 不載
     skill,2026-07-27 同 /feat 讀檔紀律),**動態用法仍必 grep**(AST graph 抓不到字串拼接 /
     reflection)
   - 跑現有測試,baseline **全綠**
   - 讀懂現有實作意圖(註解 / commit message / 為什麼這樣寫)
   - 整理表:現況 vs 目標(行為 / signature / 對 caller 影響 / backward compat / migration),
     **落檔 `.claude/mod/<slug>/current-state.md`**(Phase 3 reviewer dispatch 的必要輸入)
2. **Phase 2|聚焦 brainstorm**:呼叫 `brainstorming`(遵循 skill 對話流程 —
   一次一問)。產物落點為 `.claude/mod/<slug>/change-spec.md`(**user preference,顯式覆寫**,
   操作面見 `~/.claude/harness/refs/sp-overrides.md`)。
   **提問姿態分流(2026-07-27 拍板,同 /feat Phase 0)**:user 帶**已成形改法**(判準見
   `~/.claude/harness/refs/feat-phase0-2.md` 判準節,拿不準預設模糊)→ 提問改 `grilling`
   姿態,「提 2-3 方案」縮成「確認 + 至多一個 counter-proposal」,**user 拍板後**進聚焦四件事;
   change-spec.md 記分流判定一行(判定 + 命中哪條判準)。**疊 /auto 不豁免拍板**(視同
   auto.md「仍必停」清單;僅條件 1 成立之例外同 ref)。聚焦四件事:
   - 改完的成功條件(可驗收;**量化條件必附 unit + 量法**;UI / 畫面類條件必寫成
     **「畫面可指認」表述** — 位置 / 文字 / 顏色 / 元素,e2e assertion 與截圖驗收以此為準,
     2026-07-27 拍板同 /feat SC gate)
   - **不能破壞的既有行為白名單**(列出來,這比新行為更重要)
   - Backward compat / migration 策略
   - Out of scope
3. **Phase 3|Diff 級 spec**:擴寫 Phase 2 的 `change-spec.md`(同一檔,追加 diff 級章節),
   逐檔列動什麼,**三類動作分開標記**:
   - 🔴 **行為改動**(預期會讓既有測試紅)/ 🟢 **新功能**(加新測試)/ 🔵 **純重構**(測試不該變)
   - 既有測試逐一標:該紅的 / 不該紅的;新測試清單
   - Review 依 `~/.claude/harness/refs/review-protocol.md` A 節 dispatch `change-spec-reviewer`
     (傳 change-spec.md + Phase 1 `current-state.md` 路徑)
   - **輪數(2026-07-27 對齊 /feat 07-26 制):預設 1 輪;round 1 有 accepted P0 → 修復後
     限縮加輪 1 次**(只審 changelog / 變更段落,審 fix 是否改出新矛盾)。**退出條件:無 P0/P1**
     (P2 記入 spec 註記)。限縮輪後仍有 → 停下回報 user 三選一
     (縮 scope / 換做法 / 接受寫入 Known Risks)
4. **Phase 4|TDD + 分 commit**(順序 **🔵 → 🔴 → 🟢**:先重構讓地基乾淨,再改行為,最後加新東西):
   - 🔵 純重構:測試完全不動,改完該綠的還是綠
   - 🔴 行為改動:**先改測試讓它紅** → 改實作讓它綠(鐵則 E 改 assertion 禁令的唯一合法通道)
   - 🟢 新功能:先寫紅測試 → 實作 → 綠
   - Commit 前 cat `docs/next-time.md`(順手衝動寫進去)
5. **Phase 5|自評**:依 `~/.claude/harness/refs/review-protocol.md` B 節跑 code review
   (**預設 medium 檔位**),輸出 `code-review-round-<N>.json` **落檔 `.claude/mod/<slug>/`**
   (2026-07-27 拍板 round JSON 落檔義務)→ `receiving-code-review` 分類處理 →
   自評收斂後把當下 HEAD sha
   追記到 change-spec.md 末尾一行 `self_review_head: <sha>`(收尾節 review 增量判準)
   - **白名單對照必讀(2026-07-27 拍板,同 /feat Phase 4 (b) 例外)**:finder prompt 必附
     change-spec.md「不能破壞的既有行為白名單」節的行號範圍 — 白名單對照不受「按需才開檔」裁量
   - **輸出契約**:P0/P1 逐條展開,P2 慣例 / 風格類彙總計數不逐條 receiving,疑似行為級 P2
     例外照常展開
6. **Phase 6|自動化驗證**:呼叫 `auto-verify` skill 全綠。**既有測試紅時對照 Phase 3 spec**:
   - 該紅(🔴)→ 改 assertion(行為真的變了)
   - **不該紅 → 不改 assertion**,代表打到無關東西,回去看打到什麼
7. **Phase 7|真實環境驗證**(呼叫 `auto-verify` 真實環境節):
   - 新行為符合 Phase 2 成功條件
   - **Phase 2 白名單逐一檢查**(既有行為保留優先於新行為)
   - Edge case + migration(若有):新舊資料 / caller 都正常
   - Console 乾淨
8. **Phase 8|回頭核**:目標行為證據(檔案 / 行號 / 截圖)+ 白名單逐條打勾 + **migration 可逆性**;
   UI 改動的收尾回報**內嵌關鍵畫面截圖**(對應 Phase 2 可指認表述)供 user 過目
   (2026-07-27 拍板同 /feat 收尾 UI 驗收點)

## 失敗 routing
- 既有測試紅但不該紅 → 打到無關東西,回 Phase 3 看 spec 漏列什麼
- Caller 漏掉(grep 沒抓到)→ 回 Phase 1 重 grep(動態用法 / template string)
- Backward compat 撐不住 → 評估 deprecate window 或回 Phase 2 改 scope

規模分流(S/M/L)判準見 `~/.claude/harness/refs/scope-tiers.md`。

## Done
目標成功條件全綠 + 既有行為白名單全保留 + 三類 commit 分明 + migration 可逆(若有)。
收尾前跑 `python ~/.claude/hooks/check_feat_tags.py`(自動取 merge-base 為起點;三類 emoji
目前為 warning 模式)。
**全過後呼叫 `branch-lifecycle` 收尾節**,再做最終回報。

## 禁止(本流程特有,共通禁止見 CLAUDE.md)
- ❌ 砍掉看似無用的 code,沒查清楚動態用法
- ❌ 行為改動 + 重構混同一個 commit
- ❌ **Backward compat 沒談就改 API** / 資料格式
