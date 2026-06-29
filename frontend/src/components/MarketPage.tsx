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
          className="px-4 py-1 text-xs bg-red-500/10 text-red-600 border-b border-red-500/30"
        >
          資料更新失敗:{error}(顯示上次成功結果)
        </div>
      )}
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
