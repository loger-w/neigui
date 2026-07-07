import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// MiniBar — horizontal pos/neg progress bar
// ---------------------------------------------------------------------------

interface MiniBarProps {
  value: number;
  maxAbs: number;
  width: number;
  height: number;
}

export function MiniBar({ value, maxAbs, width, height }: MiniBarProps): ReactElement {
  const ratio = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  const w = ratio * width;
  const sign = value >= 0 ? "pos" : "neg";
  const fill = value >= 0
    ? "var(--color-up, #dc2626)"
    : "var(--color-down, #16a34a)";
  return (
    <svg width={width} height={height} role="img" aria-hidden="true">
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        className="fill-[var(--color-line,#262626)] opacity-50"
      />
      <rect
        data-testid="minibar-fill"
        data-sign={sign}
        x={0}
        y={0}
        width={w}
        height={height}
        fill={fill}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — small filled line chart with last-point dot
// ---------------------------------------------------------------------------

interface SparklineProps {
  series: number[];
  width: number;
  height: number;
}

export function Sparkline({ series, width, height }: SparklineProps): ReactElement {
  // Defensive: filter null / undefined / NaN. Upstream parsers should never
  // produce these, but a degenerate series silently rendered an invisible
  // 1-point polyline during P3 verification — better to skip and render
  // reserved space than emit NaN coordinates.
  const clean = series.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (clean.length < 2) {
    return (
      <svg width={width} height={height} role="img" aria-hidden="true">
        {clean.length === 1 && (
          <line
            x1={0}
            x2={width}
            y1={height / 2}
            y2={height / 2}
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeDasharray="2 2"
          />
        )}
      </svg>
    );
  }
  const lo = Math.min(0, ...clean);
  const hi = Math.max(0, ...clean);
  const span = hi - lo || 1;
  const x = (i: number) => 1 + (i / (clean.length - 1)) * (width - 2);
  const y = (v: number) => 1 + (height - 2) - ((v - lo) / span) * (height - 2);

  const points = clean.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = clean[clean.length - 1]!;
  const sign = last >= 0 ? "pos" : "neg";
  const color = last >= 0
    ? "var(--color-up, #dc2626)"
    : "var(--color-down, #16a34a)";
  const areaPoints = `${x(0)},${y(0)} ${points} ${x(clean.length - 1)},${y(0)}`;

  return (
    <svg width={width} height={height} role="img" aria-label="20D 趨勢"
         data-sign={sign}>
      <line x1={0} x2={width} y1={y(0)} y2={y(0)}
            stroke="currentColor" strokeOpacity="0.2"
            strokeDasharray="2 2" />
      <polygon points={areaPoints} fill={color} fillOpacity="0.15" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.25} />
      <circle cx={x(clean.length - 1)} cy={y(last)} r={2} fill={color} />
    </svg>
  );
}

// StrikeLadder + maxOIStrike 已刪除(options-page-v2):RangeMapSvg
// (lib/options-range-svg.tsx)取代,牆改吃後端 oi_walls 權威值。
