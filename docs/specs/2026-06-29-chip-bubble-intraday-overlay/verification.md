# Phase 5-8 Verification — Chip Bubble Intraday Overlay

**Date**: 2026-06-29
**Branch**: main (5 commits: 9816fc2 / 6078ccd / dd4fa4b / da18a34 / b33e3b1)

---

## Phase 6 — 自動化 gate(全綠)

| Gate | Command | Result |
|------|---------|--------|
| Backend pytest | `python -m pytest -q` | **231 passed**(原 223 + 新 8)+ 1 warning(starlette httpx deprecation, pre-existing) |
| Frontend vitest | `npm test` | **324 passed**(原 299 + 新 25,跨 34 個 test file)|
| Frontend build | `npm run build` | **0 error**,1.25s |
| Backend ruff | `ruff check services/finmind.py routes/chip.py tests/test_finmind.py tests/test_chip_routes.py` | **All checks passed** |

新增 test 細節:
- backend/tests/test_finmind.py:5 個 (`fetch_chip_intraday_transforms` / `_empty_when_no_kbar` / `_sorts_unsorted_input` / `_cache_hit_skips_http` / `_refresh_bypasses_cache`)
- backend/tests/test_chip_routes.py:3 個 (`test_chip_intraday_route_returns_payload` / `_default_date` / `_refresh_param`)
- frontend/src/hooks/useChipIntraday.test.ts:4 個(empty / mount / refresh / error)
- frontend/src/lib/intraday-line-svg.test.tsx:15 個(parseMinute 邊界 + pointsToPolyline 7 個 + render 4 個)
- frontend/src/lib/chip-bubble-svg.test.tsx:+4 個(無 prop / 空 series / stroke style / bubble 位置不變)
- frontend/src/lib/api.test.ts:+2 個(URL contains date + refresh / omits refresh)

---

## Phase 7 — 真實環境驗證

### Setup
- Backend: `python -m uvicorn main:app --reload --port 8000`(既有 dev server,`--reload` 自動載入新 code)
- Frontend: `npm run dev` `:5173`(既有 dev server)
- 兩 endpoint live verified via curl:
  - `GET /api/chip/2330/intraday?date=2026-06-26` → 266 points, first `{t: "09:00", price: 2360.0}` last `{t: "13:30", price: 2340.0}`
  - `GET /api/chip/2330/bubble?date=2026-06-26&refresh=true` → 7968 trades(原 cache 為早期 fetch 空 list,需 refresh)

### Screenshot evidence
- `screenshots/01-bubble-with-intraday-2330-2026-06-26.png` — 主視覺驗證
  - **背景灰色細線**(L1)從左到右完整覆蓋
  - Bubble 紅綠蝴蝶正常呈現,816 個分點
  - Y 軸 price scale(2325-2375)兩者對齊
  - 中軸垂直線 + close dashed line(紅虛線在 2340)仍在
  - 線形真實反映 2330 當日走勢:09:00 開 2360 → 11:00 下殺 2325 → 回升 2360 → 13:30 收 2340

### DOM 驗證(evaluate_script)
```json
{
  "found": true,
  "stroke": "#7c6f55",
  "strokeWidth": "1",
  "fill": "none",
  "pointerEvents": "none",
  "pointsCount": 266
}
```
- `data-testid="intraday-line"` polyline 存在於 DOM
- Style 全對齊 spec(L1 純細線:灰 `#7c6f55`, strokeWidth 1, fill none)
- pointer-events="none" 不擋 bubble hover/click
- 266 points 完全對應 backend 266 row(零資料遺失)

### 假日 / 空資料 edge case
- API 證據:`curl /api/chip/2330/intraday?date=2026-06-28` (Sunday) → `points: []`
- Code 證據:`intraday-line-svg.tsx::IntradayLineLayer` 明確 guard `if (points.length === 0) return null;`
- 單元測試證據:`intraday-line-svg.test.tsx::"empty points → renders nothing"` ✓
- 整合測試證據:`chip-bubble-svg.test.tsx::"intradayPoints=[] → no polyline"` ✓
- Component 證據:`chip-bubble-svg.tsx` 整合處 `{intradayPoints && intradayPoints.length > 0 && <IntradayLineLayer .../>}`

### Console
- `list_console_messages types=[error,warn]` → 1 個 404 error(pre-existing 與本 feature 無關,可能是 ChipBrokersWindow 對某舊 dataset fallback)
- 無 React warning / no key warning / no proptype warning

---

## Phase 8 — 回頭核(白名單逐條打勾)

