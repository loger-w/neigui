# test-inventory — refactor/force-refresh-query(Phase 2,2026-07-17)

範圍:grep `forceRef|ForceRef` 全變體共 20 檔;排除 2(useBrokerHistory = useMutation + AbortController 樣板,CLAUDE.md §3 明文另一套模板;useChipData = 雙 ref 複合 refresh + `.finally` 重置)→ **實際遷移 18 個**(含異名樣板 `useChipBrokersWindow` 的 `forceRef`,review R1 補列)。

## Baseline

- `npm test`:844 passed(86 files)— 2026-07-17 本日三輪全綠(pre-push 重驗)。

## 覆蓋現況(refresh() 行為 = 本 refactor 的核心行為合約)

**有 refresh 測試(13)**:useWarrantFlow / useWarrants / useWarrantQuotes / useDaytradeFee / useRetailMtx / useForeignFutures / useMarketSnapshot / useOptionsStrikeVolume / useOptionsSpot / useBrokerHistory(排除範圍)/ useChipIntraday / useChipBubble / useChipBrokersWindow(`useChipBrokersWindow.test.ts:83`,異名 `forceRef` 樣板)

**缺 refresh 覆蓋 → 需先補 characterization(6)**:
| Hook | 現況 |
|---|---|
| useInstitutionalOptions | 無測試檔 |
| useOptionsPCR | 無測試檔 |
| useOptionsOIWalls | 無測試檔 |
| useMaxPain | 無測試檔 |
| useWarrantIvHistory | 有檔,無 refresh test |
| useOptionsLargeTraders | 有檔,無 refresh test |

Characterization 內容(拍現行行為,不求漂亮):`refresh()` → 下一次 fetch 對 api 帶 `refresh=true`(optionsApi 系傳 `true`,api 系傳 boolean);且後續非 refresh fetch 不帶。寫法沿 `useOptionsStrikeVolume.test.ts` / `useChipBubble.test.ts` 既有樣式(vi.spyOn、jsdom pragma、無 jest-dom,per skill `frontend-testing`)。

## 變體註記(行為保存點)

- **useMarketSnapshot**:refresh() 序列 = set ref → `queryClient.cancelQueries(["market","snapshot"])` → `refetch()`(防 polling dedupe 吃掉 user click)。順序必須逐字保存。
- **optionsApi 系(9)**:`force ? true : undefined`(不讓 query string 帶 refresh=false);api 系(8)直傳 boolean。轉換留在各 hook 的 queryFn 內,helper 不碰。
- **回傳 shape**:各 hook extras(noTradingDay / asOfDate / quoteDate 等)皆由 data 派生,helper 只需暴露 `{data, isFetching, error, refresh}`(+refetch 不需對外)。
- **TanStack v5 tracked props**:helper 不得 spread 整個 query result(會擴大訂閱面改變 re-render 行為)— 只回存取過的欄位。

## e2e 判準

純 hook 內部結構重構,回傳 shape 與 UI 行為零變化 → **豁免**(`[no-e2e: internal refactor]`),per skill `e2e-conventions` 判準表。
