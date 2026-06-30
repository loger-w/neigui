# L1 Spike Report — MLCC / 被動元件 概念股 cluster 可行性

**日期**: 2026-06-30
**Scope**: 跑第二個 narrative 驗證 PCB spike 的「外部清單 vs correlation」結論是否一般化
**Status**: 完成,結論部分顛覆 PCB spike,部分強化

---

## 0. TL;DR

1. **26 檔 union(24 narrative + 2 L1c domain),85 trading day(2026-02-24 → 2026-06-29)**。
2. **MLCC narrative basket 整體 coherent 度比 PCB 高**(union inner corr 0.485 vs PCB 0.40-0.47)。**「inner < cross」反直覺現象在 MLCC 主要只出現在 1 個 article (ARTICLE_B)**;其餘 3 篇 inner 都壓 cross。→ **PCB 結論「外部清單不可信」不能一般化**,要看 narrative 的同質性。
3. **L1c set difference(8163 達方、9905 大華金屬)抓漏效果遠弱於 PCB 的 8046 南電 case**:達方邊緣命中(top partner 0.65),大華完全脫鈎(avg corr 0.18)。→ **當 narrative 本身已覆蓋頭部時,L1c 補入價值有限**。
4. **MLCC 是「同質叢」**:corr > 0.65 threshold 下 16/24 narrative 檔直接合成一桶,**沒有 PCB 那種「載板 / CCL / 玻纖」清晰分層**。真正 cluster 結構要 corr > 0.75 才浮現「MLCC 三雄 + 興勤」四劍客(2327 + 2492 + 2375 + 2428)。
5. **narrative source 品質差異懸殊**:ARTICLE_B 內 3/9 檔是 outlier(3363 上詮光纖 / 4989 榮科銅箔 / 6204 艾華可變電阻)→ production 必須對 source 做 quality score。

---

## 1. 資料取得實況

| 來源 | 狀態 | 取得內容 |
|------|------|---------|
| CMoney `cmoney-4d2a9629` 「漲價效應 10 檔」 | ✓ 完整列出 10 檔 | 採用 ARTICLE_A |
| CMoney `cmoney-50c73888` 「強勢回歸 9 檔」 | ✓ 完整列出 9 檔 | 採用 ARTICLE_B |
| CMoney `cmoney-1222626d` 「AI/國巨併購 10 檔」 | ✓ 完整列出 10 檔 | 採用 ARTICLE_C |
| CMoney `cmoney-98abc6da` 「確定漲價 9 檔」 | ✓ 完整列出 9 檔 | 採用 ARTICLE_D |
| CMoney `cmoney-71ab6bf4` 「4 大全漲價 15 檔」 | ✗ 標題 15 但內文只詳 4(含 2330 / 2317 非被動元件)| 排除避免污染 |
| L1b 必有玩家 | △ user 提 5317 凱美應為筆誤(正確 2375)| 校正後採用 |
| 2456 奇力新 | ✗ 已被 2327 國巨併購下市,FinMind 只回 4 rows | **剔除** |

**淨取得**: 24 narrative + 2 L1c(8163 達方、9905 大華金屬)= 26 檔

**反思**:
- 比 PCB spike 完整(4 篇 narrative vs 2 篇)— MLCC 編輯產量更大,因為被動元件漲價是 2025-2026 主流 narrative
- **5317 凱美 = user 筆誤**;TWSE 凱美正確股號為 2375。L1b domain knowledge 補入前需股號驗證,production 必須對股號清單做 sanity check

---

## 2. Narrative basket 內容

