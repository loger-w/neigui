# current-state — chip 主力線 540d 全量改「出界觸發階梯補抓」

/mod chip-major-lazy-window Phase 1 產物(2026-07-16)。
脈絡:docs/next-time.md「From /perf warrant-api-load(2026-07-15,Phase 0 分流)」user 已點名條目。
User 拍板(Phase 2 前置問答):初載維持 150 日曆日不變;補抓策略 = **階梯 150→300→540**;
分支從 main 開(fix/iv-backfill-empty-vs-holiday 保留未動,屬並行 session)。

## 現況(as-is)

### 資料流(frontend/src/hooks/useChipData.ts)

| Query | queryKey | days | 成本 | 觸發 |
|---|---|---|---|---|
| summaryQ | `["chip-summary", symbol, date]` | — | 快 | symbol/date 變 |
| historyBaseQ | `["chip-history", symbol, "base"]` | 540(`MAJOR_FULL_DAYS`) | 單一 request,cold ~1.5s,25-35KB gz | symbol 變 |
| majorFastQ | `["chip-history", symbol, "major", 150]` | 150(`MAJOR_FAST_DAYS`) | per-day fan-out ≈100 requests,cold ~7s | symbol 變,與 base 並行 |
| historyMajorQ | `["chip-history", symbol, "major"]` | 540 | fan-out ≈360 requests(增量 ~260),cold ~24s | **majorFastQ.isSuccess 自動觸發** ← 本次要改的點 |

- merge(useChipData.ts:89-96):`major = full ?? fast ?? []`,包成單一 `ChipHistory` 給外部。
- `majorLoading`(:102-103)= 尚無任何 major 資料且 fast/full 在抓 — 一旦 fast 落地即永久 false(背景 540 不再蓋 overlay)。
- `refresh()`(:115-125)force 雙 major query 重抓;per-day backend cache 讓重複成本 ~2 requests。
- FinMind 單位注意:`days` 一律**日曆日**;TradingDailyReport 只接受單日查詢 → 每交易日 1 request。
  150 日曆日 ≈ 100 交易日;540 ≈ 360 交易日。換算比 ~0.66。

### K 線視窗(frontend/src/components/ChipKlineChart.tsx)

- `KLINE_ZOOM_DEFAULT = 90` 根(交易日),`MIN = 30`,滾輪 ±10(:41-43);**可見根數與螢幕寬無關**(寬度只決定 candleW = width/visibleDays,:148)。
- pan:`viewEndIdx`(null = 跟最新)+ pointer 事件(:137-191);雙擊 reset(:193-196)。
- `windowRange`(:198-207)= 可見 [start, end] raw index;fullDerived 持有全量 540d candles。
- **缺料日畫成 0**:`majorByDate.get(c.date)?.major_net ?? 0`(:91)— 快取外日子與「真買賣超 0」不可分辨。
- `major-loading-overlay`(:412-423)蓋**整個**主力副圖,由 `majorLoading` prop 驅動。
- chart 目前**不知道** major 覆蓋範圍;hook 目前**不知道**可見視窗 — 兩者間無介面,本次要新開。

### 串接(frontend/src/App.tsx)

- :148-150 `useChipData(symbol, date)` 唯一 caller;:430 `majorLoading={!!symbol && majorLoading}`。

### Backend(不需改動)

- `GET /api/chip/{symbol}/history/major?days=N`:`days: int = Query(default=90, ge=5, le=540)`(routes/chip.py:90)— 任意檔位已支援。
- per-day cache `{symbol}_{d}_major`(finmind.py fetch_chip_history_major):階梯升檔只花增量 requests。
- 全量 cache 命中路徑已有測試(test_finmind.py:813 serves_from_full_cache)。

## Caller map(grep useChipData|chipHistoryMajor|chipHistoryBase|majorLoading|major-loading)

| 檔 | 用法 | 本次影響 |
|---|---|---|
| App.tsx:13,148-150,430 | hook 唯一 caller + majorLoading prop | 可能加傳 coverage/ensure 介面 |
| App.test.tsx:45-47 | mock useChipData 回傳 shape | 回傳 shape 若加欄位需同步 |
| useChipData.test.ts(~15 案例) | fast/full 時序、majorLoading、refresh、placeholder | 🔴 主要戰場:「fast 成功自動抓 full」的 assertion 該紅 |
| ChipKlineChart.tsx:35,50,412-423 | majorLoading prop + 整版 overlay | 改為區段 overlay + 出界回報 |
| ChipKlineChart.test.tsx | overlay/縮放/pan 測試 | 部分該紅(overlay 語意變) |
| api.ts:115-136,210-211 / api.test.ts:228,252 | days 參數已泛化 | 不變 |
| backend routes/chip.py + test_chip_routes.py + test_finmind.py | days 任意值已支援已測 | 不變 |
| e2e/specs/equity.spec.ts | 只 assert chipKlineChart visible,無 zoom/pan/major spec | e2e 歸屬 Phase 2 依 e2e-conventions 判 |

