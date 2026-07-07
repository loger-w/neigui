# neigui — 台股籌碼 / 選擇權分析 dashboard

User-global `~/.claude/CLAUDE.md` 的鐵則(觀察優先 / Scope / 測試 / 證據 / 禁止繞過 / 3 次上限 / Sub-agent)一律繼承,不在這裡重述。本檔只放「讀 code 看不出來」且**每個 session 都需要**的專案級事實;情境性的累積慣例在 §8 的主題 skills,按需載入。

---

## 0. 目的 & 結構

- Backend = FastAPI(Python 3.12),把 FinMind / TAIFEX 資料整成內部 JSON API。
- Frontend = React 19 + Vite 6 + Tailwind 4 + Radix UI primitives,dev server `:5173` 透過 vite proxy 轉 `/api` → `:8000`。
- 三個頁面 mode:`equity`(個股籌碼 — 三大法人 / 主力券商)、`options`(TXO 大戶 OI + 量能階梯)、`market`(全市場 heatmap / 寬度 / 排行)。`App.tsx` 的 `mode` state 用 `localStorage` 持久化。

```
backend/
  main.py            FastAPI app + CORS + Gzip + lifespan
  routes/            chip / symbols / options / market — 每個 router 自己一個檔
  services/          finmind*.py + rate_limiter.py(對外 IO)
  utils/cache.py     atomic JSON cache(版本號 invalidate)
  tests/             test_*.py,asyncio_mode = auto
frontend/src/
  App.tsx            equity 主頁面 + mode 切換
  components/        頁面元件 + ui/(shadcn-ish)
  hooks/             useXxx.ts,domain 資料 fetching
  lib/               api client、純 SVG renderer、type 定義
  index.css          @theme tokens(見 §4)
docs/specs/          spec / plan(規格優先看這)
docs/harness/        AI 開發 harness 鏡像(commands/hooks/skills/agents + SPEC)
.claude/harness.json 驗證指令插槽(auto-verify 與 git pre-push 共用的機器可讀來源)
scripts/git-hooks/   git pre-push 測試防線(core.hooksPath 指向此)
```

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
| E2E visual baseline 更新 | `npm run test:update-snapshots`(或在 GitHub 跑 `e2e-update-snapshots` workflow) | `e2e/` |
| Lint(Python) | `ruff check .`(line-length 100,target py312) | `backend/` |

完成前要過的 gate(/feat Phase 5、/mod Phase 6 等自動化驗證階段,`auto-verify` 一律套):`pytest -q` + `ruff check .`(backend)+ `npm test`(frontend vitest)+ `npm run build`(frontend,捕 TS error)+ **`npm test`(e2e,屬於 skill `e2e-conventions` 判準表「需要 e2e」的改動類型才必跑;不屬則可豁免並在 commit 註明)**。Build 過 ≠ 行為對,UI 改動還要走 chrome-devtools-mcp 真實截圖驗證。

驗證指令的**機器可讀來源** = `.claude/harness.json`(auto-verify 優先讀它、git pre-push 防線共用);改驗證指令改那裡,上表是人讀對照,兩邊要同步。**harness.json 只涵蓋無條件 gate**(pytest / ruff / vitest / build);E2E 刻意排除 — 條件跑(判準在 `e2e-conventions`)且 pre-push 跑不起,豁免與必跑由流程層把關。

### E2E 判準

