import type { ReactElement } from "react";
import { eodLabel, lotsToWan } from "../lib/market-format";
import { cn } from "../lib/utils";
import type { SectorVolumeRatioRow } from "../lib/market-types";

type Props = { rows: SectorVolumeRatioRow[] | null; eodAsOf: string | null; loaded: boolean };

export function MarketSectorVolRatio({ rows, eodAsOf, loaded }: Props): ReactElement {
  let body: ReactElement;
  if (!loaded) {
    body = (
      <div
        data-state="loading"
        role="status"
        aria-label="載入中"
        className="flex flex-col gap-1"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-4 animate-pulse bg-bg-deep" />
        ))}
      </div>
    );
  } else if (rows === null) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs">
        資料暫缺
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div data-state="empty" className="text-ink-dim text-xs">
        無符合資料
      </div>
    );
  } else {
    body = (
      <div className="overflow-y-auto min-h-0 flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-ink-dim text-left">
              <th className="font-normal">族群</th>
              <th className="font-normal">今日量(萬張)</th>
              <th className="font-normal">量比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sector} data-testid={`svr-row-${r.sector}`}>
                <td className="text-ink">
                  {r.flag && (
                    <span
                      data-flag={r.flag}
                      className={cn(
                        "inline-block w-2 h-2 rounded-full mr-1",
                        r.flag === "hot" ? "bg-accent" : "bg-ink-dim",
                      )}
                    />
                  )}
                  {r.sector}
                </td>
                <td className="text-ink">{lotsToWan(r.today_vol_lots)}</td>
                <td className="text-ink">{r.vol_ratio?.toFixed(2) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section data-testid="market-sector-vol-ratio" className="flex flex-col min-h-0 flex-1 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-ink text-sm">族群量能</h3>
        <span className="text-ink-dim text-xs">{eodLabel(eodAsOf)}</span>
      </div>
      {body}
    </section>
  );
}
