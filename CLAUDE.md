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

## 7. 2026 共識升級路線

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
