# Spec — broker-daily-flows 遺留項(followups)

日期:2026-07-21。來源:/feat broker-daily-flows(PR #53,merge `9f2e316`)Phase 8.5 記帳項,user 指示獨立成 spec 由新 session 處理。
背景 artifacts:`.claude/feat/broker-daily-flows/`(design v3 / code-review round 1-2 JSON);對應 `docs/next-time.md` 條目做完請同步刪除。

三項彼此獨立,可分開跑、分開 commit;建議入口 command 標在各節。動工前先讀 skill:`finmind-conventions`(F1)、`frontend-testing`(F2)、無(F3 純結構)。

---

## F-1 新開分點在目錄 24h cache 窗內查無,且無手動刷新路徑

建議入口:`/mod`(改既有行為)。規模:S(單檔 + 測試)。

### 現況(讀 code 可驗)

- `backend/services/broker_flows.py::_get_directory_or_none()`:分點目錄(FinMind `TaiwanSecuritiesTraderInfo`)cache TTL 24h;**無 refresh 參數** — 原實作有此參數但全 repo 零 caller 傳 True(死參數),code review S5(見 `.claude/feat/broker-daily-flows/code-review-round-1.json`)拍板 YAGNI 移除,並記為 design v3 Known Risk 2。
- 後果:新掛牌分點在目錄快取 24h 窗內,`/api/broker/traders` 搜不到、`/api/broker/daily-flows` 前置檢查 404(`broker_not_found`),user 按「重新整理」也無效(`?refresh=true` 只 bypass flows cache,不碰目錄)。

### 目標行為

- `get_daily_flows(broker_id, date, refresh=True)` 時目錄一併強制重抓(dedup key 帶 `_r{int(refresh)}`,對齊 flows cache 的 refresh 語意)。
- `search_traders` 不需 refresh 面(搜尋場景 24h 足夠;若實作極便宜可順帶,非必要)。

### 驗收(SC)

1. pytest:`refresh=True` → `fetch_securities_trader_info` 被呼叫即使目錄 cache 新鮮;`refresh=False` 維持 cache 命中 0 fetch(既有測試 `test_directory_cached_24h` 不得動)。
2. pytest:refresh 路徑的 dedup key 不與非 refresh 路徑互吃(參照 `test_daily_flows_refresh_bypasses_cache` 樣式)。
3. 配額註記:refresh 多燒 1 request/次,SC-8 帳目(design v3 §8)同步更新一行。
4. 既有 broker 測試全綠(`python -m pytest -q tests/test_broker_flows.py`)。

### 邊界

- 不做前端改動(重新整理鈕已傳 refresh=true 到 daily-flows,鏈路自然通)。
- e2e 豁免候選:hook 回傳 shape 不變、UI 無視覺變化 → 依 `e2e-conventions` 判準表屬內部行為,commit 註 `[no-e2e: ...]`(自行再判一次)。

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

## F-3 `_run_once` inflight-dedup 複本收斂(第 5 份已現,觸發條件命中)

建議入口:`/refactor`(行為零差異)。規模:M(5 服務檔 + 各自測試保護盤點)。

### 現況(docs/next-time.md「backend 候選日回退 + inflight dedup + date 驗證複本組」條目,2026-07-21 已註記觸發命中)

- `_run_once` 五份:`services/warrants.py`、`services/warrant_flow.py`(refcount+shield)、`services/market_universe.py`、`services/industry_chain.py`、`services/broker_flows.py`(refcount+shield,warrant_flow 逐字同構)。**行為已分歧**:refcount 版 vs 無 refcount 版 — 收斂前先盤點各版語意差異與依賴該差異的測試。
- date query 驗證三種擺位:`routes/warrants.py`(regex+fromisoformat)、`routes/daytrade_fee.py`(僅 fromisoformat)、`services/broker_flows.py`(service 層 fromisoformat → 400 invalid_date)。
- 連動:`backend/tests/conftest.py::_reset_realtime_task_registries` 的 module tuple(現 9 模組)— 收斂後 registry 歸屬改變要同步,docstring 有「新增模組級 registry 必掛進 fixture」規則。

### 驗收(SC)

1. 行為零差異:全 backend suite 前後皆綠(700+ passed 基準),不改任何 assertion。
2. 收斂後單一實作(建議 `utils/` 或 `services/_concurrency.py`),refcount 語意為準(它是超集);各模組 `_inflight` registry 保留模組級(conftest 清理契約不變)或集中 — 二擇一在 refactor-plan 寫明理由。
3. date 驗證收斂為單一 helper(400 `invalid_date` 語意統一),routes/warrants 與 daytrade_fee 的既有錯誤碼字串**不得變**(前端契約)。
4. 每步小 commit(🔵),任一步紅立即回退。

### 邊界

- 不順手改各服務的 cache/TTL 邏輯(只收 dedup 與 date 驗證兩族)。
- `docs/decisions.md` 先查有無 dedup 抽象的舊決策,別重開已結案討論。

---

## 明確不含(本 spec 外)

- `~/.claude/feat-improvements.md` 的 P2(feat.md Phase 4 /code-review fallback 明文化)— harness 層,走 meta-review 流程,不在專案 session 做。
- K 線 overlay 預選分點名稱退化為 id(design v3 Known Risk 1)— 既有顯示限制,未有 user 痛點回報前不動。
