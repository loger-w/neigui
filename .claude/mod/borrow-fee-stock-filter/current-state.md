# /mod borrow-fee-stock-filter — Phase 1 現況盤點

**Date**: 2026-07-11
**目標**: 券差頁加「當日單檔篩選」— 表格上方加標的選擇(手動輸入代號 + 從當日有列入券差的名單直接挑),選定後表格只顯示該檔當日筆數,可清除回全表;選單只列當天有列入的標的。

## 1. Caller map(grep 完整,含動態用法檢查)

| Symbol | 定義處 | Callers | 動態用法 |
|---|---|---|---|
| `BorrowFeePage` | `frontend/src/components/BorrowFeePage.tsx` | `App.tsx:62-63,525`(lazy import + borrow mode ternary)、`App.test.tsx:22-23`(vi.mock)、`BorrowFeePage.test.tsx` | 無(lazy import 是唯一間接引用) |
| `DaytradeFeeTable` | `frontend/src/components/DaytradeFeeTable.tsx` | `BorrowFeePage.tsx:3,67`、`DaytradeFeeTable.test.tsx` | 無 |
| `useDaytradeFee` | `frontend/src/hooks/useDaytradeFee.ts` | `BorrowFeePage.tsx:2,8`、`useDaytradeFee.test.ts`、`BorrowFeePage.test.tsx:19-20`(vi.mock) | 無 |
| `sortRows` / `formatShares` / `formatFee` | `frontend/src/lib/borrow-fee-utils.ts` | `DaytradeFeeTable.tsx`、`borrow-fee-utils.test.ts` | 無 |
| `BorrowFeeRow` / `BorrowFeeData` / `FEE_HIGHLIGHT_THRESHOLD` | `frontend/src/lib/borrow-fee.ts` | 上述各檔 + backend 同名常數互鎖測試(`test_fee_highlight_threshold_value`) | 無 |
| e2e | `e2e/specs/borrow-fee.spec.ts`(BF1/BF2)、`e2e/helpers/selectors.ts`(`borrowFeePage` / `feeRow` / `feeHigh` testids) | — | selector 對 data-testid 字串 |

Backend(`routes/daytrade_fee.py` / `services/daytrade_fee.py`):**本次不動** — 篩選是純前端 client-side(當日全表已在 payload 內,rows + month_counts 齊備)。

## 2. Baseline(全綠證據)

分支 `mod/borrow-fee-stock-filter` 開自 main@79af557,working tree 乾淨。同 commit 於 2026-07-11 16:05 pre-push(main 推平)全套跑過:
- backend `python -m pytest -q`:**627 passed, 1 skipped**
- backend `ruff check .`:All checks passed
- frontend `npm test`(vitest):**74 files / 695 passed**
- frontend `npm run build`:tsc + vite 過

e2e 未在 pre-push 範圍(harness.json 刻意排除);BF1/BF2 現況綠與否待 Phase 6 前確認(本次會動券差頁 UI,e2e 歸屬 Phase 2 讀 `e2e-conventions` 定案)。

## 3. 現有實作意圖

- `BorrowFeePage`:header(資料日 badge / NTD 註記 / partial 註記 / 重新整理鈕)+ 捲動區內 `DaytradeFeeTable`。空狀態文字「本月無券差資料」。root flex-1 min-h-0(App root flex col)。
- `DaytradeFeeTable`:呈現層 + 排序 state(預設 fee_rate desc,點欄標切換);row key `${stock_id}-${i}` — **同一股票當日可有多筆**(BFIF8U 每筆標借一 row,spec 實測 2408 單日 16 筆),表格原樣全列。
- `sortRows`:純函式(lib 層,無 React),tie-break stock_id 升冪。
- `useDaytradeFee`:TanStack useQuery,`{data, loading, error, refresh, noTradingDay}` shape,refresh 帶 force flag。
- 資料流:backend 一次回當日全 rows + 當月 month_counts → 前端零 fetch 再加工。

## 4. 現況 vs 目標

| 面向 | 現況 | 目標 |
|---|---|---|
| 行為 | 當日全表,只能排序 | 加標的選擇(輸入代號 + 當日名單挑選),選定 → 只顯示該檔當日筆數;可清除回全表 |
| 資料 | payload 已含全部所需 | 不變(client-side filter;候選名單 = rows 內 distinct stock_id) |
| API / signature | `GET /api/daytrade-fee` | **不動**。`DaytradeFeeTable` props(rows, monthCounts)不變 — 篩選在 page 層做完再傳入 |
| 對 caller 影響 | — | 無外部 caller 受影響(模組自成一體) |
| backward compat | — | 無 API / 資料格式 / localStorage 變動,無 migration |
| e2e | BF1(資料級鎖)/ BF2(mode 持久化) | BF1/BF2 不該紅(預設態 = 無篩選全表);新篩選行為 e2e 歸屬 Phase 2 定案 |

## 5. 風險備忘

- BF1 鎖 `rows.first()` 的 data-stock-id 與 feeHigh count — 新 UI 不得改預設渲染結果。
- 選單只列「當天有列入」= 從 `data.rows` 取 distinct(twse+tpex 合併),不是另抓 symbol universe。
- 手動輸入代號若不在當日名單 → 行為需在 Phase 2 定(顯示「該檔今日未列入」vs 空表)。
