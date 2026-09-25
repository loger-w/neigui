# Verification — fix/e34-symbolsearch-option-flake(2026-09-25)

## 自動化 gate(harness.json + e2e)
第一輪 = review 前(HEAD 3bdabb2);final = review 修正後(HEAD 034dd3e,含 57c6227 / 034dd3e)。

| Gate | 指令(cwd) | 第一輪 | final |
|---|---|---|---|
| backend | `python -m pytest -q`(backend) | exit 0 — 731 passed, 1 skipped | 未重跑(本分支無 backend 改動;push 時 pre-push 會再跑) |
| backend-lint | `ruff check .`(backend) | exit 0 — All checks passed | 同上 |
| frontend-test | `npm test`(frontend) | exit 0 — 102 files / 1217 passed | exit 0 — 102 files / 1218 passed |
| frontend-build | `npm run build`(frontend) | exit 0 | exit 0 |
| e2e | `npm test -- --reporter=line`(e2e,NEIGUI_BACKEND_PORT=8010 / NEIGUI_FRONTEND_PORT=5183) | exit 0 — 74 passed | exit 0 — 74 passed |
| E34 repeat×30 | `npx playwright test specs/equity.spec.ts -g E34 --repeat-each=30` | 30 passed(`loop-after-fix-…`) | exit 0 — 30 passed |

原始輸出:`evidence/gate-*.txt`、`evidence/final-*.txt`、exit code 彙整 `evidence/gate-exit-codes.txt` / `evidence/final-exit-codes.txt`。
e2e 歸屬(e2e-conventions 判準表):equity mode 搜尋 flow → `equity.spec.ts`;E34 assertion 不改(修的是產品端,非 spec)。

## 修前 / 修後迴圈 + 反向驗證
見 `diagnosis.md` Phase 6 表(E34 repeat×30:7/30 紅 → 0/30);反向驗證:只撤元件修正 → vitest 2 條紅 + A2 10/10 紅,
還原 → 綠。Spec-1 補測同法:撤 handleChange 取消 → 新測試紅(1 failed / 16 passed),還原 → 17/17。

## 真實環境(backend :8020 真 FinMind Free tier;fixed vite :5175 = worktree;pre-fix vite :5176 = main 86593f0)
Playwright headless,opus sub-agent 執行,main session 覆核 SC-1 兩張截圖。詳 `evidence/realenv-results.txt`。

| SC | 結果 | 依據 | 截圖 |
|---|---|---|---|
| SC-1 原始重現步驟(選 2330 → 點「籌碼分析」→ 10ms → 填 2412 → 500ms) | PASS | fixed 10/10 下拉仍開(「2412 中華電」);**pre-fix 9/10 被關** | `evidence/SC-1_fixed.png` / `SC-1_prefix.png` |
| SC-2 edge:不回來仍會關 | PASS | 填 23 出 20 個 option,點標題 400ms 後 listbox 0 | `evidence/SC-2_closes.png` |
| SC-3 edge:滑鼠點選項仍可選股 | PASS | header 顯示 2317 鴻海 | `evidence/SC-3_mouse_pick.png` |
| SC-4 edge:Enter 選股 | PASS | header 顯示 2412 中華電 | `evidence/SC-4_enter_pick.png` |
| U-1 未改功能:mode 切換 | PASS | 選擇權 → 個股後搜尋照常 | `evidence/U-1_mode_switch.png` |
| U-2 未改功能:自選清單 | PASS | 加入當前 → 換股 → 點清單項切回 2330 | `evidence/U-2_watchlist.png` |

Console:非預期錯誤 0。已知:`/api/chip/<symbol>` 502 `finmind_error`、`brokers_window` 503 — FinMind 帳號 Free tier
(券商分點日報 400),與本修正無關。
