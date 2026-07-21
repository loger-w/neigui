# Real-env 驗證 — mod/trader-search-truncation(2026-07-21)

環境:backend `:8000`(真 FinMind)+ frontend dev `:5173`,chrome-devtools MCP。

## 新行為(SC-2 真實鏈路)

- 搜尋「1」(id 前綴,真實目錄 120 命中)→ dropdown 50 個 `role="option"` + 尾端 `role="presentation"` 提示列**「共 120 筆,僅列前 50,請輸入更精確關鍵字」**(DOM 驗證 + 截圖 `docs/specs/broker-flows-followups/screenshots/F-2_truncation-notice.png`)。
- 搜尋「證券」(24 命中,未達上限)→ 24 options、**無**提示列(lastRole = "option")。

## 白名單 regression

- 搜尋「富邦」→ 點選 9600 → flows 雙表載入(buy 30 rows / sell 30 rows)、選定徽章「9600 富邦」顯示 — 反查鏈完整。
- Network:traders ×3、daily-flows ×1 全 200;console 唯一 error = 既有 `favicon.ico` 404(與本次無關)。
- E30 e2e(真 browser + FAKE backend)51 passed 全綠,E30 零斷言改動(change-spec SC-4 覆寫註記)。

## Gate 總結(Phase 6)

backend 704 passed, 1 skipped + ruff 乾淨;frontend vitest 902 passed(+3 新案)+ build 綠;e2e 51 passed。
