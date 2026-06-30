# Concept Drill — 從大盤 sector heatmap drill into 族群成員(輕量版)

**Date**: 2026-06-30
**Type**: /feat(新 drill view,依賴 `market-monitor-v2` Phase 5 sector heatmap click event)
**Goal**: 點 sector breadth heatmap 某 sector → drill view 顯示該 sector 成員 + 60 日 rolling 相關性 + outlier。**極簡版**,不做 concept-cluster spec V0.2 的完整 pipeline。
**SemVer**: PATCH(在 market-monitor-v2 同個 MINOR release 內順手 ship,bump 不另加位)
**Pre-reading**:
- `docs/specs/market-monitor-v2/spec.md`(sector heatmap click 觸發點)
- `docs/specs/concept-cluster/spec.md` V0.2(**做為「我們不打算做哪些」的反面教材**)
- `docs/specs/concept-cluster/spike-evidence/`(6-industry probe + spike report 的數據用得到)

---

## 1. 為什麼是「輕量版」(對比 concept-cluster spec V0.2)

V0.2 spec(40k+ 行 spec + plan + spike evidence)的 10 phase 過度設計,**6 spike + 3 critic 已驗證**:
- L1a CMoney scraper 提供有限(narrative inner corr < cross)→ 不做
- 自適應 corr threshold / fragmented_basket detector → 6 spike 全落最低檔,decision boundary 拍腦袋 → 不做
- 業務 sanity gate / 集團 reflexivity flag / source quality score → 維護成本高,效益未驗 → 不做
- L1c set-difference filtering → tech 鏈有效但傳產未驗,過早 generalize → 不做
- Reflexivity retire detector → 屬「ship 後 3 個月才需要」,V0 不必加 → 不做

**輕量版要做**:
- 從 FinMind `TaiwanStockIndustryChain` 直接 query 成員
- 算 60-day rolling Pearson 相關性矩陣
- 顯示 outlier(corr vs group avg 偏離 > 2 stdev)
- UI: drill modal 或 inline panel,從 sector heatmap 點觸發

**不做的留 V1**:
- 完整 concept-cluster pipeline(V0.2 spec 保留在 repo 當研究紀錄)
- LLM narrative ingestion
- Sub-cluster 自動命名
- Retire detector

---

## 2. 成功條件(可驗收)

1. 在 market-monitor-v2 mode 點 sector breadth heatmap 某 sector(例「半導體」)→ 開 drill view
2. drill view 顯示:
   - **成員列表**:該 sector 全部 4 位數普通股,欄位 `stock_id / name / close / chg% / vol_ratio`,按 chg% 降序
   - **Correlation heatmap**:N x N(N = sector size,N ≤ 100 截斷否則太大),Pearson 60-day daily-return,色階 -1 ~ +1
   - **Outlier flag**:該股 corr vs group avg 偏離 > 2 stdev → 紅 dot
3. 點成員 row → 觸發既有 `onSymbolPick(stockId)` callback(equity mode 既有行為)
4. 關閉 drill view → 回 market-monitor 主 view 狀態不變
5. 完成前 gate:`pytest -q` + `npm test` + `npm run build` + chrome-devtools 截圖

---

## 3. 不能破壞

| 行為 | 來源 | 驗證 |
|------|------|------|
| market-monitor-v2 全 5 panel 行為 | `MarketPage.tsx` V2 | 既有 frontend test 全綠 |
| equity / options mode | `App.tsx` | 既有 test 全綠 |
| FinMind `_CACHE_VERSION` 不動 | `services/finmind*.py` | spec 強調 |
| `useMarketSnapshot` 介面 | 既有 hook | 不改,純新 hook |

---

## 4. Out of scope(明文不做)

| 項目 | 為什麼不做 |
|------|----------|
| Sub_industry 切細(電容 vs 電感 vs 電阻) | V0.2 6 spike 證明 sub 對 corr 沒解釋力,純粒度視覺 noise > signal |
| 自動 sub-cluster 命名 + 結構類型偵測 | 同上 |
| Outlier 自動排除 / 集團 reflexivity flag / 業務 sanity gate | 6 spike 證明效益未驗 + 維護成本高 |
| L1a CMoney narrative scraper | 6 spike 證明 narrative inner corr 不穩,輕量版只信 FinMind IndustryChain |
| User 仲裁 storage | 輕量版不存使用者選擇,每次重算 |
| Reflexivity retire detector | 屬 ship 後 3 個月驗證題 |
| 跨 sector 比較 / cross-concept overlap | V1 |

---

## 5. Pipeline(極簡)

```
L1: FinMind TaiwanStockIndustryChain query 該 sector(industry 大類)所有成員
L2: FinMind TaiwanStockPrice 抓 60-day daily close
    → Pearson correlation matrix
    → group avg corr per stock(每股對其他 N-1 股的平均 corr)
L3: outlier flag(該股 group_avg_corr 偏離 group_mean - 2 stdev → red dot)
```

**結束**。無 L1a / L1c / L4 / lifecycle / 任何 V0.2 layer。

### 5.1 Backend service

