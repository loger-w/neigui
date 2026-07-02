import { useRef, type ReactElement } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { buildSegments, polylinePoints, sliceWindow, zeroLineY } from "../lib/breadth-svg";
import { eodLabel } from "../lib/market-format";
import type { Breadth } from "../lib/market-types";

type Props = { breadth: Breadth | null; eodAsOf: string | null; loaded: boolean };

type SignalSlotProps = {
  label: string;
  active: boolean;
  testid: string;
  value: string | null;
  tone: string;
};

// 槽位共用小元件(檔內 private,不 export)。inactive 槽不帶 testid,避免
// 測試靠「dot 存在」誤判 active(design brief R1-5)。
function SignalSlot({ label, active, testid, value, tone }: SignalSlotProps): ReactElement {
  return (
    <div className="flex items-center gap-1">
      <span className="text-ink-dim">{label}</span>
      {active ? (
        <span
          data-testid={testid}
          data-value={value}
          className={`inline-block w-2 h-2 rounded-full ${tone}`}
        />
      ) : (
        <span className="inline-block w-2 h-2 rounded-full border border-line" />
      )}
    </div>
  );
}

export function MarketBreadthPanel({ breadth, eodAsOf, loaded }: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(containerRef);
  const halfH = height / 2;

  let body: ReactElement;
  if (!loaded) {
    body = (
      <div data-state="loading" className="flex flex-col gap-2">
        <div className="h-24 animate-pulse bg-bg-deep" />
        <div className="h-24 animate-pulse bg-bg-deep" />
      </div>
    );
  } else if (breadth === null) {
    body = (
      <div data-state="unavailable" className="text-ink-dim text-xs">
        資料暫缺
      </div>
    );
  } else {
    const mcSeries = sliceWindow(breadth.mcclellan_series);
    const mcSegments = buildSegments(mcSeries, width, halfH, { includeZero: true });
    const mcZeroY = zeroLineY(mcSeries, halfH);
    const adSeries = sliceWindow(breadth.ad_line_series);
    const adSegments = buildSegments(adSeries, width, halfH, { includeZero: false });

    const taiexUnavailable = breadth.known_gaps.includes("taiex_unavailable");

    body = (
      <>
        <div ref={containerRef} className="h-64 lg:h-full lg:flex-1 min-h-0 relative flex flex-col">
          <div className="flex-1 min-h-0 relative">
            <svg width={width} height={halfH}>
              {mcZeroY !== null && (
                <line
                  x1={0}
                  x2={width}
                  y1={mcZeroY}
                  y2={mcZeroY}
                  stroke="var(--color-line-strong)"
                  strokeDasharray="4 3"
                />
              )}
              {mcSegments.map((seg, i) =>
                seg.pts.length === 1 ? (
                  <circle
                    key={i}
                    cx={seg.pts[0]!.x}
                    cy={seg.pts[0]!.y}
                    r={1.5}
                    fill="var(--color-ink)"
                  />
                ) : (
                  <polyline
                    key={i}
                    points={polylinePoints(seg)}
                    fill="none"
                    stroke="var(--color-ink)"
                    strokeWidth={1.2}
                  />
                ),
              )}
            </svg>
            <span className="absolute top-0 left-0 text-ink-dim text-[10px]">
              McClellan {breadth.mcclellan_oscillator?.toFixed(1) ?? "—"}
            </span>
          </div>
          <div className="flex-1 min-h-0 relative">
            <svg width={width} height={halfH}>
              {adSegments.map((seg, i) =>
                seg.pts.length === 1 ? (
                  <circle
                    key={i}
                    cx={seg.pts[0]!.x}
                    cy={seg.pts[0]!.y}
                    r={1.5}
                    fill="var(--color-ink-dim)"
                  />
                ) : (
                  <polyline
                    key={i}
                    points={polylinePoints(seg)}
                    fill="none"
                    stroke="var(--color-ink-dim)"
                    strokeWidth={1.2}
                  />
                ),
              )}
            </svg>
            <span className="absolute top-0 left-0 text-ink-dim text-[10px]">窗口相對累計</span>
          </div>
        </div>
        <div className="flex gap-4 text-xs mt-2">
          <SignalSlot
            label="±100"
            active={breadth.thrust_dot !== null}
            testid="breadth-thrust-dot"
            value={breadth.thrust_dot}
            tone="bg-accent"
          />
          <SignalSlot
            label="0 線"
            active={breadth.centerline_cross !== null}
            testid="breadth-centerline-dot"
            value={breadth.centerline_cross}
            tone="bg-ink"
          />
          {taiexUnavailable ? (
            <div className="flex items-center gap-1">
              <span className="text-ink-dim">背離</span>
              <span className="text-ink-dim">TAIEX 資料缺</span>
            </div>
          ) : (
            <SignalSlot
              label="背離"
              active={breadth.divergence_dot !== null}
              testid="breadth-divergence-dot"
              value={breadth.divergence_dot}
              tone="bg-ink-muted"
            />
          )}
        </div>
      </>
    );
  }

  return (
    <section
      data-testid="market-breadth-panel"
      className="flex flex-col min-h-0 border-r border-line p-3"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-ink text-sm">市場廣度</h3>
        <span className="text-ink-dim text-xs">{eodLabel(eodAsOf)}</span>
      </div>
      {body}
    </section>
  );
}
