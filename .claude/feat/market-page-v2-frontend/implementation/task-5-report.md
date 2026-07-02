# Task 5 report: MarketPage.tsx V2 layout 重組 + 整合測試

## 結果

STATUS: DONE

## Commits

1. `3e0031d` 🟢 test(market): MarketPage V2 layout 整合測試 for SC-9 [red]
   - `frontend/src/components/MarketPage.test.tsx` — 新增 6 個 it() 涵蓋
     DOM 順序 / 新 5 元件 root testid render / 經典檢視預設展開 /
     toggle 折疊仍 mounted / loading data-state / error&&!data 整頁分支。
   - Red 確認:9 tests → 5 failed(新元件未接線)/ 4 passed(既有 3 +
     error-branch,error-branch 本就走既有邏輯所以先綠)。
2. `c85f3eb` 🔴 feat(market): MarketPage V2 layout 重組 SC-9 [green]
   - `frontend/src/components/MarketPage.tsx` — 依 brief 結構重寫:
     header / error banner 分支 byte-identical 保留;新增
     `data && <MarketUniverseBanner>`、`market-v2-grid` 三欄
     (`MarketBreadthPanel` / `MarketSectorBreadthHeatmap` /
     `MarketSectorAmountShare`+`MarketSectorVolRatio` 直欄);既有
     `MarketHeatmap` + `MarketLeaderboard` 收進可折疊「經典檢視」
     section(`useState(true)` 預設展開,普通 button + `hidden`
     attribute,無 Radix)。

## 測試證據

- `npx vitest run src/components/MarketPage.test.tsx` → 9 passed (9)
- `npm test`(全 frontend suite)→ 53 files / 497 tests passed
- `npx tsc -b` → 無輸出(clean)
- `npm run build` → 成功,`MarketPage-CKNnOnXy.js` 21.50 kB (gzip 6.89 kB)

## 一行測試摘要

vitest 9/9 (MarketPage) + 497/497 (全 suite) 全綠,tsc -b / vite build 皆 clean。

## Scope 確認

`git status --short` 兩次提交後僅動:
- `frontend/src/components/MarketPage.tsx`
- `frontend/src/components/MarketPage.test.tsx`

未碰 5 個子元件 / hook / 其他檔案。未用 `git add -A`,未用 `--no-verify`。

## Concerns / 下次處理清單

- `waitFor` 預設 1s timeout 對 `retry: 1` + exponential backoff 的
  error 終態測試不夠(§9 既有 lesson),red-phase 第一輪撞到過,已
  補 `{ timeout: 5000 }` 對齊既有 E7 測試寫法,非新問題。
- `richSnapshot` fixture 的 `sectors: []`(空陣列)沒有覆蓋經典檢視
  區塊「有實際族群 tile」的視覺路徑 — 現有 `MarketHeatmap.test.tsx`
  已覆蓋該案例,本檔測試目的僅驗證 mount/hidden 行為,判斷為可接受
  的裁切,未寫進「下次處理」清單。
- 未跑 e2e(Playwright)— 依 CLAUDE.md 判準表這屬 market mode UI/flow
  變動,理論上該補 `e2e/specs/market.spec.ts` M# spec,但本次任務範圍
  明確界定「只改 2 檔」,e2e spec 更新未列入 Task 5 交付項,留給後續
  task 或 user 決定是否補。
