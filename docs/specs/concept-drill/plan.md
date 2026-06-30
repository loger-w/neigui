# Concept Drill — Execution Plan(輕量版)

**Pre-reading**:`spec.md`(同 dir)
**Dependency**:market-monitor-v2 spec P3(sector heatmap)需先完成 sector click event 才能接 drill
**估時**:4 phases ≈ 1.5-2 工作天

---

## Phase 1 — Backend `concept_drill` service

### 目標
單 endpoint,給 sector → 回成員 + 60-day corr matrix + outlier。

### 動的檔
- 🟢 `backend/services/concept_drill.py`(新)
- 🟢 `backend/routes/concept_drill.py`(新)
- 🟢 `backend/tests/test_concept_drill_service.py`(新)
- 🟢 `backend/tests/test_concept_drill_routes.py`(新)
- 🔵 `backend/main.py`(include router)

### 實作要點
- 成員來源:FinMind `TaiwanStockIndustryChain` filter `industry == sector`
- 套 market-monitor-v2 P1 `market_universe.get_filtered_universe()` 排 ETF / 權證 / 處置股
- N > 100 → 截斷,按 today amount 取 top 100,在 response 加 `truncated: true`
- 60-day daily-return Pearson corr matrix(同 concept-cluster spec V0.2 的演算法,直接 reuse 算法不 reuse service)
- Outlier:`group_avg_corr[stock] < mean - 2 * stdev` → flag
- Cache 24 hr by `(sector, end_date)`

### TDD 順序
1. test: 給 fixture sector + 3 stocks,corr matrix 對稱 + 對角線 1
2. test: N > 100 → truncated
3. test: 新上市股 < 60 day → `insufficient_data` flag
4. test: outlier 計算(給 fixture 4 股,1 股對其他相關性顯著低 → 標 outlier)
5. test: API endpoint GET 200 + payload shape 驗

### 完成條件
- pytest 新增 ≥ 5 test 全綠

---

## Phase 2 — Frontend drill modal + hook

### 目標
新元件 `ConceptDrillModal`,從 `MarketPage` 點 sector heatmap 觸發。

### 動的檔
- 🟢 `frontend/src/components/ConceptDrillModal.tsx`(新)
- 🟢 `frontend/src/components/ConceptDrillMemberList.tsx`(新)
- 🟢 `frontend/src/components/ConceptDrillCorrHeatmap.tsx`(新)
- 🟢 `frontend/src/lib/drill-corr-heatmap-svg.tsx`(新,純 SVG)
- 🟢 `frontend/src/hooks/useConceptDrill.ts`(新)
- 🔵 `frontend/src/components/MarketPage.tsx`(加 `pickedSector` state + modal mount)
- 🔵 `frontend/src/components/MarketSectorBreadthHeatmap.tsx`(market-monitor-v2 P5 已加 onSectorClick callback)

### TDD 順序
1. test: `drill-corr-heatmap-svg.test.ts` — 給 3x3 corr matrix,render 9 cells with 對的 fill
2. test: `ConceptDrillMemberList.test.tsx` — render rows + 點 row emit `onSymbolPick`
3. test: `ConceptDrillCorrHeatmap.test.tsx` — outlier 標 red dot
4. test: `ConceptDrillModal.test.tsx` — open=true 顯示;ESC / X close 觸發 `onClose`
5. test: `MarketPage.test.tsx` 既有 + 新 — 點 sector cell 開 modal,modal close 不影響背景 5 panel

### 完成條件
- npm test 新增 ≥ 6 test 全綠
- npm run build 過

---

## Phase 3 — Integration + 真實環境驗證

### 目標
chrome-devtools 真實點擊驗證 + 截圖。

### 步驟
1. 啟動 backend + frontend dev
2. chrome-devtools 切大盤 mode
3. 點「半導體」sector cell → 截圖 drill modal opened
4. 截圖 corr heatmap(觀察色階是否有結構,還是淡色一片 — 對應 spec §8.2 反身性檢核)
5. 截圖 outlier flag(找個有 outlier 的 sector)
6. 點成員 row → 驗證跳 equity mode

### 完成條件
- 截圖 ≥ 3 張放 `docs/specs/concept-drill/screenshots/`
- verification.md 寫

---

## Phase 4 — Lessons learned + 合併 ship

### 目標
跟 market-monitor-v2 同個 release ship,共用 changelog entry。

### 動的檔
- 🔵 `CLAUDE.md §9 Lessons Learned`(加 lesson)
- (`frontend/src/lib/changelog.ts` 由 market-monitor-v2 P6 統一加,本 spec 不另加 entry)

### CLAUDE.md §9 預計加
- 「60-day corr 矩陣對單 sector 視覺化效果」是否如預期(對照 V0.2 6 spike 結論)
- N > 100 截斷的 UX 取捨

### 完成條件
- CLAUDE.md §9 加 ≥ 1 lesson
- 跟 market-monitor-v2 同個 PR 一起 review + ship

---

## 整體驗證 gate

- [ ] `cd backend && python -m pytest -q` 全綠(新增 ≥ 5 test)
- [ ] `cd frontend && npm test` 全綠(新增 ≥ 6 test)
- [ ] `cd frontend && npm run build` 過
- [ ] chrome 截圖 ≥ 3 張
- [ ] 整合 market-monitor-v2 點 sector → drill 流程順
- [ ] 三類 commit 分開(🟢 backend / 🟢 frontend / 🔵 docs)

---

## 陷阱注意

- N > 100 大 sector 不要 render 整 matrix(瀏覽器卡)— 截斷
- 60-day corr 可能整 matrix 淡色一片(spec §8.2 預警)— 若真如此 P3 考慮加 partial corr 控大盤 beta(屬 V0.5 scope creep,先 ship 看反饋)
- `MarketPage` 加 modal state 不要破壞既有 panel render
- modal close 後 ConceptDrillModal unmount,**不要 keep data alive**(避免 stale cache)
- `_CACHE_VERSION` 不動
