# Concept Cluster — Execution Plan V0.2(6-industry probe sync 後修訂)

**Pre-reading**:`spec.md` V0.2(同 dir)
**Status**:V0.2,已 sync 6-industry FinMind IndustryChain probe + 3 adversarial critique;**傳產(金融/航運/食品/水泥/觀光)scope 未驗,P9 必跑**
**估時**:10 phases(V0.1 9 + 新 P9 + P3.6 / P3.7 細化)≈ 7-9 工作天

---

## V0.2 修訂摘要

| 變動 | 原因 | 影響 phase |
|------|------|-----------|
| P2 加 fragmented_basket case test + n-invariant detector | AI universe 1/1653 strong pair | P2 |
| P3 加 fragmented_basket short-circuit(L1c 跳過篩選)| L2 失能時 L1c 也失能 | P3 |
| 新 P3.6 — 業務 sanity gate service(§5.12)| Semi 2371 大同 / 3026 禾伸堂 等業務 mismatch | NEW P3.6 |
| 新 P3.7 — 集團股 reflexivity flag(§5.13)| 鴻海系 / 聯電系 5 檔內聚 0.7+ critic 3 raised | NEW P3.7 |
| P5 加 cross_industry_pollution flag + KY/ETF/處置股/新興題材 fallback(§5.14)| critic 1+2 missed | P5 |
| P6 加 fragmented_basket UI mode | critic 1+2 共識 | P6 |
| **新 P9 — 傳產 backtest spike**(金融 / 航運 / 食品 / 水泥 / 觀光 4-5 sample)| critic 1+2+3 一致警告 V0.2 scope 偏電子 | NEW P9 |

---

## V0.1 修訂摘要

| 變動 | 原因 | 影響 phase |
|------|------|-----------|
| P2 加自適應 threshold | MLCC 0.65-0.70 才浮現結構,PCB 0.55 已分層 | P2 |
| P2 加 cluster 結構類型偵測 | UI 對「同質叢」隱藏 sub-cluster 介面 | P2 + P6 |
| P3 拆 L1c 二次篩選 | MLCC 9905 大華掛羊頭股,純 set diff 會誤入 | P3 |
| 新 P3.5 source quality score | MLCC ARTICLE_B 是低品質 source 揭露 | NEW |
| P6 frontend 加 conditional 結構呈現 | 異質分層 vs 同質叢 UI 不同 | P6 |

---

## Phase 排序原則

按 **「先 backend / 後 frontend」+「先低風險 / 後高風險」**:
- P1-P2 = 純資料層(L1b + L2),失敗只影響本 spec,可獨立 backtest
- P3-P4 = 衍生層(L1a + L3),依賴 P1-P2
- P5 = User 仲裁 storage,需 endpoint 設計
- P6 = Frontend,等 backend 全綠
- P7 = Reflexivity retire 偵測,可獨立加
- P8 = 整合 + 真實環境驗證

每個 phase 完成前必過:
- `pytest -q`(backend)
- `npm test`(frontend,若改前端)
- `npm run build`(若改前端)
- TDD:新功能 test-first,每個 phase 末交付**新增** test count

---

## Phase 1 — L1b: TWSE 法定產業全清單 service

### 目標
建 service 從 FinMind 拿 `TaiwanStockInfo` 全清單 + industry_category 對映 + concept_id → category yaml,輸出 `L1b 成員集合`。

### 動的檔
- 🟢 `backend/services/concept_universe.py`(新)
- 🟢 `backend/data/concept_categories.yaml`(新)— concept_id → industry_category list 映射
- 🟢 `backend/tests/test_concept_universe.py`(新)
- 🔵 `backend/utils/cache.py`(可能加 helper,sub-dir cache for concept)

### 實作要點
- `concept_categories.yaml` 例:
  ```yaml
  pcb:
    display_name: PCB
    twse_categories: [印刷電路板, 電子零組件業]
    twse_categories_negative: []  # 黑名單,排除 ETF/權證/受益證券
  mlcc:
    display_name: MLCC
    twse_categories: [電子零組件業]  # 太粗,L2 corr 切細
    seed_keywords: [被動元件, 電容]  # 給 L1a 用
  ```
- service 提供:
  - `get_l1b_members(concept_id: str) -> list[StockMeta]`
  - 內部用 `services/finmind.py` 既有的 `fetch_taiwan_stock_info()`(若無就加)
  - cache key: `concept_l1b_{concept_id}`,TTL 24 小時(industry_category 不常變)

### TDD 順序
1. test: 載入 yaml + `get_l1b_members("pcb")` 回非空 list,含 `3037` `8046`(已知 PCB 成員)
2. test: 排除 ETF(stock_id prefix `00`)+ 權證(stock_id 長度 ≠ 4 + non-digit)
3. test: 多 category 合併去重
4. impl 到 test 全綠

