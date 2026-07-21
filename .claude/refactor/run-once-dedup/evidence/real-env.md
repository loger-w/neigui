# Real-env 驗證 — refactor/run-once-dedup(2026-07-21)

Server:`python -m uvicorn main:app --port 8000`(非 --reload,fresh process,真實 .env)。
全部 curl 對 `127.0.0.1:8000`;date 驗證 edge 皆零 upstream 成本。

## Edge cases(收斂後行為與收斂前逐位相同)

| 請求 | 結果 | 驗證點 |
|---|---|---|
| `GET /api/daytrade-fee?date=not-a-date` | `400 {"detail":{"error":"bad_date"}}` | daytrade_fee 錯誤碼不變 |
| `GET /api/warrants/2330/flow?date=20260721` | `400 {"detail":{"error":"bad_date"}}` | **strict regex 保留** — ISO 變體仍被 warrants 擋(寬鬆版會放行) |
| `GET /api/warrants/2330/flow?date=2026-13-99` | `400 {"detail":{"error":"bad_date"}}` | 形狀合法日曆非法(R2-2)仍擋 |
| `GET /api/broker/daily-flows?broker_id=9600&date=2026-99-99` | `400 {"detail":{"error":"invalid_date"}}` | broker_flows 錯誤碼 invalid_date 不變 |

## Happy path

- `GET /api/daytrade-fee` → 200,1.26s,10136 bytes(真實 TWSE/TPEx 路徑經收斂後 `_run_once`)。
- 並發 ×2 `GET /api/daytrade-fee?refresh=true`(Start-Job 並行)→ 200/200,payload 位元組數相同(10136),無 500 / CancelledError。

## Regression 抽樣(未動功能 ×2)

- `GET /api/symbols?search=2330` → 200,回 `[{"symbol":"2330","name":"台積電"}]`。
- `GET /api/market/snapshot` → 200,0.75s,185729 bytes — 此路徑實跑 finmind_realtime + market_universe + industry_chain 三個收斂後模組(含裸版→refcount 的兩份)。

## E2E 歸屬

判準表(skill `e2e-conventions`)「純 backend service 重構(無 route 行為改動)」豁免格:routes 兩檔僅換驗證實作,response shape 與 `detail.error` 字串不變,既有 contract test(`tests_e2e/test_api_warrants.py::test_flow_bad_date_400` 等)在 pytest 全 suite 內已鎖並全綠。`[no-e2e: internal refactor, error contract 不變]`
