import type { ReactElement } from "react";
import type { OptionsStrikeVolume, StrikeRow } from "../lib/options-types";

interface Props {
  data: OptionsStrikeVolume | null;
  loading: boolean;
  error: string | null;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtSigned(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : `−${Math.abs(n).toLocaleString()}`;
}

function Row({ row, side }: { row: StrikeRow; side: "call" | "put" }): ReactElement {
  const cls =
    row.oi_change > 0
      ? "text-[var(--color-up,#dc2626)]"
      : row.oi_change < 0
      ? "text-[var(--color-down,#16a34a)]"
      : "text-ink-muted";
  return (
    <tr data-testid={`${side}-row`} className="border-b border-line/50">
      <td className="px-3 py-1.5 text-right font-medium">{fmt(row.strike)}</td>
      <td className="px-3 py-1.5 text-right">{fmt(row.volume)}</td>
      <td className={`px-3 py-1.5 text-right ${cls}`}>{fmtSigned(row.oi_change)}</td>
    </tr>
  );
}

export function OptionsStrikeVolumePanel({ data, loading, error }: Props): ReactElement {
  return (
    <section className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 px-4 py-2 text-sm text-ink-muted">
        熱門履約價
      </header>
      {error && (
        <div className="shrink-0 px-4 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}
      {loading && !data && (
        <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
          載入中…
        </div>
      )}
      {!loading && !error && !data && (
        <div className="flex-1 flex items-center justify-center text-ink-dim text-sm">
          尚無資料
        </div>
      )}
      {data && (
        <div className="flex-1 grid grid-cols-2 gap-px bg-line overflow-auto">
          <div className="bg-bg">
            <table className="w-full text-sm">
              <thead className="text-ink-dim text-xs">
                <tr>
                  <th className="px-3 py-1 text-right">Strike</th>
                  <th className="px-3 py-1 text-right">Volume</th>
                  <th className="px-3 py-1 text-right">OI ±</th>
                </tr>
              </thead>
              <tbody>
                {data.call.map((r) => (
                  <Row key={`call-${r.strike}`} row={r} side="call" />
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-bg">
            <table className="w-full text-sm">
              <thead className="text-ink-dim text-xs">
                <tr>
                  <th className="px-3 py-1 text-right">Strike</th>
                  <th className="px-3 py-1 text-right">Volume</th>
                  <th className="px-3 py-1 text-right">OI ±</th>
                </tr>
              </thead>
              <tbody>
                {data.put.map((r) => (
                  <Row key={`put-${r.strike}`} row={r} side="put" />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