```python
# backend/services/concept_drill.py
async def get_sector_drill(
    sector: str,         # e.g. "半導體"
    end_date: str,
    refresh: bool = False,
) -> SectorDrillResult:
    """單 sector drill: 成員 + corr matrix + outlier."""

class SectorDrillResult:
    sector: str
    members: list[StockMeta]      # stock_id / name / close / chg% / vol_ratio
    correlation_matrix: dict[stock_id, dict[stock_id, float]]
    outlier_stocks: list[stock_id]
```

Cache:24 hr by (sector, end_date)。

### 5.2 API endpoint

`GET /api/concept-drill/{sector}?refresh=true`

回 SectorDrillResult JSON,error contract 沿用 `{detail: {error: "<code>"}}`。

---

## 6. Frontend

### 6.1 Drill view 觸發

從 `MarketSectorBreadthHeatmap` 點 sector cell → 既有 `onSectorClick(sector)` callback → `MarketPage` 開 modal / drawer:

```tsx
<ConceptDrillModal
  sector={pickedSector}
  open={!!pickedSector}
  onClose={() => setPickedSector(null)}
  onSymbolPick={onSymbolPick}
/>
```

### 6.2 Modal layout

```
+--------------------------------------------------+
| [半導體] drill                          [X close] |
+--------------------------------------------------+
| 成員列表(N=142,左欄,點 row → onSymbolPick)     |
|--------------------------------------------------|
| stock_id | name | close | chg% | vol_ratio | flag|
| 2330     | 台積 | 1180  | +1.2 | 1.3       |     |
| 3711     | 日月 | ...   | ...  | ...       |     |
| ...                                              |
+--------------------------------------------------+
| Correlation heatmap (右欄,N x N,色階 -1 ~ +1)   |
|                                                  |
| Outlier 標 red dot in heatmap                    |
+--------------------------------------------------+
```

### 6.3 元件

- 🟢 `ConceptDrillModal.tsx`(新)
- 🟢 `ConceptDrillMemberList.tsx`(新,左欄)
- 🟢 `ConceptDrillCorrHeatmap.tsx`(新,右欄)
- 🟢 `lib/drill-corr-heatmap-svg.tsx`(純 SVG renderer)
- 🟢 `hooks/useConceptDrill.ts`(新)
- 🔵 `MarketPage.tsx`(加 drill state + modal mount)

### 6.4 UI 文字嚴禁方向性(承襲 spec V0.2 慣例)

`expect(screen.queryByText(/買進|賣出|滿倉|減碼|強勢|弱勢警示/)).toBeNull()`

只呈現「相關性高 / 偏離平均」這類結構描述,不寫操作建議。

---

## 7. 風險 + 開放問題

| 風險 | 緩解 |
|------|------|
| Sector size N > 100(半導體 142 / 電子零組件業 > 200)| heatmap render 大會卡 — 截斷 N ≤ 100,按 amount 取 top 100;或 modal 加 sub-filter「全部 / top 50 / top 100」 |
| FinMind 60-day daily close 抓 100 檔對 rate limit 有壓力 | concurrent 8 + sponsor tier 應夠;若不夠 P3 加 batch endpoint 探討 |
| 新上市股 < 60 day → corr 算不準 | 該股標 `insufficient_data` flag,heatmap row 灰底 |
| Outlier 閾值「2 stdev」拍腦袋 | spec 標 V0 預設,production 後依使用者反饋校準 |

### 開放問題
- 是否該加「sub_industry」filter chip(let user choose to drill 進「半導體 / IC 設計」)?V0.5 加,不在 V0
- 是否該加 dendrogram 視覺?V0.5 加(V0.2 spec 寫過,可參考)
- 是否該保留 user 仲裁紀錄(例「我覺得這檔不該在這個 sector」)?V0.5 加

---

## 8. 反身性 self-audit

1. **「sector heatmap 點下去 = user 想看 sector 內細節」是假設** — 若 user 真實使用模式是「看整盤,不 drill」,本 spec 浪費功夫 → P4 ship 後 chrome usage event 追蹤
2. **「60-day corr 看得到結構」也是假設** — V0.2 6 spike 證明 raw Pearson 受 market beta 主導,union corr 普遍 0.2-0.35。半導體 corr matrix 可能整 N x N 都是 0.3-0.6 一片淡色 → P4 視覺驗證,若太淡考慮加 partial correlation(扣大盤 beta)
3. **不存 user 仲裁是刻意取捨** — 簡化 / 不維護黑名單;若 user 反覆看同 sector 想 hide 某股,V0.5 再加 storage

---

## 9. SemVer & Changelog

- 跟 market-monitor-v2 一起 ship 算同個 MINOR(`0.18.x → 0.19.0`)
- 不另加 changelog entry,併入 market-monitor-v2 的 entry:
  ```ts
  { date: '2026-MM-DD', kind: 'feature', scope: 'global',
    text: '大盤掃描頁新增族群參與度等指標,點族群可看內部成員與相關性' }
  ```

---

## 10. Revision History

- **V0**(2026-06-30)— 輕量版誕生,作為 concept-cluster spec V0.2 over-engineering 的反向修正
