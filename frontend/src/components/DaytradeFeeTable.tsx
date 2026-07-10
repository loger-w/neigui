import { useState, type ReactElement } from "react";
import { FEE_HIGHLIGHT_THRESHOLD, type BorrowFeeRow } from "../lib/borrow-fee";
import {
  formatFee,
  formatShares,
  sortRows,
  type SortDir,
  type SortKey,
} from "../lib/borrow-fee-utils";
import { cn } from "../lib/utils";

interface Props {
  rows: BorrowFeeRow[];
  monthCounts: Record<string, number>;
}

interface Column {
  key: SortKey | null;
  label: string;
  align: "left" | "right";
}

const COLUMNS: Column[] = [
  { key: null, label: "市場", align: "left" },
  { key: "stock_id", label: "代號", align: "left" },
  { key: null, label: "名稱", align: "left" },
  { key: "lending_shares", label: "借券股數", align: "right" },
  { key: "fee_rate", label: "借券費率", align: "right" },
  { key: "month_count", label: "本月次數", align: "right" },
];

export function DaytradeFeeTable({ rows, monthCounts }: Props): ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>("fee_rate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = sortRows(rows, sortKey, sortDir, monthCounts);

  return (
    <table className="w-full text-sm tabular-nums border-collapse">
      <thead>
        <tr className="border-b border-line-strong text-ink-dim">
          {COLUMNS.map(({ key, label, align }) => (
            <th
              key={label}
              scope="col"
              aria-sort={
                key === sortKey
                  ? sortDir === "desc" ? "descending" : "ascending"
                  : undefined
              }
              className={cn(
                "py-2 px-2 font-normal whitespace-nowrap",
                align === "right" ? "text-right" : "text-left",
              )}
            >
              {key ? (
                <button
                  type="button"
                  onClick={() => handleSort(key)}
                  className={cn(
                    "inline-flex items-center gap-0.5 pointer-coarse:min-h-11 cursor-pointer transition-colors hover:text-ink",
                    key === sortKey && "text-accent",
                  )}
                >
                  {label}
                  {key === sortKey && (
                    <span aria-hidden="true" className="text-[0.625rem]">
                      {sortDir === "desc" ? "▼" : "▲"}
                    </span>
                  )}
                </button>
              ) : (
                label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => {
          const high = r.fee_rate >= FEE_HIGHLIGHT_THRESHOLD;
          return (
            <tr
              key={`${r.stock_id}-${i}`}
              data-testid="fee-row"
              data-stock-id={r.stock_id}
              className="border-b border-line"
            >
              <td className="py-1.5 px-2">
                <span className="inline-block px-1.5 py-0.5 text-xs border border-line text-ink-muted">
                  {r.market === "twse" ? "上市" : "上櫃"}
                </span>
              </td>
              <td className="py-1.5 px-2 text-ink font-medium">{r.stock_id}</td>
              <td className="py-1.5 px-2 text-ink-muted">{r.name}</td>
              <td className="py-1.5 px-2 text-right text-ink">
                {formatShares(r.lending_shares)}
              </td>
              <td
                data-testid={high ? "fee-high" : undefined}
                className={cn(
                  "py-1.5 px-2 text-right",
                  high ? "text-accent font-medium" : "text-ink",
                )}
              >
                {formatFee(r.fee_rate)}
              </td>
              <td className="py-1.5 px-2 text-right text-ink-muted">
                {monthCounts[r.stock_id] ?? 1}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
