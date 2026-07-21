# Current state — mod/broker-directory-refresh(spec F-1)

日期:2026-07-21。Baseline:`tests/test_broker_flows.py + test_broker_routes.py` 43 passed 全綠(main 分支點 `53d1e58`,F-3 收斂已入)。

## 現況

- `backend/services/broker_flows.py::_get_directory_or_none()`(:155):**無參數**。cache 新鮮(24h TTL)→ 直接回;miss/stale → `_run_once("broker_directory", _do_fetch)` 抓 `TaiwanSecuritiesTraderInfo`(~1011 筆,1 request);空 rows 回 None 不落 cache;`httpx.HTTPError / HTTPException` → log warning → None(R10 降級,不拖垮 caller)。
- `get_daily_flows(broker_id, date_param, refresh)`(:220):步驟 2 呼叫 `_get_directory_or_none()`,**refresh 參數不傳入** — `?refresh=true` 只 bypass flows cache(dedup key `bflow_{id}_{d}_r{int(refresh)}`),目錄仍吃 24h cache。
- 後果(spec F-1 現況):新掛牌分點在目錄 cache 窗內 `daily-flows` 404(`broker_not_found`),按「重新整理」無效。
- 歷史:原實作有 refresh 參數但零 caller 傳 True,code review S5 拍板 YAGNI 移除,記 design v3 Known Risk 2。

## Caller map(grep 全 repo `.py`,無動態用法/字串拼接)

| Caller | 位置 | 影響 |
|---|---|---|
| `search_traders` | `broker_flows.py:192` | 不傳 refresh(spec:搜尋場景 24h 足夠)— 簽名加預設參數即不受影響 |
| `get_daily_flows` 步驟 2 | `broker_flows.py:236` | **改動點**:傳入 `refresh` |
| 測試 monkeypatch `bf._get_directory_or_none` | `test_broker_flows.py:200,292,365` + `test_broker_routes.py` 無 | `_async_ret(value)` 的 stub 收 `*args`,簽名加參數不破 |
| route `GET /api/broker/daily-flows` | `routes/broker.py:28` | 已傳 refresh 到 service,route 零改動 |
| 前端「重新整理」 | `BrokerFlowsPanel` → `useBrokerFlows` refresh(true) | 鏈路已通,前端零改動(spec 邊界) |

## 現況 vs 目標

| 面向 | 現況 | 目標 |
|---|---|---|
| `_get_directory_or_none` 簽名 | `()` | `(refresh: bool = False)` — refresh=True 跳過 cache 新鮮檢查強制重抓 |
| dedup key | `"broker_directory"` | `f"broker_directory_r{int(refresh)}"`(對齊 flows cache refresh 語意,SC-2) |
| `get_daily_flows` 步驟 2 | `_get_directory_or_none()` | `_get_directory_or_none(refresh)` |
| refresh 重抓失敗 | n/a(不會發生) | 沿用既有 catch → None 降級(**不** fallback 舊 cache:目標場景是「新分點不在舊目錄」,fallback 舊 cache 會照樣 404,None 降級才讓 flows 嘗試繼續)|
| refresh 成功 | n/a | 照 `_do_fetch` 既有路徑落 cache(他人後續 24h 吃新資料)|
| Backward compat | — | 參數帶預設值,search_traders / 測試 stub 零改動;無 migration |
| 配額 | 0 額外 | refresh 多燒 1 request/次(`/data` 計配額;SC-3 帳目同步 design v3 §8)|

## 既有測試盤點(43 案,與目錄相關者)

- `test_directory_cached_24h`(:372)— **spec SC-1 明文不得動**;走 search_traders 路徑,不受影響。
- `test_daily_flows_refresh_bypasses_cache`(:236)— refresh=True 案;斷言只看 `report_calls`,目錄多抓不破。
- `test_search_traders_directory_unavailable_503` / `test_daily_flows_rejects_malformed_broker_id_even_degraded` / `test_directory_fetch_error_degrades_broker_name` — 降級路徑白名單,皆不該紅。
- `_FakeFM.info_calls` 計數器已存在,新測試直接用。
