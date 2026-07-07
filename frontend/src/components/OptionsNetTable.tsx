import type { ReactElement } from "react";
import type { OptionsLargeTraders } from "../lib/options-types";

interface Props {
  data: OptionsLargeTraders | null;
}

const GROUPS = [
  { key: "top5_prop", seriesKey: "top5_prop_net", label: "前 5 特定法人" },
  { key: "top10_prop", seriesKey: "top10_prop_net", label: "前 10 特定法人" },
  { key: "top5_all", seriesKey: "top5_all_net", label: "前 5 全交易人" },
  { key: "top10_all", seriesKey: "top10_all_net", label: "前 10 全交易人" },
] as const;

function fmtSigned(n: number): string {
  if (!n) return "0";
  return n > 0 ? `+${n.toLocaleString()}` : `−${Math.abs(n).toLocaleString()}`;
}

/** NET 四組對照表(options-page-v2 §2 — 原 OptionsLargeTradersStrip 降級進
 * 進階區)。當日淨部位 + 20 日變化,附受眾需要的名詞說明。 */
export function OptionsNetTable({ data }: Props): ReactElement | null {
  if (!data) return null;

  const first = data.series[0];
  const last = data.series[data.series.length - 1];

  return (
    <div data-testid="options-net-table" className="rounded-lg border border-line bg-bg-deep/50 p-4">
      <h3 className="text-sm font-semibold text-ink-muted mb-2">
        大戶淨部位對照(delta 等效,單位:口)
      </h3>
      <table className="text-xs w-full tabular-nums">
        <thead className="text-ink-dim">
          <tr>
            <th className="text-left font-normal">分組</th>
            <th className="text-right font-normal">當日淨部位</th>
            <th className="text-right font-normal">20 日變化</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => {
            const net = data.current[g.key].net;
            const change =
              first && last && first !== last
                ? last[g.seriesKey] - first[g.seriesKey]
                : null;
            return (
              <tr key={g.key} className="border-t border-line/40">
                <td className="py-1 text-ink-muted">{g.label}</td>
                <td className={`py-1 text-right ${net >= 0 ? "text-bull" : "text-bear"}`}>
                  {fmtSigned(net)}
                </td>
                <td className="py-1 text-right text-ink-dim">
                  {change === null ? "—" : fmtSigned(change)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[0.6875rem] text-ink-dim leading-relaxed">
        特定法人 = 前 N 大交易人中的法人機構;全交易人 = 含自然人大戶。
        正值代表整體佈局偏多方(買 call + 賣 put 合成),負值偏空方。
      </p>
    </div>
  );
}
