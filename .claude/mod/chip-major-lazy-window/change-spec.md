# change-spec — chip 主力線:自動 540 全量 → 出界觸發階梯補抓

/mod chip-major-lazy-window Phase 2+3 產物(2026-07-16)。現況事實與 probe 證據見同目錄 `current-state.md`(Phase 1)。

## 0. 背景與動機

現行:majorFast(150 日曆日)成功後**自動**背景抓 540 全量(~360 requests/新標的,其中 ~260 個在預設視窗外)。動機:
1. **配額**:6000 req/hr 下每小時只能冷載 ~16 檔;砍自動 540 每檔省 ~260 requests。
2. **體感**:fan-out 存活期間佔滿共用 TokenBucket,期間任何操作(點日期、切 symbol)排隊變慢;prd 因 Vercel 不轉發 abort,殭屍燒到完(probe 實證,見 current-state.md)— lazy 化直接刪掉殭屍最大來源。
3. **使用行為**:user 自述極少回看舊主力資料;為不看的區間預燒不划算。

## 1. User 拍板決策(2026-07-16 Phase 2 問答)

- 初載**維持 150 日曆日不變**(它就是「預設可見 90 根 + 假期緩衝」的換算,不再壓小;不做「按螢幕大小變區間」— 可見根數與螢幕寬無關)。
- 補抓策略 = **階梯 150→300→540**(不做出界直上 540、不做精算 debounce)。
- 補抓期間**缺料區段**顯示 loading(區段級,非整版)。

## 2. 成功條件(SC,全部可驗收)

| # | 條件 | 量法 |
|---|---|---|
| SC-1 | 新 symbol 初載對 `/history/major` 只發一筆 `days=150`,**無任何自動 days=300/540 請求** | vitest spy assert;e2e request 記錄;Phase 7 DevTools network 面板截圖 |
| SC-2 | 拖曳/縮放使可見左界早於現有覆蓋 → 自動發**能覆蓋左界的最小檔位**請求(可跳檔);期間主力副圖已載區段 bars 照常顯示、缺料區段顯示 `major-gap-overlay`;落地後 overlay 消失、bars 補齊 | vitest(hook 時序 + overlay 幾何);e2e;DevTools 截圖 |
| SC-3 | 同檔位重複觸發冪等(拖曳連續事件不重發請求) | vitest spy 呼叫次數 |
| SC-4 | 上市 < 150 日曆日個股:不觸發升檔、無永久 loading(candles 本身從上市日開始,無「早於上市」的可見 candle) | vitest(短 candles fixture) |
| SC-5 | 白名單全保留(§3) | 既有測試綠 + Phase 7 逐條手驗 |
| SC-6 | 回歸防護:fan-out 在途切 symbol,dev 環境後端 ~2s 內取消(probe 已證現行為;lazy 化不得破壞) | Phase 7 user_count 手驗(dev) |

## 3. 既有行為白名單(不能破壞;優先級高於新行為)

1. 初載體感不變:base(540 單請求)+ major(150)**並行**發出;K 線 TTI 不變;major 落地前主力副圖整版 `major-loading-overlay`,落地即消,之後不再蓋。
2. K 線互動:拖曳選日 click-suppress、雙擊 reset(90 根 + auto-tail)、hover crosshair、滾輪 zoom clamp [30, candles.length]、HUD 顯示。
3. Symbol pivot 不閃前一 symbol 資料(summary 的 placeholder guard 慣例;major 新 placeholder 同樣要 guard)。
4. `refresh()`:force 重抓(`refresh=true`)summary + base + major(當前檔位),語意不變。
5. Cancel 鏈:所有 queryFn `({signal}) => api.xxx(..., {signal})` 直傳(skill `cancel-chain`)。
6. 覆蓋範圍**內**缺值日(停牌等)主力顯示 0 — 現狀保留。
7. options / market / warrant 各 mode 完全不動。

## 4. Backward compat / migration