### 完成條件
- pytest 新增 ≥ 4 test 全綠
- 手動跑 `get_l1b_members("pcb")` 印出來,**手動 sanity check**:含 8046 南電 ✓、含 3037 欣興 ✓、不含 0050 (ETF) ✓

### 不能破壞
- 既有 `services/finmind.py` 行為(若需新增 helper 則 additive)

---

## Phase 2 — L2: Correlation discovery service

### 目標
給定一組 stock_id list,從 FinMind 抓 250 trading day daily close → log return → Pearson corr matrix → HRP distance → average-linkage cluster → 切 sub-cluster + strong pair。

### 動的檔
- 🟢 `backend/services/concept_correlation.py`(新)
- 🟢 `backend/tests/test_concept_correlation.py`(新)
- 🟢 deps: `scipy` 加進 `backend/requirements.txt`(計算量大,純 Python 不夠)

### 實作要點(V0.1 更新)
- API:
  ```python
  def compute_concept_clusters(
      stock_ids: list[str],
      end_date: str,
      lookback_days: int = 250,
      # V0.1: 不再 fix threshold,改自適應
      threshold_mode: Literal["auto", "manual"] = "auto",
      manual_subcluster_threshold: float | None = None,
      manual_strong_pair_threshold: float | None = None,
  ) -> ConceptClusterResult
  ```
- 自適應 threshold(V0.1 NEW)— 算完 corr matrix 後先算 union inner corr,按 spec §5.7 表查:

  ```python
  def derive_thresholds(union_inner: float) -> tuple[float, float]:
      if union_inner < 0.45:
          return 0.55, 0.65  # 異質分層
      if union_inner < 0.55:
          return 0.65, 0.72  # 中度同質
      return 0.70, 0.78      # 高度同質
  ```

- Cluster 結構類型偵測(V0.1 NEW)— 按 spec §5.10 公式:
  ```python
  def detect_structure_type(sub_clusters, union_inner) -> str:
      # 回傳 'heterogeneous_tiered' | 'homogeneous_cluster' | 'transitional'
  ```

- `ConceptClusterResult`:
  - `correlation_matrix: dict[stock_id, dict[stock_id, float]]`(round 3)
  - `distance_matrix`(HRP `sqrt(0.5*(1-rho))`)
  - `union_inner_corr: float`(NEW)
  - `derived_subcluster_threshold: float`(NEW)
  - `derived_strong_pair_threshold: float`(NEW)
  - `structure_type: str`(NEW,'heterogeneous_tiered'|'homogeneous_cluster'|'transitional')
  - `sub_clusters: list[set[stock_id]]`(connected component @ derived threshold)
  - `strong_pairs: list[(stock_id, stock_id, corr)]`
  - `outlier_stocks: list[stock_id]`
- 並發抓 FinMind:semaphore 5 + token bucket
- Cache:`concept_corr_{concept_id}_{end_date}_{lookback}`,TTL 24 小時

### TDD 順序(V0.2 更新)
1. test: 給 2 檔已知高度相關股(2330 / 2317),corr > 0.4
2. test: 給 3 檔,strong_pair 含最高 corr pair
3. test: 給 spike 用的 22 檔 PCB universe,sub_clusters 中應含 `{3037, 3189, 4958, 8046}`(ABF 載板),structure_type = `heterogeneous_tiered`
4. test: 給 spike 用的 26 檔 MLCC universe,structure_type = `homogeneous_cluster`,主桶 ≥ 16/26(V0.1)
5. test: 缺資料 stock(下市 / 新上市)gracefully skip
6. test: `derive_thresholds(0.20) == (skip_sub, 0.55)`(V0.2 fragmented bucket NEW)
7. test: `derive_thresholds(0.40) == (0.55, 0.65)`、`derive_thresholds(0.50) == (0.65, 0.72)`、`derive_thresholds(0.60) == (0.70, 0.78)`(V0.1)
8. test: HRP distance `d(rho=1.0) == 0`、`d(rho=-1.0) == 1.0`(spec §風險 caveat 鎖)
9. test: 6-spike AI 58 檔 universe → `fragmented_basket`,strong_pair ≤ 3(V0.2 NEW,corresponds spike empirical 1)
10. test: detect_cluster_type n-invariant — universe=10/strong=0 → fragmented;universe=500/strong=25 → fragmented(2 個 universe size 都觸發,n-invariant 驗 critic 2 raised)
11. impl

### 完成條件
- pytest 新增 ≥ 8 test 全綠(原 5 + V0.1 加 3)
- 手動驗證 PCB 22 檔結果與 spike report §3 數字一致(corr 0.780 欣興 ↔ 景碩、structure_type heterogeneous)
- 手動驗證 MLCC 26 檔結果與 mlcc spike §3 數字一致(corr 0.809 國巨 ↔ 華新科、structure_type homogeneous)

