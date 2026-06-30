# L1 Spike Report — PCB 概念股 cluster 可行性

**日期**: 2026-06-30
**Scope**: 用最少資源實證「半自動 concept cluster pipeline」假設
**Status**: 完成,結論顛覆原 pipeline 設計

---

## 0. TL;DR

1. **用 CMoney 三個資料源組出 20 檔 PCB 相關股票 union(4 個月 81 trading day)**。
2. **CMoney narrative basket 內部相關性 (0.397) 比 cross-basket (0.416) 還低** — 證明 CMoney editorial 不是 coherent cluster,只是 narrative-driven 標題包裝。
3. **真實的 sub-cluster 必須用 strong correlation pair (>0.65) 找,不是用外部清單**。Spike 浮現三組:
   - **ABF 載板雙雄**(3037 欣興 ↔ 3189 景碩 corr 0.78)
   - **傳統 PCB 製造**(2313 華通 ↔ 2367 燿華 corr 0.75)
   - **玻纖布 ↔ CCL ↔ PCB 製造 三角**(1802/1815 ↔ 2383/6274 ↔ 2368)
4. **原 pipeline 設計需要顛倒**:外部清單只能當 "candidate pool",**correlation 才是 cluster discovery 工具**,user 仲裁負責「給 sub-cluster 命名 + 移除 outlier」。
5. Goodinfo 因 JS-rendered + browser 工具不通未抓到;MoneyDJ WebFetch 結果有 hallucination,本輪剔除。

---

## 1. 資料取得實況

| 來源 | 狀態 | 取得內容 |
|------|------|---------|
| **MoneyDJ** 同業股價 a=C023120 | ✗ WebFetch hallucinate(光磊出現 4 次不同股號)| 不採用 |
| **Goodinfo** 印刷電路板/車用PCB | ✗ JS-rendered,chrome-devtools(profile lock)+ claude-in-chrome(extension 未連)都失敗 | 不採用 |
| **CMoney 4 篇 article**(cmnews.com.tw)| △ 2 篇完整(9+8 檔),2 篇 teaser 遮股號(3XX9)| 採用完整的 2 篇 |
| **CMoney 概念股板 C50851** | △ 顯示 8/41 檔,要按「查看其他 33 檔」展開 | 採用可見的 3 個新成員 |

**淨取得**: 20 檔 union(來自 3 個 CMoney sub-source)

**反思**: 原計畫「三家來源橫向比對」未達成。外部資料源取得成本比研究結論預估高得多 —
- 動態頁面普遍(Goodinfo)
- WebFetch 對表格類資料有 hallucination 風險(MoneyDJ)
- 編輯型 article 會 teaser 遮代號(CMoney 部分)

→ **production pipeline 必須有 robust browser scraper(Playwright)+ HTML pattern 而非 LLM 解讀**,不能靠 WebFetch。

---

## 2. 三個 CMoney sub-source 內容

### N1 — "PCB族群再度點火,9檔逆勢上攻"(HDI/載板 narrative)
2429 銘旺科 / 4958 臻鼎-KY / 2316 楠梓電 / 3189 景碩 / 3715 定穎投控 / 3037 欣興 / 2313 華通 / 6141 柏承 / 2455 全新

### N2 — "外資喊多PCB族群,8檔全面上攻"(CCL/玻纖/材料 narrative)
2368 金像電 / 1802 台玻 / 1815 富喬 / 6274 台燿 / 6213 聯茂 / 2383 台光電 / 8021 尖點 / 3167 大量

### C50851 — PCB 概念股板可見成員(3 檔新成員,其餘已在 N1/N2)
2355 敬鵬 / 2367 燿華 / 3044 健鼎

**Source overlap**: N1 ∩ N2 = ∅;N1 ∩ C50851 = ∅;N2 ∩ C50851 = ∅。三來源**完全互補無重疊**。

---

## 3. 量化結果

### 3.1 narrative basket 內部 vs 跨 basket 相關性(KEY FINDING)