| Source | 股號 | 股名 | 來源 narrative |
|--------|------|------|---------------|
| **ARTICLE_A** (漲價效應 10 檔) | 2492 華新科 / 2375 凱美 / 3026 禾伸堂 / 2327 國巨 / 6173 信昌電 / 6862 三集瑞-KY / 3624 光頡 / 4760 勤凱 / 6449 鈺邦 / 2472 立隆電 |||
| **ARTICLE_B** (強勢回歸 9 檔) | 4989 榮科 / 8043 蜜望實 / 3026 禾伸堂 / 3363 上詮 / 3357 臺慶科 / 6449 鈺邦 / 2472 立隆電 / 2478 大毅 / 6204 艾華 |||
| **ARTICLE_C** (AI/國巨併購 10 檔) | 6449 鈺邦 / 8043 蜜望實 / 5328 華容 / 2375 凱美 / 3236 千如 / 3357 臺慶科 / 6432 今展科 / 2327 國巨 / 2428 興勤 / 6173 信昌電 |||
| **ARTICLE_D** (確定漲價 9 檔) | 2327 國巨 / 2492 華新科 / 3236 千如 / 5228 鈺鎧 / 6127 九豪 / 6155 鈞寶 / 2478 大毅 / 6173 信昌電 / 6284 佳邦 |||

**Source overlap(narrative ∩):**
- A ∩ B = {3026, 6449, 2472}(3 檔)
- A ∩ C = {2375, 2327, 6173, 6449}(4 檔)
- A ∩ D = {2492, 2327, 6173}(3 檔)
- B ∩ C = {8043, 3357, 6449}(3 檔)
- B ∩ D = {2478}(1 檔)
- C ∩ D = {2327, 6173, 3236}(3 檔)

→ **4 篇 article 重疊度遠高於 PCB**(PCB 三來源完全不重疊),反映 MLCC narrative 共識性更強(2327 國巨 4 篇全列、6173 信昌電 3 篇、2375 凱美 3 篇)。

**L1c (L1b - L1a):**
- 8163 達方
- 9905 大華金屬

---

## 3. 量化結果

### 3.1 narrative basket inner / cross corr(KEY FINDING)

```
ARTICLE_A inner (10 檔)  : 0.586    ← 高
ARTICLE_B inner ( 9 檔)  : 0.404    ← 異常低
ARTICLE_C inner (10 檔)  : 0.565
ARTICLE_D inner ( 9 檔)  : 0.560

A x B cross : 0.479
A x C cross : 0.562    ← 接近 C inner
A x D cross : 0.549
B x C cross : 0.476
B x D cross : 0.458
C x D cross : 0.551

24 檔 union inner : 0.485
2 檔 L1c inner    : 0.136
narrative x L1c   : 0.319
```

**對比 PCB spike**:
| 指標 | MLCC | PCB |
|------|------|-----|
| Basket inner 平均 | **0.529** | 0.435 |
| Cross 平均 | **0.513** | 0.416 |
| 任何 basket inner < 其他 cross? | 只 B 一篇 | N1 inner (0.397) < N1×N2 (0.416) |
| Union inner | 0.485 | 0.397 |

→ **MLCC narrative 整體 coherent**(inner > cross 大部分成立);**PCB 結論「外部清單不可信」不能一般化** — 取決於 narrative 是否真實對應同質結構。
→ **ARTICLE_B 是 outlier source**:inner 0.404 比跟其他 narrative 的 cross (0.466) 還低,**只有它符合 PCB-style 「narrative ≠ cluster」**。

### 3.2 L1c 抓漏效果 — 跟 PCB 的 8046 case 對比

| 維度 | PCB / 8046 南電 | MLCC / 8163 達方 | MLCC / 9905 大華金屬 |
|------|---------------|----------------|-------------------|
| L1c source | user 仲裁補 | L1b 法定產業 set diff | L1b 法定產業 set diff |
| Top partner | 3037 欣興 **0.751** | 6449 鈺邦 **0.652** | 2472 立隆電 0.292 |
| 二次 partner | 4958 臻鼎-KY 0.655 | 6173 信昌電 0.545 | 2375 凱美 0.260 |
| avg corr vs union | 0.406 | 0.440 | **0.184** |
| 是否進入主桶(corr > 0.55)| ✓ 進入 ABF 載板 | ✓ 邊緣命中 | ✗ 獨立 outlier |
| 解釋 | ABF 載板真實 cluster 漏網 | 鍵盤模組廠周邊有電容業務,弱關聯 | 銅 strip / 銅 contact 本業,與 MLCC 無直接傳導 |

