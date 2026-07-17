---
name: cancel-chain
description: API 取消傳導鏈(browser abort → vite proxy → uvicorn → route task → inflight dedup → prd 直連 Railway / rewrite fallback)。改 cancel 鏈任一環、排查 prd 502 / CancelledError 500、新增可能 >30s 的 endpoint、寫新 inflight dedup 或前端 fetch 時先讀。
---

# API cancel 傳導慣例(2026-07-03 /perf 沉澱,三輪修正)

## 前端:fetch 一律接 AbortSignal

- `lib/api.ts::get(path, params, options?: { signal? })` 為 base。所有 `api.*` / `optionsApi.*` / `fetchMarketSnapshot` 尾端加 `options?: RequestOptions`;每個 `useQuery({ queryFn: ({ signal }) => api.xxx(..., { signal }) })` 直傳 TanStack Query 內建 controller。**useMutation 沒內建 signal** — 走 `useRef<AbortController | null>` + `useEffect(deps)` cleanup pattern(`useBrokerHistory` 是樣板)。**禁止再寫「裸 fetch(url)」**。Trigger:寫任何新 hook / api method / 前端 fetch call 時。

## Cancel 鏈四環 + 驗收方法

- browser abort → ① vite proxy destroy upstream(`vite.config.ts` proxy `configure` 掛 `res.on("close")` + `proxyReq.destroy()`,**vite 預設不轉發 abort**)→ ② uvicorn http.disconnect → ③ `utils/cancel.py::run_with_disconnect` watcher cancel route task → ④ `_run_once` subscriber refcount 歸 0 才 cancel 底層 fan-out(`asyncio.shield` 保護 shared dedup)。
- **每環都可能斷,驗收必須驗到最後一環**。2026-07-03 教訓:chrome-devtools 看到 `net::ERR_ABORTED` **只證明第一環**,當時 ①③④ 全斷但表面看起來「修好了」。驗收唯一可信法:FinMind `user_info.user_count` side-channel(打 uncached symbol fan-out → abort → 看 count 停哪;先量 idle drift,配額細節見 `finmind-conventions`)。Trigger:改動 cancel 鏈任一環 / 懷疑 cancel 沒生效時。

## 第五環:prd 拓撲(直連 Railway;rewrite 只剩 fallback)

- 拓撲(2026-07-17 fix/prd-cancel-propagation 起):prd 正式域名(`neigui.vercel.app`)前端**直連 Railway**(`lib/api-base.ts::apiOrigin`,hostname 精確比對;CORS 靠 Railway env `FRONTEND_ORIGIN`)— browser abort 直達 Railway edge,edge 會傳導 disconnect(2026-07-16 P1 probe 實證),cancel 鏈端到端通。dev / e2e(localhost)走 vite proxy(第①環);preview deploy(`neigui-git-*`)origin 不在 CORS 名單,留在 `vercel.json` rewrite fallback。改 Railway 網域時 `api-base.ts` 與 `vercel.json` 兩處同步。
- **Vercel rewrite 不轉發 client abort**(2026-07-16 P2/P3 probe 實證,勿誤讀):edge 對 origin 的 fetch 與 client 連線解耦 — 瀏覽器 ERR_ABORTED 後 origin 上的 fan-out 殭屍燒到完(實測 +368/次)並佔滿 rate limiter。rewrite 路徑上唯一會斷 origin 連線的是 ~30s router timeout(`ROUTER_EXTERNAL_TARGET_ERROR`),那是「超時強制斷線」不是「abort 傳導」;走 rewrite 的路徑(preview)>30s route 必死、使用者 abort 無效。
- **長計算(EOD 類)必須與 request 生命週期脫鉤**:module 持有引用的背景 task + inline 小預算 + `xxx_pending` payload 旗標,`finmind_realtime._ensure_eod_task` 是樣板。Railway 磁碟 ephemeral,每次 redeploy cache 全清 = 必冷。Trigger:新增任何可能 >30s 的 endpoint / 排查 prd 502。
- 驗收 prd cancel 鏈同四環慣例:FinMind `user_info.user_count` side-channel;prd 有 ~1 req/s 常駐消耗會干擾判讀(見 docs/next-time.md 待查條目),先量 idle drift 再判。

## Inflight dedup 必須 shield + refcount

- `await _inflight[key]`(無 shield)時,asyncio 會把 awaiting task 的取消直接傳進共用 task,一個斷線請求毒殺所有共乘請求(收 CancelledError → 裸 500)。`finmind.py::_run_once` 與 `finmind_realtime._run_once` 是 refcount 樣板;route 邊界另補 CancelledError → 503(還連著才轉,已斷線 re-raise)。Trigger:寫任何新的 inflight dedup / 看到 prd CancelledError 500。

## 相關

- 配額與 rate limit 真相 → skill `finmind-conventions`
- 本機 dev server(:8000 / --reload watcher)驗證前檢查 → skill `e2e-conventions`
