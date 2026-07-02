import type { ReactElement } from "react";
import { eodLabel, pctText, signedPctPoints } from "../lib/market-format";
import type { SectorAmountShareRow } from "../lib/market-types";

type Props = { rows: SectorAmountShareRow[] | null; eodAsOf: string | null; loaded: boolean };

export function MarketSectorAmountShare({ rows, eodAsOf, loaded }: Props): ReactElement {
  let body: ReactElement;
  if (!loaded) {
    body = (
      <div data-state="loading" className="flex flex-col gap-1">
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
              <th className="font-normal">成交占比</th>
              <th className="font-normal">Δ20MA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // CR1-13:顏色改用與 signedPctPoints 顯示同源的四捨五入值,避免
              // ±0.00003 這類 rounding 邊界值顯示 "0.00" 卻仍上色。
              const pts = r.share_delta_20ma == null ? null : Number((r.share_delta_20ma * 100).toFixed(2));
              const deltaClass = pts === null ? "text-ink-dim" : pts > 0 ? "text-accent" : "text-ink-muted";
              return (
                <tr key={r.sector} data-testid={`sas-row-${r.sector}`}>
                  <td className="text-ink">{r.sector}</td>
                  <td className="text-ink">{pctText(r.today_share, 1)}</td>
                  <td className={deltaClass}>{signedPctPoints(r.share_delta_20ma)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section
      data-testid="market-sector-amount-share"
      className="flex flex-col min-h-0 flex-1 p-3 border-b border-line"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-ink text-sm">族群資金流向</h3>
        <span className="text-ink-dim text-xs">{eodLabel(eodAsOf)}</span>
      </div>
      {body}
    </section>
  );
}
