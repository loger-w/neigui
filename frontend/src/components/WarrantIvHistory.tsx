import { useMemo, useRef } from "react";
import { useWarrantIvHistory } from "../hooks/useWarrantIvHistory";
import { useContainerSize } from "../hooks/useContainerSize";
import { computeIvHistoryChart, computeIvPercentile } from "../lib/warrant-iv-svg";
import type { WarrantIvDrift } from "../lib/warrant-data";

// 展開列 IV 歷史重設計(warrant-iv-redesign):上下雙 panel 共 x 軸(上 IV %、
// 下標的收盤)+ 位階摘要列。中性呈現:全 ink 色階零紅綠,線型區分(實/虛/點/
// 細直線);文案只陳述統計事實。圖寬吃滿表格(useContainerSize,ref 掛恆存 wrapper)。

const MIN_WIDTH = 320;

const DRIFT_LABEL: Record<string, string> = {
  declining: "長期遞減",
  rising: "長期遞增",
  stable: "平穩",
  insufficient: "樣本不足",
};

/** drift 顯示規則(change-spec R2):斜率片段僅 declining/rising 且 slope_bid 非 null。 */
function driftSummaryText(drift: WarrantIvDrift): string {
  const label = DRIFT_LABEL[drift.label] ?? drift.label;
  const directional = drift.label === "declining" || drift.label === "rising";
  const slopePart =
    directional && drift.slope_bid != null
      ? ` · 斜率 ${drift.slope_bid * 100 >= 0 ? "+" : ""}${(drift.slope_bid * 100).toFixed(2)} pp/日`
      : "";
  return `${label}${slopePart} · 有效樣本 ${drift.n_valid} 日`;
}

function lastNonNull(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v;
  }
  return null;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-ink-dim">{label}</span>
      <span className="text-ink tabular-nums">{value}</span>
    </span>
  );
}

function LegendItem({
  label,
  className,
  strokeWidth,
  dash,
}: {
  label: string;
  className: string;
  strokeWidth: string;
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
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          className={className}
        />
      </svg>
      {label}
    </span>
  );
}

function AxisTicks({
  ticks,
  keyPrefix,
  padLeft,
  xEnd,
}: {
  ticks: { y: number; label: string }[];
  keyPrefix: string;
  padLeft: number;
  xEnd: number;
}) {
  return (
    <>
      {ticks.map((t) => (
        <g key={`${keyPrefix}${t.y}`}>
          <line
            x1={padLeft}
            y1={t.y}
            x2={xEnd}
            y2={t.y}
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-line"
          />
          <text
            x={padLeft - 4}
            y={t.y + 3}
            textAnchor="end"
            fontSize="0.5625rem"
            fill="currentColor"
            className="text-ink-dim"
          >
            {t.label}
          </text>
        </g>
      ))}
    </>
  );
}

