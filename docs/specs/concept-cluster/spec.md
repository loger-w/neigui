# Concept Cluster — Spec V0.2(6-industry FinMind probe + 3 adversarial critique sync)

**Date**: 2026-06-30(V0.2 同日 sync,V0.1 → V0.2 經 6 產業 IndustryChain probe + 3 critic verify)
**Scope warning(V0.2 NEW)**: V0.2 所有實證樣本(PCB / 被動元件 / 半導體 / 光通訊 / EV / AI)**皆為「電子科技 / theme-driven concept」**,**未驗** 金融 / 航運 / 水泥 / 食品 / 觀光 / 生技等「single-driver 傳產」。3 位 critic 一致警告:航運三雄(2603/2609/2615)/ 金控四大 / 水泥三雄 在 TW 實證 corr 常駐 ≥ 0.6,直接套用本 V0.2 的 fragmented_basket / business_sanity_gate / 永遠不信 FinMind sub_industry 等規則會**誤殺真實同質訊號**。**spec V0.2 的所有自適應規則,僅限於 technology / theme-driven concept 套用**;傳產 concept 待 P9 補 3-5 個 spike 驗證後決定是否啟用相同規則。
**Type**: /feat(新 mode + 新 backend service + 新前端頁面)
**Goal**: 用半自動 pipeline(外部清單 + 量化驗證 + user 仲裁)建構台股「概念股 / 主題 cluster」系統,**自適應地**處理「異質分層」(PCB-like)與「同質叢」(MLCC-like)兩種 cluster 結構模式。
**SemVer bump**: MINOR(`0.x.0` → `0.(x+1).0`)— 使用者可感的新分析模式
**Pre-reading**:
- 兩輪 deep-research 結論 + 反身性 audit
- `spike-evidence/concept-cluster-spike-pcb.md`(PCB spike,異質分層 case)
- `spike-evidence/concept-cluster-spike-mlcc.md`(MLCC spike,同質叢 case)
- `spike-evidence/pcb_cluster_result.json` / `mlcc_cluster_result.json` / `industry_probe_v2.json`(6 產業 250-day corr matrix)

---

## 0.6 V0.2 修訂摘要(6-industry FinMind probe + adversarial critique sync)

V0.2 基於:
- **Probe**:6 產業 410 unique 股票 41-201 trading day FinMind IndustryChain + 250-day corr matrix
- **6 並行 analyze agent**:每產業評估 sub_industry inner corr / cluster structure / mismatch case
- **3 並行 adversarial critic**:預設 skeptic,1 verdict major_rework / 2 accept_with_caveats

### 6 產業實證對照(用於 V0.2 設計依據)

| 產業 | N | union corr | structure | sub 細分夠? | 需外部補? |
|------|---|----------|----------|----------|----------|
| PCB | 89 | 0.315 | heterogeneous_tiered | ❌(硬板 44 檔擠一桶 0.27)| ✓ |
| Passive | 53 | 0.339 | heterogeneous_tiered | △(8 sub 但 cross-sub 47 strong pair)| ✓ |
| Semiconductor | 89 | 0.271 | heterogeneous_tiered | ❌(IC 設計 n=1、IC 通路 0.23 < universe)| ✓ |
| Optical_Comm | 49 | 0.240 | heterogeneous_tiered | ❌(sub 切法無分群 lift)| ✓ |
| EV | 74 | 0.333 | heterogeneous_tiered | ❌(整車 sub 0.20)| ✓ |
| AI | 58 | 0.205 | **fragmented_basket**(實際)| ❌(11 sub 全 loose,1/1653 strong pair)| ✓ |

→ 6/6 都是 heterogeneous,且 V0.1 的 0.45/0.55 threshold 全落最低檔,**需要再向下擴**。

### V0.2 新增層(採納 synthesis 共識)

| 新需求 | 證據 | 影響 spec § |
|-------|------|-----------|
| **fragmented_basket 結構類型(第 4 種)** | AI 1/1653 strong pair | §1.3 + §5.7 + §5.10 |
| **自適應 threshold 表加 <0.25 bucket** | 6/6 spike 落 0.205-0.339 | §5.7 |
| **cross_industry_pollution flag**(個股出現多 concept universe)| 2308 台達電 in Semi/EV/AI | §5.5 |
| **業務 sanity gate(L1b 後 / L2 前)** | PCB 大同 2371、Semi 禾伸堂 3026 | §5.12(新)|
| **FinMind sub_industry 不直接當 L1b 邊界**(限 tech concept)| 51 sub 中僅 PCB 酚醛樹脂 n=2 達 tight | §5.2 改寫 |
| **集團股 reflexivity flag**(critic 3 missed)| 鴻海系 / 聯電系 / 光寶系 / 台塑系 / 遠東系 多檔內聚 0.7+ | §5.13(新)|
| **KY / ETF / 處置股 / 新興題材無 sub fallback**(critic 1+2 missed)| 凱崴 5498 KY、矽光子 / CPO 無 FinMind tag | §5.14(新)|
| **scope 限定為 tech concept**(critic 1+2+3 共識)| 6 spike 全電子,傳產未驗 | spec 頂部 + §1.3 |
| **P9 傳產 backtest spike** | 同上 | plan 新 P9 |

---

## 0.5 V0.1 修訂摘要(MLCC sync 後新增)