### 不能破壞
- 既有 FinMind rate limit(token bucket 是共享 singleton)— 並發抓不超過全局 quota

---

## Phase 3 — L1c 二次篩選 + L3 outlier/集團股 flag(V0.1 更新)

### 目標
合併 L1a / L1b → universe;算 L1c missing 集合;**L1c 候選跟 narrative top-3 centrality 算 60-day corr 二次篩選**(NEW V0.1);用 L2 結果算 outlier flag;查 TaiwanStockInfo market_cap 算集團股 flag。

### 動的檔
- 🟢 `backend/services/concept_flags.py`(新)
- 🟢 `backend/tests/test_concept_flags.py`(新)

### 實作要點(V0.1 更新)
- API:
  ```python
  def compute_l1c_with_filter(
      l1a_members: set[str],
      l1b_members: set[str],
      l2_result: ConceptClusterResult,
  ) -> dict[stock_id, L1cHitKind]:
      """V0.1: 對 L1b-L1a 候選跟 narrative top-3 centrality 算 corr 篩選。"""
      # 從 l2_result.strong_pairs 找出 centrality top-3 stocks
      # 對每個候選 = l1b - l1a,算 60-day corr vs top-3 mean
      # 分檔:strong (>=0.65) | edge (0.35-0.65) | weak (<0.35)

  def compute_flags(
      l1a_members: set[str],
      l1b_members: set[str],
      l1c_hits: dict[str, L1cHitKind],   # NEW V0.1
      l2_result: ConceptClusterResult,
      market_cap_data: dict[str, float],
      all_concept_memberships: dict[str, set[str]],
  ) -> dict[stock_id, list[FlagKind]]
  ```
- `L1cHitKind` enum:`l1c_strong_hit` | `l1c_edge_hit` | `l1c_weak_hit`
- `FlagKind` enum(V0.1 擴):
  - `missing_from_narrative`(原 L1b - L1a,V0)
  - `l1c_strong_hit`(類 PCB 8046 case)— 自動加入 cluster(V0.1)
  - `l1c_edge_hit`(類 MLCC 8163 case)— flag 標,user 確認(V0.1)
  - `l1c_weak_hit`(類 MLCC 9905 掛羊頭)— 預設 exclude(V0.1)
  - `outlier_low_corr`(corr to union avg < 0.3)
  - `outlier_isolated`(L2.outlier_stocks)
  - `large_cap_warning`(market_cap > 5000 億)
  - `cross_concept_warning`(屬於 ≥ 3 個其他 concept)

### TDD 順序(V0.1 更新)
1. test: PCB 8046 case — l1c_strong_hit(corr 0.751 vs ABF 三雄)
2. test: MLCC 8163 達方 case — l1c_edge_hit(corr 0.65 vs top-3)
3. test: MLCC 9905 大華 case — l1c_weak_hit(corr 0.18)
4. test: spike 6141 柏承 avg corr 0.30 → flag `outlier_low_corr`
5. test: 2330 台積電 假設 market_cap > 5000 億 → flag `large_cap_warning`
6. test: 多 flag 合併
7. test: top-3 centrality 推導(strong_pair 出現次數 ranking)
8. impl

### 完成條件
- pytest 新增 ≥ 8 test 全綠

---

## Phase 3.5 — Source-level quality score(V0.1 NEW)

### 目標
對 L1a 多 source(多篇 CMoney article)算 inner corr,**relative 低於 25 百分位** → 標 quality flag,該 source 獨有成員進 user 仲裁佇列。

### 動的檔
- 🟢 `backend/services/concept_source_quality.py`(新)
- 🟢 `backend/tests/test_concept_source_quality.py`(新)

### 實作要點
- API:
  ```python
  def compute_source_quality(
      sources: dict[source_id, list[stock_id]],
      correlation_matrix: dict[str, dict[str, float]],
  ) -> dict[source_id, SourceQuality]:
      """對每個 source 算 inner corr;跨 source 比較,低於 25 百分位標 low quality。"""

  class SourceQuality:
      source_id: str
      inner_corr: float
      percentile: float  # 0.0-1.0
      quality_flag: Literal["high", "medium", "low"]
      exclusive_members: list[stock_id]  # 該 source 獨有
  ```
- 例外:concept 只 1 個 source → skip(無比較基準),所有成員 quality="high"

### TDD 順序
1. test: MLCC ARTICLE_B inner 0.40 << 其他 (0.56-0.59) → low quality
2. test: PCB N1 inner 0.397 ≈ N2 inner 0.472 → 兩者 medium(無相對極端)
3. test: concept 只 1 source → all members high
4. test: exclusive_members 計算正確
5. impl

