# Refactor — 下次處理(non-blocking,留待後續)

P0(TanStack Query swap)收尾時掃出來的可清理項。**不在這次 refactor scope**,避免一次改太多;留檔等下次再動。

## 1. `frontend/src/lib/api.ts` 自有 cache 層該移除

`api.ts` 的 `__apiGet` 內建 5 分鐘 TTL cache(`_cache` Map)+ seq map(`_seqMap`)+ LRU 100 entries(`CACHE_MAX_ENTRIES`)。P0 之後 TanStack Query 已是 cache 真主,這層**現在是冗餘**:同一筆資料被兩處 cache,失效規則(TTL 5 分 vs Query staleTime 5 分)恰好對齊只是巧合。

**為何不在 P0 一起拆**:
- `chip-data.test.ts` / `api.test.ts` 直接 assert cache 行為,拆掉要連帶改 ~5 個 test
- TanStack Query QueryClient.setQueryData / removeQueries 已能取代,但驗證契約要花時間
- 拆掉的同時連帶可砍 `__testCache` / `CACHE_TTL` / `CACHE_MAX_ENTRIES` exports

**下次怎麼做**:
1. 寫 characterization test 把 api.ts cache 行為拍下(若新增 test 而非搬到 hook 層測,行為才有保護)
2. `__apiGet` 改成純 fetch(無 cache、無 seq)
3. 移除 `_cache` / `_seqMap` / `clearApiCache` / `__testCache` exports
4. 把 api.ts cache 相關 test 改到 hook 層測 TanStack Query 行為,或直接刪除(冗餘)
5. 預期淨減 ~70 行

## 2. `useBrokerHistory` 的 hybrid pattern 可待 backend 改 per-broker endpoint 後簡化

目前 `useBrokerHistory.ts` 用 useMutation + setQueryData + disabled useQueries 三層拼起來只為了把 batch endpoint 塞進 TanStack Query 心智模型。後端如果改 `/api/chip/{symbol}/broker_history/{broker_id}`,frontend 就能改成單純 `useQueries`(每個 broker_id 一個 query),hook 內邏輯預估 -50 行,**也順便砍掉這份 file 的 useEffect**。

**為何不在 P0 一起改**:
- 改 backend endpoint = 行為改動,不是 refactor(要新測試保護新路由)
- 5 個 broker 一次打 5 request vs 1 batch request,網路成本差約 5x latency(若不上 HTTP/2 keep-alive 連線重用更嚴重)
- 純 frontend refactor 已把 seqRef 跟 cacheRef 都拔掉,本次目標達成

**下次怎麼做**:
1. backend `/api/chip/{symbol}/broker_history` 新增 single-id mode(或新 endpoint)
2. frontend `api.chipBrokerHistory` 拆 batch vs single,或讓 `useBrokerHistory` 直接 useQueries each id
3. 把 hook 內 useMutation + setQueryData + disabled useQueries 三層拆成單純 `useQueries`

## 3. 修 ESLint 標出的 14 個 anti-pattern warning

P2-c 已把 ESLint base + `react-you-might-not-need-an-effect` + `react-hooks` 全裝起來(`npm run lint` 通)。React 19 新出的 `react-hooks/set-state-in-effect` + `react-hooks/refs` 對某些合理 reset pattern 過嚴,所以兩條暫時降成 warning,等下次跟其他 anti-pattern 一起處理。

**下次該修的 14 條**(`cd frontend && npm run lint` 完整列表):

- **`ChipBrokersPanel.tsx`**(3 warning):`allBrokers` logical expression 在 useMemo deps 內,需要先包一層 useMemo
- **`ChipBubbleView.tsx:26`** `react-you-might-not-need-an-effect/no-adjust-state-on-prop-change`:`setSelectedBroker(null)` on `[symbol]` change → 改用 `key={symbol}` 強制 remount,或把 selectedBroker derive from symbol
- **`ChipBubbleView.tsx:214`** `incompatible-library`:TanStack Virtual 的 `useVirtualizer()` 是已知不可 memoize,**這條沒辦法修,可以 inline disable + 註解**
- **`BrokerSearch.tsx:48`** prop → state sync(`setQuery(value ?? "")`):改成 derived state
- **`BrokerSearch.tsx:92`** `setActiveIdx(0)` reset on `[filtered]` change:同上,改 derived 或 useReducer
- **`useBrokerHistory.ts:97`** `no-event-handler`:`useEffect` 內讀 props 觸發 fetch,plugin 建議 push 到 parent。**對 useBrokerHistory 的 hybrid pattern(useMutation + setQueryData)不適用**,inline disable + 註解
- **`chip-bubble-svg.tsx:346`** `react-hooks/refs`(ref mutation during render):`bubblesRef.current = bubbles` 該移到 `useEffect`,或改用 `useMemo` 內回傳 + 在 caller 持 ref

**為何不在本 session 修**:六個檔要動,每個都要 derive 改寫 + 跑該檔測試確認行為等價;這 session 已經改過 16 個 commit,集中修 anti-pattern 應該另立 refactor session,scope 更清楚。

## 4. 可考慮加 React Query Devtools 到 dev build

P0 已 install `@tanstack/react-query-devtools` 但**尚未在 main.tsx mount**。掛上後可在 dev 環境看 query cache、stale time、refetch 順序,debug 起來省事不少。production build 自動 tree-shake 掉。

```tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
// ...
<QueryClientProvider client={queryClient}>
  <App />
  <ReactQueryDevtools initialIsOpen={false} />
</QueryClientProvider>
```

只是裝飾,可隨時加。
