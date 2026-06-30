# Brainstorm — E2E Testing Framework

**Slug**: `e2e-tests`
**Start SHA**: `1590ea7`
**Branch**: `feat/e2e-tests`
**Date**: 2026-06-29

---

## 動機 (Goal)

為 trash-cmoney 全棧加 E2E 測試框架,目標達到 **1.0.0 release confidence**:
1. 每次改動可機械化確認「3 mode + API + UI 截圖」全綠
2. 抓出 FinMind upstream 契約漂移(本機 opt-in 模式)
3. CI 上 push/PR 自動跑全套,visual baseline 進 git diff

非目標:取代既有 vitest unit test / pytest service-level test。E2E 是**整鏈路 smoke + golden path regression**,不取代下層測試金字塔。

---

## 成功條件 (Success Criteria)

每條 SC 附「驗證方式」(指令 / 測試名 / 截圖步驟)。

### SC-1: Playwright E2E framework 可在本機運作
- **驗證**:`cd frontend && npm run e2e` 退出碼 0,test report 顯示所有 spec ran
- **scope**:Playwright + @playwright/test 安裝,`e2e/playwright.config.ts` 設定 Chromium-only,webServer 自動啟 backend (uvicorn + `FAKE_FINMIND=1`) + frontend (vite)
- **edge**:依賴只跑 Chromium(Firefox / WebKit 列 out of scope)

### SC-2: Backend 支援 `FAKE_FINMIND=1` 切假料
- **驗證**:`FAKE_FINMIND=1 python -m uvicorn main:app --port 8001` 啟動後,`curl localhost:8001/api/chip/2330?date=2026-06-26` 回 fixture 內容(不打 FinMind)
  - [amendment 2026-06-30: 日期由 2026-06-27 改 2026-06-26 — 06-27 是 Saturday 不是 Friday,fixture pin 必須是真實交易日]
- **scope**:`services/finmind.py` 的 `get_finmind()` 在環境變數 = `"1"` 時回 `FakeFinMindClient`,讀 `tests_e2e/fixtures/*.json` by `(dataset, stock_id, date)` 查表
- **edge**:fixture 查無 → 回空 list(對應 no_trading_day)

### SC-3: equity mode golden path E2E
- **驗證**:`npx playwright test e2e/equity.spec.ts` 綠
- **scope**(5 test case):
  1. 首頁 default render(籌碼分析 title + SymbolSearch + 重新整理 disabled)
  2. 搜尋 2330 → 顯示三大法人 + brokers panel + K 線
  3. 籌碼總覽 ↔ 泡泡圖 tab 切換,泡泡圖元件 lazy load 成功
  4. 點 broker → broker series overlay 出現在 K 線
  5. 重新整理 button click → spinner 出現 → 資料 refresh
- **edge**:symbol input 空狀態的 disabled 狀態正確

### SC-4: options mode golden path E2E
- **驗證**:`npx playwright test e2e/options.spec.ts` 綠
- **scope**(4 test case):
  1. 切到 options mode → OptionsPage lazy load → 4 cards (Max Pain / OI Walls / PCR / Institutional) 同時 render
  2. Refresh button 同時 invalidate 4 個 hook(全 4 spinner 出現)
  3. Spot price + 履約價 ladder 顯示
  4. 大戶 OI strip 顯示
- **edge**:fixture 提供 weekly contract `TXO202607W2` 與月選 `TXO202607` 並行情境

### SC-5: market mode golden path E2E
- **驗證**:`npx playwright test e2e/market.spec.ts` 綠
- **scope**(3 test case):
  1. 切到 market mode → 熱力圖 (sectors heatmap) + leaderboard 同時 render
  2. Leaderboard tab 切換(漲幅 / 跌幅 / 成交額)
  3. 點 leaderboard 股票 → 跳回 equity mode 且 SymbolSearch 已帶入該股號
- **edge**:fixture universe 不能含 index rows (001/002),需 filter 過

### SC-6: mode 切換 + localStorage 持久化
- **驗證**:`npx playwright test e2e/navigation.spec.ts` 綠
- **scope**:
  1. 三 mode toggle button 全可點 + active style 切換
  2. Reload 頁面後 mode 維持(讀 `localStorage["mode"]`)
  3. SymbolSearch / chip_window_days / chip_panel_width 各自 localStorage roundtrip
- **edge**:首次訪客(localStorage 空)default 是 equity mode

### SC-7: Backend API contract pytest
- **驗證**:`cd backend && python -m pytest tests_e2e/ -v` 綠
- **scope**:
  1. `/api/chip/{symbol}` happy + 404(symbol 不存在)+ 400(date 格式錯)
  2. `/api/options/{option_id}/{contract_date}` 系列 endpoints(max_pain / oi_walls / pcr / large_traders / strike_volume)happy + error shape
  3. `/api/market/{type}` (heatmap / leaderboard) happy + sector filter
  4. `/api/symbols/{symbol}` happy + 404
  5. **所有** error response shape `{"detail": {"error": "<code>"}}` 鎖死 schema(用 pydantic 或手寫 assert)
- **edge**:gzip middleware 在 response > 1000 bytes 時觸發 (test `Content-Encoding: gzip` header)

### SC-8: no_trading_day fallback E2E
- **驗證**:`pytest tests_e2e/test_api_no_trading_day.py` + `playwright test --grep "no trading day"` 雙綠
- **scope**:
  1. Backend:傳週六日期 → response 含 `no_trading_day: true`
  2. Frontend:options mode 載入週六日 → 顯示「無交易日」訊息(繁中)
- **edge**:跨假日(連假首日)的 fallback 取最近 T-1

