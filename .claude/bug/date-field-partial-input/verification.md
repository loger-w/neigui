# Verification — fix/date-field-partial-input(2026-09-25)

## 自動化 gate(最終程式碼 HEAD = fd16003;其後僅 docs / artifacts)
| Gate | 指令 | cwd | exit | 結果 | log |
|---|---|---|---|---|---|
| backend | `python -m pytest -q` | backend | 0 | 731 passed, 1 skipped | `evidence/gate_backend_pytest.log` |
| backend-lint | `ruff check .` | backend | 0 | All checks passed | `evidence/gate_backend_ruff.log` |
| frontend-test | `npm test` | frontend | 0 | 102 files / **1214 passed**(+9) | `evidence/gate_frontend_vitest.log` |
| frontend-build | `npm run build` | frontend | 0 | built(含 tsc -b) | `evidence/gate_frontend_build.log` |
| e2e(全套) | `npm test`(ports 8010/5183) | e2e | 0 | **74 passed**(含 O7) | `evidence/gate_e2e.log` |

## 診斷迴圈與 regression
- L1(DateField vitest):修正前 4/4 紅 → 轉正為 `date-field.test.tsx` 7 條(紅先行)+ review 後 2 條
  (外部 value 丟草稿:紅先行;純原生路徑鎖定:characterization)。
- L2(選擇權頁 Playwright):修正前單鍵 9 支 `date=0002-06-26` → 轉正為 O7(紅先行 29 支 → 綠)。
  O7 段序偵測另以 Chromium `--lang=en-US` 實跑綠(暫存 config,已刪)。

## 反向驗證(/bug gate)
- `git checkout 7585838~1 -- date-field.tsx OptionsHeader.tsx` → date-field.test 7 failed / 14 passed;O7 failed。
- `git checkout HEAD -- …` 還原 → 21 passed。

## 真實環境:重走原始重現步驟(Playwright 真 browser,FAKE backend)
- A2 選擇權頁:O7(真鍵盤逐位打年份 → 無 `date=0…` 請求、以完整日期查詢)。
- A1 個股頁(`evidence/realenv_equity_typing.log`,暫存 spec 已刪):年份逐鍵顯示
  `0002→0020→0202→2026-06-26`;Backspace 清空 → `""`;點欄位外 blur → 還原 `2026-06-26`;**全程 0 支 API 請求**
  (修正前會跳到最早交易日並抓資料)。

## Blast radius sanity
- 個股頁:E1 / E47 等 equity e2e 全綠;stepper 路徑經 e2e 全套覆蓋。
- 選擇權頁:O1–O7、NTD1(選週六 → 無交易日)綠。
- 分點反查:純原生路徑未動;E30 / E47 / N5 / N6 綠;BrokerFlowsPanel vitest 綠。

## 行為改變(需 user 確認)
- 選擇權頁月曆「清除」:改前 = 以空日期重抓最新(欄位空白);改後 = 不動作,失焦還原。

## Debug 清理
- `grep -rn "DEBUG-dfp1" frontend/src e2e/specs` → 無殘留;repro / probe / realenv 暫存檔皆已刪。