- 無持久化狀態(TanStack cache 是 session 級、backend per-day cache 與 window cache 格式不變)→ **無 migration**。
- Backend API 零改動(`days` 參數本已支援 5-540;per-day cache `{symbol}_{d}_major` 保證階梯增量成本)。
- 舊 full-window cache(`{symbol}_540_major`)仍會被 `fetch_chip_history_major(days=540)` 命中 — 已看過的股票升到 540 檔幾乎零成本。

## 5. Out of scope

- Backend 任何改動;Vercel abort 傳導 /bug(next-time 已記,獨立處理);broker_history / summary / bubble / warrant;`_run_once` 家族收斂(next-time 既有條目);K 線 base 540 一次抓的策略。

## 6. 設計核心

### 6.1 單一 major query + 檔位 state(useChipData.ts)

現行 fast/full 兩條 query 收斂成**一條**:

```
const [tier, setTier] = useState<{ symbol: string; days: number }>({ symbol, days: MAJOR_FAST_DAYS });
const majorDays = tier.symbol === symbol ? tier.days : MAJOR_FAST_DAYS;  // derived reset,無 stale-render
```

- queryKey:`["chip-history", symbol, "major", majorDays]`。majorDays ∈ {150, 300, 540}(`MAJOR_TIERS`)。
- **derived reset pattern**(不用 `useEffect(() => reset, [symbol])`):effect reset 會產生一個「新 symbol + 舊檔位」的中間 render,直接對新 symbol 發大檔位請求 — 必須避免。
- queryFn 回傳 `{ days: majorDays, payload }`(payload = API 回傳)— days 隨資料走,placeholder 保舊檔資料時 coverage 仍可從 `data.days` 正確計算。
- `placeholderData: (prev) => (prev?.payload.symbol === symbol ? prev : undefined)` — 升檔換 key 時保留前檔資料(subchart 不閃空),symbol pivot 時清空(白名單 3;同 summary 現成 pattern)。
- **R5(review P2)已拍板:tier 跨 symbol 殘留 = 接受的行為** — A 升到 540 → 切 B(derived 回 150)→ 切回 A 時**若中間未在其他 symbol 升檔**(tier 仍 = {A, 540}),直接以 days=540 重載;若中間在 B 升過檔則回 150。tier 是單一 state,此殘留是實作簡化的自然結果,兩種結果皆可接受、無任何 SC 或測試依賴特定一種。成本可忽略(backend window cache 命中)。SC-1 的「新 symbol」定義 = **本 session 未升檔過的 symbol**;vitest/e2e assertion 據此寫。
- 合併:`major = majorQ.data?.payload.major ?? []`(base 未變)。
- `majorLoading`(整版 overlay,語意不變)= `majorQ.data == null && majorQ.isFetching`(placeholder 算有資料 → 升檔期間不整版蓋)。
- 🔴 刪除:`historyMajorQ`(自動 540)與其 gating(`enabled: majorFastQ.isSuccess`)。

### 6.2 升檔政策(hook 內)

```
lastReportRef = useRef<{ symbol: string; fromDate: string } | null>(null)

ensureMajorCoverage(fromDate: string): void
  lastReportRef.current = { symbol, fromDate }   // 先記錄,anchor 未到也不遺失需求
  applyPolicy(fromDate)

applyPolicy(fromDate):
  anchor = majorQ.data?.payload.last_date(無資料時 return — 由補跑 effect 接手)
  needed = MAJOR_TIERS 中最小的 t 使 addDays(anchor, -t) <= fromDate;皆不滿足 → 540
  needed > majorDays → setTier({ symbol, days: needed })

// R1 死區補跑:major 資料落地時,對最後回報的可見左界重跑政策
useEffect(() => {
  const rep = lastReportRef.current
  if (majorQ.data && rep && rep.symbol === symbol) applyPolicy(rep.fromDate)
}, [majorQ.data])
```