### 完成條件
- pytest 新增 ≥ 5 test 全綠

### 不能破壞
- 不影響 L2 correlation discovery 結果(只是新增 layer 在其上)

---

## Phase 3.6 — 業務 sanity gate(V0.2 NEW,§5.12)

### 目標
對 L1b universe 套用「seed_keyword 過濾」+ 「黑名單仲裁」,自動 flag 業務不符 concept 的股票(例 PCB universe 中 2371 大同)。

### 動的檔
- 🟢 `backend/services/concept_business_gate.py`(新)
- 🟢 `backend/tests/test_concept_business_gate.py`(新)
- 🟢 `backend/data/concept_categories.yaml` 加 `seed_keywords` + `business_sanity_exclusions` 欄位

### 實作要點
- API:
  ```python
  def apply_business_gate(
      l1b_universe: list[str],
      concept_id: str,
      stock_info: dict[str, StockInfo],  # name + main_products
      seed_keywords: list[str],          # from yaml
      exclusions: set[str],              # from yaml
  ) -> dict[stock_id, list[FlagKind]]
  ```
- yaml schema 擴充:
  ```yaml
  pcb:
    display_name: PCB
    twse_categories: [印刷電路板, 電子零組件業]
    seed_keywords: [PCB, 印刷電路板, 載板, 軟板, 銅箔, CCL, 玻纖]
    business_sanity_exclusions:
      - "2371"  # 大同(過去歸 IC 但業務轉重電,已非 PCB 鏈)
  ```

### TDD 順序
1. test: PCB universe 中 2371 大同 → `business_off_concept`
2. test: PCB universe 中 3037 欣興(name 含「欣興」+ 主要產品 PCB)→ pass
3. test: yaml black list 命中 → 強制 `business_off_concept`(無論 seed_keyword 是否符)
4. test: yaml 缺 `seed_keywords` → skip gate,全部 pass(向下相容)

### 完成條件
- pytest 新增 ≥ 4 test 全綠

### 不能破壞
- 不 hard-cut,只 flag — UI 預設 collapse 但保留進 L4 仲裁

---

## Phase 3.7 — 集團股 reflexivity flag(V0.2 NEW,§5.13)

### 目標
對 concept universe 中同屬一集團的 ≥ 3 檔股票標 `group_reflexivity_warning`,避免「假高內聚 sub-cluster」誤命名(critic 3 raised:鴻海系 5 檔在 PCB universe 自成 cluster)。

### 動的檔
- 🟢 `backend/services/concept_group_reflexivity.py`(新)
- 🟢 `backend/data/group_constituents.yaml`(新)— 集團 → 成員 mapping
- 🟢 `backend/tests/test_concept_group_reflexivity.py`(新)

### 實作要點
- yaml:
  ```yaml
  foxconn_group:
    display_name: 鴻海集團
    members: ["2317", "2354", "2392", "3481", "3508", "6121", "8076"]
  uni_president_group: ...
  taiwan_plastic_group: ...
  far_eastern_group: ...
  lite_on_group: ...
  ```
- API:
  ```python
  def detect_group_reflexivity(
      l1b_universe: set[str],
      group_yaml: dict,
  ) -> dict[group_id, list[stock_id]]:
      """回傳每集團 ≥ 3 檔在 universe 出現的成員。"""
  ```

### TDD 順序
1. test: PCB universe 含 3508 / 8076 / 2317 → `foxconn_group` flag
2. test: universe 內某集團只 2 檔 → 不 flag(threshold ≥ 3)
3. test: 空 yaml → skip,無 flag

### 完成條件
- pytest 新增 ≥ 3 test 全綠

### 不能破壞
- 不影響 corr 計算;UI sub-cluster 命名時 lower weight

---

## Phase 4 — L1a: CMoney narrative scraper

### 目標
從 CMoney cmnews.com.tw 抓近 90 天 PCB / MLCC 等 narrative article,parse 出成分股清單。

### 動的檔
- 🟢 `backend/services/concept_scraper.py`(新)
- 🟢 `backend/data/concept_scraper_seeds.yaml`(新)— concept_id → CMoney 搜尋關鍵字 / 已知 URL list
- 🟢 `backend/tests/test_concept_scraper.py`(新)
- 🟢 deps: `beautifulsoup4` 加進 `backend/requirements.txt`

### 實作要點
- V0 簡化:`seeds.yaml` 手動維護 URL list,**不寫自動搜尋**(避免被 Google 擋)
  ```yaml
  pcb:
    article_urls:
      - https://cmnews.com.tw/article/cmoney-88d625bc-d8cd-11f0-b456-f43ae41a3574
      - https://cmnews.com.tw/article/cmoney-db728137-bfa5-11f0-8678-67dffadd94fc
  ```
