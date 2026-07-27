# neigui — 台股籌碼 / 選擇權分析 dashboard

User-global `~/.claude/CLAUDE.md` 的鐵則(觀察優先 / Scope / 測試 / 證據 / 禁止繞過 / 3 次上限 / Sub-agent)一律繼承,不在這裡重述。本檔只放「讀 code 看不出來」且**每個 session 都需要**的專案級事實;情境性的累積慣例在 §8 的主題 skills,按需載入。

---

## 0. 目的 & 結構

- 三個頁面 mode:`equity`(個股籌碼 — 三大法人 / 主力券商)、`options`(TXO 大戶 OI + 量能階梯)、`market`(全市場即時「今日三卡」— 加權vs上櫃強弱+貢獻 top5 / 市值分層 / 族群輪動三層鑽取,+ heatmap / 排行;**零歷史窗**,全部吃 tick snapshot,2026-07-20 market-today 改版)。`App.tsx` 的 `mode` state 用 `localStorage` 持久化。

---

## 1. 啟動 & 驗證(覆寫 `auto-verify` 預設)

| 用途 | 指令 | 工作目錄 |
|------|------|---------|
| Backend dev | `python -m uvicorn main:app --reload --port 8000` | `backend/` |
| Frontend dev | `npm run dev` | `frontend/`(`:5173`,strictPort)|
| Python 測試 | `python -m pytest -q` | `backend/` |
| Python 單檔測試 | `python -m pytest -q tests/test_options_routes.py::TestName -x` | `backend/` |
| Frontend 測試 | `npm test` (vitest run) | `frontend/` |
| Frontend watch | `npm run test:watch` | `frontend/` |
| Frontend build | `npm run build` (tsc -b + vite build) | `frontend/` |
| E2E 測試 | `npm test` (playwright,跳過 `@live` / `@visual`) | `e2e/` |
| E2E 單檔 | `npx playwright test specs/equity.spec.ts` | `e2e/` |
| Lint(Python) | `ruff check .`(line-length 100,target py312) | `backend/` |

完成前要過的 gate(/feat Phase 5、/mod Phase 6 等自動化驗證階段,`auto-verify` 一律套):`pytest -q` + `ruff check .`(backend)+ `npm test`(frontend vitest)+ `npm run build`(frontend,捕 TS error)+ **`npm test`(e2e,屬於 skill `e2e-conventions` 判準表「需要 e2e」的改動類型才必跑;不屬則可豁免並在 commit 註明)**。Build 過 ≠ 行為對,UI 改動還要走 chrome-devtools-mcp 真實截圖驗證。

驗證指令的**機器可讀來源** = `.claude/harness.json`(auto-verify 優先讀它、git pre-push 防線共用);改驗證指令改那裡,上表是人讀對照,兩邊要同步。**harness.json 只涵蓋無條件 gate**(pytest / ruff / vitest / build);E2E 刻意排除 — 條件跑(判準在 `e2e-conventions`)且 pre-push 跑不起,豁免與必跑由流程層把關。

E2E 歸屬判準(動哪個 spec / 豁免類型 / `@live` 規則)在 skill `e2e-conventions`(2026-07-06 自本檔移入)— `/feat` Phase 0 / `/mod` Phase 2 **決定 e2e 歸屬前必讀**,結論寫進 brainstorm.md / change-spec.md,TDD 階段同步動 spec。

`.env` 需要 `FINMIND_TOKEN`(必填,否則 `FinMindClient.__init__` raise);optional 變數與配額真相見 skill `finmind-conventions`。

---

## 2. Python 風格(專案特化)

已移入 skill `backend-conventions`(2026-07-27):寫改 `backend/**/*.py`、開新 endpoint /
service、寫 backend 測試前**必讀** — future annotations 強制 / type hints / logging /
FastAPI error contract / 外部 IO 樣板 / async / 錯誤處理 / pytest 慣例全在該檔。

---

## 3. React / TypeScript 風格(專案特化)

已移入 skill `frontend-conventions`「Stack / 元件慣例」節(2026-07-27):寫改 frontend
元件 / hook / 樣式前**必讀** — hook 回傳 shape / TanStack Query / semantic token / lazy /
繁中 UI 文字 / hidden vs ternary / useSessionState 等全在該檔;vitest 測試慣例照舊見
`frontend-testing`。

