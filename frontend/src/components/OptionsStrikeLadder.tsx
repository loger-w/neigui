import type { ReactElement } from "react";
import { StrikeLadder } from "../lib/options-svg";
import type { OptionsStrikeVolume, OptionsSpot } from "../lib/options-types";

interface Props {
  data: OptionsStrikeVolume | null;
  spot: OptionsSpot | null;
  loading: boolean;
  error: string | null;
}

export function OptionsStrikeLadder({
  data, spot, loading, error,
}: Props): ReactElement {
  return (
    <section data-testid="options-strike-ladder" className="flex-1 flex flex-col overflow-hidden">
      <header className="shrink-0 px-4 py-2 text-xs text-ink-dim uppercase tracking-wide border-b border-line flex items-center gap-2">
        <span>成交量分布 · Strike Ladder</span>
        {data && (
          <span className="text-[10px] text-ink-dim normal-case tracking-normal">
            {(data.call.length + data.put.length)} 個有量
          </span>
        )}
      </header>
      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}
      {loading && !data && (
        <div
          data-testid="ladder-loading"
          className="flex-1 flex items-center justify-center text-ink-dim text-sm"
        >
          載入中…
        </div>
      )}
      {data && (
        <div className="flex-1 overflow-hidden">
          <StrikeLadder data={data} spot={spot?.spot ?? null} />
        </div>
      )}
    </section>
  );
}
