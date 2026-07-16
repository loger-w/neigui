# /mod warrant-selector-table — Change Spec

規模:**L**(前後端 ≥10 檔、對內 API 移除)→ Phase 3 reviewer max 2 輪。
決策來源:前一 session 與 user 問答定案(下拉單選 / 前後端一併刪 / align 屬性修法),本檔為驗證後採用;Phase 2 對話已由該定案取代(user 顯式指示「可直接驗證後採用」)。
Phase 1 現況盤點:`current-state.md`(同目錄)。

---

## Phase 2 — 成功條件 / 白名單 / Compat / Out of scope

### 成功條件(可驗收)

- **SC-1(對齊)**:權證表 thead 中「代號 / 名稱 / 類型」表頭靠左、其餘資料欄表頭靠右,與各欄資料格(td)對齊方向一致;展開按鈕空 th 不變。
  量法:vitest th className assertion;e2e E8 `toHaveCSS("text-align", ...)`(代號 left、履約價 right);Phase 7 DevTools 截圖。
- **SC-2(發行商篩選)**:篩選列出現「發行商」下拉(單選);預設「全部」= 不篩;選項 = 該標的權證名稱實際抽出的發行商(去重,不隨其他篩選條件縮減);選定後表格僅剩該發行商權證;「重製篩選」與換標的皆回「全部」;不新增表格欄。
  量法:vitest(純函式 + 元件);e2e E20(fixture 2330 六檔發行商互異:選凱基 6→1,重製回 6);截圖。
- **SC-3(分點移除)**:展開列僅剩 IV 時序區塊(`warrant-brokers-detail` 不存在、不發 `/brokers` 請求);backend 無 `/api/warrants/{warrant_id}/brokers` 路由;`useWarrantBrokers` / `api.warrantBrokers` / 型別 / `services/warrant_brokers.py` / 對應測試全數移除;**權證分點流向頁(/flow)零影響**。
  量法:vitest absence assertion;pytest route-absence;e2e E11 移除後全套綠;Phase 7 network 面板無 /brokers 請求。

### 不能破壞的既有行為白名單(逐條 Phase 7 打勾)

| # | 行為 | 錨點 |
|---|---|---|
| W1 | row 展開 lazy 抓 IV 歷史 + `warrant-iv-chart` 渲染 | E13、WarrantSelector.test.tsx SC-7 |
| W2 | 權證分點流向頁聚合鏈(凱基-台北 3,960 元)+ `fetch_warrant_trading_daily_report` 保留 | E14、test_warrant_flow.py |
| W3 | 排序 / 篩選既有行為:差槓比 asc 預設、null 沉底、認售 toggle | E9、SC-2/SC-4 測試 |
| W4 | 欄位選單:隱藏 / 調序 / localStorage 持久;展開列 colSpan = th 總數 | E18、欄位選單測試 |
| W5 | 重製篩選:既有欄位歸零 + 排序回預設 + input 清空 | E19、重製測試 |
| W6 | 快照基準日 / 最後更新顯示;重整鈕只刷 quotes 層 | SC-3 顯示面測試 |
| W7 | 換標的:展開列與篩選歸零(epoch remount) | symbol switch 測試 |
| W8 | 其餘 warrants API(warrants / quotes / iv-history / flow)行為與 error contract 不變 | test_warrants_routes.py 餘測試 |
| W9 | `WarrantIvHistory.tsx` / `warrant-iv-svg.ts` 零 diff(另一 session 所有) | git diff 檢查 |
| W10 | changelog 既有 entries 原樣,只新增 | changelog.ts |

### Backward compat / migration

- `GET /api/warrants/{warrant_id}/brokers`:內部 API、唯一 consumer 為同批移除的前端、user 已確認無其他消費者、pre-1.0 → 直接移除,無 deprecation window。
- 殘留 cache 檔 `warrant_brokers_*.json`:無讀取方之 inert 檔,不需清理 / migration。
- `WarrantFilters` 加 `issuer` 欄位:純前端 state 型別,無持久化(不進 localStorage)→ 無 migration。
- Migration 可逆性:git revert 兩個 🔴 commit 即完整還原(無資料格式變更)。

### Out of scope(寫進 next-time 而非本次動)

- `useWarrantIvHistory.ts` 等檔內「useWarrantBrokers 樣板」歷史註解(純註解,不影響行為)。
- forceRefreshRef 抽共用(next-time 既有條目)。
- 發行商抽取失敗(非標準簡稱)之權證的「其他」分組 — 現設計:抽不出者僅在「全部」可見(名單外券商屬例外情況,graceful degradation)。
- 牛熊證命名變體支援(next-time 既有觸發條件:user 提到牛熊證時)。

### E2E 判準結論(e2e-conventions 判準表)