---

## 4. 跨檔契約

- **API error JSON shape**:`{ "detail": { "error": "<code>" } }`,frontend `lib/api.ts` 的 `__apiGet` 解 `error.message`。改契約 = 同時改兩邊。
- **`no_trading_day` flag**:options API 在 `as_of_date !== requested_date` 時 payload 加 `no_trading_day: true`;前端 hook 統一暴露成 `noTradingDay` boolean。spec §2.5。
- **Refresh 慣例**:URL query `?refresh=true` → backend 跳過 cache、重抓 FinMind。frontend hook 的 `refresh()` 一律帶 true。
- **Cache version bump**:`_CACHE_VERSION`(在各 service 內)+1 即作廢所有舊 cache,不需手動清。
- **Contract ID 格式**(options):`<option_id><contract_date>` 串平,例如 `TXO202607`(月) / `TXO202607W2`(週)。解析靠 `_resolve_contract`,**不要在前端拆字串**。
- **三大法人鍵名一律 `foreign / dealer / trust`**(自營商 = dealer),**不是 `prop`** — 對齊 `chip-data.ts`;同 repo 用兩個 key 表示同一監管實體會撞 bug + 撞測試。
- **分點名稱顯示一律走 `lib/broker-name.ts`**,契約:selection / API / callback 以 `broker_id`(或原始 name,如 BrokerSearch)為 key,**新顯示點不准直接印 raw name** — formatBrokerLabel / formatBrokerName 分工與 dash-insensitive 比對細節已移 skill `frontend-conventions`「分點名稱顯示」節(2026-07-27)。
- **TXO domain 鐵則**:
  - 支撐 = bull(紅)/ 壓力 = bear(綠):Call Wall = 壓力 = bear 色、Put Wall = 支撐 = bull 色。顏色 binding 一律加 data-testid + 正向 assertion 鎖住。
  - PCR / Max Pain UI **嚴禁方向性文案**(不寫「做多 / 做空 / 賣選 / 滿倉」),只呈現分位 + region 標(高/中/低)+ 統計表;元件測試 `expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull()` 鎖住。
  - Hit rate 一律用 **T-1 日**的 Max Pain / OI Wall,不用 settlement 當天(結算前 OI 已 collapse,用當天 = look-ahead bias,命中率 90%+ 全是假的)。

---

## 5. 資料源

- **FinMind = 主要資料源**。User 是 Sponsor tier,付費 dataset 全開(夜盤法人 / 大戶 OI / Tick / 結算價)。詳見 memory: [[reference_finmind_api]]。挑 dataset 不要被「Free 限制」框住。接入慣例與配額見 skill `finmind-conventions`。
- **TAIFEX OpenAPI** 只在 FinMind 沒提供的指標(PC ratio / VIX 分鐘 / opt delta 日報)才走。
- 沒有 DB。State = client(React) + filesystem JSON cache(backend)。Cache 路徑 `utils.cache.chip_cache_dir()`。

---

## 6. 提交慣例

- Commit message 既有風格:`<type>(<scope>): <subject>`,type 取 `feat` / `fix` / `chore` / `refactor` / `perf`,scope 多用 `options` / `chip` / `frontend`。subject 描述「為何」 > 「做了什麼」。
- 三類分開(對應 user-global B 條):🔴 行為改 / 🟢 新功能 / 🔵 重構 不混 commit。emoji 前綴僅流程內(/feat /mod /refactor 等)TDD commit 強制(/feat Phase 8 script 驗);流程外 commit 只要求三類不混,不強制 emoji 前綴。
- DevTools MCP 驗證截圖放 `docs/specs/<feature>/screenshots/`,commit 訊息註明 `chore(...): ... verification screenshots`。

---

## 7. 版本管理慣例

User-facing changelog 在 `frontend/src/lib/changelog.ts`,前端 top bar 右側 `v0.x.y` badge 點開即顯示。版本字串遵循 **SemVer 2.0.0 三段式** `MAJOR.MINOR.PATCH`(2026-06-29 deep-research 21 條 verified claim 為基礎)。