MLCC spike(26 檔 4 篇 narrative)推翻了 V0 「外部清單必不可信 + L1c 必有漏網主流」這個來自 PCB 單一 sample 的過早一般化。新增 4 個需求:

| 新需求 | 證據 | 影響 spec § |
|-------|------|-----------|
| **自適應 corr threshold** | PCB 0.55 切已分層、MLCC 0.65-0.70 才浮現結構 | §5.7 + §1.3 |
| **Source-level quality score** | MLCC ARTICLE_B inner 0.404 << 其他 inner 0.56-0.59,3/9 是 outlier | §5.8 |
| **L1c 二次篩選**(corr 過濾) | MLCC 9905 大華金屬法定屬被動元件但對 narrative top-3 corr 0.18(掛羊頭股)| §5.9 |
| **Cluster 結構類型 label** | PCB 異質分層 / MLCC 同質叢 兩種模式 UI 呈現不同 | §5.10 + §7.5 |

新增 §1.3「兩種 cluster 結構模式」說明 case study,新增 §5.7-5.10 對應實作層。Plan.md 對應修改 P2 / P3,新增 P3.5。

---

## 1. 目標 & 動機

### 1.1 三個用戶痛點(已驗證)

| 痛點 | 證據 |
|------|------|
| **TWSE 法定 industry_category 太粗** | 南電(IC 載板)、欣興(IC 載板)、臻鼎(HDI)、高技(軟板)全歸「電子零組件業」一桶。同利多不會一起拉。 |
| **CMoney narrative basket 不可信** | PCB spike: N1 inner corr 0.397 < N1×N2 cross corr 0.416。Editorial 是 narrative wrapping,不是 coherent cluster。 |
| **主流玩家會被外部清單漏** | PCB spike: 8046 南電被 CMoney 3 個 source 全漏,但 corr 0.751 命中 ABF cluster。 |

### 1.2 解法:五層 pipeline + user 仲裁(V0.1 更新)

```
L1a 外部 narrative 清單(CMoney + Goodinfo)
    → candidate pool
    → 每篇 article 算 inner corr → source quality score(NEW V0.1)

L1b TWSE 法定產業全清單(FinMind industry_category)
    → completeness pool

L1c L1b - L1a set difference
    → 跟 narrative top-3 centrality 算 60-day corr 二次篩選(NEW V0.1)
    → ≥ 0.65: 自動命中(類 PCB 8046 case)
    → 0.35-0.65: 邊緣命中,標 flag(類 MLCC 8163 case)
    → < 0.35: 弱關聯,標「掛羊頭」需 user 確認(類 MLCC 9905 case)

L2  correlation discovery
    → 算 union inner corr → 自適應 cluster threshold(NEW V0.1)
    → 切 connected component
    → 偵測 cluster 結構類型(異質分層 / 同質叢)(NEW V0.1)

L3  outlier + 集團股 flag
    → quality 提醒

L4  user 仲裁(命名 + 補漏 + 排除 outlier + source 仲裁)
    → final cluster
```

**核心顛倒**:外部清單不再決定 cluster 邊界,只當 candidate pool;correlation 才是 discovery 工具。

**V0.1 補強**:外部清單品質、L1c 命中率、cluster 結構類型**因 concept 而異**,pipeline 必須自適應,不能 fixed parameter。

### 1.3 三種 cluster 結構模式(V0.2 已驗證,scope 限 tech concept)

| 維度 | 異質分層(PCB-like) | 同質叢(MLCC-like) | **碎片化籃(AI-like)V0.2 NEW** |
|------|-------------------|-------------------|--------------------------------|
| 業務結構 | 上下游差異 | 同向 driver | 概念敘事拼盤(技術 taxonomy ≠ 市場共振)|
| union inner corr | 0.30-0.45 | ≥ 0.55 | **< 0.25** |
| strong pair / total | 5-15% | > 20% | **< 0.5%** |
| sub 內聚 | 0.30-0.45 | 0.50+ | 全 < 0.35 |
| L1c 命中率 | 高 | 低 | 不適用(L2 失能) |
| Cluster 切分 threshold | 0.55 已分層 | 0.65-0.70 浮現 | **跳過 sub-cluster 切分** |
| Sub-cluster 數 | 3-4 個有意義 | 1 主桶 + outlier | 無有效 sub-cluster |
| UI 呈現 | dendrogram + sub-cluster 命名 | two-tier 主桶 + outlier | **narrative-driven + strong pair only** |
| 案例 | PCB / 被動 / 半導體 / 光通訊 / EV | MLCC、漲價題材 | AI 主題股 |

**V0.2 scope warning(critic 1+2+3 共識)**:本表 6 個 spike 全為「電子科技 / theme-driven」產業 — heterogeneous_tiered 在電子鏈 是常態。**傳產 / 金融 / 航運 / 食品 / 水泥 / 觀光** 預期會落 `homogeneous_cluster`(例:航運三雄 corr 0.85+、金控四大 同步利率敏感、水泥三雄 同期景氣循環),套用 fragmented_basket / business_sanity_gate 等規則會誤判 — V0.2 規則僅限 tech concept 套用,傳產 concept 待 P9 補 spike 驗證。

**待驗模式**:傳產 single-driver(P9)、新興題材無 FinMind sub_industry 對映(矽光子 / CPO / 量子)— 可能還有第 5 種模式。

### 1.3 不解決的問題

