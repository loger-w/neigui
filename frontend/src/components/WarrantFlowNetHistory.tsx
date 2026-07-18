import { useRef } from "react";
import { useWarrantFlowHistory } from "../hooks/useWarrantFlowHistory";
import { useContainerSize } from "../hooks/useContainerSize";
import { computeNetHistoryChart } from "../lib/warrant-flow-history-svg";

// 外部淨額時序區塊(design warrant-flow-net-history v3 §3.5):
// summary 級認購/認售雙線,中性線型區分(ink 實線 / ink-muted 虛線)+ 零軸 —
// 線的 series 身分 ≠ 方向,不套 bull/bear;方向由零軸上下位置表達(SC-7)。
// null 日斷點不補 0(SC-4);缺日走「已累積 N/20 日」+ 補建 CTA(SC-5,
// backfill ≤3 缺日/次,api 層 divergence 註解)。

const CHART_H = 160;
const MIN_WIDTH = 320;

export function WarrantFlowNetHistory({ symbol, active }: { symbol: string; active: boolean }) {
  const { data, loading, error, refresh } = useWarrantFlowHistory(symbol, active);
  // 恆存 wrapper(loading / error / data 三態都 mount)— useContainerSize
  // null-ref early-return 陷阱(frontend-conventions)
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width } = useContainerSize(wrapRef);

  if (!symbol || data?.empty_reason === "no_warrants") return null;

  const chartW = Math.min(width, 900);
  const geom =
    data && width >= MIN_WIDTH ? computeNetHistoryChart(data.days, chartW, CHART_H) : null;

  return (
    <div
      ref={wrapRef}
      data-testid="flow-net-history"
      className="px-4 py-3 border-b border-line"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-ink-dim">外部淨額時序(近 {data?.window ?? 20} 交易日)</span>
        {data && data.missing_count > 0 && (
          <>
            <span className="text-ink-dim tabular-nums">
              已累積 {data.built}/{data.window} 日
            </span>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              aria-label="補建缺日"
              className="px-2 py-0.5 pointer-coarse:min-h-11 border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 transition-colors cursor-pointer"
            >
              補建缺日
            </button>
          </>
        )}
        {geom && (
          <span className="ml-auto inline-flex items-center gap-3 text-[0.7rem] text-ink-dim">
            <LegendItem label="認購" className="text-ink" dash={undefined} />
            <LegendItem label="認售" className="text-ink-muted" dash="4 3" />
          </span>
        )}
      </div>

      {error ? (
        <div className="mt-2 text-xs text-accent">{error}</div>
      ) : geom ? (
        <svg
          data-testid="flow-net-history-chart"
          width={chartW}
          viewBox={`0 0 ${chartW} ${CHART_H}`}
          height={CHART_H}
          role="img"
          aria-label="認購與認售外部淨額近二十交易日走勢"
          className="mt-2 block"
        >
          {/* 零軸(方向分界) */}
          <line
            x1={0}
            x2={chartW}
            y1={geom.zeroY}
            y2={geom.zeroY}
            stroke="currentColor"
            strokeWidth={1}
            className="text-line-strong"
          />
          {geom.yTicks.map((t) => (
            <text
              key={`y${t.y}`}
              x={2}
              y={t.y + 3}
              fontSize={10}
              fill="currentColor"
              className="text-ink-dim"
            >
              {t.label}
            </text>
          ))}
          {geom.xTicks.map((t) => (
            <text
              key={`x${t.x}`}
              x={t.x}
              y={CHART_H - 4}
              fontSize={10}
              textAnchor="middle"
              fill="currentColor"
              className="text-ink-dim"
            >
              {t.label}
            </text>
          ))}
          <Series segments={geom.callSegments} testId="net-history-call-seg" className="text-ink" />
          <Series
            segments={geom.putSegments}
            testId="net-history-put-seg"
            className="text-ink-muted"
            dash="4 3"
          />
        </svg>
      ) : (
        <div className="mt-2 text-xs text-ink-dim">
          {data
            ? loading
              ? "補建中..."
              : `資料累積中(已累積 ${data.built}/${data.window} 日)— 每日檢視自動累積,或按補建缺日`
            : loading
              ? "載入中..."
              : null}
        </div>
      )}
    </div>
  );
}

function Series({
  segments,
  testId,
  className,
  dash,
}: {
  segments: { x: number; y: number }[][];
  testId: string;
  className: string;
  dash?: string;
}) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.length === 1 && seg[0] ? (
          <circle
            key={i}
            data-testid={testId}
            cx={seg[0].x}
            cy={seg[0].y}
            r={2.5}
            fill="currentColor"
            className={className}
          />
        ) : (
          <polyline
            key={i}
            data-testid={testId}
            points={seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray={dash}
            className={className}
          />
        ),
      )}
    </>
  );
}

function LegendItem({
  label,
  className,
  dash,
}: {
  label: string;
  className: string;
  dash?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden="true">
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={dash}
          className={className}
        />
      </svg>
      {label}
    </span>
  );
}

export default WarrantFlowNetHistory;
