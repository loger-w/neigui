import type { ReactElement } from "react";
import type { OptionsMaxPain } from "../lib/options-types";

interface Props {
  data: OptionsMaxPain | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

function fmtNTD(n: number): string {
  if (!isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("zh-TW", {
    style: "currency", currency: "TWD", maximumFractionDigits: 0,
  }).format(n);
}

export function OptionsMaxPainCard({
  data, loading, error, onRefresh,
}: Props): ReactElement {
  return (
    <div data-testid="options-max-pain-card" className="rounded-lg border border-line bg-bg-deep/50 p-4 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-muted">Max Pain</h3>
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
          <div className="text-3xl font-bold tabular-nums text-ink">
            {data.current.max_pain ?? "—"}
          </div>
          <div className="text-xs text-ink-dim mt-1">
            賣方總賠付:{fmtNTD(data.current.total_loss_ntd)}
          </div>
          <div className="text-xs text-ink-dim">
            履約價數 {data.current.strike_count}
            {data.current.strikes_with_call_oi_only > 0 && ` · call-only ${data.current.strikes_with_call_oi_only}`}
            {data.current.strikes_with_put_oi_only > 0 && ` · put-only ${data.current.strikes_with_put_oi_only}`}
          </div>

          {data.hit_rate ? (
            <div className="mt-3 pt-3 border-t border-line/60">
              <div className="text-xs text-ink-dim mb-1">
                過去 {data.hit_rate.samples} 期 結算與 T-1 Max Pain 乖離
              </div>
              <div className="flex gap-3 text-xs">
                <span>中位數 <span className="tabular-nums text-ink">{fmtPct(data.hit_rate.median_abs_deviation_pct)}</span></span>
                <span>±1% <span className="tabular-nums text-ink">{fmtPct(data.hit_rate.hit_within_1pct, 0)}</span></span>
                <span>±2% <span className="tabular-nums text-ink">{fmtPct(data.hit_rate.hit_within_2pct, 0)}</span></span>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-ink-dim italic">
              {data.insufficient_data?.reason === "no_settlements_fetched_in_mvp"
                ? "歷史命中率尚未啟用"
                : "歷史資料不足"}
            </div>
          )}

          {data.latest_settlement_pending && (
            <div className="mt-2 text-xs text-ink-dim">最近結算尚未公布</div>
          )}

          {data.data_quality_warnings.length > 0 && (
            <ul
              className="mt-2 text-[0.625rem] text-ink-dim space-y-0.5"
              data-testid="warnings"
            >
              {data.data_quality_warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
