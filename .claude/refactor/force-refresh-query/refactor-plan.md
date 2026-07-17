# refactor-plan — force-refresh-query(Phase 3,2026-07-17)

## 動機(Phase 1)

- `forceRefreshRef` 三行樣板複製到 18 個 hook(next-time 門檻條目,user 點名收割)。
- 已知 pattern 級 race(refresh 旗標可被非 refresh 的 in-flight fetch 提前消費)存在於每份複本 — 收斂後修一處即可。**race 修復是行為改動,不在本 /refactor**(收斂後另開 /bug)。
- 本次行為合約:**每個 hook 的對外 shape 與 fetch 語意逐字不變**(race 原樣保留)。

## 目標形狀

新檔 `frontend/src/hooks/useForceRefreshQuery.ts`:

```ts
import { useRef } from "react";
import {
  useQuery,
  type QueryFunctionContext, type QueryKey, type UseQueryOptions,
} from "@tanstack/react-query";

interface ForceRefreshQueryOptions<T>
  extends Omit<UseQueryOptions<T, Error>, "queryFn"> {
  /** 與原樣板同語意:queryFn 收 force(read→clear 由 helper 做),轉換(如 force ? true : undefined)留在呼叫端。 */
  queryFn: (force: boolean, ctx: QueryFunctionContext<QueryKey>) => Promise<T>;
  /** useMarketSnapshot 專用掛點:refresh() 於 set ref 之後、refetch 之前呼叫(cancelQueries 防 polling dedupe)。 */
  onBeforeRefetch?: () => void;
}

export function useForceRefreshQuery<T>(options: ForceRefreshQueryOptions<T>) {
  const forceRefreshRef = useRef(false);
  const { queryFn, onBeforeRefetch, ...rest } = options;
  const { data, isFetching, error, refetch } = useQuery<T, Error>({
    ...rest,
    queryFn: (ctx) => {
      const force = forceRefreshRef.current;
      forceRefreshRef.current = false;
      return queryFn(force, ctx);
    },
  });
  return {
    data, isFetching, error,
    refresh: () => {
      forceRefreshRef.current = true;   // 順序與原樣板逐字同:set ref → (cancel) → refetch
      onBeforeRefetch?.();
      refetch();
    },
  };
}
```

- **只回 `{data, isFetching, error, refresh}`**,不 spread query result(TanStack v5 tracked props:spread 會擴大訂閱面、改變 re-render 行為 = 行為差異)。
- 各 hook 改寫後:queryKey / enabled / refetchInterval / retry / staleTime / placeholderData 原樣傳入 `rest`;extras 照舊由 data 派生;對外回傳 shape 逐字不變。
- **範圍修正(review R1)**:grep `forceRef|ForceRef` 全變體後,遷移對象 = 18 個(原 17 + `useChipBrokersWindow`,其 `forceRef` 為同樣板異名,已有 refresh 測試)。
- 排除(2,皆記入之後 race /bug 的必修清單):
  - useBrokerHistory:useMutation + AbortController 樣板(CLAUDE.md §3 明文另一套模板)。
  - useChipData:雙 ref(summaryForceRef/historyForceRef)複合 refresh + `.finally` 重置,非單 query 形狀,硬套 helper 需改行為。

## 步驟(每步單獨綠、單獨 commit)

| # | 內容 | commit 類 | 檔數 / 預估 diff |
|---|---|---|---|
| S1 | 6 個缺覆蓋 hook 補 refresh characterization test(useInstitutionalOptions / useOptionsPCR / useOptionsOIWalls / useMaxPain 新檔;useWarrantIvHistory / useOptionsLargeTraders 加 case) | 🟢 | 6 檔,~90 行 |
| S2 | 新增 `useForceRefreshQuery.ts` + `useForceRefreshQuery.test.ts`(consume-and-clear、refresh 標記下一發、onBeforeRefetch 順序、非 refresh fetch 不帶 force;**含 refetchInterval callback 讀 `query.state.data` 的型別用例 — review R3,把 useMarketSnapshot 的型別風險提前到 S2 驗**) | 🔵 | 2 檔,~90 行 |
| S3 | 遷移批次 1(api 系):useChipBubble / useChipIntraday / useDaytradeFee / useWarrants / useWarrantIvHistory / **useChipBrokersWindow(R1 補列)** | 🔵 | 6 檔,~-70 行 |
| S4 | 遷移批次 2(warrant/market):useWarrantFlow / useWarrantQuotes / useRetailMtx / useForeignFutures / useMarketSnapshot(onBeforeRefetch=cancelQueries) | 🔵 | 5 檔,~-60 行 |
| S5 | 遷移批次 3(options 系):useOptionsSpot / useInstitutionalOptions / useOptionsPCR / useOptionsOIWalls / useMaxPain / useOptionsStrikeVolume / useOptionsLargeTraders | 🔵 | 7 檔,~-80 行 |

每步後跑:該批 hook 測試檔 + `useForceRefreshQuery.test.ts`;S5 後跑全套 vitest。

## Phase 5-8

- Blast radius:grep `forceRef|ForceRef`(全變體,R1;收尾應只剩 useBrokerHistory 與 useChipData)+ grep 各 hook caller(對外 shape 不變,預期零連動)。
- auto-verify 全綠;真實環境:dev server 抽「重新整理」按鈕 2 處(equity 泡泡圖 / options 頁)行為與 refactor 前一致 + regression 抽 2 個未改功能。
- e2e 豁免:`[no-e2e: internal refactor]`(test-inventory.md 判準)。
- 量化:預期淨刪 ~130-170 行、樣板 18→1(排除 2 個異形樣板,已記錄)。

## Review 處置記錄

- R1(P1)採納:useChipBrokersWindow 納入、useChipData 明文排除、blast-radius grep 改全變體、量化修正。
- R2(P2)**rejected**:/refactor command 檔 Phase 2 明文「characterization test 標 🟢 新測試、跟 refactor 的 🔵 分開 commit」,S1 維持 🟢(command 檔 > reviewer 偏好);不入 changelog(§7:測試補強不入)。
- R3(P2)採納:型別風險驗證提前到 S2。

## Known risks

- TanStack v5 型別泛型(UseQueryOptions 四參數)在 Omit 後的推導 — S2 以 tsc 綠為準,必要時 helper 泛型加 TQueryKey。
- refetchInterval callback 型別(useMarketSnapshot / useWarrantQuotes)需通過 rest passthrough 不降級。