本次改動屬「需要 e2e」類型(equity UI 行為改動 + backend route 移除)→ Phase 6 必跑 e2e 全套。
- SC-1 → E8 補 th CSS assertion(不開 V#:V1-V6 baseline 不含權證 tab,非 layout 大改)。
- SC-2 → 新 E20。
- SC-3 → 刪 E11;E13 展開鈕 label 同步;`selectors.ts` 刪 `warrantBrokersDetail`(FOOTER ENFORCEMENT 同 PR);`tests_e2e/test_api_warrants.py` 刪 `test_brokers_happy_path` 1 支 + `test_bad_symbol_400_all_paths` 部分改寫(詳 Commit B 表)。

---

## Phase 3 — Diff 級 spec(逐檔,三類標記)

Commit 順序(🔵→🔴→🟢;本次無 🔵):

### Commit A 🔴 fix(frontend): 權證表頭對齊依欄位 align,不再用 first: 猜位

| 檔 | 動作 |
|---|---|
| `frontend/src/lib/warrant-columns.tsx` | `WarrantColumnDef` 加必填 `align: "left" | "right"`;`warrant_id`/`name`/`kind` = `"left"`,其餘 14 欄 = `"right"` |
| `frontend/src/components/WarrantSelector.tsx:344` | th className 改 `cn("px-2 py-1.5 font-normal", c.align === "left" ? "text-left" : "text-right")`;刪 `text-right first:text-left` |
| `frontend/src/components/WarrantSelector.test.tsx` | 🆕 新測試:代號/名稱/類型 th 帶 `text-left`、履約價/現價 th 帶 `text-right`(紅先行) |
| `e2e/specs/equity.spec.ts` E8 | 🆕 補 `toHaveCSS("text-align")`:代號 th = left、履約價 th = right |

### Commit B 🔴 mod(warrants): 前後端移除分點買賣超(展開列只留 IV)

前端:
| 檔 | 動作 |
|---|---|
| `components/WarrantSelector.tsx` | 刪 `useWarrantBrokers` import / `brokersHook` state / RowPair `brokersHook` prop 與簽名 / `warrant-brokers-detail` 區塊(:431-467);展開列只留 `WarrantIvHistory`;展開鈕 aria-label 「展開分點 X」→「展開明細 X」 |
| `hooks/useWarrantBrokers.ts` + `useWarrantBrokers.test.ts` | 整檔刪 |
| `lib/api.ts` | 刪 `warrantBrokers` method 與 `WarrantBrokersPayload` import |
| `lib/warrant-data.ts` | 刪 `WarrantBrokerRow` / `WarrantBrokersPayload` |
| `lib/warrant-columns.tsx` | `warrant_id.desc`「…可展開 IV 時序與分點明細」→「…可展開 IV 時序」 |
| `components/WarrantSelector.test.tsx` | 🆕 紅先行:展開後 `queryByTestId("warrant-brokers-detail")` null + 不呼叫已刪 API;刪 3 支分點測試(:194-208 / :258-273 / :324-336)與 mockApis 的 warrantBrokers spy;`/展開分點/` 引用改 `/展開明細/`(改寫面 = :318/:359,刪除面 :202/:271/:330 隨測試消失;**以 grep 為準**,review R4) |

backend:
| 檔 | 動作 |
|---|---|
| `routes/warrants.py` | 刪 brokers handler(:100-104)+ import `warrant_brokers`;docstring 移除 brokers 錯誤邊界描述 |
| `services/warrant_brokers.py` | 整檔刪 |
| `tests/test_warrant_brokers.py` | 整檔刪(7 支 = 該紅) |
| `tests/test_warrants_routes.py` | 🆕 紅先行:`"/api/warrants/{warrant_id}/brokers" not in {r.path for r in app.routes}`;刪 3 支 brokers 測試(:55-59 / :96-115)+ `import services.warrant_brokers as wb` + docstring 修 |
| `services/finmind.py:646-647` | **只改 docstring**:caller 指涉 `warrant_brokers.py` → `warrant_flow.py`(method 保留 — warrant_flow.py:171 續用) |
| `backend/tests_e2e/test_api_warrants.py` | 刪 `test_brokers_happy_path`(:81-87)整支;`test_bad_symbol_400_all_paths`(:177-187)**只刪 :181-183 的 /brokers 斷言 3 行**,保留 /api/warrants 與 /flow 的 bad_symbol 斷言(review R1 — 該測試同時是 W8 的 e2e 級保護) |
| `docs/next-time.md` | :23 修剪 `_candidate_dates` 複本描述(warrant_brokers 刪除後複本數 2→1;review R6) |
| `docs/specs/warrant-selector/spec.md` | 文件頂部加涵蓋性 amendment(分點展開已於 2026-07-16 本 mod 移除,列受影響段落),並在 §3.3 route 清單與 §5 SC-6 就地標記(review R3 — 單點註記留高誤導面);其他提及段落由頂部 amendment 涵蓋 |

e2e:
| 檔 | 動作 |
|---|---|
| `e2e/helpers/selectors.ts` | 刪 `warrantBrokersDetail`(FOOTER ENFORCEMENT:同 PR 三步齊動) |
| `e2e/specs/equity.spec.ts` | 刪 E11 整支;E13 `/展開分點/` → `/展開明細/` |

**保留不動(易誤刪清單)**:`services/warrant_flow.py`、`finmind.py::fetch_warrant_trading_daily_report` 本體、MANIFEST 三個 `TaiwanStockWarrantTradingDailyReport_*.json` fixture(flow E14 + test_warrant_flow.py:499 在用)、`useWarrantIvHistory.*` 註解、`WarrantIvHistory.tsx` / `warrant-iv-svg.ts`。

### Commit C 🟢 feat(frontend): 發行商下拉篩選(名稱抽取)

| 檔 | 動作 |
|---|---|
| `lib/warrant-utils.ts` | 加 `WARRANT_ISSUERS`(台灣權證發行商 2 字簡稱名單,現役為主:元大/凱基/統一/群益/富邦/永豐/國泰/兆豐/中信/元富/永昌/玉山/台新/國票/康和/宏遠);`extractIssuer(name): string | null` — 主路徑 `name.slice(2,4)` ∈ 名單(標準簡稱格式:標的 2 字 + 發行商 2 字),fallback **從 index 2 起**掃描全名(容 3 字標的簡稱 — issuer 落點 index 3;index 0/1 由主路徑與「標的自身撞名(國泰金/富邦金)」排除;review R5 收窄 false-positive 面);`WarrantFilters.issuer: string | null` + `DEFAULT_FILTERS.issuer = null`;`filterWarrants` 加 issuer 分支(選定時 `extractIssuer(r.name) !== f.issuer` 剔除,抽不出者一併剔除) |
| `lib/warrant-utils.test.ts` | 🆕 紅先行:標準名 / 3 字標的 fallback / 標的 = 金控名(國泰凱基→凱基)/ 名單外 → null / 認售名 / 3 字標的第 2-3 字含名單字樣之反例(review R5);filterWarrants issuer 分支(null 全放行 / 指定發行商 / null-issuer row 被剔) |
| `components/WarrantSelector.tsx` | 篩選列「類型」群組後加 `發行商` 原生 `<select>`(OptionsHeader.tsx:38 樣板;aria-label「發行商篩選」;controlled `value={filters.issuer ?? "all"}`);選項 = `全部` + 從 `warrantsHook.data.warrants` 名稱抽取之去重發行商(`useMemo`,localeCompare 排序;從 terms 推導 → 不隨其他篩選縮減) |
| `components/WarrantSelector.test.tsx` | 🆕 紅先行:下拉選項 = 全部 + 實際發行商;選定後 rows 過濾;重製篩選回「全部」+ rows 回全量 |
| `e2e/specs/equity.spec.ts` | 🆕 E20:選凱基 6→1(030011)→ 重製回 6 + 下拉回 all |

### Commit D 🟢 feat(frontend): changelog 0.32.0

| 檔 | 動作 |
|---|---|
| `frontend/src/lib/changelog.ts` | 新 VersionEntry `0.32.0`(MINOR:發行商篩選新功能主導;同 ship event 併對齊修復與分點移除兩項;text 撰寫前讀 `changelog-conventions`)— 現行最新 = **0.31.2**(review R2 校正) |
| `changelog.test.ts:83` | 最新版本 pin "0.31.2" → "0.32.0" |

### 既有測試標紅表

**該紅(🔴,隨 B 刪除/改寫)**:`useWarrantBrokers.test.ts` 全部(刪)、`WarrantSelector.test.tsx` 分點 3 支(刪)+ `/展開分點/` label 引用(改)、`test_warrant_brokers.py` 全部(刪)、`test_warrants_routes.py` brokers 3 支(刪)、`tests_e2e/test_api_warrants.py` `test_brokers_happy_path`(刪)+ `test_bad_symbol_400_all_paths` 部分改寫(只刪 /brokers 斷言 3 行,review R1)、e2e E11(刪)/ E13 label(改)。

**不該紅(打到 = 回頭查)**:`test_warrant_flow.py` 全部、`useWarrantIvHistory.test.ts`、`useWarrants/useWarrantQuotes` 測試、WarrantSelector 其餘測試(欄位選單 / 重製 / 價量兩行 / badge / epoch)、e2e E8(除新增 assertion)/ E9 / E12 / E13(除 label)/ E14 / E18 / E19、options / market / navigation / NTD 全部、backend 其餘 718−(7+3) 支。

### 驗證計畫(Phase 6-7)

- 自動化(auto-verify + harness.json):backend `pytest -q` + `ruff check .`;frontend `npm test` + `npm run build`;e2e `npm test`(本次屬必跑類型;改 fixture 無 → 不需清 `e2e/.cache`,但跑前照 SOP 檢查)。
- 真實環境(Phase 7):dev server(:8000 FAKE 不用 — 真 FinMind)+ :5173,DevTools MCP:對齊截圖、發行商下拉操作截圖、展開列只剩 IV + network 無 /brokers、console 乾淨;白名單 W1-W10 逐條。

### Known risks / P2 註記

- 發行商名單為 heuristic(名單外新券商 / 非標準簡稱抽不出 → 僅「全部」可見);graceful degradation 已定為設計,user 名單問題浮現時再補條目即可(單常數陣列)。
- e2e fixture 權證名(t187ap37_L.json)剛好每發行商一檔,E20 count 訊號 discriminative。

---
self_review_head: 9a65603c734f859b8781d9a34843053e0844b098
