# /mod warrant-selector-table — Phase 1 現況盤點

日期:2026-07-16。Worktree:`.claude/worktrees/warrant-selector-table`(分支 `mod/warrant-selector-table`,基準 main @ 9f8e70e)。
背景:三項改動由前一 session 與 user 問答定案(對齊修復 / 發行商下拉篩選 / 分點買賣超前後端移除),本 session 驗證後採用。

## Baseline(全綠,2026-07-16 實測)

| 驗證 | 結果 |
|---|---|
| backend `python -m pytest -q` | 718 passed, 1 skipped |
| backend `ruff check .` | All checks passed |
| frontend `npm test`(vitest) | 84 files / 802 passed |
| frontend `npm run build` | ✓ built(tsc + vite) |

## 項目 1:表頭對齊不對稱(🔴 行為修復)

### 現況與根因(已驗證,與 user 描述一致)
- `WarrantSelector.tsx:335-363` 表格:`<tr>` 第一個 child 是**展開按鈕空 th**(`:338`,`aria-label="展開"`,不在 columns registry);資料欄 th 由 `visibleColumns.map` 渲染,className = `"px-2 py-1.5 text-right first:text-left font-normal"`(`:344`)。
- Tailwind `first:` = `:first-child`。展開 th 才是 first-child → **`first:text-left` 永遠不生效**,所有資料欄表頭(含代號/名稱/類型)一律右對齊。
- 對照 cell:`warrant-columns.tsx` 中 `warrant_id`(:67)/`name`(:74)/`kind`(:89)三欄 td 是 `text-left`,其餘 td `text-right` → 前三欄表頭與資料格對齊不對稱。

### 目標
- `WarrantColumnDef`(`warrant-columns.tsx:49-59`)加 `align: "left" | "right"`;`warrant_id`/`name`/`kind` = left,其餘 = right。
- th 依 `c.align` 渲染,移除 `text-right first:text-left` 猜測式寫法。
- Caller 影響:`WarrantColumnMenu.tsx` 只用 `id/label/desc/lockVisible` — 加欄位 additive,無影響。

## 項目 2:發行商下拉篩選(🟢 新功能;已定案:下拉、單選)

### 現況
- 資料源 TWSE `t187ap37_L` / TPEx 無獨立發行商欄;`WarrantTerm.name`(權證簡稱)含發行商,標準格式 = 標的簡稱(2字)+發行商簡稱(2字)+年碼+購/售+序號,例「台積凱基61購01」→ 凱基。
- 篩選純函式層 = `warrant-utils.ts`:`WarrantFilters`(:12)/`DEFAULT_FILTERS`(:26)/`filterWarrants`(:58)。
- 篩選列 UI = `WarrantSelector.tsx:130-317`;「重製篩選」`:150` 用 `setFilters(DEFAULT_FILTERS)` + epoch remount → 新欄位進 `WarrantFilters` 即自動被重製覆蓋(select 為 controlled 則連 remount 都不需要,但 remount 無害)。
- 原生 `<select>` 專案樣板 = `OptionsHeader.tsx:38-52`(border-line / bg-bg / aria-label)。

### 目標
- `warrant-utils.ts`:known 發行商名單常數 + `extractIssuer(name): string | null` 純函式;`WarrantFilters.issuer: string | null`(null=全部);`filterWarrants` 新分支。
- `WarrantSelector.tsx`:篩選列加下拉,選項 = 該標的實際出現的發行商(從 terms 推導,不隨其他篩選縮)+「全部」預設;不加表格欄。
- e2e fixture 名(2330):凱基/元大/富邦/群益/統一/國泰 各 1 檔(6 檔),抽取後每發行商恰 1 列 — e2e 可鎖 count 6→1。

## 項目 3:分點買賣超前後端移除(🔴 行為移除)

### Caller map(2026-07-16 全 grep,含動態用法)

**前端(全刪/改):**
| 檔 | 位置 | 動作 |
|---|---|---|
| `components/WarrantSelector.tsx` | :4 import、:57 brokersHook、:375 prop 傳遞、:392/:399 RowPair 簽名、:431-467 `warrant-brokers-detail` 區塊、:415 aria-label「展開分點 ...」 | 刪區塊;展開列只留 `WarrantIvHistory`;aria-label 改「展開明細 ...」 |
| `hooks/useWarrantBrokers.ts` + `.test.ts` | 整檔 | 刪 |
| `lib/api.ts` | :7 型別 import、:240-246 `warrantBrokers` | 刪 |
| `lib/warrant-data.ts` | :81-91 `WarrantBrokerRow`/`WarrantBrokersPayload` | 刪 |
| `lib/warrant-columns.tsx` | :65 warrant_id desc「…與分點明細」 | 文案改 |
| `components/WarrantSelector.test.tsx` | :76-79 mock、:194-208(SC-6)、:258-273(同名分點)、:324-336(展開列分點表)整支刪(內含 :202/:271/:330 的 /展開分點/ 隨測試消失);:318/:359 的 /展開分點/ 引用改寫(實作時以 grep 為準,勿只依本表行號) | 刪測試 3 支 + mock;label 改 |
| `hooks/useWarrantIvHistory.ts`/`.test.ts` | 註解引「useWarrantBrokers 樣板」 | **不動**(純歷史註解,scope 外) |