本次改動**要不要動 e2e、動哪個 spec 檔**(E# / O# / M# / N# / NTD# / L# / V#)、豁免類型、grey zone 預設「需要」、FinMind `@live` 規則 — 判準表已併入 skill `e2e-conventions`(2026-07-06 自本檔移入)。`/feat` Phase 0 / `/mod` Phase 2 **決定 e2e 歸屬前必讀該 skill**,結論寫進 `brainstorm.md` / `change-spec.md`,TDD 階段(/feat Phase 3 / /mod Phase 4)同步動 e2e spec。

`.env` 需要 `FINMIND_TOKEN`(必填,否則 `FinMindClient.__init__` raise)。Optional:`FINMIND_RATE_LIMIT_PER_SEC`(code 預設 40;調 rate 不解決配額 — FinMind 真瓶頸是每小時 6000 requests,見 skill `finmind-conventions`)、`FRONTEND_ORIGIN`。

---

## 2. Python 風格(專案特化)

只列非顯而易見、跨檔一致的:

- **`from __future__ import annotations` 強制**寫在每個 `.py` 第一行(註解後)。
- Type hints **無例外**:函式參數 + 回傳、module-level globals。`dict | None` / `list[dict]` 風格,不要 `Optional` / `List`。
- **Logging**:`logger = logging.getLogger(__name__)`,**禁止** `print`。
- **FastAPI error contract**:`raise HTTPException(status_code=..., detail={"error": "<code>"})` — frontend 依賴 `detail.error` 字串解析。新 endpoint 不要塞自由文字。
  - 502 = upstream 故障(httpx / FinMind);503 = 服務尚未就緒;400 = 用戶錯;404 = 找不到。
- **外部 IO 慣例**(`services/finmind.py` 是樣板):
  - Module-level singleton(`get_finmind()`),不要每次 `new`。
  - 所有 FinMind 呼叫先過 `TokenBucket.acquire_async()`。
  - JSON cache 用 `utils.cache.atomic_write_json` / `read_json`,寫入帶 `_cache_version`,版本 bump 即失效。
  - 同 key 並發走 `_run_once` inflight dedup。
- **async**:`httpx.AsyncClient(timeout=30.0)` + `await`。同步阻塞函式不要混進 route handler。
- **錯誤處理**:catch 要具體(`httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException`),不裸 `except`。`except Exception` 只在 route 邊界 + 一定要 `logger.exception` + 轉 502。
- **測試**:`asyncio_mode = "auto"`,async test 不用 `@pytest.mark.asyncio`。Mock 走 `monkeypatch`,不 `unittest.mock`。
- Ruff:line-length 100。Format 跟既有檔對齊,不順手重排既存格式。

---

## 3. React / TypeScript 風格(專案特化)

- **Custom hook 統一回傳 shape**:`{ data, loading, error, refresh, ...extras }`。新 hook 照這個介面開,UI 元件依賴它。
- **資料 fetching 一律 TanStack Query `useQuery`**:`queryFn: ({ signal }) => api.xxx(..., { signal })` 直傳內建 AbortSignal(cancel 鏈細節見 skill `cancel-chain`);對外回傳 shape 維持上一條。**useMutation 沒內建 signal** — `useBrokerHistory.ts` 的 AbortController pattern 是樣板。**不要**再寫手動 `seqRef` stale-drop(已全面淘汰)。
- **Function component + hooks only**。沒有 class 元件。
- **Tailwind 用 semantic token,不用原色**(`text-ink` / `text-ink-muted` / `text-ink-dim` / `text-accent` / `border-line` / `border-line-strong` / `bg-bg` / `bg-bg-deep`)。token 在 `frontend/src/index.css` 的 `@theme`。Bull = 紅 / Bear = 綠(台股慣例,**不要套美股 green-up 配色**)。
- **重元件 lazy**:跨 tab 切換的大元件(`ChipBubbleView` / `OptionsPage`)走 `React.lazy()` + `<Suspense fallback={...}>`。
- **純渲染抽到 `lib/*-svg.tsx`**:SVG 計算函式無 React 依賴,獨立單元測試(看 `chip-svg.test.ts`)。元件只負責掛 DOM。
- **`cn(...classes)`** 走 `lib/utils.ts`(`clsx` + `tailwind-merge`),不直接拼字串。
- **UI 文字一律繁體中文**(`重新整理` / `載入中` / `無交易日` …)。錯誤訊息也用繁中。Aria-label 同樣繁中。
- **Vitest 測試 colocated** `*.test.tsx` / `*.test.ts`,跑 RTL 的檔要在頂端寫 `/** @vitest-environment jsdom */` pragma(不用 global config)。`afterEach(cleanup)`。測試慣例細節見 skill `frontend-testing`。
- **Path alias** `@/` → `src/`(`vite.config.ts` + `tsconfig.app.json`),但既有 code 多用相對 import,維持就好。
- **Date 用 `YYYY-MM-DD` 字串** 在 API + state 流動;`new Date()` 只在 `App.tsx` 的 `todayStr()` 等邊界。
- **`hidden` attribute > 條件 render(tab 層級)**:tab 切換用 `<div hidden={tab !== "x"}>` 保留 DOM 避免重渲染(看 `App.tsx` overview / bubble)。**mode 層級例外**:App.tsx 的 mode 切換是 ternary(避免多頁同時 mount 抓資料),加新 mode 見 skill `market-pipeline`。

---

## 4. 跨檔契約

- **API error JSON shape**:`{ "detail": { "error": "<code>" } }`,frontend `lib/api.ts` 的 `__apiGet` 解 `error.message`。改契約 = 同時改兩邊。
- **`no_trading_day` flag**:options API 在 `as_of_date !== requested_date` 時 payload 加 `no_trading_day: true`;前端 hook 統一暴露成 `noTradingDay` boolean。spec §2.5。
- **Refresh 慣例**:URL query `?refresh=true` → backend 跳過 cache、重抓 FinMind。frontend hook 的 `refresh()` 一律帶 true。
- **Cache version bump**:`_CACHE_VERSION`(在各 service 內)+1 即作廢所有舊 cache,不需手動清。
- **Contract ID 格式**(options):`<option_id><contract_date>` 串平,例如 `TXO202607`(月) / `TXO202607W2`(週)。解析靠 `_resolve_contract`,**不要在前端拆字串**。
- **三大法人鍵名一律 `foreign / dealer / trust`**(自營商 = dealer),**不是 `prop`** — 對齊 `chip-data.ts`;同 repo 用兩個 key 表示同一監管實體會撞 bug + 撞測試。
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

判斷本次改動屬於哪一格,**新增 VersionEntry 條目**(最新放陣列 index 0):
- 同一 ship event 多 commit 收尾 → 一個新 entry,date = 最後 commit 日期
- Hotfix 一個既有 release → 新 entry,bump PATCH(`0.14.0` → `0.14.1`)
- Refactor 不入 changelog,除非伴隨 user-visible 變動則合併到該變動的 entry

### 撰寫 change item 規則

- `kind` 二選一:`feature`(新功能 / 新視覺)或 `fix`(影響體驗的修正)
- `scope` 三選一:`equity` / `options` / `global`,**不要混用** `prop` 或自由文字
- `date` 用 `YYYY-MM-DD`(同專案其他 date 慣例)
- `text` 一句話 user-facing:核心原則 = **寫「使用者體感到什麼」,不寫「工程上怎麼做」**;完整撰寫判準與壞/好詞例對照已移至 skill `changelog-conventions`(2026-07-06),**寫 entry 文字前必讀**。

### 1.0.0 升級標準

SemVer FAQ 建議「production use 或 stable consumed API」。本專案無外部 API consumer,1.0.0 留給 user 自行宣告「日常依賴」的時點。

不在自動化驗證強制,屬 PR 流程紀律(類似 commit message convention)。

---

## 8. 主題 skills 索引(累積慣例的按需載入層)

專案累積的 code-anchored 慣例已按主題拆進 `.claude/skills/`,**動到對應範圍前先讀該 skill**:

| 情境 | Skill |
|---|---|
| 接 FinMind dataset / probe 腳本 / fan-out 設計 / 配額評估 / 成串 502/503 排查 / backend test 基建 | `finmind-conventions` |
| Market snapshot / EOD / breadth / sector aggregation / heatmap / universe filter | `market-pipeline` |
| Cancel 鏈 / prd 502 / CancelledError / >30s endpoint / inflight dedup / 前端 fetch signal | `cancel-chain` |
| **判斷改動要不要 e2e(Phase 0)** / 寫改 e2e spec / fixture rotation / :8000 與 --reload 驗證前檢查 | `e2e-conventions` |
| 寫 component / hook 的 vitest 測試 | `frontend-testing` |
| 新元件 / SVG renderer / 響應式 / useContainerSize / 驗證截圖 | `frontend-conventions` |
| 寫 changelog entry 文字(VersionEntry `text`) | `changelog-conventions` |

- 技術選型的已採納 / 不採納決策 → `docs/decisions.md`(提議新 library / 大重構前先查,別重開已結案討論)。
- 順手發現的待辦 → `docs/next-time.md`(commit 前 cat 一次)。
- 新 lesson 沉澱目的地(/feat Phase 8.5 規則):code-anchored 慣例 → 上表對應 skill 檔(**寫入前先查同主題舊條目做合併/翻新/刪除,不准只往上疊**);每 session 必讀契約 → 本檔 §2-§4;帳號 / 偏好 / 名單 → memory;流程瑕疵 → `~/.claude/feat-improvements.md`。
