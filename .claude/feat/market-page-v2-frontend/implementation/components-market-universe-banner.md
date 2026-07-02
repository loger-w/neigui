# implementation: frontend/src/components/MarketUniverseBanner.tsx(🟢)+ .test.tsx(🟢)

對應:SC-8。design v3 §10。

## Props / 結構

```tsx
import type { ExcludedCount } from "../lib/market-types";

type Props = { universeSize: number; excludedCount: ExcludedCount; stale: boolean };
export function MarketUniverseBanner({ universeSize, excludedCount, stale }: Props): ReactElement
```

- MarketPage 只在 `data` 非 null 時 render 本元件(banner 無 loading 態)
- root:

```tsx
const total = excludedCount.etf + excludedCount.warrant + excludedCount.watch_list;
<div
  data-testid="market-universe-banner"
  className="px-4 py-1 text-xs text-ink-muted border-b border-line bg-bg-deep"
>
  已過濾 ETF / 權證 / 處置股 共 {total} 檔 · 納入 {universeSize} 檔(以本次掃描範圍為準)
  {stale && " · 資料停滯,顯示最近成功結果"}
</div>
```

- D-1 裁決:「處置股」精確措辭;**無分項數字**(不出現「ETF 347」「權證 67」等 per-category 數)

## 失敗測試清單(.test.tsx,先紅)

1. `文案全文:total 加總正確(347+67+57=471)+ 含「處置股」+ 含「以本次掃描範圍為準」+ 納入 1917`(SC-8)
2. `禁分項數字:queryByText(/ETF 347|權證 67|處置股 57/) → null`(SC-8;CLAUDE.md §9 banner 文案 lesson)
3. `禁 overclaim:queryByText(/注意股|全額交割/) → null`(D-1)
4. `stale=true → 含「資料停滯」;false → 不含`(SC-8)
5. `方向性文案 lock`(SC-10a)