- **「該不該買」** — UI 嚴禁方向性文案,只呈現結構訊號(同 PCR / Max Pain panel 慣例)
- **跨概念橋接分析**(例:「PCB + AI 雙概念股」)— scope 太大,留待 V1
- **籌碼共動 cluster** — 另一個 spec(deep-research §4 / spike option C),本 spec 不含
- **LLM 自動命名 sub-cluster** — L4 仍是 user 仲裁手動命名,LLM 只在 narrative ingestion 用

---

## 2. 成功條件(可驗收)

1. 進入新 mode `concept`,看到 ≥ 3 個 active concept(spec 範例 PCB / MLCC / 一個由 user 仲裁建立的)
2. 點 PCB → 看到:
   - **22 ± n 檔成員列表**(L1a + L1c 合併,outlier flag 標出)
   - **Correlation heatmap**(22 x 22 矩陣,顏色 = corr 強度)
   - **自動 sub-cluster 命名建議**(由 strong pair 結構推出 3-4 個 sub-group,user 仲裁命名)
   - **L1c 漏網成員 flag**(例:8046 南電會被列出「法定有但 narrative 漏,corr 0.75 命中 ABF cluster」)
3. User 可在 UI 上:
   - Confirm sub-cluster 名稱(寫入 storage)
   - Add 新成員(手動補,例 1303 南亞)
   - Exclude outlier(例 6141 柏承)
   - Rename concept(例「PCB」→「PCB 載板」)
4. **Reflexivity retire flag**: concept 內部 corr 連續 4 週 < 0.4 → 自動切 watch 狀態,UI 顯示 retire 候選
5. 既有 chip / options mode 行為 100% 不變(pixel-level 一致)
6. 既有 cache 不 invalidate(`_CACHE_VERSION` 不動)
7. 完成前 gate:`pytest -q` + `npm test` + `npm run build` 全綠 + chrome-devtools 截圖驗證 UI

---

## 3. 不能破壞的既有行為(白名單)

| 行為 | 來源 | 驗證 |
|------|------|------|
| Equity mode(個股籌碼)所有 panel 行為 | `App.tsx` equity 分支 | 既有 frontend test 全綠 |
| Options mode 所有 panel | `App.tsx` options 分支 + `OptionsPage.tsx` | 既有 options test 全綠 |
| `App.tsx` mode 切換 ternary 結構(現 equity/options) | `App.tsx:render` | 改 3-way → 4-way ternary,加 `concept`,測試 mode 切換 |
| FinMind `_CACHE_VERSION = N` 不動 | `services/finmind.py` | spec 強調 |
| `_run_once` inflight dedup pattern | `services/finmind.py` | 新 service 沿用同 pattern |
| API error contract `{detail: {error: "<code>"}}` | `routes/*` | 新 endpoint 一律遵守 |
| Bull = 紅 / Bear = 綠 配色 | `index.css @theme` | heatmap 中 high corr 用 ink-accent,不用紅 |

---

## 4. Out of scope(寫進「下次處理」清單)

| 項目 | 為什麼延後 |
|------|----------|
| L1a Playwright scraper for Goodinfo / MoneyDJ | V0 只用 CMoney(cmnews.com.tw 是 static HTML 可直接 httpx) + FinMind industry_category。Goodinfo / MoneyDJ 留 V1 加 |
| 跨 concept 橋接分析(PCB ∩ AI) | 視覺化複雜度高,V0 不上 |
| LLM 自動命名 sub-cluster | L4 user 命名;LLM 留給 narrative ingestion 子任務 |
| Anue 新聞 narrative ingestion + 熱度 EMA | 屬於反身性退潮偵測的「新聞熱度」訊號,V0 用「成員相關性」一個訊號夠;留 V1 加 |
| 籌碼共動 cluster(broker + 法人連續同向) | 另一個 spec(option C 路線),屬獨立分析角度 |
| Live polling | 概念股 cluster 是日頻訊號,EOD refresh 夠 |
| 跨日期回放(看 cluster 隨時間漂移) | V0 只顯示「最近 250 day」snapshot |
| Backtest UI(retire 訊號歷史命中率) | 屬調參工具,V0 不上 |

---

## 5. Pipeline 詳細設計

### 5.1 L1a — 外部 narrative 來源(V0 只用 CMoney)

**資料來源**:`cmnews.com.tw/article/cmoney-*`(static HTML,httpx + BeautifulSoup 直接解)

**ingestion 邏輯**:
- 預定義 concept_id → CMoney 搜尋關鍵字 映射(例 `pcb` → `["PCB 概念股", "PCB 族群"]`)
- 用 Google site:cmnews.com.tw 搜尋,撈近 90 天 article URL list(或 V0 簡化:手動維護 article URL 清單在 yaml)
- 對每篇 article,httpx 抓 HTML,BeautifulSoup parse,regex 找 `\d{4}\s+[一-鿿]+`(股號 + 中文股名)
- **過濾 teaser**:若 article 文本中 `\(\d{2}XX\d\)` 模式比例 > 30% 視為遮股號 teaser,跳過
- 輸出:`{concept_id, sources: [{url, fetched_at, members: [stock_id]}], merged_members: [stock_id]}`

**caveat**(spike 已驗):
- WebFetch 對表格類資料 hallucinate → 不用,改用 BeautifulSoup
- 半年內 URL 失效率高 → fetch 失敗 logger.warning 但不擋 pipeline

