import { useMemo, type ReactElement } from "react";
import type { BorrowFeeRow } from "../lib/borrow-fee";
import { aggregateDayStats, formatLots } from "../lib/borrow-fee-utils";
import { cn } from "../lib/utils";

interface Props {
  rows: BorrowFeeRow[];
  /** 列點擊 → 設定單檔篩選(等同 combobox 選定;polish SC-3)。 */
  onPickStock?: (stockId: string) => void;
}

// 本日借券統計(mod/borrow-fee-layout):當日全集 per-stock 加總,張數 desc
// 固定排序;免搜尋常駐 overview,不受單檔篩選影響(rows 一律傳全集)。
// 數字用 ink 階層 — 資料非互動態,禁 accent(色彩語意鐵則)。
export function BorrowDayStatsTable({ rows, onPickStock }: Props): ReactElement {
  const stats = useMemo(() => aggregateDayStats(rows), [rows]);

  return (
    <section data-testid="borrow-day-stats">
      <div className="flex items-baseline justify-between gap-2 pb-2 border-b border-line-strong">
        <h2 className="text-sm text-ink font-medium">本日借券統計</h2>
        <span className="text-xs text-ink-dim">單位:張</span>
      </div>
      <table className="w-full text-sm tabular-nums border-collapse">
        <thead>
          <tr className="border-b border-line text-ink-dim">
            <th scope="col" className="py-1.5 pr-2 font-normal text-left">代號</th>
            <th scope="col" className="py-1.5 px-2 font-normal text-left">名稱</th>
            <th scope="col" className="py-1.5 pl-2 font-normal text-right">張數</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr
              key={s.stock_id}
              data-testid="day-stat-row"
              data-stock-id={s.stock_id}
              // 互動 affordance 綁 handler 存在(review BF-P2-1):唯讀 caller
              // 不該看到可點樣式 / 吃掉 Space
              tabIndex={onPickStock ? 0 : undefined}
              aria-label={onPickStock ? `篩選 ${s.stock_id} ${s.name}` : undefined}
              onClick={onPickStock ? () => onPickStock(s.stock_id) : undefined}
              onKeyDown={
                onPickStock
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        // Space 預設捲動頁面 — 統計欄本身 overflow-y-auto,
                        // 不擋會選股同時跳捲(spec R2)
                        e.preventDefault();
                        onPickStock(s.stock_id);
                      }
                    }
                  : undefined
              }
              className={cn(
                "border-b border-line transition-colors",
                onPickStock &&
                  "cursor-pointer hover:bg-line-strong/30 focus-visible:bg-line-strong/30",
              )}
            >
              <td className="py-1.5 pr-2 text-ink font-medium">{s.stock_id}</td>
              <td className="py-1.5 px-2 text-ink-muted">{s.name}</td>
              <td className="py-1.5 pl-2 text-right text-ink">
                {formatLots(s.total_shares)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
