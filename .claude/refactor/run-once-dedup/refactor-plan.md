# Refactor plan — run-once-dedup(spec F-3)

日期:2026-07-21。入口:`/auto 既有測試前後皆全綠 /refactor docs/specs/broker-flows-followups/spec.md F-3`。
前置:`test-inventory.md`(同目錄)。Baseline:backend 700 passed, 1 skipped 全綠。

## Phase 1 — Why

- `docs/next-time.md`「backend 候選日回退 + inflight dedup + date 驗證複本組」條目已註記**觸發條件命中**(第 5 份複本出現);spec F-3 由 user 拍板獨立成項。
- **行為已分歧**:7 份 refcount+shield 版(修過 2026-07-03 prd 500 的正確版)與 2 份無 refcount 裸版(market_universe / industry_chain,保留「第一個斷線請求殺共用 task」的 latent bug)並存。下一個新 service 抄到哪份看運氣 — 複本繼續增生的成本已高於收斂成本。為什麼是現在:F-1(broker 目錄 refresh)即將動 broker_flows 的 dedup key,收斂後只動一處。
- Date 驗證三處三種寫法,錯誤碼與嚴格度不一致,同為複本增生族。

## 範圍決策

- **[auto-default: 收斂全部 9 份模組級 + finmind method 版(共 10 份),非 spec 點名的 5 份 | reason: spec 現況段落計數過時(寫「第 5 份已現」實測 9 份);SC-2 驗收是「收斂後單一實作」,只收 5 份會留 4 份複本、動機(止住增生)不成立;各份遷移為機械式同構替換,風險不隨份數升級]**
- **[auto-default: 共用實作放 `utils/concurrency.py::run_once(registry, key, coro_fn)`,registry 保留模組級 `_inflight` dict | reason: spec SC-2 二擇一;conftest `_reset_realtime_task_registries` 與 `test_warrant_flow_history` monkeypatch 都依賴模組級 registry,保留 = conftest 清理契約零改動;集中 registry 要重寫 conftest + 失去 per-module 測試隔離]**
- **[auto-default: 各模組保留 `_run_once` 名字為 2 行薄 wrapper 委派共用實作 | reason: test_finmind_realtime / test_finmind_cancel 以屬性名直接呼叫 `mod._run_once` / `client._run_once`,wrapper 讓全部測試零改動(SC-1「不改任何 assertion」)]**
- **[auto-default: date helper 放 `utils/validation.py::parse_date_param(value, *, error_code, strict)`,參數化保留三處現行差異 | reason: 三處嚴格度與錯誤碼不一致是現行對外行為;統一嚴格度 = 行為改動 = /mod 範圍。參數化把分歧顯式化,統一案記 docs/next-time.md]**
- **SC-3 讀法(review R2)**:spec SC-3「400 `invalid_date` 語意統一」與「warrants / daytrade_fee 錯誤碼字串不得變」兩子句互斥(現行三處兩種碼)。依 /refactor 行為不變鐵則,以「錯誤碼不得變」子句為準,「語意統一」解讀為「統一經單一 helper 走 400 路徑」;錯誤碼字面統一案記 `docs/next-time.md`(/mod 候選)。
- market_universe / industry_chain 由裸版換 refcount 版 = cancel 邊界語意升級(共乘存活)。**spec SC-2 明文拍板「refcount 語意為準(它是超集)」**,非本 session 自行決定;正常路徑(無 cancel)行為逐位相同,無任何既有測試依賴裸版語意(inventory 查證)。
- 邊界(spec):不動各服務 cache/TTL 邏輯;`docs/decisions.md` 查過無 dedup 抽象舊決策(grep 零命中)。

## 步驟(每步單獨綠 + 單獨 🔵 commit;預估 diff 皆 <100 行)

1. **新增 `utils/concurrency.py` + finmind.py method 委派**
   `run_once(registry: dict, key: str, coro_fn)` 實作 = 現行 refcount+shield 逐字搬移(docstring 沿用 finmind.py 版最完整的 cancel-chain 說明);`FinMindClient._run_once` 改 `return await run_once(self._inflight, inflight_key, coro_fn)`。
   驗證:`pytest -q tests/test_finmind_cancel.py` + 全 suite。
2. **遷移 refcount 版 4 份**:finmind_realtime / daytrade_fee / broker_flows / warrant_flow → 薄 wrapper。
   驗證:`pytest -q tests/test_finmind_realtime.py tests/test_daytrade_fee.py tests/test_broker_flows.py tests/test_warrant_flow.py tests/test_warrant_flow_history.py` + 全 suite(review R1:`services/warrant_flow_history.py:92,172` 跨模組直呼 `wf._run_once`,薄 wrapper 保住此用法,測試檔列入驗證)。
3. **遷移 refcount 版 3 份**:warrants / warrant_quotes / warrant_iv_history → 薄 wrapper。
   驗證:對應測試檔 + 全 suite。
4. **🟢 characterization test**:market_universe / industry_chain 並發 dedup(concurrent ×2 → upstream 1 call)— 遷移前先拍現狀(此性質兩版皆成立,測的是「合流」不是 cancel 邊界)。獨立 commit(🟢 與 🔵 分開)。
5. **遷移裸版 2 份**:market_universe / industry_chain → 薄 wrapper(refcount 語意,spec 拍板);同 commit 更新 conftest 註解(「entry 兩種形狀並存」→ 收斂後僅 dict 形,`_drop_silently` 的雙形處理保留為防禦)+ 兩檔 `_inflight` 型別註記 `dict[str, asyncio.Task]` → `dict[str, dict[str, Any]]`(review R3,對齊其他 7 份)。
   驗證:step 4 新測試 + `pytest -q tests/test_market_universe.py tests/test_industry_chain.py` + 全 suite。
6. **date 驗證收斂**:新增 `utils/validation.py::parse_date_param`;`routes/warrants.py::_validate_date` 改委派(strict=True, bad_date)、`routes/daytrade_fee.py` 改呼叫(strict=False, bad_date)、`services/broker_flows.py` 改呼叫(strict=False, invalid_date,取回傳 date 供 clamp)。
   驗證:`pytest -q tests/test_daytrade_fee_routes.py tests/test_broker_routes.py tests/test_broker_flows.py tests_e2e/test_api_warrants.py` + 全 suite。
7. **收尾**:`docs/next-time.md` 刪已完成條目 + 記「date 驗證嚴格度統一(/mod 候選)」;blast radius grep(`_run_once` / `_inflight` / `_validate_date` 全 repo 含動態用法);auto-verify 四 gate。

## 回退

任一步紅 → 預設 refactor 改錯,`git checkout` 該步、重推;3 次失敗套鐵則 F。

## E2E 判準

內部結構收斂、API shape / 錯誤碼 / UI 零變化 → 豁免(e2e-conventions 內部行為類),commit 註 `[no-e2e: internal refactor, error contract 不變且既有 contract test 覆蓋]`。tests_e2e 的 contract tests(pytest 跑的)照常在全 suite 內。