### 5.2 L1b — TWSE 法定產業 + FinMind IndustryChain(V0.2 改寫)

**資料來源**:
1. **FinMind `TaiwanStockInfo`** — `industry_category`(32 大類)為「候選 universe 粗篩」
2. **FinMind `TaiwanStockIndustryChain`**(Sponsor 付費,V0.2 NEW 導入)— `(industry, sub_industry)` N-to-M 對映,作為「細分提示 label」**僅供 UI / L4 仲裁參考,不直接當 cluster 邊界**

**V0.2 改寫的理由**(6-spike 證據):
- 51 個 sub_industry 中**僅 PCB 酚醛樹脂(n=2,inner corr 0.715)達 tight**,其餘全 loose/moderate
- 5/6 產業出現「真實高 corr cluster 橫切 FinMind sub」(例:Passive 2428 興勤被 tag 電阻,top1 partner 是 2375 凱美電容 corr 0.779)
- materials sub 系統性內聚不足(Passive 4 個 materials sub 0.21-0.50)— 上下游材料股實際與成品高度連動

**邏輯(V0.2)**:
- 必取 `industry_category`(32 大類)當 universe 粗篩
- 同時取 `sub_industry` 當 UI 標籤 + L4 仲裁參考,**不影響 L2 cluster 切分**
- concept_id → `industry_category` list 映射(yaml,multi-category 支援)
- 對 L1b universe 套用 **業務 sanity gate(§5.12)**
- **集團股 reflexivity flag(§5.13)**:同集團 ≥ 3 檔出現時標
- **KY / ETF / 處置股 / 新興題材 fallback(§5.14)**

**caveat(V0.2 更新)**:
- 32 大類有時粗 — L2 correlation 解這層
- 32 大類有時細而漏 — yaml multi-category 解
- sub_industry 對「真實 cluster 邊界」**無預測力**(6 spike 強證據)— 只作 UI 標籤 + L4 仲裁參考
- **scope warning**:本結論僅在 tech concept(PCB / 被動 / 半導體 / 光通訊 / EV / AI)驗證;傳產 sub_industry 可能 inner corr 更高(critic 1+2+3 共識預期),P9 補驗證後可能放寬「不直接當邊界」rule

### 5.3 L1c — set difference flag

**邏輯**:
```python
l1a_members = set(L1a.merged_members)
l1b_members = set(L1b.members)
missing_from_narrative = l1b_members - l1a_members
```

**輸出**:每個 missing 成員附「在 L1b 但不在 L1a」flag,UI 上特別標出,提醒 user 仲裁。

**目的**: PCB spike 證明 narrative 會漏 8046 南電(法定 PCB 內、被三個 source 漏)— 這層自動 catch。

### 5.4 L2 — correlation discovery

**Universe**:`L1a ∪ L1b ∪ user_added`(去重)

**資料**:FinMind `TaiwanStockPrice` 抓 250 trading day daily close → log return

**Correlation**:
- Pearson(V0)
- **HRP distance**:`d(i,j) = sqrt(0.5 * (1 - rho(i,j)))`(spike 結論建議,避免 raw `1 - rho` 的 chain effect)
- **Partial correlation**(V0.5):控制 TWSE 加權指數(0050)beta — 拿掉市場 beta 後 corr 結構更乾淨。V0 先用 raw Pearson 上線,V0.5 補 partial。

**Clustering**:
- Average-linkage hierarchical clustering on distance matrix
- 切法:`corr > 0.55` connected component → sub-cluster groups(spike 顯示 threshold 比 fixed k 直覺)
- 每個 sub-cluster 至少 2 檔(單檔自成一群 = outlier 候選,進 L3)

**Strong pair**(>0.65):列為「sub-cluster 種子對」,UI 用粗線連接視覺強調。

### 5.5 L3 — outlier + 集團股 flag(+ V0.2 cross_industry_pollution)

**Outlier rule**(自動):
- 該股 vs union 平均 corr < 0.3 → `outlier_low_corr`
- 該股不屬於任何 sub-cluster(corr > 0.55 connected component 落單)→ `outlier_isolated`

**集團股 rule**(自動):
- 股票 market_cap > 5000 億 → `large_cap_warning`(corr 會被多業務稀釋,例 1303 南亞)
- 屬於多個 concept(出現在 ≥ 3 個其他 concept 的 union) → `cross_concept_warning`

**Cross-industry pollution rule(V0.2 NEW)**:
- 該股同時出現在 **≥ 2 個其他 concept 的 L1b universe** → `cross_industry_pollution`
- 證據:2308 台達電 同時在 Semi(IC 通路)/ EV / AI 三個 universe;2317 鴻海 在 EV / AI;2330 台積電 在 Semi /可能 AI 伺服器
- 跟 `cross_concept_warning`(≥ 3 個)區別:cross_industry_pollution 對 ≥ 2 個更寬鬆,因為 V0.2 證據顯示 platform 股 2 個 universe 就已是污染來源
- UI 處理:flag chip + hover tooltip 列出哪些 concept;sub-cluster 命名時 lower weight(避免大型 platform 股主導命名)

**UI 處理**:不自動排除,只標 flag,user 仲裁時可見 reason。

### 5.7 自適應 corr threshold(V0.2 表向下擴)