動態用法檢查:無 template string / reflection 呼叫 hook 或 API path 的用法(grep `history/major` 全 repo 僅 api.ts 與 backend route)。

## 目標(to-be,user 已拍板部分)

1. 初載不變:base(540 單請求)+ fast(150 日曆日)並行。**fast 成功後不再自動抓 540。**
2. 拖曳/縮放使可見視窗左邊界超出已抓覆蓋 → 升下一檔(150→300→540),per-day cache 保證只花增量(~100 / ~160 requests)。
3. 補抓期間,主力副圖**缺料區段**(而非整版)顯示 loading;已載區段照常顯示。
4. 缺料判準用「已請求範圍左邊界」,不用「已回資料最早日」(上市 < 150 天個股否則永遠 loading)。
5. 配額動機:不拖曳的 session 每新標的省 ~260 requests。

## Backward compat / 白名單(Phase 2 收斂,先列已知)

- 不拖曳 session:初載體感與現在完全一致(base+fast 並行、fast 落地 overlay 消失)。
- 拖曳選日 click-suppress、雙擊 reset zoom、hover crosshair、placeholderData 防前symbol閃爍 — 不動。
- refresh() 語意保留(force 重抓已請求的檔位)。
- cancel 鏈:新 query 一律 `queryFn: ({signal}) => api.xxx(..., {signal})` 直傳(cancel-chain 慣例)。
- 舊行為刪除點:背景自動 540 全量(這是「該紅」的行為改動,非誤傷)。

## Open questions(Phase 2 brainstorm 待收斂)

- 升檔觸發時機:windowRange 變化即觸發 vs debounce(拖曳中連續事件)。傾向:出界即觸發但同檔位冪等(queryKey 去重天然防抖),升檔一次到位不跳檔。
- 升檔期間資料保留:tier 換 queryKey 後,前一檔資料要繼續顯示(TanStack v5 `placeholderData: keepPreviousData` + symbol 換防護)。
- 區段 overlay 幾何:x 範圍 = 可見窗內 date < coverageStart 的 candles;需 hook 暴露 coverageStart。
- hook ↔ chart 介面:chart 報「可見最左 date」(`onVisibleRangeChange` 或 `ensureMajorCoverage(fromDate)`),階梯政策留在 hook。
- e2e 歸屬(依 e2e-conventions 判準表)。

## Cancel 鏈調查(2026-07-16,user 回報「540 未算完切換 → 新 symbol API 非常慢」)

User 實測兩情境:等 540 算完再切換 → 快;540 未算完切換 → 非常慢。假說:前端 abort 了但 backend fan-out 繼續跑、佔用 rate limiter。

Code 層檢查(四環在 code 上全部有接):
- ③ `routes/chip.py` 全 route 包 `utils/cancel.py::run_with_disconnect`(250ms poll disconnect → cancel route task)。
- ④ `finmind.py::_run_once`(:154-179)refcount 歸 0 → cancel 底層 task;`_fetch_one` 的 `except Exception`(:1959)不吞 CancelledError(BaseException)。
- `rate_limiter.py::TokenBucket.acquire_async` 不預訂時間槽 — token 只在授與當下扣(:41-43),被 cancel 的排隊者不燒排程。
- fan-out 結構:`_fetch_major_series` 對 uncached dates 一次 `asyncio.gather` 全併發(:1968),全部排進共用 bucket(實效 ~15/s)— **fan-out 存活期間,任何新請求都跟殘餘 backlog 搶 token**,這解釋「慢」的機制。
- `cancel.py` docstring 自述 2026-07-03 落地時「推理 chain 直接落地,不用 probe」— 即四環從未用 skill `cancel-chain` 說的唯一可信法(FinMind `user_info.user_count` side-channel)實測過端到端。

**Probe 實測結果(2026-07-16,5 輪,dev 環境)— 鏈端到端全通,user 假說在 dev 不成立:**