→ **L1c 補入價值不是 binary,而是 spectrum**:
- 強命中(0.7+,新主流):PCB 8046 南電 case
- 邊緣命中(0.6-0.7,弱關聯):MLCC 8163 達方
- 完全不命中(<0.3,標記 outlier 後剔除):MLCC 9905 大華金屬

→ **當 narrative 本身 inner corr 高、覆蓋頭部完整時(MLCC),L1c set-difference 主要 surface 「真 outlier」而不是「漏網主流」**。L1b 必須對應產業類別 + 業務描述二次驗證,不能單純 set difference。

### 3.3 strong pair(corr > 0.65)— sub-cluster 結構

| corr | pair | 解讀 |
|------|------|------|
| **0.809** | 2327 國巨 ↔ 2492 華新科 | **MLCC 雙雄** |
| **0.794** | 2327 國巨 ↔ 2375 凱美 | MLCC + 鋁質電容龍頭 |
| **0.780** | 2375 凱美 ↔ 2428 興勤 | 電容 ↔ 熱敏電阻 |
| **0.770** | 2375 凱美 ↔ 2492 華新科 | MLCC 三雄之二 |
| **0.744** | 2428 興勤 ↔ 6284 佳邦 | 熱敏電阻 ↔ 抑制器/壓敏 |
| **0.744** | 2492 華新科 ↔ 3624 光頡 | MLCC ↔ 晶片電阻 |
| **0.722** | 2327 國巨 ↔ 3624 光頡 | 同上 |
| **0.722** | 2375 凱美 ↔ 6862 三集瑞-KY | 鋁電解電容 KY |
| 0.715 | 2375 凱美 ↔ 3357 臺慶科 | 電容 ↔ 電感 |
| 0.712 | 2428 興勤 ↔ 2472 立隆電 | 熱敏 ↔ 鋁電解 |
| 0.705 | 3236 千如 ↔ 6173 信昌電 | 電感粉末 ↔ MLCC chip |
| 0.704 | 2327 國巨 ↔ 6155 鈞寶 | MLCC ↔ 鐵芯/磁性 |
| 0.700 | 3357 臺慶科 ↔ 6862 三集瑞-KY | 電感 ↔ 電容 KY |

**threshold 切分結果**:
| corr 門檻 | 主桶大小 | 獨立 outlier | 解讀 |
|---------|---------|------------|------|
| 0.50 | 23/26 | 3363、4989、9905 | 一桶水 |
| 0.55 | 22/26 | 3363、4989、5228、9905 | 一桶水 |
| 0.60 | 21/26 | 3363、4989、5228、6204、9905 | 一桶水 |
| 0.65 | 16/26 | + 4760、5328、6432、6449+8163 mini | **才開始分裂** |

→ **MLCC 是「同質叢」**:漲價題材吃整個被動元件鏈,沒有 PCB 那種「載板(數位 packaging)/ CCL(化工)/ 玻纖(原物料)」上下游差異化結構。
→ **產業屬性決定 cluster 演算法 threshold**:PCB 0.55 切已乾淨,MLCC 要 0.65-0.7 才浮現結構。**fixed threshold pipeline 不可行**,production 需自適應(用 union inner corr 反推)。

### 3.4 hierarchical clustering(average-linkage)

```
k=3 切分:
  cluster 0: 9905 大華金屬           ← outlier
  cluster 1: 3363 上詮 / 4989 榮科    ← 跨產業誤列
  cluster 2: 其餘 23 檔               ← 主桶

k=6 切分(才開始細分):
  cluster 0: 3363 上詮               ← 光纖元件
  cluster 1: 4989 榮科               ← 銅板/銅箔
  cluster 2: 9905 大華金屬           ← 銅 strip
  cluster 3: 2327 / 2375 / 2428 / 2472 / 2478 / 2492 / 3026 / 3236 / 3357 / 3624 / 5328 / 6127 / 6155 / 6173 / 6284 / 6432 / 6449 / 6862 / 8163  ← 大主桶
  cluster 4: 4760 勤凱 / 5228 鈺鎧    ← 邊緣小群
  cluster 5: 6204 艾華 / 8043 蜜望實  ← 邊緣小群
```

