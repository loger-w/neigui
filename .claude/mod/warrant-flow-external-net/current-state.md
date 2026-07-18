# current-state — /mod warrant-flow-external-net(Phase 1)

日期:2026-07-18。拍板脈絡:docs/prompts-backlog.md B2(口徑 (b) 已拍板)+ docs/next-time.md「From /feat warrant-broker-flow」[需 user 拍板] 條。

## 0. 問題(RE-1 守恆恆等式)

`TaiwanStockWarrantTradingDailyReport` 是**下單券商別**全分點報表:每檔權證跨全分點 Σ(buy−sell) ≡ 0、每 kind 買總額 == 賣總額(2330 實測精確 0.0)。因此現行 payload 兩處恆退化:

1. `warrants[].net_value`(明細表「淨買賣超」欄)≡ 0 — 無資訊量。
2. `summary.{call,put}.{buy_value,sell_value}` — 每 kind 買==賣,四數字實為兩數字。

**不退化的部分(白名單核心)**:per-branch `net_value`(top15 買賣超排行)與 branch 展開內 per-warrant net — 單一分點的淨額有真方向意義,**本次不動**。

## 1. flow payload 全 consumer map

### Backend(producer 側)
| 檔 | 角色 | 受影響點 |
|---|---|---|
| `services/warrant_flow.py` | producer:`_aggregate()`(L178-280)組三層聚合;`_empty_payload()`(L283-299)空態鍵集;`get_flow()` 組 payload | `_aggregate` 的 `summary` 與 `warrant_rows[].net_value`;`_empty_payload` 的 `summary` 鍵;`_CACHE_VERSION = 1` 需 bump |
| `routes/warrants.py` L87-96 | passthrough(dict 原样回)| 無 shape 邏輯,不動 |
| `services/warrants.py` | snapshot producer:`by_underlying` entry 含 `warrant_id / name / kind / underlying_name`(L134/170/389)| 只讀不改 — brand 抽取的輸入來源(name + underlying_name 皆在) |

### Backend 測試
| 檔 | 受影響 assertion |
|---|---|
| `tests/test_warrant_flow.py` | `test_aggregation_values`(summary 四數字 L144-145、`warrants[].net_value` L164-166)🔴;`test_aggregation_skips_bad_rows`(summary L180)🔴;`test_report_date_filter`(summary put L250)🔴;`test_empty_no_warrants`(空 summary 鍵 L263-266)🔴;`test_e2e_fixture_consistency`(fixture 守衛,視 fixture rotation 連動)。其餘測項(cap/回退/cache/fan-out/no_trading_day/retention/錯誤轉包)不碰新欄位,**不該紅** |
| `tests_e2e/test_api_warrants.py` | `test_flow_happy_path_shape_and_values`(shape 鍵集 L121-124、summary L132-133、warrants row L140-142)🔴;其餘 flow 測試(NTD/no_warrants/bad_date/bad_symbol)不該紅 |

### Frontend
| 檔 | 受影響點 |
|---|---|
| `lib/warrant-flow-data.ts` | `WarrantFlowSideValue` / `WarrantFlowSummary` / `WarrantFlowWarrantRow.net_value` 型別;`barRatio/formatValue/formatNet` 純函式(branch 側續用,不動) |
| `lib/warrant-flow-data.test.ts` | 純函式測試,不碰 payload shape — 不該紅 |
| `hooks/useWarrantFlow.ts` + test | typed passthrough,只隨型別名連動,行為不動 |
| `components/WarrantFlowPanel.tsx` | summary 區塊(L134-156 四數字)、明細表「淨買賣超」欄(L184、L211-216 netClass/formatNet) |
| `components/WarrantFlowPanel.test.tsx` | SC-2(summary 四數字 L123-135)🔴;SC-4(欄頭「淨買賣超」L159)🔴;SC-5(明細表 net 色 L178-180)🔴;其餘(SC-1/3/6/7、疊直)不該紅 |
| `lib/api.ts` `warrantFlow()` | 回傳型別引用,無欄位邏輯,不動 |
| `App.tsx` / `App.test.tsx` | 只 mount panel / mock hook,不碰欄位,不動 |
| `lib/changelog.ts` | 需新 VersionEntry(使用者可感欄位語意變更 → MINOR;寫 entry 前讀 changelog-conventions) |