```
N1 inner (9 檔)平均 corr: 0.397
N2 inner (8 檔)平均 corr: 0.472
N1 × N2 cross 平均 corr:  0.416
```

**反直覺結論**: N1 內部 (0.397) **比 N1 跟 N2 之間 (0.416) 還低**。
→ CMoney「9 檔受惠」basket 是 narrative wrapping,不是真實 cluster。
→ "外部清單作為 cluster 邊界" 的假設**被否定**。

### 3.2 strong pair(corr > 0.65)— 真實 sub-cluster 浮現

| corr | pair | sub-cluster 解讀 |
|------|------|----------------|
| 0.780 | 3037 欣興 ↔ 3189 景碩 | **ABF 載板雙雄** |
| 0.746 | 2313 華通 ↔ 2367 燿華 | **傳統 PCB 製造** |
| 0.719 | 1802 台玻 ↔ 1815 富喬 | **玻纖布上游** |
| 0.698 | 3037 欣興 ↔ 4958 臻鼎-KY | **載板 / HDI 群** |
| 0.682 | 2383 台光電 ↔ 6274 台燿 | **CCL 雙雄** |
| 0.677 | 2368 金像電 ↔ 2383 台光電 | CCL → PCB 製造傳遞 |
| 0.665 | 1815 富喬 ↔ 3715 定穎投控 | **跨 narrative 的橋** |
| 0.661 | 3044 健鼎 ↔ 6274 台燿 | CCL → PCB 製造 |
| 0.659 | 2368 金像電 ↔ 6274 台燿 | CCL → PCB 製造 |

合併出 3 個 sub-cluster + 1 個材料 chain:
- **A. ABF 載板**:3037 / 3189 / 4958
- **B. 一般 PCB 製造**:2313 / 2367 / 2355(2355 跟 2313 corr 0.504、跟 2367 corr 0.495,邊緣 member)
- **C. 上游材料 + CCL 化學鏈**:1802 / 1815 / 2383 / 6274 / 2368 / 3044 / 6213(daisy chain,corr 0.5-0.72)
- **outlier**:6141 柏承(所有對 corr ≤ 0.42)、2429 銘旺科(所有對 corr ≤ 0.46)、8021 尖點、3167 大量、2455 全新

### 3.3 hierarchical clustering(average-linkage)

```
k=4 切分:
  cluster 0: 2429 銘旺科                       ← outlier
  cluster 1: 6141 柏承                         ← outlier
  cluster 2: 2313 華通 / 2355 敬鵬 / 2367 燿華   ← 一般 PCB 製造
  cluster 3: 其餘 15 檔                        ← 主桶(載板 + CCL + 部分製造)
```

**Average-linkage k=5 加切一檔 3167 大量自成一群**;切到 k=8 才能把主桶分出「載板」vs 「CCL/玻纖」。

→ **raw Pearson correlation 在台股 ~4 個月 daily return 上區辨力不足**:全產業普遍 corr > 0.4(市場 beta 主導),只有最強 pair (>0.65) 才能切出可解讀的 sub-cluster。

### 3.4 outlier 浮現

| 股票 | 平均 corr vs union | 可能原因 |
|------|------------------|---------|
| 6141 柏承 | 0.30 | 多元複合板廠,跟 PCB 主流 narrative 脫節 |
| 2429 銘旺科 | 0.32 | 小型 PCB,近期可能個股事件主導 |
| 8021 尖點 | 0.37 | 鑽針耗材,周期跟 PCB 製造廠不同步 |
| 3167 大量 | 0.34 | PCB 設備,看資本支出 cycle |
| 2455 全新 | 0.38 | 砷化鎵晶粒,實際屬半導體 |

→ **被 CMoney 標進「PCB 概念」但相關性顯示「不是」**。production pipeline 需要 outlier flag 提醒 user 仲裁。

---

## 4. 反身性 audit(對 spike 自身)