→ Linkage 切到 k=6 才把 outlier 全分出,**主桶 19 檔不再進一步切**(因為核心 MLCC chain 內部 corr 均勻 0.55-0.80,沒有 PCB 那種 corr gap)。
→ HRP 風格距離 `sqrt(0.5*(1-rho))` + Ward 或許可以,但 spike 用 average linkage 已能 reveal 結構同質性。

### 3.5 outlier 列表

| 股票 | 來源 | avg corr | 可能原因 |
|------|------|---------|---------|
| 9905 大華金屬 | L1c | **0.18** | 銅 strip / 銅 contact,本業跟 MLCC 無直接傳導;產業 cycle 獨立 |
| 3363 上詮 | ARTICLE_B | 0.31 | 光纖通訊元件,被誤塞被動元件 narrative |
| 4989 榮科 | ARTICLE_B | 0.31 | 銅箔基板,跟 PCB / 銅原物料連動 而非 MLCC |
| 6204 艾華 | ARTICLE_B | 0.39 | 可變電阻,niche 規模小、波動低 |
| 5228 鈺鎧 | ARTICLE_D | 0.40 | KY 註冊、規模小、訊號薄弱 |

→ **ARTICLE_B 是 5 個 outlier 中 3 個的源頭**:選股品質明顯較差,把光纖、銅箔、可變電阻硬塞「被動元件強勢回歸」narrative。Production 必須有 **source-level quality score**(可用該 source basket inner corr 反推)。

---

## 4. 反身性 audit(對 spike 自身)

### A. Sample 反身性 — 兩個 narrative(PCB + MLCC)夠不夠?
- 已從 single-sample 升到 2-sample,但兩個都是「漲價題材」(PCB CCL 漲、MLCC 漲價)
- 結構性 narrative(AI / 半導體 / 重電 / 軍工 / 矽光子)還沒驗證
- 結論強度:「外部清單不可信」**不能 binary 一般化**,但「需 correlation 驗證」是必須
- 下次 sample 建議:結構性 narrative(矽光子 / CPO)或防禦 narrative(高息 ETF 成分)看是否有不同模式

### B. MLCC 「漲價」narrative 反身性
- 2025-2026 被動元件全產業同步漲價題材 → narrative basket 自然 corr 高(0.485 union inner)
- 此 corr 高度有多少來自:(a) 真實業務同質、(b) narrative-induced sync 散戶共買、(c) market beta?
  - 從 ARTICLE_A inner 0.586 vs union 0.485 vs L1c x narrative 0.319 看,**至少 (a)+(b) 主導**,僅 (c) 不能解釋 ARTICLE_B 跟其他 article 的 0.18 落差
- 對結論的影響:MLCC 高 coherent 不能單純歸功 narrative quality,**業務同質性才是主因**

### C. ARTICLE_B 反身性
- ARTICLE_B inner 0.404 異常低,被視為「品質差 source」
- 但也可能反映「ARTICLE_B 編輯有意納入跨產業 candidate」(光纖 + 銅箔當補充)
- 若 production source quality score 用 inner corr,會懲罰這種「跨產業 thematic」source — 但有些 thematic 可能是真的 emerging cluster
- 對策:source quality score **不要當 hard cut**,只當「降權」訊號 + 標記給 user 仲裁

### D. 85 trading day 樣本反身性
- ~4 個月 daily return,跟 PCB spike 相當
- 5/15 後台股大盤 rally,MLCC 從 4 月初就 lead 整波,整段 base effect 強烈
- → 樣本期太短可能 inflate MLCC 同步度(全段都被「漲價題材」共同 driver dominate)
- 250-day lookback 結果可能不同(會跨入無漲價題材的 baseline)