- 對每篇 URL:`httpx.get` → `BeautifulSoup` → regex `(\d{4})\s*([一-鿿KY\-]+?)(?=[,\s\(])` 抓「股號 + 中文股名」
- Teaser 過濾:若文本中 `\(\d{2}XX\d\)` 出現比例 > 30% → skip
- Cache:`concept_l1a_{concept_id}`,TTL 7 天
- fail-soft:單 URL fetch 失敗 logger.warning,不擋整體

### TDD 順序
1. test: parse 既知 fixture HTML(用 spike 抓過的 cmnews article 存 fixture)抓出 9 檔
2. test: teaser 文本 fixture → skip
3. test: yaml load + 多 article merge 去重
4. test: 單 URL fetch 失敗 不擋整體
5. impl

### 完成條件
- pytest 新增 ≥ 4 test 全綠
- 手動跑 `scrape("pcb")` 印出來,**手動 sanity check**:含 3037 / 4958 等 ✓

### 不能破壞
- 不對 cmnews.com.tw 高頻請求(預設 TTL 7 天 cache,user 主動 refresh 才繞 cache)
- User-Agent 帶上「trash-cmoney/spike (non-commercial)」標明來源

---

## Phase 5 — User-arbitration storage + REST endpoints

### 目標
filesystem storage(JSON file per concept)+ FastAPI endpoints for read / write / refresh。

### 動的檔
- 🟢 `backend/services/concept_store.py`(新)
- 🟢 `backend/routes/concept.py`(新)
- 🟢 `backend/data/concept_clusters/`(新 dir,放 JSON file)
- 🟢 `backend/tests/test_concept_routes.py`(新)
- 🔵 `backend/main.py`(加 router include)

### 實作要點
- store API:
  - `load_concept(concept_id) -> ConceptStore | None`
  - `save_concept(concept_id, store: ConceptStore)`(atomic write,沿用 `utils.cache.atomic_write_json`)
  - `list_active_concepts() -> list[concept_id]`(scan dir,filter lifecycle != retired)
- endpoints:
  - `GET /api/concepts` → `{concepts: [{id, display_name, lifecycle_status, member_count, last_review_at}]}`
  - `GET /api/concepts/{id}` → 完整 detail(含 corr matrix)
  - `POST /api/concepts/{id}/arbitrate` body `{action: "add_member"|"exclude_member"|"name_subcluster"|"rename_concept", ...}` → updated detail
  - `POST /api/concepts/{id}/refresh?force=true` → 重跑 L1a-L3 → update store
- error contract 沿用 `{detail: {error: "<code>"}}`
- arbitrate `action` 寫入 store 後**保留 audit trail**:`history: [{at, action, by: "user", payload}]`

### TDD 順序
1. test: load 不存在 concept → null
2. test: save → load round-trip
3. test: arbitrate add_member → member 加入 + history 增條目
4. test: arbitrate exclude_member → action="user_excluded"
5. test: POST /refresh 整合測(monkeypatch L1a/L1b/L2/L3)
6. test: GET /api/concepts 列表
7. impl

### 完成條件
- pytest 新增 ≥ 7 test 全綠

### 不能破壞
- 既有 routes 不動;新 router include 不影響既有 endpoint 路徑

---

## Phase 6 — Frontend: 第 3 mode + concept page

### 目標
加 `concept` mode 進 `App.tsx`,實作三欄佈局(族群列表 / 視覺化 / 成員仲裁)。

### 動的檔
- 🔴 `frontend/src/App.tsx`(mode ternary → multi-way,加 concept 分支)
- 🟢 `frontend/src/components/ConceptPage.tsx`(新,lazy load)
- 🟢 `frontend/src/components/ConceptList.tsx`(新,左欄)
- 🟢 `frontend/src/components/ConceptHeatmap.tsx`(新,中央)
- 🟢 `frontend/src/components/ConceptMembers.tsx`(新,右欄)
- 🟢 `frontend/src/hooks/useConcepts.ts`(新)
- 🟢 `frontend/src/hooks/useConceptDetail.ts`(新)
- 🟢 `frontend/src/lib/concept-heatmap-svg.tsx`(新,純 SVG renderer)
- 🟢 `frontend/src/lib/concept-types.ts`(新)
- 🟢 colocated `*.test.{ts,tsx}` 每檔一個

