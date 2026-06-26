import type { ReactElement } from "react";
import type { OptionsPCR, PCRRegion } from "../lib/options-types";

interface Props {
  data: OptionsPCR | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

// design v4 §7 reflexivity hedge: PCR card 不能出現「做多/做空/賣選/滿倉」字眼。
// 我們 only present 統計事實:當前 PCR + 分位 + region (透過視覺顏色) + 過去區間
// 報酬 stat,使用者自行判讀。

function regionClasses(region: PCRRegion): { chip: string; label: string } {
  // 台股慣例:bull=紅(up)、bear=綠(down)。high PCR region = "支撐方更多";
  // low region = "壓力方更多"。This is descriptive, not directional copy.
  switch (region) {
    case "high":
      return { chip: "bg-bull/15 text-bull", label: "高分位" };
    case "low":
      return { chip: "bg-bear/15 text-bear", label: "低分位" };
    case "neutral":
      return { chip: "bg-ink/10 text-ink-muted", label: "中性" };
    default:
      return { chip: "bg-ink/5 text-ink-dim", label: "資料不足" };
  }
}

function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !isFinite(p)) return "—";
  return `${p.toFixed(digits)}%`;
}

function fmtRatio(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || !isFinite(p)) return "—";
  return (p * 100).toFixed(digits) + "%";
}

export function OptionsPCRCard({
  data, loading, error, onRefresh,
}: Props): ReactElement {
  return (
    <div className="rounded-lg border border-line bg-bg-deep/50 p-4 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-muted">未平倉 PCR</h3>
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
      ) : (() => {
        const r = regionClasses(data.current.region);
        return (
          <>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold tabular-nums text-ink">
                {data.current.pcr.toFixed(2)}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${r.chip}`}>
                {r.label}
              </span>
            </div>
            {/* F3 修: drop hardcoded "90 日" — backend default lookback = 250.
                Show generic "歷史分位 P{n}" instead. */}
            <div className="text-xs text-ink-dim mt-1">
              歷史分位 P
              <span className="tabular-nums text-ink mx-1">
                {data.current.percentile.toFixed(0)}
              </span>
              · 門檻 P{data.current.thresholds.high_pct}/P{data.current.thresholds.low_pct}
            </div>

            {data.next_day_stats ? (
              <div className="mt-3 pt-3 border-t border-line/60">
                <div className="text-xs text-ink-dim mb-1">
                  各分位區次日 TX 報酬 (歷史)
                </div>
                <table className="text-xs w-full">
                  <thead className="text-ink-dim">
                    <tr>
                      <th className="text-left font-normal">區間</th>
                      <th className="text-right font-normal">均值</th>
                      <th className="text-right font-normal">標差</th>
                      <th className="text-right font-normal">正報酬率</th>
                      <th className="text-right font-normal">N</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {(["high", "neutral", "low"] as const).map((k) => {
                      const stats = data.next_day_stats![`${k}_region`];
                      return (
                        <tr key={k}>
                          <td className="text-ink-muted">
                            {regionClasses(k).label}
                          </td>
                          <td className="text-right">{fmtPct(stats.mean_pct, 2)}</td>
                          <td className="text-right">{fmtPct(stats.std_pct, 2)}</td>
                          <td className="text-right">{fmtRatio(stats.hit_positive)}</td>
                          <td className="text-right text-ink-dim">{stats.samples}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 text-xs text-ink-dim italic">
                {data.insufficient_data?.reason === "tx_returns_not_fetched_in_mvp"
                  ? "次日報酬統計尚未啟用"
                  : "資料不足"}
              </div>
            )}

            {data.data_quality_warnings.length > 0 && (
              <ul
                className="mt-2 text-[10px] text-ink-dim space-y-0.5"
                data-testid="warnings"
              >
                {data.data_quality_warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </>
        );
      })()}
    </div>
  );
}