**e2e(同 PR 強制,selectors.ts FOOTER ENFORCEMENT):**
| 檔 | 位置 | 動作 |
|---|---|---|
| `e2e/helpers/selectors.ts` | :51 `warrantBrokersDetail` | 刪 |
| `e2e/specs/equity.spec.ts` | :160-170 E11 | 刪整支 |
| `e2e/specs/equity.spec.ts` | :233(E13)`/展開分點/` | label 改 |
| `backend/tests_e2e/test_api_warrants.py` | :81-87 `test_brokers_happy_path` 整支刪;:181-183 是 `test_bad_symbol_400_all_paths`(:177-187)內嵌的 /brokers 斷言 — **只刪該 3 行**,保留 /api/warrants 與 /flow 的 bad_symbol 斷言(review R1) | 1 支刪 + 1 支部分改寫 |

**backend(刪/改):**
| 檔 | 位置 | 動作 |
|---|---|---|
| `routes/warrants.py` | :17-23 import、:100-104 handler、:1-5 docstring 提及 brokers 錯誤邊界 | 刪 handler + import;docstring 修 |
| `services/warrant_brokers.py` | 整檔 | 刪 |
| `tests/test_warrant_brokers.py` | 整檔(7 測試) | 刪 |
| `tests/test_warrants_routes.py` | :14 import wb、:55-59、:96-115(3 支 brokers 測試)、:1-5 docstring | 刪 + docstring 修 |

**⚠ 關鍵發現 — finmind.py client method 必須保留(prompt 預設不成立):**
- `finmind.py:643 fetch_warrant_trading_daily_report` 的 caller 有兩個:`warrant_brokers.py:58`(將刪)**和 `warrant_flow.py:171`(續用,權證分點流向頁)**。
- → method 保留,只把 :646-647 docstring 的「(services/warrant_brokers.py)負責」改指 `warrant_flow.py`。
- MANIFEST 三個 `TaiwanStockWarrantTradingDailyReport_*.json` fixture(030011/030012/03001P)全保留 — flow E14 與 `test_warrant_flow.py:499` 在用。

**已驗證不受影響:**
- 權證分點流向頁:`/flow` route + `services/warrant_flow.py` + `useWarrantFlow` — 獨立鏈,零共用(除 finmind method,保留)。
- `chipBrokersPanel`(主力券商,equity overview)為不同 domain,同字根不同物。
- 殘留 cache 檔 `warrant_brokers_{id}_{date}.json`:service 刪除後成 inert 死檔,無讀取方,不需清理機制。

### Backward compat
- `GET /api/warrants/{warrant_id}/brokers` 為內部 API,唯一 consumer = 本次同刪的前端;user 已確認無其他消費者;pre-1.0 無對外承諾 → 直接移除,無 deprecation window。

## E2E 判準結論(e2e-conventions 判準表,Phase 2 必填)

| 項目 | 判準格 | 動作 |
|---|---|---|
| 1 對齊 | equity UI 改既有行為(視覺微調,V1-V6 baseline 不含權證 tab) | 在 E8 補 th `toHaveCSS("text-align")` assertion(代號 left / 履約價 right) |
| 2 發行商篩選 | equity UI 新功能 | 新 E20 spec:下拉選凱基 → 6→1;重製 → 回 6 |
| 3 分點移除 | 改既有行為 + backend route 移除 | 刪 E11;E13 label 同步;selectors.ts 刪 testid;tests_e2e 刪 `test_brokers_happy_path` 1 支 + `test_bad_symbol_400_all_paths` 部分改寫(只刪 /brokers 斷言 3 行) |

## 版本 / changelog
- 現行最新 **0.31.2**(changelog.ts:43;review R2 校正 — worktree base 已含另一 session 的 0.31.2)。三項同 ship event → 單一 entry,主導 = 新功能(發行商篩選)→ **MINOR bump 0.32.0**(對齊修復與分點移除併入同 entry;寫 text 前讀 `changelog-conventions`)。
- changelog 有 pin 測試(`changelog.test.ts:83` pin "0.31.2")→ 同步更新為 0.32.0。

## 衝突迴避(user 指示)
- 另一 session 改 `WarrantIvHistory.tsx` / `warrant-iv-svg.ts` — 本批次**不碰這兩檔**;`WarrantSelector.tsx` 保留 `<WarrantIvHistory warrantId=... />` 呼叫原樣。
- 本 session 在 worktree,主 checkout(`mod/chip-major-lazy-window`)不動。
