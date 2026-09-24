# Verification — mod/date-field-dark-calendar(2026-09-24)

證據目錄:`evidence/`。自動化指令來源 `.claude/harness.json` + e2e(判準表:跨 mode 視覺 → navigation.spec N#)。

## 自動化 gate
| Gate | 指令 | cwd | exit | 結果 | log |
|---|---|---|---|---|---|
| backend | `python -m pytest -q` | backend | 0 | 731 passed, 1 skipped | `gate_backend_pytest.log` |
| backend-lint | `ruff check .` | backend | 0 | All checks passed | `gate_backend_ruff.log` |
| frontend-test | `npm test` | frontend | 0 | 102 files / 1205 passed | `gate_frontend_vitest.log` |
| frontend-build | `npm run build` | frontend | 0 | built(含 tsc -b) | `gate_frontend_build.log` |
| e2e(全套,HEAD aea12c2) | `npm test`(ports 8010/5183) | e2e | **1** | 72 passed / **1 failed = E34** | `gate_e2e.log` |

frontend gate 跑於 32cd9cc;其後 aea12c2 只動 e2e spec 與 JSDoc 註解(行為不變),build 由 pre-push 再覆核。

**E34 失敗 = 既有 flake**:同一步 SymbolSearch `getByRole("option")` 15s 0 筆;前一個分支
(mod/broker-flows-date-picker)已以 merge-base 8d9c5a6 主樹同指令重現(1/3 紅,
`.claude/mod/broker-flows-date-picker/evidence/gate_e2e_E34_baseline_main.log`)。本分支只改 CSS,
未觸 SymbolSearch;N7 在全套內為綠。未 skip、未改 assertion。

TDD:N7 紅先行(computed `normal` → 改 CSS 後 `dark`);`toHaveCSS` 改寫後變異檢查(拿掉
color-scheme → 紅 `normal`)。版本釘選斷言事前標「該變」後先紅再改 changelog。

## 像素實驗(Playwright Chromium,#0e0c08 底)
- 收合狀態:`W1_closed_A_current.png` 與 `W1_closed_C_dark_inv035.png` 逐像素相同(diff bbox None);
  `W1_closed_B_dark_nofilter.png` 圖示變亮(peak 128→183)→ 需反算 invert 0.35。
- 鍵盤編輯選取段:`W2_focus_segment_before_after.png`(上:改前系統藍白字;下:dark 淺藍黑字)。
- 選取段改專案色可行性:Chromium 149 五種作者 CSS 全無效(見 change-spec 實作期追記)→ user 決定維持。

## 真實環境(opus sub-agent,chrome-devtools MCP;全 PASS)
| SC | 判定 | 可指認表述 | 證據 |
|---|---|---|---|
| SC-1 | PASS | 個股 / 選擇權 / 分點反查「選擇日期」computed color-scheme = dark;欄位底 / 邊框 / 字色不變,圖示最亮像素 (128,124,117) 與改前參考圖相同 | `SC-1_equity_field.png` / `SC-1_options_field.png` / `SC-1_flows_field.png` |
| SC-2 | PASS | 點月曆圖示 → 原生月曆**被拍到且為深色**(面板 #3b3b3b、白字、超過今天反灰、「清除 / 今天」藍字);Esc 關閉值不變 | `SC-2_popup_attempt.png` |
| SC-3 | PASS | 選擇權頁 html / body / 「選擇合約」`<select>` 皆 `normal`(未外溢,W5) | — |
| SC-4 | PASS | 月份段 ArrowUp / ArrowDown 正常增減(W2 行為) | — |
Console:僅預期 502 / favicon 404。

## 白名單
| # | 證據 |
|---|---|
| W1 | 像素實驗 A=C;SC-1 |
| W2 | SC-4 鍵盤行為正常;**外觀**:選取段反白改為淺藍黑字(已上呈,user 接受) |
| W3 | e2e 全套 equity spec 除既有 E34 flake 外全綠;DateField / App 的 TS 邏輯零改動(diff 僅 JSDoc) |
| W4 | E47 / N5 綠;BrokerFlowsPanel 零改動 |
| W5 | SC-3 |
| W6 | 收合逐像素不變 → baseline 預期無 diff(Linux baseline 本機無法比對,CI 覆核) |

Migration:無;可逆:revert 即回白底原生月曆。
