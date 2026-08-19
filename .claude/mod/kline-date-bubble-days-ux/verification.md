# verification — mod/kline-date-bubble-days-ux(2026-08-19)

## 自動化 gate(auto-verify;harness.json 無條件 gate + 條件 e2e)

| gate | command | exit / 結果 |
|---|---|---|
| vitest | `npx vitest run`(frontend) | 0 — 1188 passed(fix 波後;波尾前 1170;一次 1/1170 載入 flake 重跑 3 次全綠) |
| build | `npm run build`(frontend,tsc -b + vite) | 0 |
| e2e | `npm test`(e2e,FAKE fixture,ports 8010/5183) | 0 — 71 passed(含新 E46 / 追加 E43 E38);fix 波後 E38/E43/E46 重跑綠 |
| backend | 未動 backend(pytest / ruff 不適用) | — |
| visual | V1 / V4 baseline(linux-only)需重生:push 後觸發 `e2e-update-snapshots` workflow | 待 workflow |

## 真實環境(devtools MCP,:5175 ↔ :8000 真 FinMind,2330)

| SC | 證據 | 結果 |
|---|---|---|
| SC-1 日期軸 | `evidence/SC-1-kline-date-axis-hover.png`(1600):底部刻度 4/13 … 8/19 共 12 個,hover 中段 chip「2026-07-02」對齊十字軸;`evidence/SC-1-mobile-430-date-axis.png`:430px 刻度 5 個,軸列 bottom === 疊圖容器 bottom(763);首刻度切邊 → review F9 已改 start/end anchor | PASS |
| SC-2 連續天數 | `evidence/SC-2-SC-3-before-days1.png`:selector 左「連續天數」,wrapper title「累計最近 1 個交易日的分點成交(1 = 僅當日)」;fix 波後 group `aria-describedby=bubble-days-hint` 實測 | PASS |
| SC-3 不跑版 | JS 量測:點 5 日後 120ms 內 `bubble-screenshot` disabled=true、loading badge 顯示,截圖 / 輸入區間 / selector / 頂欄 refresh / 過濾清單 五鈕 bbox 前後完全相同(x,y,w 逐一相等);e2e E43 載入期取樣 |Δx|,|Δy| < 1(包 F 前實測 Δy=42 → 包 F 後 0) | PASS |
| SC-4 每日開收 | `evidence/SC-4-days5-daymarks.png` / `-after-fix.png`:5 欄 8/13–8/19 底部日期(fix 後畫在泡泡之上)、開→收迷你 K 身紅漲綠跌、「開 2440 / 收 2435 …」貼位標籤;DOM 實測 5 欄 data-oob=false、文字正確 | PASS |

白名單抽查:W1(HUD 仍無日期、sel-cursor chip 在)、W2(days=1 畫面無 day-marks、分時線照畫)、W4(截圖鈕有資料時 enabled)、W7(累計 badge / loading badge 位置不變)— 截圖可見。未改功能抽 2:籌碼總覽前 15 大列表 / 泡泡圖右側明細 — 正常。

## 回頭核 goal

- K 線加日期 ✓(SC-1)/ 連續天數提示 ✓(SC-2)/ 切天數不跑版(含 user 看到的「整個頁面按鈕重排」= 頂欄 refresh 換行)✓(SC-3 + 包 F)/ 每日開收標示清楚 ✓(SC-4)。
- migration:無。
