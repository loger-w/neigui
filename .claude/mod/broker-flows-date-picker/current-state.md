# Phase 1 現況表 — mod/broker-flows-date-picker

## 動機(user 原話)
「分點反查加上日期選擇」

## 歷史脈絡
原 feat `broker-daily-flows` design v3 §2.3(`.claude/feat/broker-daily-flows/design.md:130`)
刻意劃界:「date 參數:v1 前端不傳(恆走 today);參數保留給 curl / 未來(YAGNI 邊界:
不做前端 date picker)」。**後端 `date` 參數早已完整實作並有測試**,本 mod 主體是前端接線。

## Caller map(grep 完整,含動態用法)

| 符號 | caller | 備註 |
|---|---|---|
| `GET /api/broker/daily-flows` | `api.brokerDailyFlows`(`lib/api.ts:258`) | 唯一前端 caller;`tests_e2e/test_api_broker.py`、`tests/test_broker_routes.py` |
| `api.brokerDailyFlows(brokerId, refresh?, options?)` | `useBrokerDailyFlows.ts:12` | 目前不帶 date |
| `useBrokerDailyFlows(brokerId, active)` | `BrokerFlowsPanel.tsx:75` | 唯一 caller |
| queryKey `["broker-flows", brokerId]` | `useBrokerDailyFlows.ts:10` | 無 invalidateQueries / 動態字串引用(grep 確認) |
| `BrokerFlowsPanel({active, onPickStock})` | `App.tsx:660`(flows mode ternary,active 恆 true) | `App.test.tsx:95` mock |
| `onPickStock(sid, name, brokerId)` | `App.tsx:334 handleFlowStockPick` | setMode equity → setTab overview → handlePick → 預選分點;**不動 equity date** |
| sessionStorage `neigui.session.flows-selected` | `BrokerFlowsPanel.tsx:41` | N5 跨 mode 還原 |

## 現況 vs 目標

| 面向 | 現況 | 目標(待 grilling 定案) |
|---|---|---|
| 查詢日期 | 前端不傳 → backend `clock.today()` | 使用者可選日期 |
| 後端 | `date` 已支援:非法日 400 `invalid_date`、未來日 clamp today、候選日 ≤3 weekday 回退、過去日 cache 永久、今日 TTL 30min、全空 503 | 預期不動(待確認) |
| UI 日期呈現 | 標頭右側純文字「資料日 MM-DD」;回退時 banner「{requested} 尚無資料,顯示 {as_of}」 | 日期控制項 |
| 交易日曆 | flows mode 無交易日清單(equity 的 stepper 吃 K 線 candles;backend `trading_calendar.py` 未開 route) | stepper 是否要做、日曆從哪來 |
| 狀態保留 | 已選分點 sessionStorage 還原 | 日期是否一併保留 |
| 跳轉 equity | 不帶日期 | 是否同步 equity date |

## 環境事實(自查)
- **FinMind token 目前為 Free(level 1)**(2026-09-24 `user_info` 實測;trader-only 專用 path
  回 400「Your level is register」,連 2026-09-23 都拿不到)→ 真實環境分點反查整條路徑現況
  即不可用;歷史深度 probe 無法執行。本機 cache 僅存 `bflow_9216_2026-07-21` /
  `bflow_9600_2026-07-20` / `bflow_9801_2026-07-21`(過去日 cache 無條件命中 → real-env 可用
  這三組驗證)。
- 資料 21:00 上料(finmind-conventions)。
- FAKE `_get` 對 trader 查詢有 `date` 過濾;fixture `taiwan_stock_trading_daily_report_trader_9600_2026-06-26.json`
  只有 06-26 單日 → FAKE 下查其他日會 3 日回退全空 → 503。

## 既有行為白名單(不能破壞)
- W1 未選日期(預設)行為與請求形狀不變:不帶 `date` → 最新資料日;「資料日 MM-DD」;回退 banner 文案。
- W2 搜尋 combobox 全部行為(a11y activedescendant / 截斷提示 / echo 不誤查 / dash-insensitive)。
- W3 常用分點星號 + chips 一鍵帶入(localStorage,N6)。
- W4 已選分點跨 mode 還原(sessionStorage,N5)。
- W5 點列跳轉 equity 總覽 + symbol 帶入 + 分點預選(E30)。
- W6 重新整理鈕 → `refresh=true`,且只刷目前查詢。
- W7 錯誤碼繁中映射、`stock_count > 60` 截斷註記、空表「無買超 / 無賣超」。
- W8 active gate:未選分點不 fetch。
- W9 後端:非法日 400、未來日 clamp、過去日 cache 永久、今日 TTL、≤3 requests、全空 503、id 白名單。
- W10 手機 375 標頭列 flex-wrap 不溢出。

## Baseline(2026-09-24,worktree)
- frontend vitest:BrokerFlowsPanel / useBrokerDailyFlows / App 3 檔 54 tests 綠
- backend pytest:test_broker_flows + test_broker_routes 48 passed