- anchor 用 **payload 的 `last_date`**(backend `end = clock.today()`),不在前端 new Date() — 遵守 §3「new Date() 只在邊界」,且與 backend 實際抓取窗口一致。
- 同檔冪等(needed <= majorDays → no-op):拖曳連續事件天然去重,不需 debounce(SC-3)。
- 只升不降(zoom 回窄視窗不縮檔;已抓資料保留)。
- **R1(review P0)死區防護**:升檔檢查有兩個觸發源 —(a)chart 的 windowRange 變化回報;(b)majorQ.data 落地時對 `lastReportRef` 補跑。覆蓋兩個死區場景:初載 fan-out 在途時 zoom-out(回報時 anchor null → 150 落地後補跑升檔)、跨 symbol 保留 zoom(chart 的 visibleDays 是 local state 不重置;B 的 major 先落地時 ref.symbol 仍是 A → guard 擋下;B 的 base 落地觸發 windowRange 變化 → ref 更新為 B → 正常路徑)。ref 帶 symbol 是必要的:沒有它,A 的舊 fromDate 會在 B 的 major 落地時把 B 誤升到 540。對應新 vitest 案例見 §8。
- `addDays(dateStr, n)`:lib 無現成 helper(已 grep),新增純函式 `frontend/src/lib/date-utils.ts` + 單元測試(YYYY-MM-DD in/out,UTC 錨定避免時區日界 bug)。

### 6.3 缺料區段 overlay(ChipKlineChart.tsx)

新 props(全 optional,向後相容):

- `majorCoverageStart?: string | null` — hook 暴露:`addDays(data.payload.last_date, -data.days)`(landed 檔位的覆蓋左界;升檔中 = 前檔的)。
- `majorFetching?: boolean` — `majorQ.isFetching`。
- `onVisibleRangeChange?: (leftmostDate: string) => void` — chart 在 `windowRange` 變化的 effect 裡回報 `candles[windowRange.start].date`。**政策留在 hook,chart 只報事實**(App 接線:`onVisibleRangeChange={ensureMajorCoverage}`)。

Overlay 幾何(主力買賣超 subchart row 內):

```
covered = majorCoverageStart == null || majorCoverageStart <= candles[0].date   // R4 clamp:錨差 sliver 視為全覆蓋
gapCount = covered ? 0 : 可見 candles 中 date < majorCoverageStart 的數量(缺料必在左側,candles 升冪)
gapCount > 0 && majorFetching → 左對齊 overlay,width = (gapCount / visibleCount) * 100%
  data-testid="major-gap-overlay",樣式沿用 major-loading-overlay(bg-bg-deep/40 + spinner + 「主力資料載入中…」)
```

註:R4 clamp 的 `candles[0].date` 是**全量** candles 首根(fullDerived),非可見窗首根 — clamp 針對「base 與 major 的 last_date 錨點不一致(跨午夜)造成的最左側 sliver」,不能誤把「可見窗已拖到覆蓋內」當成全覆蓋。

- 這同時修掉現有「假 0」問題:覆蓋外日子現被 `?? 0` 畫成假 0 bar(current-state.md),改後 fetching 期間被 overlay 蓋住。
- 上市不足個股天然免疫:candles 從上市日開始,不存在 date < coverageStart 的可見 candle(coverageStart 必早於上市日,因為檔位以日曆日回推)→ 無 overlay、`ensureMajorCoverage` 算出的 needed 檔位也 ≤ 已滿足…(上市日在覆蓋內 → no-op)(SC-4)。
- 接受的 P2 邊緣:升檔請求**失敗**時 overlay 消失(majorFetching false)、缺料區回到 0 bars,error 由 hook 既有 `error` 欄位浮出 — 不做區段級錯誤 UI(記 Known Edges)。

## 7. Diff 級逐檔(🔴 行為改 / 🟢 新功能 / 🔵 純重構)

實作順序 🔵→🔴→🟢(/mod Phase 4 鐵則)。本次無獨立 🔵(fast/full 收斂為單 query 與行為刪除不可分,歸 🔴)。

### frontend/src/lib/date-utils.ts(新檔)🟢
- `addDays(dateStr: string, n: number): string`(UTC 錨定)。
- 新測試 `date-utils.test.ts`:正負位移、跨月/跨年、閏日。