### 實作要點(V0.1 更新)
- hook 用 TanStack Query(per CLAUDE.md §8 P0,但若專案還沒導入 → 沿用既有 fetch hook pattern + `seqRef` race protection)
- `ConceptPage` lazy load(`React.lazy()` + `<Suspense>`)
- mode switcher 加第 3 顆按鈕「族群」;`App.tsx` ternary 改 switch / object map
- heatmap SVG:純函式 in `lib/concept-heatmap-svg.tsx`,測試獨立(不需 jsdom)
- UI 文字嚴禁方向性:`expect(screen.queryByText(/買進|賣出|滿倉|強勢輪入/)).toBeNull()`
- 配色:high corr 用 `text-ink-accent`,避開 bull/bear 紅綠
- **Conditional cluster 結構呈現(V0.1 NEW)**:
  - `structure_type === 'heterogeneous_tiered'` → 顯示完整 dendrogram + sub-cluster 命名 UI
  - `structure_type === 'homogeneous_cluster'` → 隱藏 sub-cluster 介面,只顯示「主桶」+「outlier 列表」two-tier;加 banner「此 concept 同質性高,無實質 sub-cluster 結構」
  - `structure_type === 'transitional'` → 兩種視覺都給,user toggle 切換
- **L1c 三檔分區呈現(V0.1 NEW)**:右欄成員列表用「漏網主流」(`l1c_strong_hit`)/「邊緣可疑」(`l1c_edge_hit`)/「掛羊頭」(`l1c_weak_hit`)三個 collapsible section,user 一眼分辨
- **Source quality 標示(V0.1 NEW)**:成員 hover 顯示來源 source list,low-quality source 標 ⚠ icon

### TDD 順序(V0.1 更新)
1. test: `lib/concept-heatmap-svg.test.ts` — 給 3x3 corr matrix,render 出 9 個 rect with 對的 fill / x / y
2. test: `ConceptList.test.tsx` — 顯示 active / watch tab,點 concept emit `onSelect(id)`
3. test: `ConceptMembers.test.tsx` — 成員列表 + outlier flag + 仲裁按鈕點擊 emit event
4. test: `ConceptMembers.test.tsx` — L1c 三檔分區(strong/edge/weak)各自渲染 collapsible(V0.1)
5. test: `ConceptPage.test.tsx` heterogeneous_tiered — 顯示 dendrogram + sub-cluster 命名(V0.1)
6. test: `ConceptPage.test.tsx` homogeneous_cluster — 隱藏 sub-cluster 介面 + 顯示同質性 banner(V0.1)
7. test: `ConceptPage.test.tsx` transitional — toggle 視覺(V0.1)
8. test: `App.test.tsx` mode 切換 — equity → concept → options 三個都顯示對的子頁
9. test: 嚴禁文案 lock
10. impl

### 完成條件(V0.1 更新)
- npm test 新增 ≥ 25 test 全綠(原 20 + V0.1 加 5)
- npm run build 過(tsc 無錯)
- chrome-devtools-mcp 截圖驗證(V0.1 擴):
  - 進 concept mode → 截
  - 點 PCB(heterogeneous_tiered)→ 截 heatmap + 22 檔成員 + dendrogram + sub-cluster 命名 + 8046 在 `l1c_strong_hit` 區
  - 點 MLCC(homogeneous_cluster)→ 截 主桶 + outlier 二層 + 同質性 banner + 9905 在 `l1c_weak_hit` 區
  - 點 ARTICLE_B 低品質 source 標 ⚠ → 截
  - 點 exclude 6141 → 截更新後狀態
- 截圖放 `docs/specs/concept-cluster/screenshots/`

---

## Phase 7 — Reflexivity retire detector

### 目標
週末 EOD cron 算每個 concept 的 strong_pair_avg_corr,連續 N 週低於閾值自動切 watch / retired。

### 動的檔
- 🟢 `backend/services/concept_lifecycle.py`(新)
- 🟢 `backend/tests/test_concept_lifecycle.py`(新)
- 🔵 `backend/routes/concept.py`(加 GET `/api/concepts/_lifecycle_check` 手動觸發)

### 實作要點
- API:
  ```python
  def evaluate_lifecycle(
      concept_store: ConceptStore,
      historical_corr: list[float],  # 過去 N 週每週的 strong_pair avg corr
      watch_threshold: float = 0.4,
      retired_threshold: float = 0.35,
      watch_weeks: int = 4,
      retired_weeks: int = 2,
  ) -> LifecycleStatus
  ```
- 寫回 `concept_store.lifecycle_status` + `lifecycle_history`
- V0 不裝 cron;手動 endpoint 觸發,或 dev 加 launchd / Task Scheduler 提醒

### TDD 順序
1. test: corr 4 週都 < 0.4 → watch
2. test: 已 watch 再 2 週 < 0.35 → retired
3. test: 中間有反彈 → reset 計數
4. test: 手動 revive 後 lifecycle_history 留紀錄
5. impl

### 完成條件
- pytest 新增 ≥ 5 test 全綠

---

## Phase 8 — 整合 + 真實環境驗證 + lessons learned