### Pre-1.0 階段(0.x.y)bump 規則

| 變動類型 | bump 位 | 範例 |
|---|---|---|
| 使用者可感的新功能(新 panel / 新指標 / 新分析模式 / 新資料源) | **MINOR** | `0.14.0` → `0.15.0` |
| 使用者可感的 UX / 視覺改動(layout 大改、popover redesign) | **MINOR** | `0.13.0` → `0.14.0` |
| 影響體驗的 bug fix(使用者會抱怨的) | **PATCH** | `0.14.0` → `0.14.1` |
| 非關鍵 bug / 性能改進(使用者可感受) | **PATCH** | cache 加速、回應更穩 |
| Breaking change(pre-1.0 階段) | **MINOR**(per git-cliff zero-preservation 慣例,保留 leading 0 表 API 未穩定) | API 重命名 |
| 純內部 refactor / 測試補強 / 文件 | **不入 changelog** | refactor 不算 release |
| 真正 production-ready 宣告 | **MAJOR → 1.0.0**(由 user 自行決定發布時點) | — |

### 每次 commit / PR 前

判斷本次改動屬於哪一格,**新增 VersionEntry 條目**:
- Hotfix 一個既有 release → 新 entry,bump PATCH(`0.14.0` → `0.14.1`)
- Refactor 不入 changelog,除非伴隨 user-visible 變動則合併到該變動的 entry
- 結構欄位(`kind` / `scope` / `date` / index 0 / 同 ship event 合併)與 `text` 撰寫判準 → skill `changelog-conventions`,**寫 entry 前必讀**

不在自動化驗證強制,屬 PR 流程紀律(類似 commit message convention)。1.0.0 升級時點由 user 自行宣告(理由見 `docs/decisions.md`)。

---

## 8. 主題 skills 索引(累積慣例的按需載入層)

專案累積的 code-anchored 慣例已按主題拆進 `.claude/skills/`,**動到對應範圍前先讀該 skill**:

| 情境 | Skill |
|---|---|
| 接 FinMind dataset / probe 腳本 / fan-out 設計 / 配額評估 / 成串 502/503 排查 / backend test 基建 | `finmind-conventions` |
| 接 TWSE RWD / OpenAPI、TPEx OpenAPI 直抓端點 / 民國日期 / 月批次 cache / TPEx TLS 與無歷史限制 / 直抓 service 的 FAKE 層 | `twse-tpex-conventions` |
| Market snapshot / 今日三卡(index_strength / cap_tiers / sector_rotation)/ IndustryChain / heatmap / universe filter | `market-pipeline` |
| Cancel 鏈 / prd 502 / CancelledError / >30s endpoint / inflight dedup / 前端 fetch signal | `cancel-chain` |
| **判斷改動要不要 e2e(Phase 0)** / 寫改 e2e spec / fixture rotation / :8000 與 --reload 驗證前檢查 | `e2e-conventions` |
| 寫 component / hook 的 vitest 測試 | `frontend-testing` |
| 寫改 backend `*.py`(風格 / IO 樣板 / error contract / pytest 慣例) | `backend-conventions` |
| 寫改 frontend 元件 / hook(stack 慣例)/ SVG renderer / 響應式 / 分點名稱顯示 / 驗證截圖 | `frontend-conventions` |
| 寫 changelog entry 文字(VersionEntry `text`) | `changelog-conventions` |

- 技術選型的已採納 / 不採納決策 → `docs/decisions.md`(提議新 library / 大重構前先查,別重開已結案討論)。
- 順手發現的待辦 → `docs/next-time.md`(commit 前 cat 一次)。
- 新 lesson 沉澱目的地(/feat Phase 8.5 規則):code-anchored 慣例 → 上表對應 skill 檔(**寫入前先查同主題舊條目做合併/翻新/刪除,不准只往上疊**);跨檔契約 → 本檔 §4;backend / frontend 風格 → 對應 conventions skill(2026-07-27 起 §2/§3 已移入);帳號 / 偏好 / 名單 → memory;流程瑕疵 → `~/.claude/feat-improvements.md`。