### E. 沒控制 market beta 的反身性
- 跟 PCB spike 同樣 caveat — 沒有 partial correlation 控 TWSE 加權指數 beta
- MLCC 區間漲幅大、跟大盤同向,raw corr 結構性偏高
- 影響:「同質叢」結論可能在 partial corr 下變成「弱分層 sub-cluster」— 但目前 spike 沒做這層

---

## 5. 對 production pipeline 設計的補強(KEY)

### PCB spike 設計回顧
```
L1a 外部 narrative 清單 → 只當 candidate pool
L1b TWSE 法定產業 / industry_category 全清單 → 抓「完整」候選
L1c set difference → 自動 flag 漏網 member
L2 correlation discovery → strong pair (>0.65) + Ward 找 sub-cluster
L3 outlier flag + 集團股 flag
L4 user 仲裁
```

### MLCC spike 後的補強

**5.1 — 自適應 corr threshold(NEW)**
PCB: 0.55 切已分層;MLCC: 0.65-0.70 才浮現結構。Fixed threshold pipeline 不可行。
→ **用 union basket inner corr 反推 threshold**:
- union inner < 0.45 → threshold 0.55(分層明顯,如 PCB)
- 0.45 ≤ union inner < 0.55 → threshold 0.65(中度同質,如 MLCC)
- union inner ≥ 0.55 → threshold 0.70+(高度同質)+ 提示 user「此 narrative 結構單一,sub-cluster 可能無實質意義」

**5.2 — Source-level quality score(NEW)**
PCB N1 inner 0.397 < cross 0.416 → 整個 N1 該降權
MLCC ARTICLE_B inner 0.404 << 其他 inner 0.56-0.59 → ARTICLE_B 該降權
→ 每篇 narrative 計算 inner corr,跟同期間其他 source 比較,**relative 低於 25 百分位的 source 標 "quality flag"**,該 source 獨有的成員需 user 仲裁(可能含 outlier)。

**5.3 — L1c 二次篩選(NEW)**
9905 大華金屬被歸進 L1b「被動元件」但 corr 0.18 → 對 MLCC narrative 完全不命中。
→ L1c 候選需有 **業務描述 keyword match** 或 **歷史 corr 達閾值**,單純 industry_category set difference 會包入掛羊頭股。
→ Production 流:
  1. industry_category set difference → 候選集
  2. 跟 narrative basket top-3 stocks(highest centrality)算 60-day corr
  3. < 0.35 → 標「弱關聯」,加入時要 user 確認

**5.4 — Cluster 結構類型自動 label(NEW)**
spike 顯示 cluster 有兩種型態:
- **異質分層(PCB)**:有 2-3 個 sub-cluster,corr gap 明顯,可命名(ABF / CCL / 玻纖)
- **同質叢(MLCC)**:一桶大主流 + 少量 outlier,corr 連續分布無 gap,無實質 sub-cluster
→ 給 user 看的 panel UI 應該對「同質叢」案例**隱藏 sub-cluster 選單**,只展示「主桶 + outlier」two-tier 結構;對「異質分層」才展示 multi-tier。

### Production pipeline 更新版

```
L1a 外部 narrative 清單(多篇 article + 概念股板)
  → 每篇算 inner corr → source quality score
  → low-quality source flag + 標記其獨有成員需仲裁

L1b TWSE / FinMind industry_category 全清單

L1c L1b - L1a set difference
  → 跟 narrative top-3 centrality 算 60-day corr
  → < 0.35 標「弱關聯」需 user 確認
  → ≥ 0.65 自動命中(類 PCB 8046 case)
  → 0.35-0.65 標「邊緣」(類 MLCC 8163 case)

L2  correlation discovery
  → 計算 union inner corr → 推 cluster threshold
  → 用 threshold 切 connected component
  → 標記 cluster 結構類型(異質分層 / 同質叢)

L3  outlier flag(avg corr < 25 百分位)+ 集團股 flag

L4  user 仲裁(對應 L1a low-quality / L1c 邊緣 / L3 outlier)
```

