# Harness 改版 review 交接(2026-07-27 封批復審 — 限縮式)

> 給新 session 的 review 入口。這是 2026-07-25 起 harness 密集改版期的**最後一輪復審**:
> 審過即封批,之後 harness 修補依 chore.md「Harness 攢批」規則湊批再動。
> 真實檔在 `~/.claude/`,repo 內 `docs/harness/` 是鏡像(`python
> scripts/sync-harness-mirror.py --check` 驗漂移,review 當下應「全部一致」)。
>
> **本次是限縮式復審,不是全文重掃**:只審下列三個 commit 的 diff 與其交互面。
> 已審過的批次(8b72906 / d177c08 / 114371c / 6ee39e6)不重開,除非本批 diff 與它們
> 產生新矛盾。前三批的教訓一致:**fix / 搬移自己造的新矛盾是最高命中率的 finding 類型**。
>
> **本批需要新 session 的特殊理由**:357301a 改的就是每個 session 的常駐層(專案
> CLAUDE.md 瘦身 + 兩支 conventions skill),你這個新 session 本身就是 smoke test —
> 開工時順手回答:常駐層讀起來自不自足、`backend-conventions` / `frontend-conventions`
> 兩支 skill 有沒有出現在你的可用 skill 清單、CLAUDE.md 指路行指不指得到東西。

## Review 對象(三個未經獨立視角的 commit)

| commit | 內容 | 風險面 |
|---|---|---|
| `15e14f8` | 收件匣 5 條拍板落地(25 檔 +2893/-31,大宗是 mirror 新收的 19 個 skill 鏡像檔) | 量測腳本行為改動有 137 hooks 測試保護,風險低;**純條文部分沒人看過**:dispositions 6 條 row 改寫(07-26 後繼詞彙)、chore.md「Harness 攢批」強制句、writing-plans L158 殘句修法 |
| `43a16d2` | 四 command 同步批的復審補修(8 檔 +64/-23):3 P1 + 4 P2 的 fix | **最該看**。補修七處全是條文手術:mod.md `[amendment]` 義務 + 退出條件改寫、refactor.md 同型、review-protocol A2 通則化 + C 節續號、change-spec-reviewer 限縮節、dispositions refactor row、feat-phase0-2 去 feat 語彙 |
| `357301a` | 專案 CLAUDE.md 瘦身(5 檔 +60/-39):§2 → 新 skill `backend-conventions`、§3 + 分點名稱細節 → `frontend-conventions`、§1 壓縮 | 搬移類:搬丟內容 / 斷鏈 / 指路行指不準;撰寫者只做了 grep 自查 |

## Review 角度(限縮)

- **搬移完整性逐字核**(357301a):`git show 357301a^:CLAUDE.md` 取出舊 §2 / §3 /
  分點名稱段原文,與 `backend-conventions/SKILL.md`、`frontend-conventions` 新增兩節
  逐字對 — 有沒有條目在搬移中滅失或被改寫;§4 留下的「契約核心句」與移走的細節有無
  互相矛盾;§1 壓縮掉的 `.env` optional 變數(`FINMIND_RATE_LIMIT_PER_SEC` /
  `FRONTEND_ORIGIN`)在 finmind-conventions 是否真的找得到(撰寫者沒驗過這點,
  只憑「配額真相在該 skill」推定)。
- **補修的新矛盾**(43a16d2):mod.md Phase 3 現在同時有「`[amendment]` 標記段落」
  (限縮輪指向)與 feat-phase0-2 寫入要求的 amendment 慣例 — 兩處格式一致嗎;
  「退出條件:無 P0,且 P1 逐條處置」與 mod.md Phase 3 原有「P2 記入 spec 註記」、
  receiving 三分類的銜接是否自洽;review-protocol A2 通則(「有標記指標記,無者圈行號」)
  與 design-reviewer 既有限縮輪節(只寫 changelog / amendment)是否又形成 /feat 側
  的兩檔兩說(design.md 有 changelog 義務,所以可能不衝突 — 驗證這個推定)。
- **dispositions 條文改寫的語意保真**(15e14f8):6 條 row 從舊字串改到 07-26 後繼
  詞彙 — 逐條驗新 check 字串真的鎖住原 row 想鎖的機制,不是換了個碰巧存在的字串
  (例:「rollbacks」是否鎖得住「跨 phase meta-cycle」這個原意)。
- **常駐層 smoke test**(357301a,新 session 特有):見檔頭三問。另 CLAUDE.md §8
  沉澱目的地行改「跨檔契約 → §4;風格 → conventions skill」— 與 /feat Phase 8.5
  規則(refs/feat-phase8.md)的沉澱表述有無失同步。
- **攢批強制句的自指**(15e14f8):chore.md 新句要求「集中時間窗攢批」— 本日
  8 個 harness commit 是否算一個時間窗(是;整天同 session);句子本身放 chore.md
  步驟 1,但 harness 改動不一定走 /chore — 落點夠不夠,或該同時在 user CLAUDE.md
  留一行。

## 機械驗證(2026-07-27 實跑輸出,復審時應可重現)

- `python scripts/sync-harness-mirror.py --check` → 全部一致。
- `harness_load_estimate.py --verify-dispositions` → VIOLATIONS n=0。
- hooks `python -m pytest tests -q` → 137 passed。
- `CLAUDE.md` = 10,354 bytes(瘦身前 14,015,−26.1%)。
- `grep -c "amendment" ~/.claude/commands/mod.md` = 2;`grep -c "逐條處置"` mod.md /
  refactor.md / review-protocol.md 各 = 1。
- commit stat:15e14f8 = 25 檔 +2893/-31;43a16d2 = 8 檔 +64/-23;357301a = 5 檔 +60/-39。

## 已知未修 / 已知裁量(不要當新發現回報)

- /mod /refactor 輪數改制無 /mod 側實證 — 顯式風險註在 RATIONALE,落檔義務已補,
  日後實證覆核,前輪復審已裁定不立案。
- C4 graphify docs 語意層評估結案不建(next-time 有重評條件)。
- baseline profiles(`*-before`)全程零改動;feat-L-before 缺 `baseline_bytes` 是**設計
  正確的失效狀態**(該 baseline 已不可信,腳本拒絕它是 A1 的本意),不是 bug。
- next-time 剩餘條目全為產品側,非 harness。

## 還原路徑(復審判定要退回時)

- `357301a`(瘦身):git revert 即完整還原(CLAUDE.md 與兩支 skill 都在 repo 版控內,
  無 `~/.claude/` 側改動;mirror 只動了 RATIONALE 一行)。
- `43a16d2`(補修):git revert 鏡像 + 真實檔七處刪句 / 還原(各帶「2026-07-27 復審補 /
  復審改」標記;dispositions refactor row 見 git 歷史)。
- `15e14f8`(收件匣批):腳本 + 測試 revert 該 commit;chore.md 刪攢批句;mirror
  DIR_MAPS / ORPHAN_SCOPES 刪 6 條目 + 刪鏡像 skills/<6支>/ 目錄;dispositions rows
  見 git 歷史;收件匣 5 條標記回 [proposed]。
- 逐條退回時:對應落點刪句 + RATIONALE 對應條目劃掉並註明,mirror 重跑 `--fix`。