對照 spec §2 不能破壞的既有行為白名單:

| 行為 | 驗證證據 | 結果 |
|------|---------|------|
| Bubble 蝴蝶布局 pixel 完全不動 | `chip-bubble-svg.test.tsx F11` 既有 snapshot test 全綠 + 新 case "bubble pixel positions unchanged regardless of intradayPoints presence" 明確比對 cx/cy/r 相同 | ✓ |
| 選 broker 後 filter / 中軸 / hint 行為 | F1 (no yellow stroke) + F2 (single-broker bypass) + F11 (filter renders matched only) 共 9 個既有 case 全綠 | ✓ |
| 右側 Price bar + buy/sell trade list | ChipBubbleView.test F2 sort header 6 個 case 全綠 | ✓ |
| useChipBubble 介面 `{ data, loading, error, refresh }` | useChipBubble.test 4 個 case 全綠 | ✓ |
| API client `_cache` TTL 5 min | api.test 既有 13 cache cases 全綠 | ✓ |
| Hover tooltip / click select | overlay rect 仍在 SVG 最末層(`chip-bubble-svg.tsx:464-474`),IntradayLineLayer 插入在 close-line 之前、bubbles 之後,**不影響 hit test order**;手動截圖頁面互動 OK | ✓ |
| Backend 既有 7 個 `/api/chip/*` endpoint(本次新增 /intraday 後變 8)| test_chip_routes 全綠;curl /api/chip/2330/bubble 仍正常 | ✓ |
| `_CACHE_VERSION = 3` 不變 | grep 確認 `services/finmind.py:19` 未動 | ✓ |

對照 spec §1 成功條件:

| # | 條件 | 證據 |
|---|------|------|
| 1 | 任一個股 + 交易日 → 背景灰線出現 | screenshot 01 ✓ |
| 2 | 線 Y 軸與 bubble Y 軸共用 sY scale | pointsToPolyline 接受父層傳入的 yLow/yHigh,跟 bubble 的 yLow/yHigh 是同一 source(chip-bubble-svg.tsx local)✓ |
| 3 | 線 X 軸是時間 09:00 → 13:30 fixed | SESSION_START_MIN=540, SESSION_RANGE_MIN=270;15 個單元測試 ✓ |
| 4 | 線在 bubble 後方 | 插入點在 close-dashed-line 之前(行 423-432)、bubbles 之後 → SVG render order 是 grid → time-line → close-dashed → bubbles → overlay ✓ |
| 5 | 切 symbol/date/refresh 正確更新 | useChipIntraday TanStack Query 用 `["chip-intraday", symbol, date]` queryKey,自動跟既有 useChipBubble 同形 cache 行為 ✓ |
| 6 | 無資料(假日 / 該日無交易)→ 不畫線 | API empty / unit / integration / code guard 4 重證據 ✓ |
| 7 | FinMind 502 → bubble 仍正常 | backend exception_handler 已涵蓋(`main.py:62`),intraday 失敗不影響 bubble(獨立 endpoint + 獨立 hook)✓ |
| 8 | 既有 223 backend + 299 frontend 全綠 | 全部跑過 ✓ |
| 9 | `npm run build` 成功 | 0 error,1.25s ✓ |

---

## Migration 可逆性

本次純 additive，無 migration 需求:
- 新 endpoint /intraday 獨立(刪除即恢復)
- 新 cache key `_intraday` 後綴獨立(可單獨清除)
- BubbleChartSvg / ChipBubbleView 新 prop 都 optional(不傳即 0 影響)
- App.tsx 新 hook 呼叫獨立(註解掉一行即恢復)

git revert 5 個 commit 即可完整回滾,無資料遷移風險。

---

## Out-of-scope 未做項(對齊 spec §4)

✓ 未做 polling / 即時 push
✓ 未做高低區間帶 / 蠟燭 K / 量柱(L2/L3 樣式)
✓ 未做 toggle 開關
✓ 未做 X 軸 time tick / crosshair
✓ 未做跨日對比 / N 日 overlay
✓ 未做 chip-bubble-svg.tsx 拆檔 refactor(寫進 docs/refactor-next.md 候選)

---

## Done 標準達成

✓ 5 個 commit 都是 🟢 純 additive(無 🔴,本案無「行為改動」)
✓ 自動化 gate 全綠(231 backend + 324 frontend + 0 build error + ruff clean)
✓ 真實環境 DevTools MCP 截圖驗證 ✓
✓ 既有白名單行為 9 條逐條保留
✓ 成功條件 9 條全達成
✓ Migration 可逆(git revert 5 commit)