**5.5 — 兩個 sample 共識**:
- correlation 永遠該做(不論 narrative 多 coherent)
- outlier flag 永遠該有
- user 仲裁 layer 永遠必要
- **threshold / 是否畫 sub-cluster 要 case-by-case**

---

## 6. 對下一步的建議

**Spike 已從 1 sample 升 2 sample,結論強度提升但仍未飽和**:
- 已證明 PCB 是「異質分層」case,MLCC 是「同質叢」case
- 未驗證:結構性主流(AI server / 矽光子 / 半導體先進製程)或防禦型(高息 ETF / 重電 / 軍工)是否還有第三種 cluster 結構模式

**建議再 spike 一個 narrative**:
- 矽光子 / CPO(預期會像 PCB:有 leader + follower 分層)
- 或 重電(預期會像 MLCC:同質叢漲價題材)
- 任一驗證後可放心改 pipeline 設計

**或直接 commit to production spec**(風險可控,因為已涵蓋兩種模式):
- 用 §5 的更新版 pipeline 寫 `docs/specs/concept-cluster/`
- 接受「需自適應 threshold + source quality score + L1c 二次篩選」3 個 spike 才浮現的新需求

---

## 7. 跟 PCB spike 對照表(快速 reference)

| 維度 | PCB spike | MLCC spike |
|------|----------|-----------|
| Universe | 22 檔(20 narrative + 2 user 仲裁)| 26 檔(24 narrative + 2 L1c)|
| Trading days | 81 | 85 |
| Narrative source 數 | 3(N1 / N2 / C50851)| 4(A / B / C / D)|
| Source 重疊度 | 完全互補(0 ∩)| 中度重疊(2327 4 篇全列)|
| union inner corr | 0.397 | 0.485 |
| inner < cross 反直覺? | ✓ N1 inner < N1xN2 | △ 只 B 一篇 |
| L1c 補入命中度 | ✓ 強(8046 corr 0.751)| △ 弱(8163 0.65,9905 0.18)|
| Sub-cluster 結構 | ✓ 異質分層(ABF / CCL / 玻纖 / 製造)| ✗ 同質叢(漲價共動一桶)|
| Threshold 切分 | 0.55 已分層 | 要 0.65-0.70 才浮現 |
| 適合的演算法 | average + threshold 0.55-0.65 | 高 threshold + 用 inner corr 自適應 |
| Outlier 比例 | 5/22 (23%) | 4/26 (15%) |
| Source quality 差異 | 三 source 質均 | ARTICLE_B 明顯弱 |
| 對 pipeline 啟示 | L1b/L1c set diff 抓漏有效 | 自適應 threshold + source quality 必要 |

---

## 8. 對單一 MLCC narrative 仲裁建議(若立刻用此 spike)

若 user 要立刻把 MLCC concept cluster 放上 dashboard:
- **核心 5 檔(corr 互相 0.7+,4 篇 narrative 共識)**:2327 國巨、2492 華新科、2375 凱美、6173 信昌電、2428 興勤(只在 C 篇但 corr 0.78 給 2375)
- **次要 9 檔(corr 0.55-0.7)**:3026 禾伸堂、2472 立隆電、2478 大毅、3236 千如、3357 臺慶科、3624 光頡、6155 鈞寶、6284 佳邦、6862 三集瑞-KY
- **邊緣 / 觀察 4 檔(corr 0.4-0.55)**:6449 鈺邦、4760 勤凱、5228 鈺鎧、5328 華容、6432 今展科、8043 蜜望實
- **建議剔除 6 檔(outlier 或非 MLCC)**:3363 上詮(光纖)、4989 榮科(銅箔)、6204 艾華(可變電阻)、9905 大華金屬(銅 strip)、6127 九豪、8163 達方(邊緣命中 fluctuating)

最終 production basket 建議從 24 narrative 過濾為 14-18 檔(剔除 outlier + ARTICLE_B 獨有 + L1c 邊緣)。
