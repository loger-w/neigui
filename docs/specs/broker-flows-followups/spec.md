# Spec — broker-daily-flows 遺留項(followups)

日期:2026-07-21。來源:/feat broker-daily-flows(PR #53,merge `9f2e316`)Phase 8.5 記帳項,user 指示獨立成 spec 由新 session 處理。
背景 artifacts:`.claude/feat/broker-daily-flows/`(design v3 / code-review round 1-2 JSON);對應 `docs/next-time.md` 條目做完請同步刪除。

三項彼此獨立,可分開跑、分開 commit;建議入口 command 標在各節。動工前先讀 skill:`finmind-conventions`(F1)、`frontend-testing`(F2)、無(F3 純結構)。

---

## F-1 新開分點在目錄 24h cache 窗內查無,且無手動刷新路徑 —(已完成,2026-07-21)

mod/broker-directory-refresh 收割:`_get_directory_or_none(refresh: bool = False)`,`get_daily_flows(refresh=True)` 目錄一併強制重抓(dedup key `broker_directory_r{0,1}`,成功寫回 cache);search_traders 不長 refresh 面;失敗沿 R10 降級不 fallback 舊 cache(user 拍板)。SC 1-4 全過(45 passed = 43 既有 + 2 新,`test_directory_cached_24h` 零改動;配額註記入 design v3 §8;changelog 0.38.1)。artifacts 在 `.claude/mod/broker-directory-refresh/`。

---

## F-2 分點搜尋 50 筆上限靜默截斷,無「已截斷」提示

建議入口:`/mod`。規模:S-M(backend shape 微調 + 前端 dropdown + 測試)。

### 現況

- `backend/services/broker_flows.py::search_traders`:命中 > 50(`_SEARCH_LIMIT`)→ `hits[:50]` 靜默截斷,回傳 shape = `[{broker_id, broker_name}]`(裸陣列,無總數資訊)。
- `frontend/src/components/BrokerFlowsPanel.tsx` dropdown 直接 render;寬 query(如「證券」)user 看到 50 筆但不知道還有更多,可能誤判「找不到」。

### 方向性抉擇(新 session Phase 0 要拍板,二選一)

- (a) **回應 shape 改物件** `{hits: [...], total: N}` → 前端 dropdown 尾端顯示「共 N 筆,僅列前 50,請輸入更精確關鍵字」。動 API contract(`lib/api.ts` + `useTraderSearch` + contract test 同改)。
- (b) **不動 shape**:回 51 筆時前端以 `hits.length > 50` 推斷截斷(backend `_SEARCH_LIMIT` 改 51、前端顯示前 50 + 提示)。hack 味重但零 contract 變更。
- 傾向 (a)(contract 誠實);屬對外契約變更 → 若在 /auto 下遇到請停下問(auto.md 方向性抉擇判準)。

### 驗收(SC)

1. pytest:>50 命中 → total 正確、hits=50;≤50 → 無提示欄位歧義。
2. vitest:dropdown 截斷提示出現/不出現兩案(`BrokerFlowsPanel.test.tsx` 既有 mock 樣式)。
3. contract test(`tests_e2e/test_api_broker.py::test_traders_search_by_name`)同步改 shape 斷言。
4. 全套 gate 綠(harness.json 四項;e2e:E30 有碰 traders 回應 → 需同步改 spec 斷言,不豁免)。

---

## F-3 `_run_once` inflight-dedup 複本收斂 —(已完成,2026-07-21)

refactor/run-once-dedup 收割:實測 10 份(9 模組級 + FinMindClient method,spec 原計 5 份過時)收斂至 `utils/concurrency.run_once`;date 驗證 3 處收斂至 `utils/validation.parse_date_param`(錯誤碼/嚴格度以參數保留 — SC-3 兩子句衝突以「錯誤碼不得變」為準,字面統一記 `docs/next-time.md` /mod 候選)。全 suite 前後皆綠(700→702,+2 characterization),artifacts 在 `.claude/refactor/run-once-dedup/`。

---

## 明確不含(本 spec 外)

- `~/.claude/feat-improvements.md` 的 P2(feat.md Phase 4 /code-review fallback 明文化)— harness 層,走 meta-review 流程,不在專案 session 做。
- K 線 overlay 預選分點名稱退化為 id(design v3 Known Risk 1)— 既有顯示限制,未有 user 痛點回報前不動。