### A. Spike scope 預期 vs 實際
- 預期:三家 LIST source 對比 + correlation 驗證
- 實際:只有 1 家(CMoney)資料可用;correlation 結果**顛覆**原本「外部清單作 cluster 邊界」假設

### B. CMoney narrative basket 反身性
- N1 用「外資 / 主力進場」當 narrative 把 9 檔包裝成 article → 散戶讀完買 → 部分股票同步上漲 → 看起來像 cluster
- 但 spike data 顯示這個 "narrative-induced sync" 強度 (0.397) 還不如 N1xN2 cross (0.416)
- → **CMoney editorial 是「行銷話術」非「真實 cluster」**,在 dashboard 引用前必須先用 correlation 過濾

### C. 「4 個月 81 trading day」樣本反身性
- 短期 daily return correlation 受 market beta + 同產業 beta 主導,普遍偏高
- 真正想抓「概念股」差異化動能,需要 longer lookback(250 trading day)+ partial correlation 控制 TWSE 加權指數 beta + 同 industry_category beta
- → 本 spike 的 raw corr 數字會 overstate 同步度

### D. 用 PCB 當 test case 反身性
- PCB 是「AI 受惠」主流 narrative,2026 上半年全產業同向漲 → 普遍 corr 高
- 若換到 「重電 / 軍工 / 矽光子」這種更小眾、leader-follower 結構明顯的 narrative,可能 corr 結構更清晰
- → spike 結論可能 PCB-specific,不可一般化

---

## 5. 對原 pipeline 設計的修正(KEY)

### 原設計(deep-research 結論)
```
L1 外部清單 (MoneyDJ + CMoney + Goodinfo) → 定 cluster 邊界
L2 correlation → 驗證該邊界內成員相關性是否一致
L3 LLM narrative ingestion → 追熱度
```

### Spike 後的修正設計
```
L1 外部清單(CMoney narrative + Goodinfo TWSE 法定) → 只當 candidate pool(寬鬆)
L2 correlation discovery → 用 strong pair (>0.65) + Ward clustering 找真實 sub-cluster
L3 outlier flag → 自動標出「在 L1 清單但 L2 相關性低於閾值」的股票
L4 user 仲裁 → 給 sub-cluster 命名 + 確認 outlier 是否該留
```

**關鍵差異**:
1. **L1 不再決定 cluster 邊界**,只蒐集 candidate
2. **L2 從 "驗證" 改 "discovery"**,因為外部清單不可信
3. **新增 L3 outlier flag** — 這是 spike 才暴露的需求
4. **User 仲裁的工作從 "確認清單" 改 "命名 sub-cluster"** — labour 更輕(因為 cluster 已從 corr 浮現)

### Production 必要的演算法升級
- **distance metric**: 用 HRP 風格 `d = sqrt(0.5 * (1 - rho))` 取代 raw `1 - rho`
- **linkage**: 用 average 或 Ward,絕不 single(chain effect)
- **lookback**: 250 trading day(1 年)而非 spike 的 4 個月
- **partial correlation**: 至少控制 TWSE 加權指數 beta,理想再加 industry_category beta
- **threshold cut**: 不用 fixed k=N,用 corr threshold(初步試 0.55-0.65)動態切

---

## 6. 取得問題的工程結論

| 問題 | spike 觀察 | production 對策 |
|------|----------|----------------|
| WebFetch hallucinate 表格 | MoneyDJ 光磊出現 4 次 | scraper 用 BeautifulSoup + 直接 HTML pattern,不用 LLM 解讀 |
| Goodinfo JS-render | WebFetch 看到「載入中」 | Playwright headless,等 DOM ready |
| CMoney article teaser 遮股號 | 4 篇中 2 篇遮 | 只爬「完整列表型」article,過濾 teaser |
| 概念股板分頁展開 | C50851 顯示 8/41 | scraper 必須處理「查看其他」展開 |
| Chrome MCP profile lock | dev profile 撞 lock | 給 scraper 獨立 user-data-dir |

---

## 7.5 User-arbitration case study(2026-06-30 補測)