export function WarrantIvHistory({
  warrantId,
  ivPercentile,
}: {
  warrantId: string;
  ivPercentile?: number | null;
}) {
  const { data, loading, error } = useWarrantIvHistory(warrantId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width: cw } = useContainerSize(wrapRef);
  const width = Math.max(MIN_WIDTH, cw);

  const drift = data?.drift ?? null;
  const trendSlope =
    drift && (drift.label === "declining" || drift.label === "rising")
      ? drift.slope_bid
      : null;

  const geom = useMemo(
    () => (data ? computeIvHistoryChart(data.series, width, trendSlope) : null),
    [data, width, trendSlope],
  );
  const selfPercentile = useMemo(
    () => (data ? computeIvPercentile(data.series) : null),
    [data],
  );

  const latestBid = data ? lastNonNull(data.series.map((p) => p.iv_bid)) : null;
  const latestHv = geom ? lastNonNull(geom.hv) : null;

  let body: React.ReactNode;
  if (loading && !data) {
    body = <span className="text-ink-dim">載入引波歷史...</span>;
  } else if (error) {
    body = <span className="text-accent">{error}</span>;
  } else if (!data || !geom) {
    body = <span className="text-ink-dim">無歷史引波資料</span>;
  } else {
    const hvDiff =
      latestBid != null && latestHv != null ? (latestBid - latestHv) * 100 : null;

    body = (
      <>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-dim">
          <span>買賣價反解引波(近 {data.series.length} 交易日)</span>
          <LegendItem label="買價IV" className="text-ink" strokeWidth="1.5" />
          <LegendItem label="賣價IV" className="text-ink-muted" strokeWidth="1.5" dash="4 3" />
          <LegendItem label="HV20(標的)" className="text-ink-dim" strokeWidth="1.25" dash="1.5 3" />
          <LegendItem label="標的收盤" className="text-ink-muted" strokeWidth="1.25" />
        </div>
        <div
          data-testid="warrant-iv-summary"
          className="flex flex-wrap items-center gap-x-5 gap-y-1"
        >
          <SummaryItem
            label="最新買價IV"
            value={latestBid != null ? `${(latestBid * 100).toFixed(1)}%` : "—"}
          />
          <SummaryItem
            label="自身60日位階"
            value={selfPercentile != null ? `P${Math.round(selfPercentile)}` : "—"}
          />
          <SummaryItem
            label="同標的位階"
            value={ivPercentile != null ? `P${Math.round(ivPercentile)}` : "—"}
          />
          {hvDiff != null && (
            <SummaryItem
              label="vs HV20"
              value={`${hvDiff >= 0 ? "+" : ""}${hvDiff.toFixed(1)} pp`}
            />
          )}
          {drift && <SummaryItem label="IV趨勢" value={driftSummaryText(drift)} />}
        </div>
        <svg
          data-testid="warrant-iv-chart"
          width={geom.width}
          height={geom.height}
          viewBox={`0 0 ${geom.width} ${geom.height}`}
          role="img"
          aria-label="買賣價反解引波與標的收盤時序圖"
          className="max-w-full"
        >
          <AxisTicks
            ticks={geom.ivPanel.yTicks}
            keyPrefix="ivy"
            padLeft={geom.pad.left}
            xEnd={geom.width - geom.pad.right}
          />
          <AxisTicks
            ticks={geom.pricePanel.yTicks}
            keyPrefix="py"
            padLeft={geom.pad.left}
            xEnd={geom.width - geom.pad.right}
          />
          {geom.xTicks.map((t, i) => (
            <text
              key={`x${t.x}`}
              x={t.x}
              y={geom.height - 5}
              // 末 tick 靠右對齊,置中會超出 svg 右緣被裁(real-env 實測)
              textAnchor={i === geom.xTicks.length - 1 ? "end" : "middle"}
              fontSize="0.5625rem"
              fill="currentColor"
              className="text-ink-dim"
            >
              {t.label}
            </text>
          ))}
          {geom.ivPanel.hvPath && (
            <path
              data-series="hv20"
              d={geom.ivPanel.hvPath}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="1.5 3"
              className="text-ink-dim"
            />
          )}
          {geom.ivPanel.trendPath && (
            <path
              data-series="trend"
              d={geom.ivPanel.trendPath}
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.7"
              className="text-ink-dim"
            />
          )}
          <path
            data-side="bid"
            d={geom.ivPanel.bidPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-ink"
          />
          <path
            data-side="ask"
            d={geom.ivPanel.askPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            className="text-ink-muted"
          />
          {geom.pricePanel.pricePath && (
            <path
              data-series="price"
              d={geom.pricePanel.pricePath}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              className="text-ink-muted"
            />
          )}
        </svg>
        {data.terms_approx_dates.length > 0 && (
          <div className="text-ink-dim">歷史 IV 以現行條款近似</div>
        )}
      </>
    );
  }

  return (
    <div ref={wrapRef} className="space-y-1.5">
      {body}
    </div>
  );
}