**6-spike 證據**:6 個產業全落 0.205-0.339,V0.1 表全部落最低檔,需再向下擴一行給 fragmented_basket。

**邏輯**:用 `union inner corr` 反推 threshold:

| union inner corr | 推測模式 | subcluster_threshold | strong_pair_threshold |
|----------------|---------|---------------------|----------------------|
| **< 0.25(V0.2 NEW)** | **fragmented_basket** | **跳過 sub-cluster** | **0.55**(僅標 strong pair) |
| 0.25 ≤ x < 0.45 | 異質分層 | 0.55 | 0.65 |
| 0.45 ≤ x < 0.55 | 中度同質 | 0.65 | 0.72 |
| ≥ 0.55 | 高度同質 | 0.70 | 0.78 |

UI 上明示「此 concept 結構同質,sub-cluster 切分結果可能無實質意義」(警告 user 不要過度解讀)。

**critic 2 caveat**:V0.2 中間區段 [0.45, 0.55) 中度同質 bucket 仍**無 spike 樣本** — 只有 PCB 0.31 + MLCC 0.65 各代表頭尾。Production 校準時要注意中段 threshold 是 V0.1 拍腦袋值。

### 5.8 Source-level quality score(V0.1 NEW)

**MLCC spike 證據**:ARTICLE_B inner 0.404 << 其他 inner 0.56-0.59,該 source 獨有 3 檔(3363 上詮、4989 榮科、6204 艾華)全是 outlier。

**邏輯**:
- 每篇 narrative article(L1a source)計算 inner corr(用 L2 算好的 matrix)
- 跨同一 concept 的多 source 比較 inner corr,**低於 25 百分位**標 `quality: low`
- 該 source **獨有**(不在其他 source 中)的成員 → 進 user 仲裁佇列,UI 標「來源品質較低,可能含跨產業誤列」
- **不 hard-cut**(避免懲罰 emerging cluster narrative),只是「降權 + 標記」

**例外處理**:若 concept 只有 1 個 source(無比較基準)→ skip quality score,所有成員照常進。

### 5.9 L1c 二次篩選(V0.1 NEW)

**MLCC spike 證據**:9905 大華金屬法定屬「電子零組件業」但對 MLCC narrative top-3(2327 國巨 / 2492 華新科 / 2375 凱美)的 60-day corr 僅 0.18 — **掛羊頭股**,純 industry_category set difference 會誤入。

**邏輯**:
- L1c 候選成員 = L1b - L1a
- 對每個候選,跟 L1a narrative basket 內「centrality 最高的 3 檔」(strong pair 出現次數最多的)算 60-day Pearson corr,取平均
- 分三檔:
  - `avg_corr ≥ 0.65` → `l1c_strong_hit`(類 PCB 8046 case),自動加入 cluster
  - `0.35 ≤ avg_corr < 0.65` → `l1c_edge_hit`(類 MLCC 8163 case),flag 標出讓 user 確認
  - `avg_corr < 0.35` → `l1c_weak_hit`(類 MLCC 9905 case),預設 exclude,user 可手動 add

UI 上把 `l1c_strong_hit` 跟 `l1c_weak_hit` 分區呈現,user 看一眼就知道「漏網主流」vs「掛羊頭」。

### 5.6 → 移到 §5.11(因 V0.1 補強層插入)— 跳到下方查 user 仲裁 + storage

### 5.10 Cluster 結構類型自動 label(V0.2 加 fragmented_basket)

**6 spike 證據**:V0.1 PCB(異質)+ MLCC(同質)+ V0.2 AI(碎片化籃,1/1653 strong pair)= 4 種模式。

**邏輯**(L2 output 的一部分):
```python
def detect_cluster_type(
    sub_clusters: list[set[str]],
    union_inner_corr: float,
    strong_pair_count: int,    # V0.2 NEW
    total_pair_count: int,     # V0.2 NEW
    universe_size: int,        # V0.2 NEW(for n-invariant threshold)
) -> ClusterStructureType:
    # V0.2 NEW: fragmented_basket(AI-like)
    # critic 2 raised: strong_pair_count / total_pair_count 太 n-dependent,
    # 改用 n-invariant 形式 — strong_pair_count ≤ universe_size * 0.05(每股最多平均 0.05 個 strong pair)
    if (
        union_inner_corr < 0.25
        and strong_pair_count <= max(2, universe_size * 0.05)
    ):
        return "fragmented_basket"

    largest = max(len(c) for c in sub_clusters)
    total = sum(len(c) for c in sub_clusters)
    if largest / total > 0.7 and union_inner_corr > 0.5:
        return "homogeneous_cluster"
    if len([c for c in sub_clusters if len(c) >= 2]) >= 3:
        return "heterogeneous_tiered"
    return "transitional"
```

UI 對應(V0.2 加 fragmented_basket):
- `heterogeneous_tiered`:dendrogram + sub-cluster 命名(PCB / EV 案例)
- `homogeneous_cluster`:two-tier 主桶 + outlier + 同質性 banner(MLCC 案例;**critic 預期傳產也屬此類**)
- `fragmented_basket`(V0.2 NEW):**隱藏 dendrogram + sub-cluster 介面**,只顯示「概念敘事拼盤」banner +「strong pair only」table(corr > 0.55 的 pair)+ 整體 corr heatmap **不顯示**(避免暗示有結構)(AI 案例)
- `transitional`:兩種視覺都給,user toggle

