# Diagnosis — E34 SymbolSearch option flake(2026-09-25)

## 症狀
E34(WL-1)`fill("2412")` 後 `getByRole("option")` 15s 內 0 筆。失敗快照:搜尋框 focused、值 = 2412、無 listbox。
fill 後無任何 `/api/symbols/all` 請求(清單早已載入,beforeEach 的 2330 下拉正常)。

## Phase 1 — 迴圈與基準
- 原 spec:`npx playwright test specs/equity.spec.ts -g E34 --repeat-each=N`(NEIGUI_*_PORT 8010/5183)
  → 2/10、7/30 紅(~23%),全紅在 `equity.spec.ts:820`。
- 臨時縮減 spec `e2e/specs/zz-scratch-e34.spec.ts`(不 commit,診斷後刪)。

## Phase 2 — 縮減(每列 30 或 20 次)
| 變體 | 紅 |
|---|---|
| 完整(選 2330 → 加入當前 + 等清單項 → fill) | 7/30 |
| 拿掉「加入當前」 | 0/30 |
| 加入當前、不等清單項即 fill | 0/30 |
| 點標題(無關元素)即 fill | 2/30 |
| 點標題後等 5 / 10 / 15 / 20 / 25 / 30 / 40ms | 9/20、12/20 + 18/30、3/20、6/20、1/20、2/20、1/20 |
| 點標題後等 ≥ 60ms / 150ms | 0 |
| 不點任何東西、等 150ms | 0/30 |
| 不先選股(點進搜尋框 → 點標題 → 10ms → fill) | 0/30 |

最小重現 = 選股 → 點別處(搜尋框失焦)→ 150ms 內 fill → 下拉不出現(10ms 時 60%)。

## Phase 3 — 假說(user 2026-09-25 核可順序)
1. 失焦的 150ms 關閉計時器未在 focus / change 時取消 → 回來打字後被舊計時器關掉 ← **確認**
2. 主執行緒長任務(選股後畫圖)放大:讓短暫開啟的下拉在 assertion 前就被關(放大器,非根因)
3. SymbolSearch remount 遺失 open(快照值仍 2412,不支持)
4. useAllSymbols 暫時空清單(fill 後無 refetch,不支持)

## Phase 4 — 驗證(「出現後再等 HOLD ms 仍開著?」)
| 實驗 | 計時器 | 條件 | 結果 |
|---|---|---|---|
| A1 | 150 | 選股、d=10、hold=300 | 19/20 紅(11 從未看到、8 出現後被關) |
| A2 | 150 | 不選股、d=10、hold=300 | **20/20 紅**(全為出現後被關)— 確定性迴圈 |
| A3 | 150 | 不選股、d=200、hold=300 | 0/20(計時器已先觸發)|
| B1 | 1000 `[DEBUG-e34]` | 不選股、d=10、hold=300 | 0/20 |
| B2 | 1000 `[DEBUG-e34]` | 不選股、d=10、hold=1200 | 20/20 紅 |

關閉時點隨計時器常數移動 → 根因 = `SymbolSearch.tsx` `onBlur` 排的 `setTimeout(() => setOpen(false), 150)`
在重新 focus / 輸入時未 `clearTimeout`。「先選股」只是放大器:畫圖佔住主執行緒,短暫開啟的下拉在
assertion 看到前就被關,才從「出現後消失」變成「從未出現」(E34 的症狀)。

## Phase 5 決策(user 2026-09-25「都建議即可」)
- 修法:`onFocus` 與 `handleChange` 取消待觸發的關閉計時器(只改 SymbolSearch)。
- 回歸測試 seam:`SymbolSearch.test.tsx` vitest(假時鐘:失焦 → 10ms 內回來 → 過 200ms 下拉仍開),
  另補「沒回來照常關」鎖既有行為;E34 不改,以 repeat×30 作 e2e 確認。
- 同病 3 元件記 `docs/next-time.md`,本次不動。
- changelog:0.50.4(PATCH,fix / equity)。
- **事前標「該變」的斷言**:`changelog.test.ts:82-83`「最新版本是 v0.50.3」→ 0.50.4(版本釘選,隨 bump 必變)。

## Phase 6 — 修後驗證 + 反向驗證(fix = 9d5fd60)
| 迴圈 | 修前紅 | 修後紅 |
|---|---|---|
| A2(不選股、d=10、hold=300) | 20/20 | 0/20 |
| A1(選股、d=10、hold=300) | 19/20 | 0/20 |
| 最小重現 headingdelay d=10 | 18/30 | 0/30 |
| **E34 原 spec repeat×30** | **7/30** | **0/30** |

反向驗證(只 `git apply -R` 元件修正、測試保留):SymbolSearch vitest 2 條紅回來(16 中 2 failed)、
A2 10/10 紅 → `git checkout` 還原 → 16/16 綠。原始輸出見 `evidence/loop-*.txt`
(A1/A2/A3/B1/B2 與 nopick、d=5、d=10×30 為前景執行,數字即上表與 Phase 2/4 表)。

## 同病結構(blast radius)
同一「失焦計時器不取消」寫法另見:`BrokerSearch.tsx:177-181`、`BorrowFeeStockFilter.tsx:96-99`、
`BrokerFlowsPanel.tsx:192-193`(後者連 ref 都沒存)。SymbolSearch 唯一 caller = `App.tsx:434`。
