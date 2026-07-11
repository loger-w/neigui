import { useMemo } from "react";
import { useWarrantIvHistory } from "../hooks/useWarrantIvHistory";
import { computeIvChart } from "../lib/warrant-iv-svg";

// 展開區 bid/ask IV 時序圖(SC-7)。中性呈現:ink 階兩線(bid 實線 / ask 虛線),
// 不用紅綠方向色;文案只陳述統計事實。
const CHART_W = 480;
const CHART_H = 140;

export function WarrantIvHistory({ warrantId }: { warrantId: string }) {
  const { data, loading, error } = useWarrantIvHistory(warrantId);
  const geom = useMemo(
    () => (data ? computeIvChart(data.series, CHART_W, CHART_H) : null),
    [data],
  );

  if (loading && !data) {
    return <span className="text-ink-dim">載入引波歷史...</span>;
  }
  if (error) {
    return <span className="text-accent">{error}</span>;
  }
  if (!data || !geom) {
    return <span className="text-ink-dim">無歷史引波資料</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-dim">
        <span>買賣價反解引波(近 {data.series.length} 交易日)</span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth="1.5" className="text-ink" />
          </svg>
          買價IV
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-ink-muted" />
          </svg>
          賣價IV
        </span>
      </div>
      <svg
        data-testid="warrant-iv-chart"
        width={CHART_W}
        height={CHART_H}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label="買賣價反解引波時序圖"
        className="max-w-full"
      >
        {geom.yTicks.map((t) => (
          <g key={`y${t.y}`}>
            <line
              x1={geom.pad.left}
              y1={t.y}
              x2={CHART_W - geom.pad.right}
              y2={t.y}
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-line"
            />
            <text
              x={geom.pad.left - 4}
              y={t.y + 3}
              textAnchor="end"
              fontSize="9"
              fill="currentColor"
              className="text-ink-dim"
            >
              {t.label}
            </text>
          </g>
        ))}
        {geom.xTicks.map((t) => (
          <text
            key={`x${t.x}`}
            x={t.x}
            y={CHART_H - 5}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            className="text-ink-dim"
          >
            {t.label}
          </text>
        ))}
        <path
          data-side="bid"
          d={geom.bidPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-ink"
        />
        <path
          data-side="ask"
          d={geom.askPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          className="text-ink-muted"
        />
      </svg>
      {data.terms_approx_dates.length > 0 && (
        <div className="text-ink-dim">歷史 IV 以現行條款近似</div>
      )}
    </div>
  );
}
