import type { ReactElement } from "react";
import type { OptionsOIWalls } from "../lib/options-types";
import { fmtPct } from "../lib/options-format";

interface Props {
  data: OptionsOIWalls | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function OptionsOIWallsCard({
  data, loading, error, onRefresh,
}: Props): ReactElement {
  return (
    <div data-testid="options-oi-walls-card" className="rounded-lg border border-line bg-bg-deep/50 p-4 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-muted">OI 牆</h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-ink-dim hover:text-ink disabled:opacity-50"
          aria-label="重新整理"
        >
          {loading ? "載入中…" : "重新整理"}
        </button>
      </div>

      {error ? (
        <div className="text-bear text-sm">指標載入失敗:{error}</div>
      ) : data === null ? (
        <div className="text-ink-dim text-sm">{loading ? "載入中…" : "無資料"}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              {/* F2 修: 壓力 (resistance, bearish for further upside) → bear/green */}
              <div className="text-xs text-ink-dim mb-1">Call Wall (壓力)</div>
              <div data-testid="call-wall" className="tabular-nums text-bear font-medium">
                {data.current.static_call_wall?.strike ?? "—"}
              </div>
              {data.current.dynamic_call_wall && (
                <div className="text-[0.6875rem] text-ink-dim mt-0.5">
                  動態 <span className="tabular-nums">{data.current.dynamic_call_wall.strike}</span>
                  {data.current.dynamic_call_wall.partial_window && " *"}
                </div>
              )}
            </div>
            <div>
              {/* F2 修: 支撐 (support, bullish floor) → bull/red */}
              <div className="text-xs text-ink-dim mb-1">Put Wall (支撐)</div>
              <div data-testid="put-wall" className="tabular-nums text-bull font-medium">
                {data.current.static_put_wall?.strike ?? "—"}
              </div>
              {data.current.dynamic_put_wall && (
                <div className="text-[0.6875rem] text-ink-dim mt-0.5">
                  動態 <span className="tabular-nums">{data.current.dynamic_put_wall.strike}</span>
                  {data.current.dynamic_put_wall.partial_window && " *"}
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-ink-dim mt-2">
            區間寬度 <span className="tabular-nums text-ink">{fmtPct(data.current.band_width_pct)}</span>
          </div>

          {data.hit_rate ? (
            <div className="mt-3 pt-3 border-t border-line/60">
              <div className="text-xs text-ink-dim mb-1">
                過去 {data.hit_rate.samples} 期 結算落於牆區比例
                {/* CR3 / design R13:剔除樣本數透明化(T-1 close 缺或側別無候選) */}
                {data.hit_rate.dropped_no_close > 0 &&
                  `(剔除 ${data.hit_rate.dropped_no_close} 期資料不全)`}
              </div>
              <div className="flex gap-3 text-xs">
                <span className="tabular-nums text-ink">
                  {(data.hit_rate.pct_settled_inside_band * 100).toFixed(0)}%
                </span>
                <span className="text-ink-dim">
                  平均寬度 {fmtPct(data.hit_rate.avg_band_width_pct)}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-ink-dim italic">
              歷史命中率尚未啟用
            </div>
          )}

          {(data.current.data_quality_warnings.length > 0 ||
            data.data_quality_warnings.length > 0) && (
            <ul
              className="mt-2 text-[0.625rem] text-ink-dim space-y-0.5"
              data-testid="warnings"
            >
              {[
                ...data.current.data_quality_warnings,
                ...data.data_quality_warnings,
              ].map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
