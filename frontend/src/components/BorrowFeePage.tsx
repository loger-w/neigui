import { useMemo, useState, type ReactElement } from "react";
import { useDaytradeFee } from "../hooks/useDaytradeFee";
import { BorrowDayStatsTable } from "./BorrowDayStatsTable";
import { BorrowFeeStockFilter } from "./BorrowFeeStockFilter";
import { DaytradeFeeTable } from "./DaytradeFeeTable";
import { distinctStocks, formatShares, type StockOption } from "../lib/borrow-fee-utils";
import { cn } from "../lib/utils";

// 券差查詢 — 最上層「券差」mode 頁(App.tsx 4-way ternary + lazy)。
// root 用 flex-1 min-h-0(App root 是 flex col;h-full 會下溢 nav 高度被裁切)。
export function BorrowFeePage(): ReactElement {
  const { data, loading, error, refresh, noTradingDay } = useDaytradeFee();
  const [selectedStock, setSelectedStock] = useState<StockOption | null>(null);

  const stockOptions = useMemo(() => (data ? distinctStocks(data.rows) : []), [data]);
  const rows = data
    ? selectedStock
      ? data.rows.filter((r) => r.stock_id === selectedStock.stock_id)
      : data.rows
    : [];
  // 全集有無當日列(非篩選後)— 統計表 render 與空態高度基準的判準(SC-5)
  const hasDayRows = !!data && data.rows.length > 0;

  return (
    <div data-testid="borrow-fee-page" className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
        {data && (
          <div className="mt-3 max-w-xs">
            <BorrowFeeStockFilter
              options={stockOptions}
              selected={selectedStock}
              onSelect={setSelectedStock}
              onClear={() => setSelectedStock(null)}
            />
          </div>
        )}
        {/* 選股加總 summary(borrow-fee-totals SC-2/3):本日 = 該股 as_of 列前端
            相加(同日多筆合計);本月 = payload month_shares(缺 key 顯「—」,
            次數段一併不 render — ?? 1 fallback 會捏造次數,design R1)。
            edge(partial tpex 低估):沿用既有 partial badge,此處刻意不加註。
            數字用 ink 階層 — 資料非互動態,禁 accent(色彩語意鐵則)。 */}
        {data && selectedStock && (() => {
          const dayTotal = rows.reduce((s, r) => s + r.lending_shares, 0);
          const monthTotal = data.month_shares?.[selectedStock.stock_id] ?? null;
          // 次數綁定累計非 null(Phase 4 F1):month_shares 整缺(版本 skew)時
          // month_counts 是舊欄位仍在,「—(N 次)」是數字與次數矛盾的畫面。
          const monthCount =
            monthTotal !== null
              ? data.month_counts?.[selectedStock.stock_id] ?? null
              : null;
          return (
            <p
              data-testid="borrow-fee-stock-summary"
              className="mt-2 text-sm text-ink-muted"
            >
              本日標借合計{" "}
              <span className="text-ink font-medium tabular-nums">
                {formatShares(dayTotal)}
              </span>{" "}
              股<span className="mx-1.5 text-ink-dim">·</span>本月累計{" "}
              <span className="text-ink font-medium tabular-nums">
                {monthTotal !== null ? formatShares(monthTotal) : "—"}
              </span>
              {monthTotal !== null && " 股"}
              {monthCount !== null && (
                <span className="ml-1 text-ink-dim">({monthCount} 次)</span>
              )}
            </p>
          );
        })()}
      </header>

      {error && (
        <div className="shrink-0 px-6 py-2 text-sm text-accent bg-accent/[0.06] border-b border-line">
          {error}
        </div>
      )}

      {/* 分欄(mod/borrow-fee-layout):≥lg 左明細 / 右統計各自獨立捲動,<lg 堆疊
          單一捲動(明細先)。統計表吃全集 data.rows — 不受單檔篩選影響(SC-3),
          全集空才整個不 render(SC-5)。 */}
      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:flex lg:gap-x-6 px-4 sm:px-6 py-3">
        <div className={cn("lg:flex-1 lg:min-w-0 lg:overflow-y-auto", !hasDayRows && "h-full")}>
          {data && rows.length > 0 ? (
            <div className="max-w-4xl">
              <DaytradeFeeTable rows={rows} monthCounts={data.month_counts} />
            </div>
          ) : (
            <div
              className={cn(
                "flex items-center justify-center text-sm text-ink-dim",
                // 統計表並存時 <lg 堆疊流高度為 auto,h-full 失去基準 → min-h 置中;
                // ≥lg 左欄 flex stretch 高度明確,恢復 h-full 整欄置中(review F1)
                hasDayRows ? "min-h-40 lg:min-h-0 lg:h-full" : "h-full",
              )}
            >
              {loading
                ? "載入中..."
                : error
                  ? ""
                  : data && selectedStock
                    ? "該檔今日無券差資料"
                    : "本月無券差資料"}
            </div>
          )}
        </div>
        {hasDayRows && data && (
          <aside className="mt-6 lg:mt-0 lg:w-72 lg:shrink-0 lg:overflow-y-auto">
            <BorrowDayStatsTable rows={data.rows} />
          </aside>
        )}
      </div>
    </div>
  );
}
