# Test inventory — refactor/run-once-dedup(F-3)

日期:2026-07-21。Phase 2 盤點:收斂前各 `_run_once` 複本與 date 驗證的測試保護現況。

## `_run_once` 複本現況(spec 說 5 份,實測 9 份模組級 + 1 份 method)

| # | 檔案 | 語意 | 測試保護 |
|---|------|------|---------|
| 1 | `services/finmind.py::FinMindClient._run_once`(method,`self._inflight`) | refcount+shield(原版,docstring 最完整) | `tests/test_finmind_cancel.py` 4 tests(共乘存活 / 末位 cancel 殺 task / registry 清理 / gather 合流)— **直接呼叫 `client._run_once`** |
| 2 | `services/finmind_realtime.py:108` | refcount+shield | `tests/test_finmind_realtime.py:752,787` — **直接呼叫 `fr._run_once`,並斷言 `fr._inflight[key]["refs"]` 數值** |
| 3 | `services/daytrade_fee.py:172` | refcount+shield | `tests/test_daytrade_fee.py:157,178`(dedup 合流 + cancel 存活) |
| 4 | `services/warrants.py:278` | refcount+shield | 間接(`test_warrant_*` 經公開 API) |
| 5 | `services/warrant_flow.py:95` | refcount+shield | `tests/test_warrant_flow.py:398`(refresh 不與 cached inflight 合流) |
| 6 | `services/warrant_quotes.py:74` | refcount+shield | `tests/test_warrant_quotes.py:348`(合流 calls==1) |
| 7 | `services/warrant_iv_history.py:92` | refcount+shield | 間接 |
| 8 | `services/broker_flows.py:49` | refcount+shield | `tests/test_broker_flows.py`(dedup key `_r{refresh}` 相關)+ `test_brokers_window.py:425` |
| 9 | `services/market_universe.py:146` | **無 refcount 裸版**(`await _inflight[key]` 直等) | **無 dedup 專屬測試**(僅經公開 API 間接) |
| 10 | `services/industry_chain.py:102` | **無 refcount 裸版** | **無 dedup 專屬測試**(`test_industry_chain.py` 只測 cache/TTL,無並發案) |

7 份 refcount 版逐字同構(diff 驗證過,僅 docstring 出處註記不同)。

## 測試對實作細節的依賴(收斂設計約束)

- `fr._run_once` / `client._run_once` 被測試**以模組/instance 屬性名直接呼叫** → 各模組必須保留 `_run_once` 名字(薄 wrapper 委派共用實作),不能改成 call site 直呼共用函式,否則要動測試(違反 SC-1「不改任何 assertion」)。
- `fr._inflight[key]["refs"]` 被直接斷言 → entry 形狀 `{"task": Task, "refs": int}` 是測試契約,共用實作必須沿用。
- `tests/conftest.py::_reset_realtime_task_registries` 清 9 個模組的 `mod._inflight` → registry 必須保留模組級(收斂決策:不集中)。
- `tests/test_warrant_flow_history.py:117` monkeypatch `wf._inflight` → 同上,模組級 dict 名字不能動。
- **`services/warrant_flow_history.py:92,172`(production 跨模組 caller)直呼 `wf._run_once`**(review R1 補記)→ warrant_flow 的 `_run_once` 名字是跨模組介面,薄 wrapper 必須保留。

## Date 驗證三處

| 檔案 | 現行為 | 錯誤碼 | 測試 |
|------|--------|--------|------|
| `routes/warrants.py::_validate_date` | regex `^\d{4}-\d{2}-\d{2}$` + `fromisoformat` 雙驗(擋 `20260721` 這種 ISO 變體) | `bad_date` | `tests_e2e/test_api_warrants.py:166` |
| `routes/daytrade_fee.py:25-29` | 僅 `fromisoformat`(**接受** `20260721`) | `bad_date` | `tests/test_daytrade_fee_routes.py:50` |
| `services/broker_flows.py:234-238` | 僅 `fromisoformat`(**接受** `20260721`),parsed 供 clamp 用 | `invalid_date` | `tests/test_broker_flows.py:177` + `test_broker_routes.py:46` |

三處嚴格度**不一致**(warrants 嚴格、另兩處寬鬆)且錯誤碼不同 → 零行為差異要求 helper 參數化(`error_code` + `strict`),不得統一嚴格度(統一 = 行為改動 = /mod 範圍,記 next-time)。

## 覆蓋缺口(Phase 2 行動)

- market_universe / industry_chain 無並發 dedup 測試 → 遷移前補 🟢 characterization test(concurrent ×2 → upstream 1 call),獨立 commit。
- refcount 語意本身已被 test_finmind_cancel / test_finmind_realtime / test_daytrade_fee 三組鎖住,共用實作落地後這些測試直接變成共用實作的保護網(經 wrapper)。

## Baseline

- 收斂前 `python -m pytest -q`(backend)全綠:**700 passed, 1 skipped, 20.86s**(2026-07-21,branch 起點 = main `2a4e7ad`)。
