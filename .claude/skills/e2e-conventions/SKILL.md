---
name: e2e-conventions
description: Playwright E2E 框架慣例(FAKE_FINMIND 三層架構、clock 凍結、fixture rotation、selector 對 snapshot)+ E2E 判準表(本次改動要不要動 e2e、動哪個 spec 檔、豁免類型)+ 本機 dev server(:8000 / --reload)驗證前檢查。/feat /mod Phase 0 判 e2e 歸屬、寫或改 e2e spec、rotate fixture、real-env 驗證 backend 改動前先讀。
---

# E2E 測試框架慣例(2026-06-30 /feat e2e-tests 沉澱)

## E2E spec 新增 / 修改判準表(/feat /mod Phase 0 強制)

`/feat` / `/mod` 流程強制套用 — Phase 0 brainstorm 時就要決定本次改動屬哪格,寫進 `change-spec.md` / `brainstorm.md`,Phase 3 TDD 同步動 e2e spec。(2026-07-06 自專案 CLAUDE.md §1 移入;CLAUDE.md 只留指標。)

| 改動類型 | 對應 spec 檔 | 動作 |
|---|---|---|
| equity mode UI / flow(三大法人 / 主力券商 / K 線 / 搜尋 / range 切換) | `e2e/specs/equity.spec.ts`(E#) | 新功能 → 加 E# spec;改既有行為 → 改對應 E# assertion |
| options mode UI / flow(4 cards / strike ladder / large traders / refresh) | `e2e/specs/options.spec.ts`(O#) | 同上(O#) |
| market mode UI / flow(heatmap / leaderboard) | `e2e/specs/market.spec.ts`(M#) | 同上(M#) |
| 跨 mode 行為(mode toggle / localStorage 持久化 / mode 切換時 unmount) | `e2e/specs/navigation.spec.ts`(N#) | 同上(N#) |
| 無交易日 fallback(`no_trading_day` flag 行為) | `e2e/specs/no-trading-day.spec.ts`(NTD#) | 同上(NTD#) |
| Backend route response shape / `detail.error` 字串 / 新 endpoint | `backend/tests_e2e/test_api_*.py` + 若前端會用 → `e2e/specs/live-contract.spec.ts`(L#) | contract test 必補;前端 hook 接到的話加 L# schema 驗證 |
| 視覺(layout / typography / color token / spacing 大改) | `e2e/specs/visual.spec.ts`(V#)+ baseline PNG | 跑 `npm run test:update-snapshots` 或開 GitHub `e2e-update-snapshots` workflow,baseline diff 進 PR review |
| 純內部 refactor(hook 內部、lib 純函式、`*-svg.tsx` 算式、測試結構) | — | **豁免**,Phase 5 不必跑 e2e(commit message 註 `[no-e2e: internal refactor]`) |
| 純 backend service 重構(無 route 改動) | — | **豁免**(同上) |

**判準爭議 → 預設「需要」**:介於 user-facing 與內部之間的 grey zone(例:hook 回傳 shape 改動但 UI 視覺不變),預設算 user-facing 補 e2e。Phase 6 真實環境驗證若發現 e2e 漏抓的 regression → 回 Phase 0 補 SC + 補對應 spec(`/feat` Phase 7 失敗類型 (3) 「實作有做但測試漏」)。

**FinMind token / 即時資料相關**:e2e 預設跑 FAKE_FINMIND fixture(快、deterministic);若改動需要真打 FinMind 才能驗(例:新 dataset 接入)→ 加 `@live` tag 寫進 `e2e/specs/live-contract.spec.ts`,本機跑 `npm run test:live`,**CI 不跑 `@live`**(避免吃 token / 撞 rate limit)。

## FAKE_FINMIND 三層架構

- `services/finmind.py::FinMindClient.__init__` 在 `FAKE_FINMIND=1` 跳 httpx + token + 用 `NoOpBucket`;`services/finmind_fake.py::FakeFinMindClient(FinMindClient)` 繼承 + override `_get` 讀 `tests_e2e/fixtures/MANIFEST.json` preload。**不要** parse filename heuristic — explicit MANIFEST 對映 filename→{dataset, data_id} 是 6 輪 review 確認的唯一 sound path。新 fixture 寫進 fixtures/ 必同 commit 加 MANIFEST 條目,`backend/tests/test_fake_finmind_manifest.py` 3 個 gate 會抓 drift。Trigger:新增 FinMind dataset / 新 chip route fan-out 時。

## Clock 凍結

- `services/clock.py::today() / now()` indirection:全 backend `date.today()` 已 swap 成 `clock.today()`。`FAKE_FINMIND=1 + FAKE_TODAY=YYYY-MM-DD` 凍 backend 時鐘;production 走預設。**新 code 不准直接呼叫 `date.today()`,一律走 `clock.today()`** — `backend/tests/test_options_routes_clock.py` 鎖著「route 退回 wall-clock 就紅」的 timebomb(fixture 期約日過期後會自然引爆,爆了就是有 route 沒走 clock 或 fixture 該 rotate)。Trigger:新 route / service 用到今天日期時。

## Spec 撰寫紀律

- **痛點註解強制**:每個 `test('...')` 上方必 `// 痛點: <design rationale>` 註解,連回 design round 或 SC edge case。沒寫 = wrong reason 過綠。Trigger:寫任何 e2e spec 時。
- **Selector 必對 page snapshot,不准憑記憶**:第一次 run failure trace 帶 page snapshot,真實 placeholder / aria-label / role 全在。**真實值範例(已校齊)**:SymbolSearch placeholder = `搜尋代號或名稱...`;Mode buttons = `個股 / 選擇權 / 大盤`;Active state = `aria-current="page"`;RangeSelector = `aria-label="設為 N 日"`;ChipBrokersPanel / ChipKlineChart 早期 return path 也要 root testid。Trigger:寫 Playwright spec 任 selector 時。
- e2e 量測 viewport 幾何一律 `test.use({ viewport })` 在導航前固定 — `setViewportSize` 後立即量測會撞 resize relayout race(實測假綠)。Trigger:寫 viewport 量測 spec 時。

## Fixture rotation

- 政策:每季 + release 前。現行 fixture 基準日:trading day = 2026-06-26 (Fri)、no-trading-day = 2026-06-27 (Sat)(**每季 rotation 後更新本行**)。
- **任何 fixture date 寫死前必驗星期**:`python -c "from datetime import date; print(date.fromisoformat('YYYY-MM-DD').strftime('%A'))"` — 曾把週六誤記成週五,cascade 進 ~10 個 fixture filename + clock-pin + visual baseline。Trigger:rotate fixture / 新 fixture 寫死日期時。

## 本機 dev server(:8000)驗證前檢查(三條教訓合併,2026-07-03 定版)

1. **:8000 被占先查 CommandLine 再決定殺**:`(Get-CimInstance Win32_Process -Filter "ProcessId = <pid>").CommandLine`。
2. 帶 `--reload` 的 dev server **不能直接信任**:file watcher 會靜默失效(實測 worker 子行程 3 小時沒 respawn,期間所有 backend 改動沒生效 = 白驗)。**驗證 backend 改動前,對照 python 子行程 creationDate vs 改動時間**;不符就手動重啟。
3. 非 --reload 殘留 zombie(taskkill 殺不死)→ `Get-Process python | Stop-Process -Force` 清掉再跑。
- Trigger:e2e dev loop 撞 port / Phase 5-6 real-env 驗證 backend 改動前。
