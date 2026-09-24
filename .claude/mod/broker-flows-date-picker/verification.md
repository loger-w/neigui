# Verification — mod/broker-flows-date-picker(2026-09-24)

證據目錄:`evidence/`。自動化指令來源:`.claude/harness.json`(4 gate)+ e2e(判準表「需要」:flows UI + FAKE fixture)。
`react-doctor` 不在 frontend devDependencies → 該 gate 不適用。

## 自動化 gate

### Round 1(HEAD = 21c8d44,review 前)
| Gate | 指令 | cwd | exit | 結果 | log |
|---|---|---|---|---|---|
| backend | `python -m pytest -q` | backend | 0 | 731 passed, 1 skipped | `gate_backend_pytest.log` |
| backend-lint | `ruff check .` | backend | 0 | All checks passed | `gate_backend_ruff.log` |
| frontend-test | `npm test` | frontend | 0 | 102 files / 1202 passed | `gate_frontend_vitest.log` |
| frontend-build | `npm run build` | frontend | 0 | built | `gate_frontend_build.log` |
| e2e(全套) | `npm test`(NEIGUI ports 8010/5183) | e2e | 0 | 72 passed | `gate_e2e.log` |

### Round 2(review fix 後,HEAD = 3a3b03e / c3a8335 僅 docs)
backend 自 round 1 起零改動(fix 波只動 frontend / docs),pytest / ruff 結果沿用。
| Gate | 指令 | cwd | exit | 結果 | log |
|---|---|---|---|---|---|
| frontend-test | `npm test` | frontend | 0 | 102 files / 1205 passed | `gate_frontend_vitest_r2.log` |
| frontend-build | `npm run build` | frontend | 0 | built | `gate_frontend_build_r2.log` |
| tsc | `npx tsc -b` | frontend | 0 | 0 errors | `gate_frontend_tsc_r2.log` |
| e2e(flows 相關) | `playwright test -g "E30\|E37\|E47\|N5\|N6"` | e2e | 0 | 5 passed | (console) |
| e2e(全套) | `npm test` | e2e | **1** | 71 passed / **1 failed = E34** | `gate_e2e_r2.log` |

**E34 失敗判定 = 既有 flake,非本分支造成**:
- 失敗點:E34(WL-1 自選清單)SymbolSearch `getByRole("option")` 15s 0 筆 — 與 `docs/next-time.md` 既有條目同一步。
- 分支單跑 `-g E34 --repeat-each=3`:2 failed / 1 passed(`gate_e2e_E34_triage.log`)。
- **merge-base 8d9c5a6 主樹**同指令:1 failed / 2 passed,同一步失敗(`gate_e2e_E34_baseline_main.log`)。
- 本分支未觸及 SymbolSearch / symbols 路徑;round 1 全套 E34 為綠。未 skip、未改 assertion;next-time 條目翻新記錄反證「無負載即綠」(c3a8335)。

TDD 紅先行紀錄:ticket 01 hook 索引斷言先紅;ticket 02 新 RTL 9 條先紅;ticket 03 onPickStock 2 條先紅 + E47 後半先紅(個股頁日期 06-26);review Spec-4 跨午夜 RTL 先紅。E47 前半另做變異檢查(hook 不傳 date → 卡「資料日 06-25」紅)。

## 真實環境

環境:FinMind 帳號 Free(level 1,user_info 實測)→ trader-only path 全日期 400;後端(主樹 = merge-base,後端 code 與分支相同)起 :8020、`CHIP_DATA_DIR` 指 scratchpad 複本(僅 `bflow_9600_2026-07-20` 等 3 檔 cache);前端 worktree `vite :5175`。收尾已關閉,port 釋放確認。

### API 層(`realenv_api.txt`,經 vite proxy)
- happy:`date=2026-07-20` → 200,as_of 07-20,stock_count 1012,buy_top 景碩 / 台積電
- edge:`date=2026-02-31` → 400 `invalid_date`(W9)
- edge:`date=2026-07-10`(未快取)→ 502 `finmind_error`(Free 帳號)
- regression:不帶 date(最新模式)→ 502 `finmind_error`(Free 帳號;現況,非本改動)

### UI 截圖(opus sub-agent,chrome-devtools MCP;全 PASS)
| SC | 判定 | 可指認表述 | 截圖 |
|---|---|---|---|
| SC-1 | PASS | 未選分點已顯示「選擇日期」= 2026-09-24,樣式 class 與個股頁日期欄相同 | `SC-1_date-field-idle.png` |
| SC-2 | PASS | 選 9600 → 設 07-20 → 錯誤橫幅消失、「資料日 07-20」「共 1012 檔,各列前 30」、買超首列景碩 / 台積電;表頭序 搜尋 → 富邦☆ → 日期 → 資料日 → 共…檔 → 重新整理(最右);200 請求帶 `date=2026-07-20` | `SC-2_happy-0720.png` / `_r2` |
| SC-3 | PASS | 年份逐鍵 0002→0020→0202→2026,無 date 以 0 開頭的請求;打字不被 app 搶值;blur 後完整日期 | `SC-3_after-blur.png` / `_r2`、`SC-3_intermediate-0002_r2.png` |
| SC-4 | PASS | 切個股再切回,日期 07-20 / 資料日 / 9600 富邦 / 雙表仍在 | `SC-4_restored.png` |
| SC-5 | PASS | 點台積電 → 籌碼分析、2330、日期欄 2026-07-20;另見 `/api/chip/2330?date=2026-07-20` | `SC-5_equity-synced.png` |
| SC-6 | PASS | 設回 09-24 → 單發不帶 date 請求(502 預期)、欄位 09-24 | `SC-6_back-to-latest.png` / `_r2` |
| SC-7 | PASS | 375×812 表頭折 3 行,scrollWidth 375 ≤ 375 | `SC-7_mobile-375.png` |
| SC-8 | PASS | ☆ → 「常用 富邦 ×」、★;× 移除復原(未改功能抽驗) | `SC-8_saved-chip.png` |

Round 2(草稿模型修正後)重驗 SC-2 / SC-3 / SC-6 全 PASS(`*_r2.png`)。Console:僅預期的 502/503 resource 失敗 + favicon 404,無新 error。
另觀察(非本範圍):375 寬頂部 mode 列右側版本號被截斷 — 既有頂欄問題(next-time 已有頂欄換行條目)。

## 白名單逐條核對
| # | 保留證據 |
|---|---|
| W1 | RTL「預設最新模式:請求不帶 date」;E47 `toHaveValue("2026-06-26")` + 「資料日 06-26」;E30 全綠;real-env SC-6 單發不帶 date |
| W2 | 既有 combobox RTL 全綠(activedescendant / 截斷 / echo / dash);E37 綠 |
| W3 | N6 綠;real-env SC-8 |
| W4 | N5 綠(含日期擴充);real-env SC-4 |
| W5 | RTL onPickStock 第 4 參數 null(最新模式);App 僅 flowsAsOf 非 null 才 setDate;E30 綠 |
| W6 | RTL「已選日期下重新整理 → 同日 + refresh=true」;hook refresh 測試綠 |
| W7 | RTL「最新模式 + unavailable → 尚未上料」「錯誤碼映射」「stock_count>60」「無賣超」綠 |
| W8 | RTL「未選分點不打 flows API」、hook active gate 測試綠 |
| W9 | 後端零改動;pytest 731 綠;real-env 400 invalid_date |
| W10 | real-env SC-7(375 無橫捲) |

Migration:無(新增 sessionStorage key 缺值 = null = 最新模式);可逆:revert 前端 commits 即回現況。
