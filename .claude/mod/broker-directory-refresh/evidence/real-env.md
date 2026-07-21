# Real-env 驗證 — mod/broker-directory-refresh(2026-07-21)

Server:`python -m uvicorn main:app --port 8000`(fresh process,真實 .env / 真 FinMind)。
判準 side-channel = `data/cache/chip/broker_directory.json` 的 `fetched_at`(python 讀,PS ConvertFrom-Json 撞大小寫 key)。

## 新行為(SC-1 真實鏈路)

| 步驟 | 結果 |
|---|---|
| `GET /api/broker/daily-flows?broker_id=9600`(warm baseline) | 200;`fetched_at = 2026-07-21T12:20:36` |
| 再次 refresh=false | 200;`fetched_at` **不變**(白名單:cache 命中 0 fetch)|
| `...&refresh=true` | 200;`fetched_at` **前進至 12:20:49** — 目錄真的被強制重抓(真 FinMind request)|

## 白名單 regression

- `GET /api/broker/traders?search=9600` → 200(search 路徑照走 24h cache,無 refresh 面)。
- flows 回應 shape 不變(200 payload 正常)。
- Server log 掃 `ERROR|WARNING|Traceback` 零命中。

## E2E 歸屬

`[no-e2e: 回傳 shape 與 UI 不變,refresh 內部行為]` — e2e-conventions 判準表內部行為豁免;既有 broker contract test 於 pytest 全 suite 內全綠。

## 配額

本輪 real-env 消耗:目錄 2 fetch + flows 2 fetch ≈ 4 requests(6000/hr 可忽略)。