### E2E(e2e-conventions 判準:equity mode UI 欄位語意變更 → E# 必動)
| 檔 | 受影響點 |
|---|---|
| `e2e/specs/equity.spec.ts` E14 | 現有 assertion 鎖 branch 側(凱基-台北 3,960 元、展開、明細表首列 id)— branch 不動故**現 assertion 應存活**;需**加**新口徑資料級 assertion(summary 外部淨額 / 明細表外部淨額欄) |
| `e2e/specs/no-trading-day.spec.ts` NTD2 | 只驗 flag + as_of_date,不該動 |
| `e2e/helpers/selectors.ts` | 視新 testid 增列 |
| `backend/tests_e2e/fixtures/TaiwanStockWarrantTradingDailyReport_03001{1,2,P}.json` | **fixture rotation 必要**:現行 seat 名「凱基-台北 / 元大-總公司 / 富邦-建國」與真實 FinMind 命名(無連字號;HO = 精確名「元大」「台新證券」…)不符,HO 對映在 FAKE 下會全 miss;需補 HO seat rows(id 如 9800「元大」)且維持守恆(每權證 Σnet=0)與凱基淨買 > 0(E14 存活約束) |
| `fixtures/warrants/price_day.json` | 若只補報表 rows 不加權證檔,不需動 |

### FAKE 快照的 brand 抽取輸入(風險點)
Fixture 權證名「台積凱基61購01」不以 underlying_name(「台積電」)開頭 → brand 抽取在 FAKE 下會 fail → null。連動選項(Phase 2 定):fixture 權證名 rotate 成全稱式,或抽取規則兼容。真實面:2330 全 1087 檔抽取成功;其他標的簡稱前綴未全量驗證,fail → null 是預設降級。

## 2. 現況 vs 目標

| 面向 | 現況 | 目標 |
|---|---|---|
| `warrants[].net_value` | 全分點 Σnet ≡ 0,恆零 | 改「外部人淨額」= −(發行商 HO seat net) = Σ非HO分點 net;無法對映/報表空 → `null`(不冒充 0) |
| `summary` | `{call,put}.{buy_value,sell_value}`(買==賣恆等) | 改為每 kind 外部淨額(+成交額與否 Phase 2 定);跨權證加總,null 權證不入總 |
| HO seat 對映 | 無此概念 | brand(權證名去 underlying_name 前綴取首個數字前字串)→ alias 表 → seat 精確名 + 4 碼 id。probe 實證:brand 1087/1087、HO 27/27 單一命中、量占比中位 49.2% |
| branch 排行/展開 | per-branch net(有意義) | **不動**(白名單) |
| cache | `_CACHE_VERSION = 1` | bump 2(舊 payload 全作廢,無 migration — filesystem cache 自失效) |
| backward compat | 前後端同 repo 同步改;無外部 API consumer;route passthrough 不動 | breaking-in-place,一個 PR 內原子切換;changelog MINOR |

## 3. Baseline

2026-07-18 12:44 pre-push(commit 2793a6a 推 main)全綠:backend `718 passed, 1 skipped`、ruff all pass、frontend vitest `863 passed (91 files)`、`npm run build` 過。e2e 未跑(條件 gate,本次屬必跑類,Phase 6/7 執行)。

## 4. 既有實作意圖(讀碼摘要)

- `_aggregate` 是純函式、`to_thread` 執行(hot-path 教訓)— 新聚合邏輯要維持純函式無共享狀態。
- 空 payload 鍵恆齊全(design §2.2b)— summary 改 shape 時 `_empty_payload` 同步。
- probe-first / TaskGroup / 候選日自適應(finmind-conventions)— 本次不碰 fetch 層。
- SC-5 色彩紀律:淨買 bull / 淨賣 bear;kind badge 零紅綠 — 外部淨額欄沿用同紀律。