### 5.12 業務 sanity gate(V0.2 NEW,L1b 後 / L2 前)

**6 spike 證據**:~30% 業務 mismatch — Semi 2371 大同 / 3026 禾伸堂、EV 2352 佳世達、PCB 凱崴 5498。純信 `industry_category` 會把這些股拉進 L1b 污染 corr matrix。

**邏輯**:
- 對每個 L1b 候選成員,查 `TaiwanStockInfo.stock_name` + 公司簡介(可用 FinMind `TaiwanStockOtherInfo` 或 yaml 維護)
- 若不含 concept 對應 seed_keyword(yaml,例 pcb: [PCB, 印刷電路板, 載板, 軟板, 銅箔基板])→ 標 `business_off_concept` flag
- **不 hard-cut**,進 L4 user 仲裁;UI 預設 collapse「業務疑似不符」段落
- 額外:yaml `business_sanity_exclusions: [stock_id]` 黑名單欄位,user 手動補(例 pcb 排除 2371 大同)

**對比 L1c weak_hit**:
- `l1c_weak_hit` = 業務符合 + corr 低(掛羊頭股,例 9905 大華案例)
- `business_off_concept` = 業務不符(無論 corr 高低)
- 兩個 flag 可共存,UI 分區呈現

**黑名單腐敗風險**(critic 2 raised):
- 公司 spinoff / 併購 / 轉型會讓黑名單過期
- V0.2 暫不解,留 V1 加 `effective_date` + 定期 LLM re-audit
- spec §11.8 標已知問題

### 5.13 集團股 reflexivity flag(V0.2 NEW,critic 3 missed)

**證據**:鴻海系(2317/2354/2392/3481/3508/6121/8076)/ 聯電系(2303/3014/3035/4961)/ 光寶系(2301/2451/3593)/ 台塑系(1301/1303/1326/2408/6505)/ 遠東系(1402/2903/4904/9904)等**同集團多檔股票** corr 常 0.7+,但非業務 cluster,是 **NAV / 主力持股 / 分紅政策 reflexivity 共振**。

純 §5.5 cross_industry_pollution 抓不到(每檔在單一 concept 但全集團一起)。

**邏輯**:
- 維護集團 → 成員 mapping yaml(`backend/data/group_constituents.yaml`,人工 + 公開資料維護)
- 若 concept universe 內 ≥ 3 檔屬同一集團 → 標 `group_reflexivity_warning`
- UI sub-cluster 命名時降權集團內成員(避免「鴻海 PCB 鏈」這種誤命名)
- 不 hard-cut

**實務影響**:PCB universe 中鴻海系 5 檔(3508/8076 等)會自成「假高內聚 sub-cluster」,加 flag 後 user 仲裁時可選擇「忽略集團共振、看真實業務」。

### 5.14 KY / ETF / 處置股 / 新興題材無 sub_industry fallback(V0.2 NEW,critic 1+2 missed)

| Case | 處理 |
|------|------|
| **KY 股 / 第二上市 ADR**(凱崴 5498 / 精星 8183 / 臻鼎-KY 4958)| 加 `ky_listing` flag,UI hover 提示「跨市場 listing,corr 受台股時段以外的母國資訊影響」。不 hard-cut。集團 reflexivity rule 同樣套(KY 集團如鴻海集團 KY) |
| **ETF / REITs / 期信**(prefix `00`、特殊 stock_id 範圍)| **預設排除**(spec §5.3 L1c 已 filter,§5.2 L1b 也須 filter)— ETF 與成份股天然強 corr,會 inflate inner corr 誤判 homogeneous_cluster |
| **處置股 / 全額交割 / 暫停交易** | 從 FinMind `TaiwanStockTradingDate` 或 TWSE 公告抓處置期 + 解禁日,corr 計算時 mask 該股 in_disposition 區間(視為 missing day)。**spec V0.2 標記為 known gap,V1 補實作** |
| **新興題材無 FinMind sub_industry**(矽光子 / CPO / 量子 / 低軌衛星 / SiC / 機器人 / AI Agent)| L1b lookup 直接 empty → L1a narrative basket + user 手動指定 industry_category list(yaml `concept_categories.yaml.X.fallback_no_sub: true`)→ L2 直接跑(跳過 sub_industry tag 邏輯)— **不阻擋 concept 上線**,只是少了 sub label |
| **被併購下市股**(2456 奇力新 → 2327 國巨)| FinMind `TaiwanStockPrice` 回 rows < min_threshold → 自動 skip(P1 已實作),caveat:仍可能在 chain stale tag |

### 5.11 L4 — user 仲裁 + storage(原 §5.6)

**Storage**:`backend/data/concept_clusters/<concept_id>.json`(filesystem,無 DB,專案慣例)

