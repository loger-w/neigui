# Task 6 report — e2e specs + backend contract + changelog

## 改動檔案(6,無新檔)

1. `backend/tests_e2e/test_api_market.py` — 追加 `test_market_snapshot_v2_keys`(含痛點 docstring),鎖 6 個 v2 key 存在性。
2. `e2e/helpers/selectors.ts` — 追加 6 個 market v2 testid 常數(`marketUniverseBanner` / `marketBreadthPanel` / `marketSectorBreadthHeatmap` / `marketSectorAmountShare` / `marketSectorVolRatio` / `marketClassicToggle`);header FOOTER ENFORCEMENT root testid 計數 10 → 16(既有 10 + 新 6)。
3. `e2e/specs/market.spec.ts` — 追加 M4(v2 panels 空狀態不 crash)/ M5(經典檢視預設展開防回歸)/ M6(折疊 toggle hidden 慣例),沿用既有 describe 的 `beforeEach`(installFixtureClock + mode=market)。
4. `e2e/specs/live-contract.spec.ts` — L3 追加 v2 四欄 + `universe_size` 存在性 assert,`breadth` 非 null 時驗 `known_gaps` / `mcclellan_series` 為 array。
5. `frontend/src/lib/changelog.ts` — CHANGELOG index 0 插入 `0.19.0`(大盤掃描全面改版,5 條 feature/global changes),date `2026-07-02`。
6. `frontend/src/lib/changelog.test.ts` — 硬編 top-version assert `0.18.2` → `0.19.0`,it() 名同步為「最新版本是 v0.19.0(大盤掃描全面改版)」;檔內其餘內容不動。

所有 6 個新 testid 已核對 Task 5 shipped 的 `MarketPage.tsx` / `MarketUniverseBanner.tsx` / `MarketBreadthPanel.tsx` / `MarketSectorBreadthHeatmap.tsx` / `MarketSectorAmountShare.tsx` / `MarketSectorVolRatio.tsx` 實際 `data-testid` 字串,完全對映無 typo。

## Red-phase 說明

- M4-M6:**implicit red-phase** — 這些 testid(`market-breadth-panel` 等)在 Task 5 落地前不存在,故若在 Task 5 之前寫這些 spec 會紅;Task 5 已 ship 對應 UI,本輪加 spec 後直接綠(標準紅綠,只是紅相位發生在前一 task,非本輪動作)。
- backend `test_market_snapshot_v2_keys`:對 main(P1-P4 已 ship)本來就綠,屬 characterization test,無紅相位(spec 原文已註明此點合法)。
- changelog:資料檔追加,無紅相位適用(spec 原文同樣說明)。

## 驗證證據

- `cd backend && python -m pytest -q tests_e2e/test_api_market.py` → `4 passed in 0.51s`
- `cd backend && python -m pytest -q`(全套)→ `471 passed, 1 skipped`
- `cd frontend && npx vitest run src/lib/changelog.test.ts` → `Test Files 1 passed / Tests 14 passed`
- `cd frontend && npx vitest run`(全套)→ `Test Files 53 passed / Tests 497 passed`
- `cd frontend && npx tsc -b` → 無輸出(clean)
- `cd e2e && npx tsc --noEmit` → `error TS2688: Cannot find type definition file for 'node'`,經 `git stash` 驗證此為**改動前既有環境問題**(`e2e/node_modules` 沒裝 `@types/node`,`package.json` devDependencies 也未列 — 與本次 6 個檔案編輯無關,pre-existing)。未修這個環境缺口(不在本 task scope)。
- Playwright suite 依指示**未執行**(留 Phase 5 驗證)。

## Commits

- A(e2e + backend contract):`6db9da1` — `🟢 test(market): e2e M4-M6 + snapshot v2 契約 keys for SC-11`
- B(changelog):`eb2270d` — `🟢 feat(frontend): changelog 0.19.0 — 大盤掃描 V2 SC-12`

## Concerns

- `e2e/tsconfig.json` 的 `types: ["node"]` 在目前 `e2e/node_modules` 缺 `@types/node` 下無法 typecheck(pre-existing,非本輪引入)。建議另開 ticket 補 `@types/node` 進 `e2e/package.json` devDependencies,否則往後任何 e2e spec 改動都無法用 `tsc --noEmit` 做靜態檢查,只能靠 Playwright 執行期抓型別錯誤。
- M4-M6 / L3 尚未經 Playwright 實跑驗證(依指示留給 Phase 5),本輪僅靜態核對 testid 字串與既有 fixture 行為假設(FAKE fixture 下 v2 四欄允許 null,不觸發整頁 error)。