- Stage A(httpx 直打 :8000,2912 days=300 abort@1.16s):user_count +74 後 36s 橫盤;server log `client disconnected — cancelling` fire。②③④ 通。
- Stage B(過 vite :5173,9945):同樣 +74 橫盤。① 通。
- Stage C(真實瀏覽器 React 流程,`FINMIND_RATE_LIMIT_PER_SEC=3` 拉寬窗口;1477 選定後 T0+23s 於 fast fan-out 在途時切 2330):
  - 瀏覽器 network:`1477/history/major?days=150` → **net::ERR_ABORTED**(TanStack 切 symbol 真的 abort)
  - server log:`client disconnected — cancelling in-flight route task` @ 13:31:19.460(切換瞬間 +0.4s)
  - user_count 3517 於切換後 ~2s 內橫盤 45s+(fan-out 已死,沒燒完剩餘 ~40 requests)
  - 1477 的 540 從未觸發(`enabled: majorFastQ.isSuccess` gate 擋住)
- 註:rate 40/s 下 fan-out 窗口僅 ~6-9s,前四輪均因 MCP 操作延遲錯過在途窗口(9917/9910/2105 三輪 540 均在切換前自然完成,均為 200 非 abort — 不構成鏈斷證據)。

**prd probe(2026-07-16,user 要求續驗)— 斷點 = Vercel rewrite 層,user 假說在 prd 成立:**

- P1 直打 Railway(`neigui-production.up.railway.app`,9904,days=300,abort@1.26s):+41(abort 前 burst)後回到 ambient drift(+11/9s)— **Railway edge 有傳導 disconnect,鏈通**。
- P2 過 Vercel rewrite(`neigui.vercel.app`,9914,同參數,abort@1.19s):**+217 在 15 秒內灌完 ≈ 整包 ~200 request fan-out 跑到完** — abort 完全沒有傳到 Railway,`run_with_disconnect` 從未 fire。
- 結論:**Vercel rewrite 不轉發 client abort**(edge 對 origin 的 fetch 與 client 連線解耦;唯一會斷 origin 的是 ~30s router timeout)。prd 上使用者切股票 → 舊 540 fan-out 變殭屍跑完:(1) 白燒 ~260 requests(配額雙倍痛),(2) 佔滿 TokenBucket,新股票請求排隊 → **user 觀察到的「mid-540 切換後很慢」100% 是這個**,dev 測不出來(vite proxy 有轉發)。
- 單次 run 未重複(配額考量);P1/P2 同程序同參數,差異懸殊(+41 vs +217),可信。
- **P3 真實 UI 重現(user 開 prd 分頁,16:07)**:選 8464(未快取)→ 540 在途 5.3s 時切 2330。瀏覽器 network:`8464/history/major?days=540` → **net::ERR_ABORTED**(前端有做事);sampler:切換後仍 **+368 燒到完**(dev 同操作 2 秒內停);**目的地 2330 被殭屍搶頻寬:`base?days=540` 6.4s(無競爭 ~1.7s)、`major?days=150` 11.4s** — user 體感完整重現並量化。
- 順帶發現:**prd 有 ~0.7-1.2 req/s 的常駐 FinMind 消耗**(兩輪 baseline 皆在爬,P1↔P2 間隔亦爬 +86/~90s)≈ 每小時 3000-4300 requests,逼近配額上限 — 疑似某長駐 keeper(candidate:warrant snapshot freshness keeper?)在打 FinMind,**獨立待查,優先級高**。

修法方向(未拍板,user 決定):
a. 本 mod lazy 化:殭屍窗口從 540(~9-27s)縮到 fast 150(~3-7s),治大半;拖曳觸發的補抓在 prd 仍會殭屍。
b. prd 前端繞過 rewrite 直連 Railway(CORS 已有 FRONTEND_ORIGIN 機制)→ abort 直達,鏈全通。
c. 應用層 cancel 信號(abort 時 sendBeacon 通知 backend 砍 inflight)— 機構較重。

本 mod Phase 7 SC 保留:升檔 fan-out 途中切換 symbol,`user_count` 停止攀升(dev 驗;prd 視修法方向)。

Per-day cache 確認:`{symbol}_{d}_major`(:1930)只補 uncached dates → 階梯升檔增量成本成立(150→300 ≈ +100 requests,300→540 ≈ +160)。

## Baseline 測試

- backend `python -m pytest -q`:**712 passed, 1 skipped**(43.96s,2026-07-16)
- frontend `npm test`:**802 passed(84 files)**(12.71s,2026-07-16)
