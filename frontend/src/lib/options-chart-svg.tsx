import type { ReactElement } from "react";
import type { OptionsLargeTraders } from "./options-types";

const GROUPS: Array<{ key: keyof OptionsLargeTraders["current"]; label: string }> = [
  { key: "top5_prop",  label: "前 5 特定法人" },
  { key: "top10_prop", label: "前 10 特定法人" },
  { key: "top5_all",   label: "前 5 全交易人" },
  { key: "top10_all",  label: "前 10 全交易人" },
];

interface BarsProps {
  current: OptionsLargeTraders["current"];
  width: number;
  height: number;
}

export function LargeTradersBars({ current, width, height }: BarsProps): ReactElement {
  const max = Math.max(
    1,
    ...GROUPS.flatMap((g) => [current[g.key].long, current[g.key].short]),
  );
  const labelW = 90;
  const barAreaW = width - labelW - 8;
  const rowH = height / GROUPS.length;
  const barH = rowH * 0.35;

  return (
    <svg width={width} height={height} role="img" aria-label="大戶 OI bars">
      {GROUPS.map((g, i) => {
        const y = i * rowH + (rowH - 2 * barH - 2) / 2;
        const longW = (current[g.key].long  / max) * barAreaW;
        const shortW = (current[g.key].short / max) * barAreaW;
        return (
          <g key={g.key}>
            <text
              data-testid="lt-label"
              x={labelW - 6} y={i * rowH + rowH / 2}
              fontSize="11" textAnchor="end"
              alignmentBaseline="middle"
              className="fill-ink-muted"
            >
              {g.label}
            </text>
            <rect
              data-testid="lt-bar"
              x={labelW} y={y} width={longW} height={barH}
              className="fill-[var(--color-up,#dc2626)]"
            />
            <rect
              data-testid="lt-bar"
              x={labelW} y={y + barH + 2} width={shortW} height={barH}
              className="fill-[var(--color-down,#16a34a)]"
            />
            <text
              x={labelW + Math.max(longW, shortW) + 4}
              y={i * rowH + rowH / 2}
              fontSize="10"
              alignmentBaseline="middle"
              className="fill-ink"
            >
              {current[g.key].net.toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface TrendProps {
  series: OptionsLargeTraders["series"];
  width: number;
  height: number;
}

export function LargeTradersTrend({ series, width, height }: TrendProps): ReactElement {
  if (series.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label="20 天淨額趨勢">
        <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="11"
              className="fill-ink-dim">無資料</text>
      </svg>
    );
  }
  const padX = 8;
  const padY = 8;
  const w = width - 2 * padX;
  const h = height - 2 * padY;
  const allNets = series.flatMap((s) => [s.top10_all_net, s.top10_prop_net]);
  const ymin = Math.min(0, ...allNets);
  const ymax = Math.max(0, ...allNets);
  const span = ymax - ymin || 1;

  const xOf = (i: number) =>
    padX + (series.length === 1 ? w / 2 : (i / (series.length - 1)) * w);
  const yOf = (v: number) =>
    padY + h - ((v - ymin) / span) * h;

  const pAll = series.map((s, i) => `${xOf(i)},${yOf(s.top10_all_net)}`).join(" ");
  const pProp = series.map((s, i) => `${xOf(i)},${yOf(s.top10_prop_net)}`).join(" ");
  const zeroY = yOf(0);

  return (
    <svg width={width} height={height} role="img" aria-label="20 天淨額趨勢">
      <line x1={padX} x2={padX + w} y1={zeroY} y2={zeroY}
            stroke="currentColor" strokeOpacity="0.2" />
      <polyline points={pAll} fill="none" strokeWidth={1}
                strokeDasharray="3 3"
                className="stroke-accent" />
      <polyline points={pProp} fill="none" strokeWidth={1.5}
                className="stroke-accent" />
    </svg>
  );
}