**Schema**:
```jsonc
{
  "concept_id": "pcb",
  "display_name": "PCB",
  "version": 1,
  "created_at": "2026-06-30",
  "last_review_at": "2026-06-30",
  "lifecycle_status": "active",  // active | watch | retired
  "members": [
    {
      "stock_id": "3037",
      "stock_name": "欣興",
      "action": "auto",  // auto (from L1a/L1b) | user_added | user_excluded
      "sub_cluster_id": "abf_substrate",
      "from_sources": ["CMoney_N1", "TWSE_PCB"],
      "flags": []
    },
    {
      "stock_id": "8046",
      "stock_name": "南電",
      "action": "auto",
      "sub_cluster_id": "abf_substrate",
      "from_sources": ["TWSE_PCB"],
      "flags": ["missing_from_narrative"]
    },
    {
      "stock_id": "6141",
      "stock_name": "柏承",
      "action": "user_excluded",
      "from_sources": ["CMoney_N1"],
      "flags": ["outlier_low_corr"]
    }
  ],
  "sub_clusters": [
    {
      "id": "abf_substrate",
      "display_name": "ABF 載板",
      "named_by_user": true,
      "auto_suggested_name": "Sub-cluster A (3037, 3189, 4958, 8046)"
    }
  ]
}
```

**Endpoints**:
- `GET /api/concepts` — list 全部 concept(id, display_name, lifecycle_status, member_count)
- `GET /api/concepts/{id}` — 完整 detail(成員 + sub-cluster + corr matrix + flag)
- `POST /api/concepts/{id}/arbitrate` — body `{action: confirm_subcluster|add_member|exclude_member|rename, ...}`
- `POST /api/concepts/{id}/refresh` — 強制重跑 L1a/L1b/L1c/L2/L3
- `GET /api/concepts/_outlier_review` — 全 concept 的 outlier flag 集合,讓 user 一次 review

---

## 6. Reflexivity retire detector

**規則(V0 簡化)**:
- 該 concept 內 sub-cluster 的「strong pair」平均 corr 連續 4 週週末 EOD calculate < 0.4 → 切 `watch`
- 進入 `watch` 後再連續 2 週 < 0.35 → 切 `retired`(UI 不顯示,但 storage 保留)
- User 可手動 revive(覆蓋自動 retire)

**caveat**:閾值 0.4 / 0.35 無 backtest 校準,V0 上線後依航運 2021 / 生技 2020 / 元宇宙 2022 退潮歷史 backtest 調整。

**V1 升級**(out of scope):加 Anue 新聞熱度 EMA、龍頭股 turnover 兩個訊號做 multi-signal retire detector。

---

## 7. Frontend 設計

### 7.1 加第 3 個 mode

**`App.tsx` 改動**:
- mode state 從 `"equity" | "options"` 擴成 `"equity" | "options" | "concept"`
- 注意:**目前是 ternary,加第 3 mode 必須改成 multi-way switch**,不要混用 `hidden` attribute(會雙頁面同時 mount,撞既有 chip data fetching)
- Mode switcher UI 加第 3 顆按鈕「族群」

### 7.2 Concept mode 三欄佈局

```
+---------------------+--------------------------------+----------------+
| 左欄 族群列表        | 中央 cluster 視覺化              | 右欄 成員 + 仲裁  |
| (active/watch tab)  | - dendrogram (top)             | - 成員列表        |
|                     | - correlation heatmap (mid)    | - outlier flag    |
| PCB         active  | - sub-cluster 命名建議 (bot)    | - L1c flag       |
| MLCC        active  |                                | - 仲裁按鈕        |
| AI          watch   |                                |                  |
| Metaverse   retired |                                |                  |
+---------------------+--------------------------------+----------------+
```

### 7.3 視覺 token 約束(沿用既有)

- 用 semantic tokens(`text-ink`、`bg-bg`、`border-line`)
- heatmap 高 corr 用 `text-ink-accent`(避開 bull/bear 紅綠)
- outlier flag 用 `text-ink-muted` + warning icon

### 7.4 UI 文字嚴禁方向性(反身性 audit 強制)

- 不出現「買進 / 賣出 / 滿倉 / 強勢輪入」
- 只出現「相關性高 / 強度上升 / 漏網 / 集團股注意」
- 元件測試鎖:`expect(screen.queryByText(/買進|賣出|滿倉|強勢輪入/)).toBeNull()`

---

## 8. 不能破壞 + Migration

- 無資料庫,storage 是新 dir `backend/data/concept_clusters/`,既有不受影響
- 無 cache version bump
- 既有 `App.tsx` mode ternary 改 multi-way 是 invasive 改動 → 必須加 mode 切換 test 鎖

---

## 9. 風險 & 開放問題

### 9.1 已知風險

| 風險 | 緩解 |
|------|------|
| L1a CMoney article URL 半年內失效率高 | 維護 fail-soft,單篇失敗 logger.warning,不擋 pipeline |
| L1b FinMind industry_category 不夠細(electronics catch-all) | concept_id → multi-category 映射在 yaml,user 可修 |
| L2 250 day x N stock 矩陣計算成本 | concept-level cache + 週末 EOD 一次計算,UI 讀 cache 不重算 |
| L3 outlier 閾值無 ground truth | V0 用 0.3 / 0.55 / 0.65 三個 hyperparameter,後期 backtest 調 |
| Reflexivity retire 閾值 0.4/0.35 純拍腦袋 | spec 明確標 V0 待 backtest 校準 |
| Frontend `App.tsx` ternary → multi-way 改動 invasive | 加 mode 切換 unit test 鎖,避免雙頁面 mount race |

### 9.2 開放問題(MLCC spike 已 sync,以下為剩餘 open question)

✓ **已回答**(MLCC spike,寫入 §1.3 / §5.7-5.10):
- MLCC sub-cluster 結構 ≠ PCB → 是「同質叢」(1 主桶 + outlier),不是「異質分層」
- L1c set difference 在 MLCC 上**價值有限** → 8163 達方邊緣命中、9905 大華完全脫鈎,因 narrative 已蓋頭部
- MLCC narrative basket **大部分 inner > cross**,僅 ARTICLE_B(品質差 source)inner < cross