### 目標
端對端跑 PCB / MLCC 兩個 concept,UI 真實截圖 + commit 慣例 + lessons learned 更新 CLAUDE.md。

### 動的檔
- 🟢 `docs/specs/concept-cluster/screenshots/*.png`
- 🟢 `docs/specs/concept-cluster/verification.md`(沿用 chip-bubble-intraday-overlay 慣例)
- 🟢 `frontend/src/lib/changelog.ts`(加 MINOR bump entry)
- 🔵 `CLAUDE.md §9 Lessons Learned`(加 concept-cluster pipeline 學到的 quirk)

### 步驟
1. 啟動 backend + frontend dev
2. chrome-devtools-mcp navigate `:5173`
3. 切到 concept mode → 截圖
4. 點 PCB → 截圖 heatmap + 成員
5. 8046 在 missing_from_narrative flag 列出 → 截圖
6. 點 add_member 補 1303 南亞 → 截圖更新
7. 切到 MLCC → 截圖
8. 反身性 dry-run:強制 watch_threshold 改 0.6 看 PCB 是否被切 watch(驗證 retire detector wiring)
9. verification.md 寫:每步驟對應截圖檔名 + 預期 vs 實際
10. changelog 加 entry:
    ```ts
    { date: '2026-MM-DD', kind: 'feature', scope: 'global',
      text: '新增族群分析模式,可自動找出概念股的 sub-cluster + 標出可能漏網的成員' }
    ```
11. CLAUDE.md §9 加 lessons learned(預期幾條):
    - L1a CMoney scraper teaser 過濾陷阱
    - L2 partial correlation 控制大盤 beta 後 corr 結構變化(若 P2.5 有做)
    - 反身性 retire detector 在系統性下跌時的 false-positive 模式

### 完成條件
- 截圖檔放對 dir
- verification.md 完整
- changelog entry 加入
- CLAUDE.md §9 至少 1-2 條新 lesson
- 三類分開 commit:
  - 🟢 backend service(P1-P4)— 一個 commit
  - 🟢 backend routes + storage(P5)— 一個
  - 🟢 frontend(P6)— 一個
  - 🟢 lifecycle(P7)— 一個
  - 🔵 docs / changelog / lessons(P8)— 一個

---

## 整體驗證 gate(收尾前必過,V0.1 更新)

- [ ] `cd backend && python -m pytest -q` 全綠(新增 ≥ 38 test;原 30 + V0.1 加 8)
- [ ] `cd frontend && npm test` 全綠(新增 ≥ 25 test)
- [ ] `cd frontend && npm run build` 過
- [ ] chrome-devtools 真實環境截圖(10 張以上,含 heterogeneous + homogeneous 兩種 case)
- [ ] PCB 22 檔成員量化結果與 spike report §3 數字一致(8046 corr 0.751、3037↔3189 corr 0.78、structure_type heterogeneous_tiered)
- [ ] MLCC 26 檔成員量化結果與 MLCC spike §3 數字一致(2327↔2492 corr 0.809、structure_type homogeneous_cluster、ARTICLE_B 標 low quality)
- [ ] changelog 新 entry
- [ ] CLAUDE.md §9 加 2+ lesson
- [ ] 三類 commit 分開
- [ ] PR 描述含 spec / plan link + verification screenshots

---

## 失敗處理(3 次上限)

任一 phase 修不過 3 次 → 停下,回報:
1. 哪個 phase / step
2. 完整錯誤
3. 試過的 3 策略 + 為何失敗
4. 推測根因

特別注意陷阱:
- FinMind `taiwan_stock_price` 偶爾回空 list(假日 / 新上市) — 不要當 error,當 "no data" gracefully skip
- `App.tsx` mode ternary 改 multi-way 容易 break 既有 chip / options 行為 — 改前先寫 mode 切換 lock test
- `_CACHE_VERSION` 不要因 concept service 而 bump(會廢掉既有 chip / options cache)
- HRP distance `sqrt(0.5*(1-rho))` 當 rho = 1 時 = 0,當 rho = -1 時 = 1 — 自己跟自己距離應為 0,test 鎖
- **V0.1 陷阱**:已併購下市股(MLCC spike 撞到 2456 奇力新被 2327 國巨併購)會回 4 rows 而非完整 250 — `compute_log_returns` 共同 trading day 取交集會把整 universe 縮到 4 day,需 pre-filter 「row count < 50% 預期」的 stock 並 logger.warning
- **V0.1 陷阱**:user 提股號可能筆誤(MLCC spike user 提 5317 凱美實際是 2375)— L1b yaml 載入時對股號做 sanity check(FinMind TaiwanStockInfo 查不到名稱 → 拋警告不擋 pipeline)
- **V0.2 陷阱:fragmented_basket detector n-invariant 拍腦袋** — `strong_pair_count ≤ universe_size * 0.05` 在 universe = 10 時等於 0(無 strong pair),universe = 500 時等於 25 — n 變化時敏感度不一致;P9 傳產驗證後可能需重校準
- **V0.2 陷阱:FinMind sub_industry 不能 hard-cut filter**(spec §5.2 改寫)— 必須 L1b 仍取 industry_category 全清單,sub_industry 僅作 UI 標籤;若誤改成「只取 sub_X 成員」會大量漏網主流玩家(例 PCB 沒分 ABF/HDI,把 sub「硬板、軟板、IC載板製造」一律取會包進 44 檔)
- **V0.2 陷阱:集團股 reflexivity 須在 sub-cluster 命名前 flag** — 否則 L2 strong_pair 列表會把鴻海系 5 檔列為「PCB 鏈高內聚」,L4 用 strong pair 給 sub-cluster 命名時會錯;集團 flag 必須在 sub-cluster 自動命名建議前算好

