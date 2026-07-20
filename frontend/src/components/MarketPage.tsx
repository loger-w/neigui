import { useState, type ReactElement } from "react";
import { useMarketSnapshot } from "../hooks/useMarketSnapshot";
import { MarketHeader } from "./MarketHeader";
import { MarketHeatmap } from "./MarketHeatmap";
import { MarketLeaderboard } from "./MarketLeaderboard";
import { MarketIndexStrength } from "./MarketIndexStrength";
import { MarketCapTiers } from "./MarketCapTiers";
import { MarketSectorRotation } from "./MarketSectorRotation";
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
    // flex-1(非 h-full):App root 是 flex-col(mode nav shrink-0 + page),
    // flex item 的 h-full = 100% 容器高,會下溢 nav 高度被 overflow-hidden 裁切
    <div className="flex flex-col flex-1 min-h-0">
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
        {/* market-today-only(change-spec.md §1):舊 EOD 四格全部退役,今日
            三卡改吃 tick snapshot 當下欄位,無背景計算、無 eod_pending 輪詢。 */}
        <div
          data-testid="market-v2-grid"
          className="lg:h-full grid grid-cols-1 lg:grid-cols-[4fr_2fr_6fr]"
        >
          <MarketIndexStrength data={data?.index_strength ?? null} loading={!data} />
          <MarketCapTiers data={data?.cap_tiers ?? null} loading={!data} />
          <MarketSectorRotation data={data?.sector_rotation ?? null} loading={!data} />
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
          {/* responsive spec §4.5:mobile 明確列高(heatmap 360px 量測有依據 +
              leaderboard 自然高由外層頁捲動收),lg 維持 560px 雙欄。 */}
          <div
            hidden={!classicOpen}
            className="grid grid-cols-1 grid-rows-[360px_auto] lg:h-[560px] lg:grid-rows-1 lg:grid-cols-[7fr_3fr]"
          >
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