### frontend/src/hooks/useChipData.ts 🔴
- 刪 `historyMajorQ` + `MAJOR_FULL_DAYS` 的自動觸發路徑(`MAJOR_FULL_DAYS` 常數保留給 base query 用)。
- `majorFastQ` → `majorQ`(§6.1);新增 tier state、`ensureMajorCoverage`(§6.2)。
- 回傳新增:`majorCoverageStart`、`majorFetching`、`ensureMajorCoverage`;既有欄位(summary/history/loading/summaryLoading/historyLoading/majorLoading/error/refresh)shape 不變。
- `refresh()`:force summary + base + majorQ(當前檔位)。
- 檔頭兩段式視窗註解改寫(150 初載 + 出界階梯;引 change-spec)。

### frontend/src/components/ChipKlineChart.tsx 🟢(+既有 overlay 行為不動)
- Props 新增三個 optional(§6.3)。
- `windowRange` 變化 effect → `onVisibleRangeChange(candles[start].date)`。
- 主力 subchart row 加 `major-gap-overlay`(§6.3 幾何)。

### frontend/src/App.tsx 🟢
- `useChipData` 解構新欄位;`<ChipKlineChart>` 傳 `majorCoverageStart` / `majorFetching` / `onVisibleRangeChange={ensureMajorCoverage}`。

### frontend/src/lib/changelog.ts 🟢
- 新 VersionEntry(MINOR,§7 CLAUDE.md 表「使用者可感的 UX 改動」;寫 text 前讀 skill `changelog-conventions`)。注意 prd 已是 0.32.0(本地 changelog pin 0.31.1)— 以 main 當下最新版為基準 bump。

### e2e/specs/equity.spec.ts 🟢
- 新 E#:(a) 初載 request 記錄無 `days=540`、僅一筆 `days=150`;(b) 滾輪 zoom-out 出界 → 發下一檔請求 + `major-gap-overlay` 出現。FAKE fixture 零新增(FakeFinMindClient 對 days 透明)。痛點註解引 SC-1/SC-2。

### backend 零改動

## 8. 測試盤點

### 該紅(🔴,行為真的變了 — 改 assertion;R2 review 後逐案補齊,行號 = 2026-07-16 baseline)
`frontend/src/hooks/useChipData.test.ts`,9 案:
| 行 | 案例 | 新 assertion 方向 |
|---|---|---|
| :63 | initial mount fires ... fast(150) then full(540) | major **僅 1 次** `days=150`,無 540 |
| :76 | full 540 does NOT fire until fast 150 resolves | 改寫:150 落地後**不自動**發第二筆(靜置 assert 次數仍 1) |
| :97 | fast failure surfaces error and never fires full | error 浮出語意保留;「never fires full」改單 query 次數斷言 |
| :110 | date change fires api.chip ONLY | :117/:122 的 `major toHaveBeenCalledTimes(2)` → **1** |
| :125 | symbol change fires all three endpoints | major 次數 2→4 改 **1→2** |
| :182 | majorLoading clears on FAST landing | 「150 落地即 false」語意保留,mock 結構改單 query(不再有 full 在途分支) |
| :215 | refresh() forces all endpoints (fast + full major) | 單 query:force 僅當前檔位一筆 |
| :235 | base carries days=540; major fast=150 then full=540 | major 僅 `days=150` |
| :247 | merged major uses fast rows first, then full rows replace | 改升檔語意:placeholder 保舊檔 rows → `ensureMajorCoverage` 觸發新檔 → 新 rows 取代 |

### 不該紅(打到 = 回頭查)
- `useChipData.test.ts` :144(history persists across date change)、:157(summary persists)、:270(major [] until lands)、:301(rapid date flip seq)。
- `ChipKlineChart.test.tsx` 全部既有案例(zoom/HUD/pan/click/broker row/loading badge)。**R3 註**:current-state.md 曾預判此檔「部分該紅(overlay 語意變)」;設計收斂後整版 `major-loading-overlay` 語意不變、gap overlay 為純新增 optional props → 改判全綠,以本檔為準。
- `App.test.tsx`(mock shape 需**同步補新欄位**,屬支援性修改非行為紅)。
- `api.test.ts`、`chip-svg` 系、backend 全部(712+1)。