---

## Phase 9 — 傳產 backtest spike(V0.2 NEW,critic 1+2+3 共識要求)

### 目標
跑 4-5 個非電子產業 spike,驗證 V0.2 的 fragmented_basket / business_sanity_gate / 「FinMind sub_industry 不直接當邊界」rule 是否在傳產上 over-fit / 誤殺。

### 動的檔
- 🟢 `scratchpad/traditional_industry_spike/` 一系列 throw-away spike script(同 PCB / MLCC 風格)
- 🟢 `scratchpad/concept-cluster-spike-traditional-summary.md` 整合報告
- 🔵 spec.md scope warning 段落 — 若驗證通過,放寬;若失敗,加 industry conditional rule

### 5 個目標 spike(從 critic 警告 + TW 實證直覺挑)
1. **航運**(2603 長榮 / 2609 陽明 / 2615 萬海 + 散裝四雄 2606/2615/2617/5608)— 預期 homogeneous_cluster(三雄常駐 corr 0.85+)
2. **金融**(玉山金 2884 / 富邦金 2881 / 國泰金 2882 / 兆豐金 2886 / 中信金 2891 / 第一金 2892 等 14-15 金控)— 預期 homogeneous_cluster(同步利率敏感)
3. **食品**(統一 1216 / 大成 1210 / 卜蜂 1215 / 福壽 1219 等)— 預期 mid corr,可能 transitional
4. **水泥**(台泥 1101 / 亞泥 1102 / 環泥 1104 / 信大 1109)— 預期 homogeneous,同景氣循環
5. **觀光**(雄獅 2731 / 鳳凰 5706 / 國賓 2704 / 福華 2702 / 晶華 2707 等)— 預期 single-event-driven homogeneous

### 步驟
- 為每個傳產跑同 V0.2 spec L1b + L2 pipeline(用 P1-P2 完成的 service)
- 評估:
  - union inner corr 是否真的 ≥ 0.5(傳產同質)?
  - structure_type 是否落 homogeneous_cluster 而非 fragmented?
  - business_sanity_gate 是否誤殺真實成員?
  - 集團股 reflexivity flag 是否有 false positive?
- 寫對照表 + spec V0.3 修訂建議(若需要)

### 完成條件
- 5 個傳產 spike 報告齊
- 對照表清楚:每產業 union inner corr / structure_type / V0.2 rule 是否 over-fit
- spec V0.3 修訂建議寫成(可能加 `industry_category_override.yaml` 讓特定大類強制 bypass V0.2 sanity gate)

### 不能破壞
- 不修 P1-P7 service code(用 production code 跑 spike,證明 V0.2 在傳產也 robust)
- 若發現 V0.2 rule 在傳產誤殺嚴重,記入 lessons learned + 開 V0.3 spec 修訂專案,**不在 P9 內直接改 code**

---

## Revision History

- **V0**(2026-06-30 早) — 8 phases,基於 PCB single-sample spike
- **V0.1**(2026-06-30 晚) — MLCC sync 後:P2 加自適應 threshold + 結構類型偵測;P3 加 L1c 二次篩選;新增 P3.5 source quality score;P6 加 conditional structure 呈現 + L1c 三檔分區 UI;整體驗證 gate 含兩種 structure type case 截圖
- **V0.2**(2026-06-30 同晚) — 6-industry FinMind IndustryChain probe + 3 adversarial critic sync。P2 加 fragmented_basket case + n-invariant detector;新 P3.6 業務 sanity gate;新 P3.7 集團股 reflexivity flag;P5 加 cross_industry_pollution + KY/ETF/處置股/新興題材 fallback;P6 加 fragmented_basket UI mode;**新 P9 傳產 backtest spike**(critic 一致要求);spec 頂部加 scope warning
