# Verification — mod/root-color-scheme-dark(2026-09-25)

證據:`evidence/`(gate log、Playwright 實驗圖)+ `docs/specs/root-color-scheme-dark/screenshots/`(真實環境改前 / 改後,CLAUDE.md §6)。

## 自動化 gate(最終 HEAD 程式碼 = 43889b3;其後僅截圖 / artifacts)
| Gate | 指令 | cwd | exit | 結果 | log |
|---|---|---|---|---|---|
| backend | `python -m pytest -q` | backend | 0 | 731 passed, 1 skipped | `gate_backend_pytest.log` |
| backend-lint | `ruff check .` | backend | 0 | All checks passed | `gate_backend_ruff.log` |
| frontend-test | `npm test` | frontend | 0 | 102 files / 1205 passed | `gate_frontend_vitest.log` |
| frontend-build | `npm run build` | frontend | 0 | built(含 tsc -b) | `gate_frontend_build.log` |
| e2e(全套) | `npm test`(ports 8010/5183) | e2e | 0 | **73 passed** | `gate_e2e.log` |

frontend / e2e gate 於 review 修正後(c18c2ab + 工作樹 changelog 用詞)重跑;backend 本分支零改動。
TDD:N7 擴充 html 斷言紅先行(`normal` → `dark`);版本釘選斷言事前標「該變」後先紅再改。

## Playwright 實驗(Chromium 149)
| 項目 | 改前(normal) | 改後(dark) | 證據 |
|---|---|---|---|
| CSS 載入前畫布 | 白 (255,255,255) | 深 (18,18,18) | `preCSS_canvas_*.png`(對 :5176 / :5175 擋 script + stylesheet) |
| number 上下鈕 | 淺 (252,252,252) | 深 (44,44,44) | `controls_before_after.png` 下半 |
| `<select>` 展開清單 | 清單底已是深色;選中列藍 (25,103,210) 白字 5.37:1 | 清單底不變;選中列淺藍 (153,200,255) 深灰字 6.43:1 | `controls_before_after.png` 上半 |
| 預設鍵盤焦點框 | 黑外圈為主 | 白外圈為主(較明顯) | `focus_ring_before_after.png` |
| 一般文字反白 | (4,55,160) | (4,55,160) 不變 | — |

## 真實環境(claude-in-chrome;chrome-devtools MCP profile 被占用)
| SC | 判定 | 可指認表述 | 截圖 |
|---|---|---|---|
| SC-0 | PASS | root color-scheme before `normal` → after `dark`;after meta = dark;select / 輸入框 / 日期 / 捲動容器 computed 皆 dark | — |
| SC-1 | PASS | 分點反查 9600@07-20 捲軸:1280 與窄視窗 before / after 逐像素相同(W1) | `SC-1_*` |
| SC-2 | PASS(收合)/ 展開清單改由 Playwright 補驗 | 收合 select 框與箭頭逐像素相同(W2);展開清單 claude-in-chrome 未拍到 → 上表實驗 | `SC-2_*` |
| SC-3 | not_executed(real-env)→ Playwright 補驗 | 選擇權頁無 number 欄位、逾時未及大盤頁;上下鈕以上表實驗為證 | — |
| SC-4 | 記錄 | 搜尋框 Ctrl+A 反白 before / after 相同(W5) | `SC-4_*` |
| SC-5 | PASS | 分點反查表頭相同;日期框邊緣 ≤8 差(150ms transition 截圖時機) | `SC-5_*` |
Console:選擇權頁無 error。

## 白名單
| # | 證據 |
|---|---|
| W1 | SC-1 逐像素相同(Chromium;Safari 未驗證) |
| W2 | SC-2 收合 select 逐像素相同 |
| W3 | 自製 checkbox(原生 sr-only)、number-field / RangeSelector(上下鈕已隱藏)未受影響 — 程式碼零改動;e2e 全綠 |
| W4 | N7 三頁日期欄位 dark;DateField 收合外觀未動(僅註解) |
| W5 | SC-4 相同;SC-5 表頭相同 |
| W6 | e2e 73 全綠;token 未改 |

預期可見變化(已列 changelog):number 上下鈕轉深、預設焦點框更明顯、開頁不閃白。
Visual baseline:CI 不比對(`--grep-invert @visual`);merge 後觸發 `e2e-update-snapshots` 重產,diff 由 user 審。
〔追記 2026-09-25〕run 36044930682 已完成:Linux 重產 V1–V6 與既有 baseline **完全相同**(create-pull-request:
`Branch 'e2e/refresh-visual-baselines' is not ahead of base 'main'`,未開 PR)→ 無 visual diff,無需 user 審 baseline。
Migration:無;可逆:revert 即回。
