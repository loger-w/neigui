# Spec — broker-daily-flows 遺留項(followups)

日期:2026-07-21。來源:/feat broker-daily-flows(PR #53,merge `9f2e316`)Phase 8.5 記帳項,user 指示獨立成 spec 由新 session 處理。
背景 artifacts:`.claude/feat/broker-daily-flows/`(design v3 / code-review round 1-2 JSON);對應 `docs/next-time.md` 條目做完請同步刪除。

三項彼此獨立,可分開跑、分開 commit;建議入口 command 標在各節。動工前先讀 skill:`finmind-conventions`(F1)、`frontend-testing`(F2)、無(F3 純結構)。

---

## F-1 新開分點在目錄 24h cache 窗內查無,且無手動刷新路徑 —(已完成,2026-07-21)

mod/broker-directory-refresh 收割:`_get_directory_or_none(refresh: bool = False)`,`get_daily_flows(refresh=True)` 目錄一併強制重抓(dedup key `broker_directory_r{0,1}`,成功寫回 cache);search_traders 不長 refresh 面;失敗沿 R10 降級不 fallback 舊 cache(user 拍板)。SC 1-4 全過(45 passed = 43 既有 + 2 新,`test_directory_cached_24h` 零改動;配額註記入 design v3 §8;changelog 0.38.1)。artifacts 在 `.claude/mod/broker-directory-refresh/`。

---

## F-2 分點搜尋 50 筆上限靜默截斷,無「已截斷」提示 —(已完成,2026-07-21)

mod/trader-search-truncation 收割:方向 (a) shape 改物件由 user 拍板 — `search_traders` 回 `{hits: ≤50, total: 截斷前命中數}`,api.ts / useTraderSearch(data 維持 hits 陣列 + total extras)/ contract test 同 commit 改;dropdown 尾端非 option 提示列「共 {total} 筆,僅列前 {hits.length}」(不入鍵盤導航,mousedown preventDefault)。SC-4 覆寫註記:E30 無 response shape 斷言,該改斷言為空集合,e2e 照跑不豁免。changelog 0.38.2。artifacts 在 `.claude/mod/trader-search-truncation/`。

---

## F-3 `_run_once` inflight-dedup 複本收斂 —(已完成,2026-07-21)

refactor/run-once-dedup 收割:實測 10 份(9 模組級 + FinMindClient method,spec 原計 5 份過時)收斂至 `utils/concurrency.run_once`;date 驗證 3 處收斂至 `utils/validation.parse_date_param`(錯誤碼/嚴格度以參數保留 — SC-3 兩子句衝突以「錯誤碼不得變」為準,字面統一記 `docs/next-time.md` /mod 候選)。全 suite 前後皆綠(700→702,+2 characterization),artifacts 在 `.claude/refactor/run-once-dedup/`。

---

## 明確不含(本 spec 外)

- `~/.claude/feat-improvements.md` 的 P2(feat.md Phase 4 /code-review fallback 明文化)— harness 層,走 meta-review 流程,不在專案 session 做。
- K 線 overlay 預選分點名稱退化為 id(design v3 Known Risk 1)— 既有顯示限制,未有 user 痛點回報前不動。