User 在 review spike report 後指出「ABF 還有南電 (8046)、玻纖布還有南亞 (1303)」— 直接補入 universe(22 檔)重算:

### 8046 南電(ABF 載板第四檔)
- 8046 ↔ 3037 欣興: **0.751** ← 新 strong pair
- 8046 ↔ 4958 臻鼎-KY: **0.655** ← 新 strong pair
- 8046 ↔ 3189 景碩: 0.594
- top 5 corr 全是 PCB 載板/CCL 群,avg 0.406
- → **ABF 載板真實 cluster 為 3037 + 3189 + 4958 + 8046 四檔**

### 1303 南亞(玻纖布大廠,台塑集團)
- 1303 ↔ 1802 台玻: **0.652** ← 新 strong pair
- 1303 ↔ 1815 富喬: 0.573
- 1303 ↔ CCL 群: 0.31-0.48(意外偏低)
- avg corr to union: 0.380
- → 跟「純玻纖布廠」對,跟 CCL 反而低 — 因南亞跨環氧樹脂 / 塑膠加工多業務,**一檔股 = 多 cluster ownership,corr 被稀釋**

### 對 spike 結論的補強

1. **「外部清單不可信」升級** — 不只 narrative basket 內部 corr 低,而是**主流玩家被漏**(8046 一補立刻命中 0.751)
2. **user 仲裁 ≠ outlier 過濾** — 還必須**補入漏失成員**,domain knowledge 不可替代
3. **大型集團股需特別標註**(南亞 / 鴻海 / 台塑集團) — corr 偏弱 ≠ 不屬於該 cluster
4. **production pipeline 必須對照 TWSE 法定產業全清單** — 拿 narrative basket 跟法定分類做 set difference,自動 surface 「法定有但 narrative 漏」的潛在 member 讓 user 仲裁

### 對 §5 pipeline 設計再修正

```
L1a 外部 narrative 清單(CMoney + Goodinfo 概念股) → 抓「熱門」候選
L1b TWSE 法定產業 / FinMind industry_category 全清單 → 抓「完整」候選(防漏)
L1c L1a vs L1b set difference → 自動 flag「法定有但 narrative 漏」讓 user 仲裁
L2  correlation discovery → strong pair (>0.65) + Ward clustering 找真實 sub-cluster
L3  outlier flag + 集團股 flag → 自動標出
L4  user 仲裁 → 命名 sub-cluster + 補漏 + 確認集團股歸屬
```

**L1b + L1c 是這個 case study 才暴露的 layer**,deep-research 沒涵蓋。

---

## 7. 下一步建議(三選一)

### Option A — 繼續驗證假設,擴大 spike(1-2 天)
- 補抓 Goodinfo(寫小 Playwright script)+ 1-2 個其他 narrative(MLCC、重電)
- 看 MLCC / 重電是否跟 PCB 一樣「narrative basket 不可信」
- **理由**:single sample(PCB)無法一般化,2 sample 才足以否定 / 確認 hypothesis

### Option B — 接受 spike 結論,直接寫 production spec(4-5 天)
- 用修正後的 pipeline 設計寫 `docs/specs/concept-cluster/`
- 接受「外部清單只是 candidate pool」+ 「correlation 才是 discovery 工具」
- **理由**:spike 已經顛覆原設計,再 spike 報酬遞減

### Option C — 切軌道改做籌碼共動 cluster(3-4 天)
- 跳過外部 narrative 依賴,完全用專案既有的 broker + 三大法人 data
- 「同步被主力分點吃 / 被法人砍」的群是否比 correlation cluster 更穩定
- **理由**:spike 已證明 correlation 不夠細;籌碼資料是專案差異化最強的角度

**我傾向 A**:單一 PCB 的 spike 結論可能是 case-specific(PCB 全產業同向漲)。再驗證 1-2 個 narrative 才能放心改 pipeline 設計。

如果你想直接決定,可以講「往 A / B / C」我就照走。
