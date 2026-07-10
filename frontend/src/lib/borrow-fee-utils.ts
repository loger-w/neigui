// 券差表排序 / 格式化純函式(無 React 依賴,獨立單測)。

import type { BorrowFeeRow } from "./borrow-fee";

export type SortKey = "fee_rate" | "lending_shares" | "month_count" | "stock_id";
export type SortDir = "asc" | "desc";

export function sortRows(
  rows: BorrowFeeRow[],
  key: SortKey,
  dir: SortDir,
  monthCounts: Record<string, number>,
): BorrowFeeRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (r: BorrowFeeRow): number | string => {
    if (key === "month_count") return monthCounts[r.stock_id] ?? 1;
    if (key === "stock_id") return r.stock_id;
    return r[key];
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va !== vb) return va < vb ? -sign : sign;
    // tie-break:stock_id 升冪(排序方向無關,保持可預測)
    return a.stock_id < b.stock_id ? -1 : a.stock_id > b.stock_id ? 1 : 0;
  });
}

export function formatShares(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatFee(n: number): string {
  return `${n.toFixed(2)}%`;
}
