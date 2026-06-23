import { useRef, type ReactElement } from "react";
import { LargeTradersBars, LargeTradersTrend } from "../lib/options-chart-svg";
import { useContainerSize } from "../hooks/useContainerSize";
import type { OptionsLargeTraders } from "../lib/options-types";

interface Props {
  data: OptionsLargeTraders | null;
  loading: boolean;
  error: string | null;
  weeklyAggregateBanner?: boolean;
}

export function OptionsLargeTradersPanel({
  data, loading, error, weeklyAggregateBanner,
}: Props): ReactElement {
  const barsRef = useRef<HTMLDivElement>(null);
  const trendRef = useRef<HTMLDivElement>(null);
  const barsSize = useContainerSize(barsRef);
  const trendSize = useContainerSize(trendRef);

  return (
    <section className="h-full flex flex-col overflow-hidden border-b border-line">
      <header className="shrink-0 px-4 py-2 text-sm text-ink-muted">
        大戶部位
      </header>
      {weeklyAggregateBanner && (
        <div
          data-testid="options-lt-weekly-banner"
          className="shrink-0 mx-4 mb-2 px-3 py-1 text-xs text-ink-dim bg-ink/[0.03] rounded"
        >
          📌 大戶 OI 為近週週選 aggregate(FinMind `contract_type='week'`),W1..W4 顯示同一份資料。熱門履約價依各週合約獨立。
        </div>
      )}
      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}
      {loading && !data && (
        <div
          data-testid="options-lt-loading"
          className="flex-1 flex items-center justify-center text-ink-dim text-sm"
        >
          載入中…
        </div>
      )}
      {data && (
        <div className="flex-1 grid grid-rows-[3fr_2fr] overflow-hidden">
          <div ref={barsRef} className="overflow-hidden">
            {barsSize.width > 0 && (
              <LargeTradersBars
                current={data.current}
                width={barsSize.width}
                height={barsSize.height}
              />
            )}
          </div>
          <div ref={trendRef} className="overflow-hidden border-t border-line">
            {trendSize.width > 0 && (
              <LargeTradersTrend
                series={data.series}
                width={trendSize.width}
                height={trendSize.height}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
