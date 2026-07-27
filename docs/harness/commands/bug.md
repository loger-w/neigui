# Bug: $ARGUMENTS

(若 $ARGUMENTS 為空,先問我 bug 描述再繼續。)

共通鐵則套用 `~/.claude/CLAUDE.md`。自主模式契約見 `~/.claude/commands/auto.md`。

## 核心紀律
**穩定重現 → 紅測試 → 修 root cause → 反向驗證**。沒重現先別動 code。

## Phases

0. **Phase 0|工作區**:呼叫 `branch-lifecycle` 開工節 + 建 `.claude/bug/<slug>/`
1. **Phase 1|重現 + 蒐證**:最小重現步驟 / stack trace / error log / 截圖 / 影響範圍
   (哪些功能、哪些使用者、嚴重度)。**無法穩定重現 → 停下問**,不靠猜。
   重現步驟落檔 `.claude/bug/<slug>/repro.md`
2. **Phase 2|Root cause**:呼叫 `systematic-debugging` 並**遵循其方法論**:
   調查階段可先列候選假說清單(廣度),但**驗證嚴格一次一個假說、一次改一個變數**。
   用實驗證明 root cause(不是「看起來像」)。實驗記錄追加寫進 `repro.md`。
   架構 / 呼叫鏈 / 檔案關係類調查,`graphify-out/` 存在時先 `graphify query "<問題>"`
   (直接跑 CLI 不載 skill),query 答不了再 Grep / Read(2026-07-27 同 /feat 讀檔紀律)
3. **Phase 3|紅測試先行**(鐵則 C):用 Phase 1 重現條件寫測試 → 現在紅且訊息符合 →
   以後防 regression。「寫不出測試」九成是測試設計問題,寫不出來說明原因
4. **Phase 4|最小修改**:只動 root cause 對應那幾行。不順手 refactor / rename / lint
   (順手衝動寫進 `docs/next-time.md`)。Commit 標 🔴 行為改動(鐵則 B)
5. **Phase 5|Blast radius**:grep 同函式 / 變數所有 caller(含動態用法 / template string /
   reflection / 外部 caller),列受影響功能各跑 sanity check
6. **Phase 6|自動化驗證**:呼叫 `auto-verify` skill(驗證指令來源以該 skill 為準)全綠
7. **Phase 7|真實環境驗證**:呼叫 `auto-verify` **真實環境節**;其中 /bug 特有的一項是
   **重走 Phase 1 重現步驟**,確認現在不會發生。Console 0 errors
8. **Phase 8|反向驗證**(關鍵):暫時還原 Phase 4 修復讓 bug 重現 — 修復已 commit(本流程預設)
   → `git revert --no-commit <fix-sha>`;尚未 commit → `git stash`。Phase 3 紅測試**該紅回來**
   → 還原修復(`git revert --abort` / `git stash pop`)→ 綠回去。**還原修復後測試還是綠 →
   測試沒抓到 bug,回 Phase 3 重寫測試**(計入鐵則 F 次數)。輸出追加寫進 `repro.md`
9. **Phase 9|留尾巴**:同類結構的 code 可能有同樣問題?寫進 `docs/next-time.md`
   (不在本次 fix 處理)

## 失敗 routing
- **同一 root cause 假設下修 3 次還紅** → 遵循 `systematic-debugging` 的處置並
  回報 user(三策略 + 各自為何失敗 + 推測的架構層根因),等 user 決定
- 重現步驟跑不出來 → 回 Phase 1 蒐證,不允許「姑且修一下」
- Blast radius 抽樣紅 → 改錯方向,回 Phase 2

## Done
紅測試綠 + 既有測試保持綠 + regression 抽樣綠 + 反向驗證通過 + `repro.md` 三段齊全。
收尾前跑 `python ~/.claude/hooks/check_feat_tags.py`(自動取 merge-base 為起點;三類 emoji
目前為 warning 模式)。
**全過後呼叫 `branch-lifecycle` 收尾節**,再做最終回報。

## 禁止(本流程特有,共通禁止見 CLAUDE.md)
- ❌ 「無法重現,姑且修一下」
- ❌ 「重啟服務就好」「清 cache 就好」當 fix
- ❌ 在 caller 加 `if x is None` 規避 root cause
- ❌ 同時改多個變數驗證假說(一次一個)
