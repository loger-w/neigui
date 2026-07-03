import type { ReactElement } from "react";
import type { OptionsStrikeVolume } from "./options-types";

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

// ---------------------------------------------------------------------------
// StrikeLadder — vertical strike axis high→low; Call bars right-anchored on
// the left half, Put bars left-anchored on the right half; optional spot
// anchor row inserted between the two strikes that straddle `spot`.
// ---------------------------------------------------------------------------

interface StrikeLadderProps {
  data: OptionsStrikeVolume;
  spot: number | null;
}

function fmtSigned(n: number): string {
  if (!n) return "0";
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${a.toLocaleString()}`;
  return n > 0 ? `+${s}` : `−${s}`;
}

/**
 * Strike with the largest OI on a side, or null if the side carries no
 * positive OI at all. This is the proxy for "Call Wall / Put Wall" — the
 * convention SpotGamma names and wantgoo/optree implement using max-OI
 * when gamma data is unavailable (research finding #2, 3-0 confirmed).
 */
function maxOIStrike(rows: ReadonlyArray<{ strike: number; oi: number }>): number | null {
  let best: { strike: number; oi: number } | null = null;
  for (const r of rows) {
    if (r.oi <= 0) continue;
    if (best === null || r.oi > best.oi) best = r;
  }
  return best ? best.strike : null;
}

export function StrikeLadder({ data, spot }: StrikeLadderProps): ReactElement {
  // Build a union of strikes from both call and put, then sort high→low.
  const allStrikes = new Set<number>([
    ...data.call.map((r) => r.strike),
    ...data.put.map((r) => r.strike),
  ]);
  const strikesDesc = Array.from(allStrikes).sort((a, b) => b - a);

  if (strikesDesc.length === 0) {
    return (
      <div
        data-testid="ladder-empty"
        className="h-full flex items-center justify-center text-ink-dim text-sm"
      >
        無成交量資料
      </div>
    );
  }

  const callByStrike = new Map(data.call.map((r) => [r.strike, r]));
  const putByStrike  = new Map(data.put.map((r) => [r.strike, r]));

  const callWallStrike = maxOIStrike(data.call);
  const putWallStrike  = maxOIStrike(data.put);

  const maxVol = Math.max(
    1,
    ...data.call.map((r) => r.volume),
    ...data.put.map((r) => r.volume),
  );

  // Compute spot insertion point: insert anchor row when cursor strike drops
  // below `spot` (since we iterate desc).
  const rows: Array<{ kind: "strike"; strike: number } | { kind: "spot" }> = [];
  let spotInserted = false;
  for (const k of strikesDesc) {
    if (
      !spotInserted && spot != null && k < spot &&
      // ensure spot is actually within the strike range (above lowest strike)
      spot < strikesDesc[0]! + 1
    ) {
      rows.push({ kind: "spot" });
      spotInserted = true;
    }
    rows.push({ kind: "strike", strike: k });
  }
  // Edge case: spot above the highest strike → insert at very top
  if (!spotInserted && spot != null && spot >= strikesDesc[0]!) {
    rows.unshift({ kind: "spot" });
  }

  return (
    <div className="h-full overflow-y-auto font-variant-numeric tabular-nums">
      <table className="w-full">
        <colgroup>
          <col style={{ width: "calc(50% - 60px)" }} />
          <col style={{ width: "120px" }} />
          <col style={{ width: "calc(50% - 60px)" }} />
        </colgroup>
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="text-[0.625rem] text-ink-dim uppercase tracking-wide border-b border-line">
            <th className="px-3 py-1 text-right">Call vol / OI±</th>
            <th className="px-3 py-1 text-center">Strike</th>
            <th className="px-3 py-1 text-left">vol / OI± Put</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "spot") {
              return (
                <tr
                  key="spot-row"
                  data-testid="ladder-row"
                  className="border-y border-accent bg-accent/[0.04]"
                  style={{ height: "26px" }}
                >
                  <td />
                  <td
                    data-testid="ladder-spot"
                    className="text-center text-accent font-semibold"
                  >
                    {(spot as number).toLocaleString()} ← 現價
                  </td>
                  <td />
                </tr>
              );
            }
            const c = callByStrike.get(row.strike);
            const p = putByStrike.get(row.strike);
            const cw = c ? (c.volume / maxVol) * 100 : 0;
            const pw = p ? (p.volume / maxVol) * 100 : 0;
            const isCallWall = callWallStrike !== null && row.strike === callWallStrike;
            const isPutWall  = putWallStrike  !== null && row.strike === putWallStrike;
            const wallTag = isCallWall && isPutWall ? "both"
                          : isCallWall ? "call"
                          : isPutWall ? "put"
                          : undefined;
            const strikeClass = isCallWall && isPutWall
              ? "text-center text-[0.8125rem] font-bold text-accent"
              : isCallWall
              ? "text-center text-[0.8125rem] font-bold text-[var(--color-up,#dc2626)]"
              : isPutWall
              ? "text-center text-[0.8125rem] font-bold text-[var(--color-down,#16a34a)]"
              : "text-center text-[0.8125rem] text-ink";
            return (
              <tr
                key={`s-${row.strike}`}
                data-testid="ladder-row"
                data-wall={wallTag}
                data-wall-call={isCallWall ? "true" : undefined}
                data-wall-put={isPutWall ? "true" : undefined}
                className="border-b border-line/40"
                style={{ height: "22px" }}
              >
                <td className="relative pr-3 text-right">
                  {c ? (
                    <>
                      <span
                        className="absolute inset-y-1 right-0 bg-[var(--color-up,#dc2626)] opacity-60"
                        style={{ width: `${cw}%` }}
                      />
                      <span className="relative text-[0.6875rem] text-ink z-10">
                        {c.volume.toLocaleString()}
                        <span
                          className={`ml-1 text-[0.625rem] px-1 rounded ${
                            c.oi_change >= 0
                              ? "bg-[var(--color-up,#dc2626)]/25 text-red-300"
                              : "bg-[var(--color-down,#16a34a)]/25 text-green-300"
                          }`}
                        >
                          {fmtSigned(c.oi_change)}
                        </span>
                      </span>
                    </>
                  ) : null}
                </td>
                <td
                  data-testid="ladder-strike"
                  className={strikeClass}
                >
                  {row.strike.toLocaleString()}
                </td>
                <td className="relative pl-3 text-left">
                  {p ? (
                    <>
                      <span
                        className="absolute inset-y-1 left-0 bg-[var(--color-down,#16a34a)] opacity-60"
                        style={{ width: `${pw}%` }}
                      />
                      <span className="relative text-[0.6875rem] text-ink z-10">
                        {p.volume.toLocaleString()}
                        <span
                          className={`ml-1 text-[0.625rem] px-1 rounded ${
                            p.oi_change >= 0
                              ? "bg-[var(--color-up,#dc2626)]/25 text-red-300"
                              : "bg-[var(--color-down,#16a34a)]/25 text-green-300"
                          }`}
                        >
                          {fmtSigned(p.oi_change)}
                        </span>
                      </span>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
