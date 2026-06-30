# trash-cmoney — 台股籌碼 / 選擇權分析 dashboard

User-global `~/.claude/CLAUDE.md` 的鐵則(觀察優先 / Scope / 測試 / 證據 / 禁止繞過 / 3 次上限 / Sub-agent)一律繼承,不在這裡重述。本檔只放「讀 code 看不出來」的專案級事實。

---

## 0. 目的 & 結構

- Backend = FastAPI(Python 3.12),把 FinMind / TAIFEX 資料整成內部 JSON API。
- Frontend = React 19 + Vite 6 + Tailwind 4 + Radix UI primitives,dev server `:5173` 透過 vite proxy 轉 `/api` → `:8000`。
- 兩個頁面 mode:`equity`(個股籌碼 — 三大法人 / 主力券商)、`options`(TXO 大戶 OI + 量能階梯)。`App.tsx` 的 `mode` state 用 `localStorage` 持久化。

```
backend/
  main.py            FastAPI app + CORS + Gzip + lifespan
  routes/            chip / symbols / options — 每個 router 自己一個檔
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
| Lint(Python) | `ruff check .`(line-length 100,target py312) | `backend/` |

完成前要過的 gate:`pytest -q` + `npm test` + `npm run build`(後者捕 TS error)。Build 過 ≠ 行為對,UI 改動還要走 chrome-devtools-mcp 真實截圖驗證。

`.env` 需要 `FINMIND_TOKEN`(必填,否則 `FinMindClient.__init__` raise)。Optional:`FINMIND_RATE_LIMIT_PER_SEC`(預設 5)、`FRONTEND_ORIGIN`。

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
- **Stale-drop 用 `seqRef`**:任何會被 prop 變化重觸發的 async fetch,先 `const seq = ++seqRef.current`,resolve / catch / finally 內先檢 `if (seq !== seqRef.current) return;`。避免 race 把舊資料蓋上新資料。`useOptionsLargeTraders.ts` 是樣板。
- **Function component + hooks only**。沒有 class 元件。
- **Tailwind 用 semantic token,不用原色**(`text-ink` / `text-ink-muted` / `text-ink-dim` / `text-accent` / `border-line` / `border-line-strong` / `bg-bg` / `bg-bg-deep`)。token 在 `frontend/src/index.css` 的 `@theme`。Bull = 紅 / Bear = 綠(台股慣例,**不要套美股 green-up 配色**)。
- **重元件 lazy**:跨 tab 切換的大元件(`ChipBubbleView` / `OptionsPage`)走 `React.lazy()` + `<Suspense fallback={...}>`。
- **純渲染抽到 `lib/*-svg.tsx`**:SVG 計算函式無 React 依賴,獨立單元測試(看 `chip-svg.test.ts`)。元件只負責掛 DOM。
- **`cn(...classes)`** 走 `lib/utils.ts`(`clsx` + `tailwind-merge`),不直接拼字串。
- **UI 文字一律繁體中文**(`重新整理` / `載入中` / `無交易日` …)。錯誤訊息也用繁中。Aria-label 同樣繁中。
- **Vitest 測試 colocated** `*.test.tsx` / `*.test.ts`,跑 RTL 的檔要在頂端寫 `/** @vitest-environment jsdom */` pragma(不用 global config)。`afterEach(cleanup)`。
- **Path alias** `@/` → `src/`(`vite.config.ts` + `tsconfig.app.json`),但既有 code 多用相對 import,維持就好。
- **Date 用 `YYYY-MM-DD` 字串** 在 API + state 流動;`new Date()` 只在 `App.tsx` 的 `todayStr()` 等邊界。
- **`hidden` attribute > 條件 render**:tab 切換用 `<div hidden={tab !== "x"}>` 保留 DOM 避免重渲染(看 `App.tsx` overview / bubble)。

---

## 4. 跨檔契約

- **API error JSON shape**:`{ "detail": { "error": "<code>" } }`,frontend `lib/api.ts` 的 `__apiGet` 解 `error.message`。改契約 = 同時改兩邊。
- **`no_trading_day` flag**:options API 在 `as_of_date !== requested_date` 時 payload 加 `no_trading_day: true`;前端 hook 統一暴露成 `noTradingDay` boolean。spec §2.5。
- **Refresh 慣例**:URL query `?refresh=true` → backend 跳過 cache、重抓 FinMind。frontend hook 的 `refresh()` 一律帶 true。
- **Cache version bump**:`_CACHE_VERSION`(在各 service 內)+1 即作廢所有舊 cache,不需手動清。
- **Contract ID 格式**(options):`<option_id><contract_date>` 串平,例如 `TXO202607`(月) / `TXO202607W2`(週)。解析靠 `_resolve_contract`,**不要在前端拆字串**。

---

## 5. 資料源

- **FinMind = 主要資料源**。User 是 Sponsor tier,付費 dataset 全開(夜盤法人 / 大戶 OI / Tick / 結算價)。詳見 memory: [[reference_finmind_api]]。挑 dataset 不要被「Free 限制」框住。
- **TAIFEX OpenAPI** 只在 FinMind 沒提供的指標(PC ratio / VIX 分鐘 / opt delta 日報)才走。
- 沒有 DB。State = client(React) + filesystem JSON cache(backend)。Cache 路徑 `utils.cache.chip_cache_dir()`。

---

## 6. 提交慣例

- Commit message 既有風格:`<type>(<scope>): <subject>`,type 取 `feat` / `fix` / `chore` / `refactor` / `perf`,scope 多用 `options` / `chip` / `frontend`。subject 描述「為何」 > 「做了什麼」。
- 三類分開(對應 user-global B 條):🔴 行為改 / 🟢 新功能 / 🔵 重構 不混 commit。
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
- `text` 一句話 user-facing,**不寫實作細節 / 工程術語 / 具體 benchmark 數字**(讀者可能含非工程背景的人,沒 baseline 也無從理解專業詞):
  - 壞:`refactor brokers_window cache key` / `permutation 相關係數` / `T-1 look-ahead` / `fallback 行為` / `資料載入吞吐提升` / `冷啟動 27 秒縮至 4 秒` / `top bar` / `dashboard` / `popover` / `badge` / `sparkline` / `trade list` / `crosshair` / `overlay` / `MVP` / `UI 元件` / `UX` / `OHLCV` / `虛擬化` / `spinner` / `骨架動畫`
  - 好:`N 日券商窗首次開啟大幅加速` / `附歷史相關性` / `結算前一交易日資料` / `資料缺漏時改用最近可用日期` / `資料載入更快` / `首次開啟大幅加速` / `頂部` / `分析工具` / `彈出視窗` / `版本號` / `迷你走勢圖` / `成交列表` / `十字游標` / `(把 overlay 略掉不另寫)` / `首版` / `介面元件` / `體驗` / `K 線資訊` / `大量資料捲動` / `讀取動畫指示`
  - 通用判準:**寫出「使用者體感到什麼」,不寫「工程上怎麼做」**。金融術語(`Max Pain` / `OI 牆` / `Call Wall` / `Put Wall` / `PCR` / `TXO` / `履約價` / `布林通道` / `台指期`)與 UI 標籤一致時保留,讓使用者能對應介面找到功能。

### 1.0.0 升級標準

SemVer FAQ 建議「production use 或 stable consumed API」。本專案無外部 API consumer,1.0.0 留給 user 自行宣告「日常依賴」的時點。

不在自動化驗證強制,屬 PR 流程紀律(類似 commit message convention)。

---

## 8. 2026 共識升級路線

以下為 2026-06 deep-research(7 個 high-confidence findings,通過 3-vote adversarial verification)的對應升級路線。**已採納項**逐一落實後本節對應條目可刪除或併入 §2/§3。

### 已對齊現狀 ✓(不需動)
- **Ruff**(check + format)取代 Black + isort + flake8 — Stack Overflow 2025 最受推崇開發工具第一,FastAPI/Pydantic/Pandas/SciPy/PyTorch/Airflow 都採用([Astral docs](https://docs.astral.sh/ruff/faq/))
- **FastAPI raise HTTPException + `{"detail": ...}`**,非 RFC 7807(FastAPI 官方至今未實作)([FastAPI errors](https://fastapi.tiangolo.com/tutorial/handling-errors/))
- **Backend layered/by-type structure** — 跟官方 `full-stack-fastapi-template`(43.8k stars,tiangolo)一致;社群 `zhanymkanov/fastapi-best-practices` 推 feature-based 是唯一未收斂分歧,solo + 小型專案跟官方
- **pytest + asyncio_mode = auto** — JetBrains/PSF 2024:pytest 53% vs unittest 23%
- **TypeScript `strict: true`** — Matt Pocock / Total TypeScript baseline ✓
- **Tailwind 4 + React 19 + Radix Primitives** — shadcn/ui 新專案預設 stack

### 採納升級項(逐步執行)

**P0 — 引入 TanStack Query,砍掉手寫 fetch hook**
- 根據 React 官方 [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect):`useEffect` 在 React 19 只剩「同步外部系統」一個正當理由,data fetching 該交給 library。
- 現有 8 個 hook(`useChipData` / `useBrokerHistory` / `useAllSymbols` / `useChipBubble` / `useOptionsLargeTraders` / `useOptionsSpot` / `useOptionsStrikeVolume`,以及 broker 列表)各自實作 `seqRef` stale-drop、loading/error state、`refresh()` — 是手工重造 TanStack Query 一半功能。
- TanStack Query 週下載 12.3M > SWR 7.7M(late 2024 黃金交叉);Q 是「professional standard」([pkgpulse 2026](https://www.pkgpulse.com/guides/tanstack-query-vs-swr-2026))。
- **規則**:新 hook 一律用 `useQuery`,對外回傳 shape 維持 `{ data, loading, error, refresh, ...extras }` 讓 UI 不感知差異。`seqRef` 從新 code 移除。

**P1 — 拿掉 `forwardRef`,開 `noUncheckedIndexedAccess`**
- React 19 把 `ref` 改成普通 prop,`forwardRef` 已 deprecate([shadcn React 19 docs](https://ui.shadcn.com/docs/react-19))。改寫範例:`React.forwardRef<HTMLInputElement, Props>(...)` → `function X({ ref, ...props }: Props & { ref?: Ref<HTMLInputElement> })`。
- `tsconfig.app.json` 加 `"noUncheckedIndexedAccess": true`,陣列索引強制成 `T | undefined`(會抓出實際的 length-0 / off-by-one 潛在 bug)([Total TypeScript](https://www.totaltypescript.com/tsconfig-cheat-sheet))。

**P2 — Backend 全域 exception handler + 加 pyright + lint useEffect anti-pattern**
- `routes/options.py` 6 處重複的 `try / except httpx.X / ValueError / Exception` 抽成 `main.py` 的 `@app.exception_handler`。route 內**只 raise 不 catch**(FastAPI 官方建議,異常會穿過 dependency 立即終止 request)。
- 加 `pyright`(basic 模式)到 backend dev deps — type hint 已寫齊,加 checker 拿到免費 invariant check。
- frontend 加 `eslint-plugin-react-you-might-not-need-an-effect`,P0 之後若還有 `useEffect` 是 anti-pattern,lint 會抓出來。

### 刻意不採納項(避免 over-engineering)

| 共識做法 | 不採納理由 |
|---------|----------|
| Frontend feature folder(`features/options/...`,bulletproof-react 風格) | 目前 ~40 個 TS 檔、兩個 mode(equity / options),by-type 結構還夠用。feature folder 是 100+ 檔回本,現在強推會變形式主義 |
| Zustand / Jotai / Redux Toolkit | 所有 state 都在 `App.tsx` 集中管,沒跨組件深度共享。P0 後 server state 進 TanStack Query,client state 更少,**完全不需要 store** |
| shadcn/ui CLI init | `components/ui/` 已自己刻齊 button/checkbox/input/skeleton/tabs/date-field,照 shadcn 寫法重整即可 |
| Backend feature-based 重構 | 官方 template + 現況都是 layered,共識本身分歧,不動 |
| RFC 7807 problem details | FastAPI 官方未實作,frontend 已依賴 `{"detail": {"error": "<code>"}}` 格式,改動成本 > 收益 |
| mypy strict | research 此項共識不強;選 pyright 因比 mypy 快、預設 basic 即可,不上 strict |

---

## 9. Lessons Learned(累積 — 從 /feat 等流程的 Phase 8.5 沉澱)

### FinMind API 接入細節
- **Sponsor tier 必須用 `Authorization: Bearer <token>` header**,**不是** `?token=` query。`?token=` 會回 400 "Token is illegal"。Probe / 直 httpx 呼叫都要套。`FinMindClient._get` 已是這個 pattern,跟著用。(Trigger:新接 FinMind dataset、寫一次性 probe 腳本時)
- **JWT 過期是日常事件**:token 的 `exp` claim 是 unix epoch,內嵌在 JWT payload。要備好「token 過期 → 真實環境驗證 blocked」的 fallback 設計(hand-built fixture + 標 R# known risk + Phase 6 deferred 路線)。(Trigger:跑 `/feat` 進入 Phase 6 real-env 前)

### TXO 籌碼指標(reflexivity hedge 慣例)
- **支撐 = bull (紅)** / **壓力 = bear (綠)** — 跟「up = bull = 紅」一致,但 wall context 的直覺常被搞反。Call Wall = 壓力 = 漲不上去 = bear color;Put Wall = 支撐 = 跌不下去 = bull color。寫顏色 binding 一律加 data-testid + 正向 assertion 鎖住。
- **PCR / Max Pain UI 嚴禁方向性文案**:不寫「做多 / 做空 / 滿倉 / 賣選」。只呈現分位 + region 標(高/中/低)+ 統計表。元件測試 `expect(screen.queryByText(/做多|做空|賣選|滿倉/)).toBeNull()` 鎖住。原因見 [[txo-chip-framework reflexivity hedge]]。
- **三大法人鍵名一律 `foreign / dealer / trust`**,**不是 `prop`**。對齊既有 `chip-data.ts` 慣例(自營商 = dealer)。同 repo 用兩個 key 表示同一個監管實體會撞 bug + 撞測試。
- **Hit rate 用 T-1 day's Max Pain / OI Wall,不要用 settlement 當天**:settlement 13:00-13:25 結算前 OI 已 collapse,當天的 Max Pain 機械式逼近 settlement,看起來命中率 90%+ 全是 look-ahead bias。寫 hit_rate parser 一定要明確設定 `t_minus_1` 取值。

### 共用 FinMind window 設計
- `services/finmind.py::fetch_taiwan_option_daily_window` 是「一份 250-day window 給三個 endpoint 共用」的範本。新 chip endpoint 跟著:
  - 用 `_run_once(f"window_{cache_key}", ...)` inflight dedup
  - Invalidation 必須在 `_run_once` coroutine 內、dedup 之後、實際 fetch 之前
  - parse cache 用 `_invalidate_chip_parse_caches(end_date)` pattern delete(`utils.cache.chip_cache_dir().iterdir()` 單次掃)
- Refresh 流前端要設「全 4 hook refresh 一起跑」(`mp.refresh(); ow.refresh(); pcr.refresh(); inst.refresh()`),**不要**用 `queryClient.invalidateQueries` cascade — cascade 不會帶 `refresh=true` 到後端,sibling 撞 parse cache 拿到 stale。

### Test infrastructure
- `backend/tests/conftest.py` 統一處理 `FinMindClient` singleton reset + `FINMIND_TOKEN` env + `CHIP_DATA_DIR` env + `NoOpBucket` 跳過 rate limiter。每個新 test 檔**不**要再寫 `_reset_singleton`,直接用 conftest 的 autouse。`bypass_finmind_rate_limiter` 是 opt-in fixture(非 autouse)。
- 寫 hook + component 測試一律用 `vi.spyOn(optionsApi, "...").mockResolvedValue / mockRejectedValue` pattern,**不要**引入 MSW(專案沒裝)。Failure-isolation E2E 在 `OptionsChipPanel.test.tsx` 用 `vi.spyOn` + `screen.getByText` 驗,**不**走 DevTools MCP。
- **沒裝 `@testing-library/jest-dom` 也沒裝 `@testing-library/user-event`**(2026-06-29 確認)。新 RTL 測試**禁止**用 `toBeInTheDocument()` / `toHaveTextContent()` / `userEvent.click()`,既有 `ModeSwitch.test.tsx` 風格為標準:`expect(el).toBeTruthy()` / `expect(el).toBeNull()` / `el.textContent` / `el.getAttribute()` + `fireEvent.click(...)`。Trigger:寫新 component / hook 測試。
- **RTL `getByText(regex)` 撞多元素 = selector 過鬆,不是 Portal leak**。Radix Popover 內 highlights `<p>` 與 changes `<li>` 若含相同 substring,寬鬆 regex 會 `getMultipleElementsFoundError`。修正:換更精確 substring(動詞前綴如 `/新增X/`)或 `within(container)` 收斂 scope,**不要**第一直覺加 `document.body.innerHTML = ""` afterEach hack(這只在真有 portal 殘留時才必要)。Trigger:寫 Radix Popover / Dialog 元件測試,內容含 user-editable 文本。
- **Radix `Tabs` 在 jsdom + fireEvent.click 不可靠**:Radix Tabs.Trigger 走 pointer events,vitest fireEvent.click 不一定觸發 onValueChange;且 `TabsContent` inactive 不 forceMount = 切過去前內容不在 DOM。**不要**為了「對齊 Radix」而用,改寫成普通 `<button role="tab" aria-selected>` + 條件 render,可測性立刻變高(MarketLeaderboard.tsx 是樣板)。Trigger:寫 jsdom 測試含 Tab 切換的元件。
- **TanStack Query v5 hook 的 `retry: 1` + `error` 終態測試**:default `retryDelay` 是 exponential backoff(初次 1s,二次 2s),`waitFor` default 1s timeout 抓不到 settle。寫 error path test 必須給 `waitFor` timeout: 5000 或 mock 出 cancelable promise。Trigger:寫 useQuery hook 的 error path test。

### E2E 測試框架慣例(2026-06-30 /feat e2e-tests 沉澱)

- **FAKE_FINMIND env-gate 三層架構**:`services/finmind.py::FinMindClient.__init__` 在 `FAKE_FINMIND=1` 跳 httpx + token + 用 `NoOpBucket`;`services/finmind_fake.py::FakeFinMindClient(FinMindClient)` 繼承 + override `_get` 讀 `tests_e2e/fixtures/MANIFEST.json` preload。**不要** parse filename heuristic — explicit MANIFEST 對映 filename→{dataset, data_id} 是 6 輪 review 確認的唯一 sound path(R3-P0-PARSE)。新 fixture 寫進 fixtures/ 必同 commit 加 MANIFEST 條目,`backend/tests/test_fake_finmind_manifest.py` 3 個 gate 會抓 drift。Trigger:新增 FinMind dataset / 新 chip route fan-out 時。
- **services/clock.py::today() / now() indirection**:**20 處** `date.today()` 已 swap 成 `clock.today()`(services/finmind.py × 15 / finmind_realtime / trading_calendar / routes/chip / routes/options × 2)。`FAKE_FINMIND=1 + FAKE_TODAY=YYYY-MM-DD` 凍 backend 時鐘;production 走預設 `date.today()`。**新 code 不准用 `date.today()` 直接呼叫,一律走 clock.today()** — `backend/tests/test_options_routes_clock.py` 鎖 timebomb,過 2026-07-15 TXO 結算後若有 route 退回 wall-clock 立紅。Trigger:新 route / service 用到 `date.today()` 時。
- **Playwright spec 痛點註解強制**:每個 `test('...')` 上方必 `// 痛點: <design rationale>` 註解,連回 design.md round 或 SC edge case。Phase 7 結構化證據表的「regression 抽樣對象」欄走這個 comment。**沒寫 = wrong reason 過綠**,違反 /goal。Trigger:寫任何 e2e spec 時。
- **Fixture rotation 政策**:每季 + release 前;trading day = 2026-06-26 (Fri),no-trading-day = 2026-06-27 (Sat)。**任何 fixture date 寫死前必 `python -c "from datetime import date; print(date.fromisoformat('YYYY-MM-DD').strftime('%A'))"` 驗** — round 2 我把 06-27 誤記成 Friday(實 Saturday)cascades 進 ~10 fixture filename + clock-pin + visual baseline。Trigger:rotate fixture / 新 fixture 寫死日期時。
- **E2E port 衝突 Windows 處理**:`reuseExistingServer: false` 設了,但若 dev server 殘留 zombie 在 :8000(taskkill 殺不死),需 `Get-Process python | Stop-Process -Force`(PowerShell)清。新 contributor 跑 `npx playwright test` 撞 8000 占用先想到這條。Trigger:Win11 / PowerShell 下 e2e dev loop 撞 port。
- **Playwright spec selector 必對 page snapshot**:寫 spec snippet 不准憑記憶,Phase 5 第一次 run failure trace 帶 page snapshot,真實 placeholder / aria-label / role 全在 — 對齊 snapshot 比 grep 真實 component code 還快(後者要 trace many wrappers)。**真實值範例(/feat e2e-tests 校齊)**:SymbolSearch placeholder = `搜尋代號或名稱...`(非 `輸入股號`);Mode buttons = `個股 / 選擇權 / 大盤`(非 `個股籌碼 / 大盤掃描`);Active state = `aria-current="page"`(非 `data-state`);RangeSelector = `aria-label="設為 N 日"`(非 text `N 日`);ChipBrokersPanel / ChipKlineChart 早期 return path 也要 root testid(否則 default state 找不到)。Trigger:寫 Playwright spec 任 selector 時。