### 新測試(🟢)
- useChipData:SC-1(初載僅 days=150、無 540 spy)/ SC-3(同檔冪等)/ 升檔時序(ensureMajorCoverage → 發 300;更早 → 直跳 540)/ placeholder 保舊檔(升檔中 major 非空)/ symbol pivot 清 placeholder / SC-4(anchor 無資料時記錄不升;fromDate 在覆蓋內 no-op)/ coverageStart 值正確。
- **R1 死區案例**:(a) 初載在途呼叫 ensureMajorCoverage(anchor null)→ 150 落地後**自動**補升檔;(b) A 出界回報後切 B → B 的 major 落地**不**觸發升檔(ref.symbol guard),B 的 windowRange 回報後才正常升。
- ChipKlineChart:gap overlay 幾何(左側寬度比例)/ majorFetching=false 無 overlay / windowRange 變化回報 leftmost date / coverageStart 蓋滿時無 overlay。
- date-utils 單元測試。
- e2e 新 E#(§7)。

## 9. e2e 判準結論(依 skill `e2e-conventions`)

equity mode UI/flow 行為改動 → **需要**,`equity.spec.ts` 加 E#(§7);非豁免類型。fixture 無新增、無 rotation 需求(基準日 2026-06-26 未逾 90 天)。

## 10. Known Edges(接受,P2)

- 升檔請求失敗:overlay 消失、缺料區回 0 bars,error 走既有 hook error 欄位;不做區段級 error UI。
- **R4 錨差 sliver**:base 與 major 各自 fetch/cache,跨午夜 session 兩者 `last_date` 可差一天 → 540 檔落地後最左側可能殘留 ≤ 數根「date < coverageStart」的 candle。§6.3 的 covered clamp 讓 overlay 不誤蓋;殘留 sliver 顯示 0 bars(與現狀一致),不重發請求。Phase 7 手驗若見此現象屬預期。
- **R5 tier 跨 symbol 殘留**:重訪已升檔 symbol 直接以其檔位重載(§6.1 已拍板接受)。
- 過年級長假使 90 根 ≈ 141+ 日曆日,逼近 150 檔邊界:超出時自動升 300(行為正確,只是初載後可能立即多一次補抓)— 與現行 fast=150 的既有假設相同,不加大初載檔位。
- prd 殭屍(Vercel 層):本 mod 縮小暴露面(自動 540 消失),根修在獨立 /bug。

## 11. 規模與 review

M 級(frontend 4 檔 + 測試 + e2e;無對外 API 改動、無 migration)→ Phase 3 dispatch `change-spec-reviewer` 1 輪,退出條件無 P0/P1。

self_review_head: 5a4f215

## Phase 7 真實環境驗證結果(2026-07-16,真 FinMind,evidence/)

- 8/8 PASS:SC-1(network 僅一筆 days=150)/ SC-2(days=300 升檔 + gap overlay 出現→落地消失,截圖 ×3)/ 白名單抽查(雙擊 reset HUD=90、refresh cycle、pivot 2330)/ console 0 errors。
- 配額量測:user_count baseline 12 → 全流程 226(**~214 requests,含初載 fast ~105 + 升檔 300 增量 ~100**);舊行為單檔初載即 ~360。SC-1 配額目標達成。
- SC-6(fan-out 在途切 symbol 的 dev cancel)subsumed by Phase 2 probe Stage C 證據(本 mod 未動 cancel 鏈,queryFn signal 直傳保留)。
- 註:驗證經 Playwright chromium 直連 :8001(chrome-devtools profile 被並行 session 鎖定,auto-verify infra fallback;vite proxy 層行為非本次 SC,已由 probe 另證)。
