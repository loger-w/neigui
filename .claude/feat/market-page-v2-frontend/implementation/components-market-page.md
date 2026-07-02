# implementation: frontend/src/components/MarketPage.tsx(🔴 行為改動)+ .test.tsx(增測 + 既有 mock 補欄位)

對應:SC-9、SC-2(間接)。design v3 §11。

## 結構(整檔改寫 grid 區;header / error 分支不動)

```tsx
import { useState, type ReactElement } from "react";
// 既有 import + 新 5 元件 + MarketUniverseBanner

export function MarketPage({ isActive, onSymbolPick }: Props): ReactElement {
  const { data, refresh, lastUpdated, isStale, isTradingSession, error } = useMarketSnapshot(isActive);
  const [classicOpen, setClassicOpen] = useState(true);   // D-2:預設展開

  // 既有 error && !data 整頁分支 — 一行不動(頁級 error 不 key 在四個新欄位,契約事實 2)
  // 既有 MarketHeader + error banner — 一行不動

  return (
    <div className="flex flex-col h-full">
      <MarketHeader ... />
      {error && <div role="alert" ...>資料更新失敗:{error}(顯示上次成功結果)</div>}
      {data && (
        <MarketUniverseBanner
          universeSize={data.universe_size}
          excludedCount={data.excluded_count}
          stale={isStale}
        />
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div
          data-testid="market-v2-grid"
          className="lg:h-full grid grid-cols-1 lg:grid-cols-[3fr_4fr_3fr]"
        >
          <MarketBreadthPanel breadth={data?.breadth ?? null} eodAsOf={data?.eod_as_of ?? null} loaded={!!data} />
          <MarketSectorBreadthHeatmap
            rows={data?.sector_breadth ?? null}
            eodAsOf={data?.eod_as_of ?? null}
            loaded={!!data}
            onSectorClick={() => {}}   // concept-drill 接點,本輪 no-op
          />
          <div className="flex flex-col min-h-0 border-l border-line">
            <MarketSectorAmountShare rows={data?.sector_amount_share ?? null} eodAsOf={data?.eod_as_of ?? null} loaded={!!data} />
            <MarketSectorVolRatio rows={data?.sector_volume_ratio ?? null} eodAsOf={data?.eod_as_of ?? null} loaded={!!data} />
          </div>
        </div>
        <section className="border-t border-line">
          <button
            type="button"
            data-testid="market-classic-toggle"
            aria-expanded={classicOpen}
            onClick={() => setClassicOpen((v) => !v)}
            className="w-full px-4 py-2 text-left text-xs text-ink-muted hover:text-ink cursor-pointer"
          >
            經典檢視 {classicOpen ? "▾" : "▸"}
          </button>
          <div hidden={!classicOpen} className="h-[560px] grid grid-cols-1 lg:grid-cols-[7fr_3fr]">
            <MarketHeatmap sectors={data?.sectors ?? []} onSymbolPick={onSymbolPick} />
            <MarketLeaderboard leaderboards={data?.leaderboards ?? null} onSymbolPick={onSymbolPick} />
          </div>
        </section>
      </div>
    </div>
  );
}
```

順序 lock(prompt 拍板):MarketHeader → error banner → universe banner → 主視圖 → 經典檢視。折疊用普通 button(非 Radix,§9 lesson)+ `hidden` attribute(保留 mount,§3 慣例)。

## 既有測試「該變」清單(機械後果,事前標記)

- `MarketPage.test.tsx:38-58` mockResolvedValue payload 補 7 新欄位(`universe_size: 1917, excluded_count: {etf:347,warrant:67,watch_list:57}, eod_as_of: "2026-07-02", breadth: null, sector_breadth: null, sector_volume_ratio: null, sector_amount_share: null`)— 否則型別補齊後 tsc 紅。既有 3 個 assertion 不動。
- `useMarketSnapshot.test.ts:11` `mockSnapshot: MarketSnapshot` 同樣補 7 欄。既有 assertion 不動。
- 不新增 factory helper(YAGNI,兩處 in-place 補)。

## 失敗測試清單(MarketPage.test.tsx 增測,先紅)

1. `DOM 順序:universe banner 在 header 後、market-v2-grid 前`(SC-9;compareDocumentPosition 或 container.children 序)
2. `新 5 root testid 全 render(data 到位後)`(SC-9;banner + breadth-panel + sector-breadth-heatmap + amount-share + vol-ratio)
3. `經典檢視預設展開:market-heatmap / market-leaderboard 可見(hidden 屬性 false)`(D-2 / SC-11e)
4. `click market-classic-toggle → 折疊 div hidden=true 且兩舊元件仍 mounted(querySelector 仍找得到)`(SC-9 hidden 慣例)
5. `data=null(fetch 未 resolve)→ 4 panel data-state=loading;error && !data → 既有整頁錯誤分支(新 panel 不 render)`(SC-9 / 契約事實 2)

mock payload(增測用):fixture 實值裁切版 — breadth 帶 3 筆 mcclellan_series + sector 三 list 各 2 rows,universe/excluded 同上。