### Market snapshot pipeline 慣例(2026-06-29 /feat market-monitor 沉澱)
- **`taiwan_stock_tick_snapshot` universe 包含「001 加權指數 / 002 不含金融指數」等 index rows**。Index 沒對到 TaiwanStockInfo,會佔據 amount 排行榜第 1。**Filter universe 必須走 `stock_id in primary_sector` 對映**(primary_sector 從 TaiwanStockInfo 推),指數天然排除;不要用 `len(stock_id)==4` 之類 pattern 過濾(會誤殺新格式)。Trigger:任何用 `taiwan_stock_tick_snapshot` 整盤 universe 的 endpoint。
- **`TaiwanStockInfo` 同時是 sector 來源也是 name 來源**:`industry_category` + `stock_name` 同 row。Build name_map 跟 sector_map 一起做,避免 frontend 看到「2330 2330」這種股號 fallback。Trigger:做整盤 snapshot 派生 endpoint。
- **TanStack Query refresh() 跟 polling 撞 race**:hook 同 queryKey polling 中,user 點 refresh 會被 in-flight queryFn dedup 吃掉,refresh 旗標等下一個 tick 才生效。修法:`refresh()` 內先 `queryClient.cancelQueries({queryKey})` 再 `refetch()`。Trigger:寫含 `refetchInterval` 又有 manual refresh 的 hook。
- **App.tsx mode 切換是 ternary 不是 hidden**:既有 `{mode === "equity" ? equity : <Suspense>OptionsPage</Suspense>}` 結構,加新 mode 必須改 3-way ternary。若用 `<div hidden={mode !== "X"}>` 從末加,既有 ternary 的 else 分支會跟新 div 同時 mount,造成雙頁面同時抓資料。Trigger:加第 N (N≥3) 個 mode 進 App.tsx。
- **Squarified treemap 公式**:`colW = sum / rect.h`(短邊配方向),不是 `colW = (sum * rect.h) / area`。Phase 3 寫錯一次,test 抓 `tile.x + tile.w ≤ sector.x + sector.w` 立刻紅(261818181 vs 480 = 顯然錯)。寫純算式 treemap / packing 演算法時,單測務必包邊界 fit check。Trigger:`lib/heatmap-svg.tsx` 同類純算式或新增類似 treemap。
