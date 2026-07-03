import { useState, type ReactElement } from "react";
import type { OptionsInstitutional, InstitutionalSide } from "../lib/options-types";

interface Props {
  data: OptionsInstitutional | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return new Intl.NumberFormat("zh-TW").format(n);
}

function sideRow(label: string, side: InstitutionalSide, highlight = false): ReactElement {
  // bull/bear color binding per 台股慣例: red = positive (net buy), green = negative.
  const totalCls =
    side.total_net > 0 ? "text-bull"
      : side.total_net < 0 ? "text-bear" : "text-ink-dim";
  return (
    <div className={`flex items-baseline gap-3 ${highlight ? "font-semibold" : ""}`}>
      <span className={`text-xs ${highlight ? "text-ink" : "text-ink-muted"} w-10`}>
        {label}
      </span>
      <span className="text-xs text-ink-dim tabular-nums">
        C {fmtInt(side.call_net)}
      </span>
      <span className="text-xs text-ink-dim tabular-nums">
        P {fmtInt(side.put_net)}
      </span>
      <span className={`text-xs tabular-nums ml-auto ${totalCls}`}>
        {side.total_net > 0 ? "+" : ""}{fmtInt(side.total_net)}
      </span>
    </div>
  );
}

export function OptionsInstitutionalCard({
  data, loading, error, onRefresh,
}: Props): ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div data-testid="options-institutional-card" className="rounded-lg border border-line bg-bg-deep/50 p-4 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-muted">三大法人</h3>
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
          {/* 外資加粗 + bg highlight per 學術證據最強 (呂宗達 2018) */}
          <div className="rounded bg-accent/10 px-2 py-1 mb-1.5">
            {sideRow("外資", data.current.foreign, true)}
          </div>
          {sideRow("自營", data.current.dealer)}
          {sideRow("投信", data.current.trust)}

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-2 text-xs text-ink-dim hover:text-ink text-left"
          >
            {expanded ? "▼ 收起日夜盤" : "▶ 展開日夜盤"}
          </button>
          {/* CLAUDE.md §3: hidden attribute > conditional render */}
          <div hidden={!expanded} className="mt-2 pt-2 border-t border-line/60 text-xs text-ink-dim">
            <div>日盤:已合計於上方</div>
            <div>夜盤:
              {data.current.session_breakdown.after_hours === null
                ? "(2021-10-13 前無資料)"
                : "已合計於上方"}
            </div>
          </div>

          {data.correlation ? (
            <div className="mt-3 pt-3 border-t border-line/60">
              <div className="text-xs text-ink-dim mb-1">
                外資 Call Net vs 次日 TX 報酬 Spearman
              </div>
              <div className="flex gap-3 text-xs">
                <span className="tabular-nums text-ink">
                  r = {data.correlation.latest_corr.toFixed(2)}
                </span>
                <span className="tabular-nums text-ink-dim">
                  p = {data.correlation.latest_p_value.toFixed(3)}
                </span>
                <span className={
                  data.correlation.is_significant ? "text-bull" : "text-ink-dim opacity-50"
                }>
                  {data.correlation.is_significant ? "顯著" : "p > 0.10"}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-ink-dim italic">
              {data.insufficient_data?.reason === "correlation_history_not_wired_in_mvp"
                ? "歷史相關性尚未啟用"
                : "資料不足"}
            </div>
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
