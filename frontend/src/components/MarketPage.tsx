import { useState, type ReactElement } from "react";
import { useMarketSnapshot } from "../hooks/useMarketSnapshot";
import { MarketHeader } from "./MarketHeader";
import { MarketHeatmap } from "./MarketHeatmap";
import { MarketLeaderboard } from "./MarketLeaderboard";
import { MarketBreadthPanel } from "./MarketBreadthPanel";
import { MarketSectorBreadthHeatmap } from "./MarketSectorBreadthHeatmap";
import { MarketSectorAmountShare } from "./MarketSectorAmountShare";
import { MarketSectorVolRatio } from "./MarketSectorVolRatio";
import { MarketUniverseBanner } from "./MarketUniverseBanner";

type Props = {
  isActive: boolean;
  onSymbolPick: (stockId: string) => void;
};

export function MarketPage({ isActive, onSymbolPick }: Props): ReactElement {
  const { data, refresh, lastUpdated, isStale, isTradingSession, error } =
    useMarketSnapshot(isActive);
  const [classicOpen, setClassicOpen] = useState(true); // D-2:預設展開

  // Phase 4 R1: 從未成功過(error AND data==null)才整頁顯示資料源錯誤;
  // 否則保留 last-good data,error 變成 header 上的小 banner,避免 transient
  // blip(網路抖動 / FinMind 502)一次失敗就 unmount 整頁 UI。
  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ink-muted gap-2">
        <p>資料源無法連線:{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-2 px-3 py-1 border border-line rounded text-xs cursor-pointer"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <MarketHeader
        lastUpdated={lastUpdated}
        isStale={isStale}
        isTradingSession={isTradingSession}
        lagSeconds={data?.lag_seconds ?? null}
        onRefresh={refresh}
      />
      {error && (
        <div
          role="alert"
          className="px-4 py-1 text-xs bg-danger/10 text-danger border-b border-danger/30"
        >
          資料更新失敗:{error}(顯示上次成功結果)
        </div>
      )}
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
          <MarketBreadthPanel
            breadth={data?.breadth ?? null}
            eodAsOf={data?.eod_as_of ?? null}
            loaded={!!data}
          />
          <MarketSectorBreadthHeatmap
            rows={data?.sector_breadth ?? null}
            eodAsOf={data?.eod_as_of ?? null}
            loaded={!!data}
            onSectorClick={() => {}} // concept-drill 接點,本輪 no-op
          />
          <div className="flex flex-col min-h-0 border-l border-line">
            <MarketSectorAmountShare
              rows={data?.sector_amount_share ?? null}
              eodAsOf={data?.eod_as_of ?? null}
              loaded={!!data}
            />
            <MarketSectorVolRatio
              rows={data?.sector_volume_ratio ?? null}
              eodAsOf={data?.eod_as_of ?? null}
              loaded={!!data}
            />
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
            <MarketHeatmap
              sectors={data?.sectors ?? []}
              onSymbolPick={onSymbolPick}
            />
            <MarketLeaderboard
              leaderboards={data?.leaderboards ?? null}
              onSymbolPick={onSymbolPick}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