→ 結論:**PCB「外部清單不可信」結論不能一般化**,V0.1 加自適應 threshold + source quality 處理兩種模式

✗ **未回答**(下一輪 spike 或 production 後 backtest 校準):
- 結構性主流 narrative(AI server / 矽光子 / CPO)是否還有第三種 cluster 結構模式?
- 防禦型 narrative(高息 ETF / 軍工 / 重電)的 cluster 結構為何?
- 自適應 threshold 的 union inner corr 分檔(0.45 / 0.55)只用 2 sample 拍腦袋,production 上線後需依 4-5 個 concept 結果校準
- Source quality score 的 25 百分位閾值同上,需 4+ concept 樣本後校準
- L1c 二次篩選的 0.35 / 0.65 兩個閾值同上
- Retire detector 閾值 0.4/0.35 仍待航運/生技/元宇宙退潮歷史 backtest

---

## 10. SemVer & Changelog

- 屬於使用者可感的新分析模式 → MINOR bump
- 例:目前 `0.18.x` → 完成後 `0.19.0`
- changelog 條目應寫(user-facing 語言,per CLAUDE.md §7):
  - kind: `feature`
  - scope: `global`(因加新 mode)
  - text:「新增族群分析模式,可自動找出概念股的 sub-cluster + 標出可能漏網的成員」

---

## 11. 反身性 self-audit(本 spec,V0.2 更新)

1. ~~**「外部清單必漏」假設只在 1 sample (PCB) 驗證**~~ → V0.1 sync MLCC 後**部分推翻**;V0.2 sync 6 spike 再強化「不可一般化」
2. **Production pipeline 預設 user 會用** — 若 user 不仲裁,cluster 永遠是 auto-suggest 狀態,品質受 corr 演算法限制
3. **Retire detector 會 false-positive** — 大盤系統性下跌時所有 cluster corr 都掉,可能誤殺長期有效 concept。需加「market regime 過濾」(若大盤同期跌,不退潮)
4. **Spec 本身的反身性** — V0.2 已用 6 產業 250-day 驗證部分,但仍 sample 不夠;Production 跑全 universe 後 corr 分布可能不同 → P2 完成後第一件事是 backtest verify spec 假設
5. **自適應 threshold / source quality / L1c 二次篩選的閾值仍拍腦袋** — 6 spike 全落 [0.205, 0.339],中段 [0.45, 0.55) 中度同質 bucket 無 sample 校準
6. ~~**「同質叢 vs 異質分層」二分法可能 sample bias**~~ → V0.2 已加 fragmented_basket(AI 案例)為第 3 種,但仍可能還有第 4 種(傳產 single-driver 未驗)
7. **V0.2 spec scope 偏電子鏈**(critic 1+2+3 共識) — 6/6 spike 是 tech / theme-driven;傳產(金融 / 航運 / 食品 / 水泥 / 觀光)未驗,套 fragmented_basket / business_sanity_gate 可能誤殺;**P9 必跑**
8. **fragmented_basket detector(§5.10)V0.2 已從 raw ratio 1/1653 改 n-invariant `≤ universe_size * 0.05`** — 但 0.05 仍拍腦袋,n=500 與 n=50 是否同樣 robust 待驗(critic 2 raised)
9. **business_sanity_exclusions 黑名單腐敗** — 公司 spinoff / 併購 / 轉型會讓黑名單過期(critic 2 raised);V0.2 沒設 `effective_date` 或 LLM re-audit,留 V1
10. **集團股 reflexivity flag 維護**(critic 3 raised) — 集團 → 成員 mapping yaml 人工維護,集團重組 / spinoff / 分割上市會讓 mapping 過期;LLM auto-suggest 留 V1
11. **新興題材無 FinMind sub_industry 對映**(critic 1+2 raised) — 矽光子 / CPO / 量子 / 低軌衛星 / SiC 等 V0.2 §5.14 給 fallback(L1a + 手動 category)但未自動 detect

---

## 12. Revision History

- **V0**(2026-06-30 早) — 基於 PCB single-sample spike 寫成,4 層 pipeline(L1a/b/c/2/3 + L4 仲裁)
- **V0.1**(2026-06-30 晚) — MLCC spike sync 後,加 4 個自適應層(§5.7-5.10),修訂 §1.2 pipeline 圖、新增 §1.3 兩種 cluster 結構模式
- **V0.2**(2026-06-30 同晚) — 6-industry FinMind IndustryChain probe + 3 adversarial critique sync。新增 §0.6 修訂摘要、§5.12 業務 sanity gate、§5.13 集團股 reflexivity flag、§5.14 KY/ETF/處置股/新興題材 fallback;§1.3 升 3 種 cluster 結構含 fragmented_basket;§5.7 表向下擴 <0.25 bucket;§5.10 加 n-invariant fragmented detector;§5.5 加 cross_industry_pollution rule;§5.2 改寫(FinMind sub_industry 不直接當邊界);頂部加 scope warning(限 tech concept);self-audit 加 5-11 條;plan 新 P9 傳產 backtest

---

## 12. 下一步

→ 看 `plan.md` 的 phase 拆分。
