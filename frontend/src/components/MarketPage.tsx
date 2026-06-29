import { type ReactElement } from "react";
import { useMarketSnapshot } from "../hooks/useMarketSnapshot";
import { MarketHeader } from "./MarketHeader";
import { MarketHeatmap } from "./MarketHeatmap";
import { MarketLeaderboard } from "./MarketLeaderboard";

type Props = {
  isActive: boolean;
  onSymbolPick: (stockId: string) => void;
};

export function MarketPage({ isActive, onSymbolPick }: Props): ReactElement {
  const { data, refresh, lastUpdated, isStale, isTradingSession, error } =
    useMarketSnapshot(isActive);

  if (error) {
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
      <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] flex-1 overflow-hidden">
        <MarketHeatmap
          sectors={data?.sectors ?? []}
          onSymbolPick={onSymbolPick}
        />
        <MarketLeaderboard
          leaderboards={data?.leaderboards ?? null}
          onSymbolPick={onSymbolPick}
        />
      </div>
    </div>
  );
}
