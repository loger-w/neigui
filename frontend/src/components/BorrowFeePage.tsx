import type { ReactElement } from "react";
import { useDaytradeFee } from "../hooks/useDaytradeFee";
import { DaytradeFeeTable } from "./DaytradeFeeTable";

// 券差查詢 — 最上層「券差」mode 頁(App.tsx 4-way ternary + lazy)。
// root 用 flex-1 min-h-0(App root 是 flex col;h-full 會下溢 nav 高度被裁切)。
export function BorrowFeePage(): ReactElement {
  const { data, loading, error, refresh, noTradingDay } = useDaytradeFee();

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <header className="shrink-0 px-4 sm:px-6 pt-5 pb-3 border-b border-line">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl text-ink font-semibold shrink-0">券差查詢</h1>
          {data && (
            <span className="text-sm text-ink-muted">
              資料日 {data.as_of_date}
            </span>
          )}
          {noTradingDay && (
            <span className="px-1.5 py-0.5 text-xs border border-line text-ink-dim">
              非交易日,顯示最近可得日
            </span>
          )}
          {data?.partial?.includes("tpex") && (
            <span className="px-1.5 py-0.5 text-xs border border-line text-ink-dim">
              上櫃資料缺(來源僅提供當月)
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label={loading ? "資料載入中" : "重新整理"}
            aria-busy={loading || undefined}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 pointer-coarse:min-h-11 text-sm border border-line text-ink-muted hover:text-ink hover:border-accent disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
          >
            {loading && (
              <svg
                data-testid="refresh-spinner"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="size-3.5 animate-spin text-accent motion-reduce:animate-none"
              >
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            重新整理
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-dim">
          證交所 / 櫃買中心標借公告之現股當日沖銷券差借券費率;法定上限 7%。
        </p>
      </header>

      {error && (
        <div className="shrink-0 px-6 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-3">
        {data && data.rows.length > 0 ? (
          <div className="max-w-4xl">
            <DaytradeFeeTable rows={data.rows} monthCounts={data.month_counts} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-ink-dim">
            {loading ? "載入中..." : error ? "" : "本月無券差資料"}
          </div>
        )}
      </div>
    </div>
  );
}
