import type { ReactElement } from "react";
import { changeColorClass, signedPercent } from "../lib/market-format";
import type { CapTier } from "../lib/market-types";

type Props = { data: CapTier[] | null; loading: boolean };

const TIER_LABEL: Record<CapTier["tier"], string> = {
  top50: "權值前 50",
  mid100: "中型 51–150",
  rest: "其餘",
};

export function MarketCapTiers({ data, loading }: Props): ReactElement {
  let body: ReactElement;
  if (loading) {
    body = (
      <div data-state="loading" role="status" aria-label="載入中" className="flex flex-col gap-2 mt-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse bg-bg-deep" />
        ))}
      </div>
    );
  } else if (data === null || data.length === 0) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs mt-2">
        資料暫缺
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3 mt-2">
        {data.map((t) => {
          const barPct = Math.round(t.up_ratio * 100);
          return (
            <div key={t.tier} data-testid={`cap-tier-${t.tier}`} className="text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-ink">
                  {TIER_LABEL[t.tier]}
                  <span className="text-ink-dim ml-1">({t.members})</span>
                </span>
                <span className={changeColorClass(t.avg_change_rate)}>
                  {signedPercent(t.avg_change_rate)}
                </span>
              </div>
              <div className="mt-1 h-1.5 bg-bg-deep rounded-full overflow-hidden">
                <div className="h-full bg-bull/70" style={{ width: `${barPct}%` }} />
              </div>
              <div className="mt-0.5 text-ink-dim text-[0.625rem]">上漲比例 {barPct}%</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section
      data-testid="market-cap-tiers"
      className="flex flex-col min-h-0 p-3 border-r border-line overflow-y-auto"
    >
      <h3 className="text-ink text-sm">市值分層</h3>
      {body}
    </section>
  );
}
