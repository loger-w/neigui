# Brainstorm — 券差查詢(daytrade-borrow-fee)

- **來源**:`docs/specs/daytrade-borrow-fee/spec.md`(user 拍板 2026-07-08;2026-07-11 amendment:頁面歸屬改最上層 mode tab)→ brainstorming HARD-GATE 替代條件成立(/auto 契約),對話式 brainstorm 以 spec 代替。
- **Scope 分級**:**L**(跨前後端;新 service + 新 router + App.tsx mode 層 + 新頁面元件 + hook + e2e,≥ 5 檔)→ Phase 1/2 各 max 3 輪 review。
- `[auto-default: 獨立 router routes/daytrade_fee.py + GET /api/daytrade-fee | reason: user 拍板 mode 級頁面後,對齊「每 mode 一 router 檔」慣例(chip/options/market);原 spec /api/market/daytrade-fee 是 market 子 tab 時代的產物]`
- `[auto-default: 前端不做日期選擇器,v1 固定顯示最近可得日 | reason: spec out-of-scope 已排除歷史月份瀏覽 UI;TPEx 僅當月,date picker 只能選當月語意彆扭;backend 仍收 date 參數(契約保留,前端 v2 再接)— SC 集合不變、對外契約不變(spec SC-1「選日期」本就與 out-of-scope 存在張力,採窄讀)]`

## SC(成功條件 + 驗證方式)

| SC | 內容 | 驗證方式 |
|---|---|---|
| SC-1 | 最上層 mode 切換列出現第 4 個 tab「券差」(個股/選擇權/大盤/券差),點擊切頁、localStorage 持久化、切換時其他 mode unmount(4-way ternary) | e2e `navigation.spec.ts` N#(mode toggle + reload 持久化);vitest App mode 切換測試;截圖 `evidence/SC-1_*.png` |
| SC-2 | 頁面顯示最近可得交易日的上市 + 上櫃合併表格:市場、代號、名稱、借券股數、借券費率、本月發生次數;預設費率降序 | backend `pytest tests/test_daytrade_fee*.py`(payload shape + 合併 + month_counts);vitest 元件表格渲染;e2e 新 spec `borrow-fee.spec.ts` BF#(資料級 assertion:row 數 > 0 且首列費率 ≥ 末列) |
| SC-3 | 費率 ≥ 3.5%(具名常數)row 標色(accent,非紅綠);全頁無方向性文案 | vitest:data-testid class 正向 assertion + `expect(screen.queryByText(/軋空|回補|做多|做空/)).toBeNull()` |
| SC-4 | 無資料日回退:date 無資料往前找當月最近有資料日,整月空遞迴前月一次,再空 404 `{"error":"no_data"}`;`no_trading_day` flag + 前端沿用既有「無交易日」樣式 | backend pytest(回退三態:當月內回退/跨月一次/404;含 date 給定 + 回退 → flag true);vitest hook `noTradingDay` + BorrowFeePage badge 渲染 `[amendment 2026-07-11: e2e 不覆蓋 NTD 態 — 單一 webServer fixture 無法同時呈現有料/無料兩態(design round-1 P2-1),e2e 只鎖 happy path]` |
| SC-5 | 排序可切換(費率/股數/次數/代號),點欄位標題循環 desc/asc | vitest:排序純函式單測(`lib/borrow-fee-utils.ts`)+ 元件點擊互動 |
| SC-6 | `?refresh=true` 跳 cache 重抓兩源;cache key = 月 + 市場,帶 `_cache_version` | backend pytest(refresh bust + cache 命中計數 monkeypatch) |
| SC-7 | parser 髒點全處理:民國兩格式(`115/07/01`/`1150701`)、padding、千分位、`3.500%` vs `1.000`、TPEx `" LendingVolume"` leading-space key、`stat != "OK"` | backend pytest 髒點各一測,fixture 用 2026-07-08/11 probe 真實 payload 縮樣 |
| SC-8 | changelog `VersionEntry` 新增(MINOR bump),寫入前讀 `changelog-conventions` | changelog.ts diff + version badge 截圖 |
| SC-9 | 完成 gate:`pytest -q` + `ruff check .` + vitest + `npm run build` + **e2e 全套 AI 實跑** + chrome-devtools 截圖入 `docs/specs/daytrade-borrow-fee/screenshots/` | 各指令 exit 0 輸出留存 `automated-verification.md`;baseline 已錄:pytest 515 passed / vitest 626 passed / e2e 24 passed |

## Edge cases(≥ 3)

1. **TWSE `stat != "OK"` 或 `data` 空**(該月無資料)→ 視為空月,觸發 SC-4 回退鏈,不 raise。
2. **TPEx 只回當月**:查詢日在上月(月初 1 號盤前看最近可得日 = 上月底)→ TWSE 可回溯、TPEx 缺 → 該日 TPEx 部分缺,payload 帶 `partial: ["tpex"]` 註記,UI 顯示「上櫃資料缺(來源僅提供當月)」;month_counts 仍按可得資料算。
3. **ETF 也會出現**(00403A / 0050 實測)→ 不過濾、不誤歸類;名稱直接用來源欄位,不查 TaiwanStockInfo。
4. **費率 7% 法定上限值** → 正常顯示 + 標色,不 clamp。
5. **同股同日多筆**(TWSE 07-09 的 8150 有 5 筆)→ **逐筆保留列出**(這正是 FinMind 判死的原因),month_counts 以「日」去重計次(同日多筆算 1 次)`[auto-default: 同日多筆算 1 次 | reason: 「本月發生次數」語意 = 發生天數;逐筆計會被單日大量標借灌爆]`。
6. **TPEx TLS(缺 SKI)**:backend py3.12 實測;炸則 `truststore`;**禁止 `verify=False`**(spec §7)。

## Out of scope(沿 spec §6)

- 歷史月份瀏覽 UI(含前端日期選擇器,v1 不做)
- 跨月連續發生訊號 / 通知
- 點代號跳 equity 分析交叉連結(已在 `docs/next-time.md`)

## E2E 判準結論(e2e-conventions,Phase 0 定案)

- **需要 e2e**(新 mode = user-facing UI 新增,非豁免類型):
  - `navigation.spec.ts`(N#):mode 列第 4 顆按鈕「券差」、切換 + `aria-current` + localStorage reload 持久化。
  - 新 spec 檔 `e2e/specs/borrow-fee.spec.ts`(BF#):表格資料級 assertion(row 數、費率降序、標色 testid、no-data 態)。
  - 每個 test 上方 `// 痛點:` 註解;selector 對 page snapshot 校齊,不憑記憶。
- **Fixture 新課題**:資料源是 TWSE RWD + TPEx OpenAPI(**非 FinMind**),FAKE_FINMIND 三層架構管不到 → 需為 daytrade_fee service 設計同型 fake 層(env 旗標 + fixture 檔),設計於 design.md;MANIFEST(FinMind 專用)不塞這組,另立對映或直接 per-service fixture dir。
- backend contract test:`backend/tests_e2e/test_api_*.py` 慣例補 `/api/daytrade-fee` shape 測試。

## Baseline(2026-07-11,分支 0cffb4f)

pytest 515 passed / 1 skipped + ruff clean;vitest 626 passed;e2e 24 passed / 2 skipped(20.1s,AI 實跑)。
