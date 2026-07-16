# current-state — 權證展開列 IV 顯示重設計

日期:2026-07-16。Worktree `mod/warrant-iv-redesign`,base = origin/main 5553262。

## Caller map(grep 全覆蓋,無動態用法)

| 單元 | 檔案 | Caller |
|---|---|---|
| `WarrantIvHistory` 元件 | `frontend/src/components/WarrantIvHistory.tsx` | **唯一** `WarrantSelector.tsx:460`(展開列 `<td colSpan>` 內,`text-xs` wrapper)|
| `useWarrantIvHistory` hook | `frontend/src/hooks/useWarrantIvHistory.ts` | 唯一 WarrantIvHistory.tsx;測試 `useWarrantIvHistory.test.ts` |
| `computeIvChart` 純函式 | `frontend/src/lib/warrant-iv-svg.ts` | WarrantIvHistory.tsx + `warrant-iv-svg.test.ts` |
| `api.warrantIvHistory` | `frontend/src/lib/api.ts:247` | hook 唯一 |
| `WarrantIvHistoryPayload` 型別 | `frontend/src/lib/warrant-data.ts:38` | api.ts / hook / 元件測試 |
| backend `get_iv_history` | `backend/services/warrant_iv_history.py:381` | `routes/warrants.py:71`(`GET /api/warrants/{id}/iv-history`);測試 `test_warrant_iv_history.py`、`tests_e2e/test_api_warrants.py` |
| e2e | `e2e/specs/equity.spec.ts` E13 | 鎖 `TESTIDS.warrantIvChart` + `path[data-side=bid]` 的 `d` 屬性 `/^M[\d.]+,[\d.]+L/`;E12 鎖表格 drift 欄(本次不動)|

無 template-string / reflection 動態引用(grep `iv_history|iv-history|IvHistory` 全 repo 已掃)。

## 現況行為

- 展開列點擊 → `WarrantIvHistory` lazy 抓 `/iv-history`,固定 480×140 SVG:
  bid IV 實線(text-ink)、ask IV 虛線(text-ink-muted),3 條 y 格線(hi/mid/lo,%)、
  3 個 x tick(MM-DD)。缺值日斷線(M 重起不插值)。
- 文案:`買賣價反解引波(近 N 交易日)` + 圖例 + `歷史 IV 以現行條款近似`(條款近似日非空時)。
- drift 資料(label/slope_bid/slope_ask/n_valid)payload 有回但**展開列 UI 未用**
  (只在表格 `iv_drift` 欄顯示 `長期遞減/長期遞增`,`warrant-columns.tsx:35 DRIFT_TEXT`,本次不動表格)。
- hook 統一 shape `{data, loading, error, refresh}`,TanStack useQuery + signal 直傳。

## 關鍵資料事實(重設計的地基)

1. **標的收盤序列 backend 已有,不用新抓**:日檔 `warrant_iv_history` 每權證存
   `{b,a,c,s,ivb,iva}`,`s` = 標的收盤、`c` = 權證收盤。`_get_underlying_series` 目前只取
   `(ivb, iva)` → 補 `s`(與 `c`)只是組裝層暴露。e2e fixture
   `fixtures/warrants/iv_history.json` 同 shape 已含 `s`,**fixture 不用改**。
2. **同標的相對位階已有現成訊號**:盤中 quotes 的 `iv_percentile`
   (`warrant_quotes.py:255`,同標的同 kind 群組、樣本 ≥5 才算)。歷史自身區間位階
   (60 日 window 內今值分位)可由 series 前端直接算,無需 backend。
3. 序列窗 = 60 交易日檔(`WINDOW_FILES=60`),TPEx 落後日不寫入,缺值日 iv 為 null。

## Baseline(worktree,2026-07-16)

- backend `python -m pytest -q`:**708 passed, 1 skipped**(36.9s)
- frontend `npm test`:**806 passed**(83 files)
- e2e:未跑(Phase 6 前跑;E13 是本次會動的 spec)

## 現況 vs 目標

| 面向 | 現況 | 目標 |
|---|---|---|
| 尺寸 | 固定 480×140 | 吃滿表格寬(useContainerSize,ref 掛恆存 wrapper)|
| 資訊 | bid/ask IV 雙線 | (a) IV 位階(自身歷史區間 + 同標的相對)(b) IV vs 標的價疊圖(c) drift 證據強化 |
| payload | series/drift/terms_approx_dates | series 每點補標的收盤(underlying_close);shape 擴充 backward compat(加欄位不改既有欄)|
| 元大參照 | — | Phase 1.5 截圖研究後定(疊圖 / BIV-SIV / 位階 / 時間軸粒度)|

## Backward compat / 對 caller 影響

- payload **只加欄位不改既有欄** → hook/型別擴充,舊欄位語意不變;無其他 API consumer。
- e2e E13 鎖 `path[data-side="bid"]` + testid `warrant-iv-chart`:重設計若改 DOM 結構,
  E13 assertion 屬 🔴 該紅該改(spec 檔 equity.spec.ts,判準表「改既有行為 → 改對應 E# assertion」)。
- 表格檔(WarrantSelector/warrant-columns/warrant-utils)另一 session 的 mod 已 merge 進
  origin/main(5553262 收尾),衝突顧慮解除;本次仍只在必要時碰 WarrantSelector.tsx 展開列接線。
- 展開列既有互動(點擊展開 / colSpan 列)不動。

## 既有行為白名單(草稿,Phase 2 定稿)

1. 展開列 lazy 抓資料(未展開不打 API);loading/error/empty 三態繁中文案。
2. 缺值日斷線語意(不插值)。
3. `歷史 IV 以現行條款近似` 註記條件(terms_approx_dates 非空)。
4. 中性呈現:無方向性文案、drift 描述只陳述統計事實。
5. 表格 iv_drift 欄與其他表格欄不動;E12 不紅。
6. backend 三條供給線(daily archive / backfill / lazy read)與 cache 行為不動。
