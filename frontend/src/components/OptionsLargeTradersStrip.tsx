import type { ReactElement } from "react";
import { MiniBar, Sparkline } from "../lib/options-svg";
import type { OptionsLargeTraders } from "../lib/options-types";

interface Props {
  data: OptionsLargeTraders | null;
  loading: boolean;
  error: string | null;
  weeklyAggregateBanner?: boolean;
}

type GroupKey = "top5_prop" | "top10_prop" | "top5_all" | "top10_all";
type SeriesKey = "top5_prop_net" | "top10_prop_net" | "top5_all_net" | "top10_all_net";

const GROUPS: Array<{ groupKey: GroupKey; seriesKey: SeriesKey; label: string }> = [
  { groupKey: "top5_prop",  seriesKey: "top5_prop_net",  label: "前 5 特定法人 NET"  },
  { groupKey: "top10_prop", seriesKey: "top10_prop_net", label: "前 10 特定法人 NET" },
  { groupKey: "top5_all",   seriesKey: "top5_all_net",   label: "前 5 全交易人 NET"  },
  { groupKey: "top10_all",  seriesKey: "top10_all_net",  label: "前 10 全交易人 NET" },
];

function fmtSigned(n: number): string {
  if (!n) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : `−${Math.abs(n).toLocaleString()}`;
}

export function OptionsLargeTradersStrip({
  data, loading, error, weeklyAggregateBanner,
}: Props): ReactElement {
  if (error) {
    return (
      <section className="shrink-0 px-6 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
        {error}
      </section>
    );
  }
  if (loading && !data) {
    return (
      <section
        data-testid="strip-skeleton"
        className="shrink-0 px-4 py-3 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 border-b border-line"
      >
        {GROUPS.map((g) => (
          <div key={g.groupKey} className="flex flex-col gap-1">
            <div className="h-2 w-32 bg-line animate-pulse" />
            <div className="h-4 w-20 bg-line animate-pulse" />
            <div className="h-1 w-full bg-line/50" />
          </div>
        ))}
      </section>
    );
  }
  if (!data) {
    return <section className="shrink-0 h-[68px] border-b border-line" />;
  }

  const maxAbs = Math.max(
    1,
    ...GROUPS.map((g) => Math.abs(data.current[g.groupKey].net)),
  );

  return (
    <>
      {weeklyAggregateBanner && (
        <div
          data-testid="strip-weekly-banner"
          className="shrink-0 px-6 py-1 text-xs text-ink-dim bg-ink/[0.03] border-b border-line"
        >
          📌 大戶 OI 為近週週選 aggregate(FinMind <code>contract_type=&apos;week&apos;</code>),週三選 + 週五選共用同一份資料。熱門履約價依各週合約獨立。
        </div>
      )}
      <section data-testid="options-large-traders-strip" className="shrink-0 px-4 py-2.5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 border-b border-line bg-bg">
        {GROUPS.map((g) => {
          const cur = data.current[g.groupKey];
          const series = data.series.map((s) => s[g.seriesKey]);
          const startVal = series[0] ?? 0;
          const endVal = series[series.length - 1] ?? cur.net;
          const trend20 = endVal - startVal;
          return (
            <div
              key={g.groupKey}
              data-testid="strip-card"
              className="grid grid-cols-[1fr_90px] gap-3 items-center"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[0.625rem] text-ink-dim uppercase tracking-wide truncate">
                  {g.label}
                </span>
                <span
                  className={`text-[1rem] font-semibold leading-none ${
                    cur.net >= 0 ? "text-[var(--color-up,#dc2626)]" : "text-[var(--color-down,#16a34a)]"
                  }`}
                >
                  {fmtSigned(cur.net)}
                </span>
                <div className="mt-1">
                  <MiniBar value={cur.net} maxAbs={maxAbs} width={140} height={3} />
                </div>
              </div>
              <div className="flex flex-col gap-px border-l border-line pl-3"
                   data-testid="strip-spark">
                <span className="text-[0.5625rem] text-ink-dim uppercase tracking-wide leading-none">
                  20D · {fmtSigned(trend20)}
                </span>
                <Sparkline series={series} width={90} height={30} />
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