### SC-9: Visual regression baseline
- **驗證**:`npx playwright test e2e/visual.spec.ts` 第一次 `--update-snapshots` 建 baseline;後續 run 比對 < threshold
- **scope**:
  1. Equity mode top-of-page 截圖(symbol = 2330, date = 2026-06-27 鎖死)
  2. Options mode top-of-page 截圖
  3. Market mode top-of-page 截圖
  4. Threshold:`maxDiffPixelRatio: 0.01` (1% pixel diff 容忍)
- **edge**:Windows 本機 vs Linux CI 字型差異 → baseline 只在 CI 環境(Linux)生成,本機跑 visual.spec.ts 跳過(`test.skip(os.platform() === 'win32')`)

### SC-10: GitHub Actions CI workflow
- **驗證**:推 commit 到 `feat/e2e-tests` → Actions run 顯示 `e2e.yml` 完成,所有 step 綠
- **scope**:
  1. `.github/workflows/e2e.yml`:install Node + Python → install deps → install Playwright browsers → run backend pytest + frontend e2e + visual baseline → upload trace artifact 失敗時
  2. Trigger:`push` to any branch + `pull_request` to main
  3. Run time 目標 < 5 分鐘(Chromium-only + fixture-mode + 不打 FinMind)
- **edge**:Playwright trace 上傳到 GitHub artifact 供 debug

### SC-11: `npm run e2e:live` 真打 FinMind opt-in 模式
- **驗證**:`FAKE_FINMIND= cd frontend && npm run e2e:live -- --grep "upstream contract"` 在本機(有 FINMIND_TOKEN)跑得綠
- **scope**:獨立 spec `e2e/live-contract.spec.ts`,只跑 happy path × 3(equity 一個 / options 一個 / market 一個),驗證真 FinMind 回應 schema 對得上前端 type
- **edge**:FINMIND_TOKEN 過期時 test fail 訊息明確顯示「token expired, update .env then re-run」

---

## Edge Cases (≥3)

- **E1: FinMind JWT 在 CI 過期**:fake-mode 完全免疫(CI 永遠不打 FinMind),只 `e2e:live` 本機才會撞;e2e:live 失敗訊息要明確指向 token expiry
- **E2: 假日 / no_trading_day**:fixture 必須含 `2026-06-27 (Sat)` 這類 empty-day case,後端正確 fallback 到 T-1,前端顯示繁中「無交易日」
- **E3: 兩 mode 同時 mount race**:CLAUDE.md §9 提到 App.tsx ternary 不能變 hidden div 雙掛載,Playwright 驗證 mode 切換時對應 `data-testid` 只出現一個 mode
- **E4: Visual baseline 跨 OS 字型差異**:Windows 本機 vs Linux CI,baseline 只在 Linux CI 生成;`visual.spec.ts` 在 Win32 平台 skip
- **E5: TanStack Query refetchInterval 干擾 test**:market mode `useMarketSnapshot` 有 polling,E2E 內 mock `refetchInterval` 設為 `false` 或用 `page.clock.install()` 凍時間
- **E6: Playwright 預設 storage state isolated**:SC-6 reload 測試需 `context.storageState()` 顯式持久

---

## Out of Scope

- 跨瀏覽器(Firefox / WebKit / Safari)— 只跑 Chromium,1.0+ 再加
- 行動裝置 viewport / responsive 測試
- Authentication / login 路徑(專案沒有)
- Real FinMind 在 CI 跑(只 local opt-in)
- Performance regression(perf PR 已有量測腳本,不混 E2E)
- 元件層 RTL component test 重寫(vitest 領域)
- E2E 內測 changelog popover 內容(VersionBadge.test.tsx 已 cover)
- Cross-mode pivot 的全 state reset 行為深度測(SC-5 case 3 只驗 symbol 帶入)
- Database / migration(無 DB)

---

## S / M / L 分流

**L** (寫入 `state.json.scope`)

理由:
- 新增檔案 ≥ 8(`playwright.config.ts` + 3 spec + helpers/ + `tests_e2e/` + `services/finmind.py` 改動 + `.github/workflows/e2e.yml` + `frontend/package.json` scripts)
- 跨前後端(backend FAKE_FINMIND + frontend Playwright + CI yaml)
- 雖未碰鑑權 / 金流 / 加密,但 **CI workflow 是基礎建設等級改動**,L 處理較穩
- Phase 1/2 各 max 3 輪 review

---

## Open Questions(進 Phase 1 前需 user 確認)

1. **brainstorm §1 架構是否照案採納?** 特別是:
   - `FAKE_FINMIND` env 旗標切 fixture(vs vcrpy / pytest-httpx style)— 上題已選此案
   - Fixture 鎖死 `2026-06-27`(vs rolling 最近交易日)— 默認鎖死
2. **SC-7 backend API contract test 放 `tests_e2e/` 還是擴 `tests/`?**
   - 推薦 `tests_e2e/`:跑法不同(需啟 FAKE_FINMIND + 完整 app),分目錄好 CI 分流
3. **SC-9 visual baseline 政策**:
   - 推薦只在 Linux CI 生成,本機跑 visual.spec.ts skip(否則 Windows 本機 = 不會綠的 noise)
4. **SC-10 CI 是否 fail-fast 或全跑完?**
   - 推薦全跑完(收集所有失敗 trace 一次性看),只在 backend pytest 完全失敗時才提前終止

---

## State 同步

`state.json.scope = "L"`,SC 共 11 條,進 Phase 1 前先 sync `sc_cycle_counts` 加 SC-1 ~ SC-11 子物件。
